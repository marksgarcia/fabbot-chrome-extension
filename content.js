(function () {
  'use strict';

  const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
  const GEOCODE_DELAY_MS = 1100;
  const SUGGEST_DEBOUNCE_MS = 350;

  let locations = [];
  let cardsContainer = null;
  let originalContainerContent = null;
  let currentSort = 'name-asc';
  let currentFilter = '';
  let selectedUserCoords = null;
  let suggestDebounce = null;
  /** Min width captured when full list is shown; used so table doesn't shrink when filtering. */
  let capturedTableMinWidth = 0;

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function haversineMi(lat1, lon1, lat2, lon2) {
    const R = 3959;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  /** Free-form single result. Use countrycodes for US-only to avoid wrong-country matches. */
  async function geocode(query, options = {}) {
    const params = new URLSearchParams({
      q: query,
      format: 'json',
      limit: '1',
      addressdetails: '0',
    });
    if (options.countrycodes === 'us') params.set('countrycodes', 'us');
    const res = await fetch(`${NOMINATIM_URL}?${params}`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || !data[0]) return null;
    return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
  }

  /** Strip BLDG, SUITE, STE, UNIT, #num etc. from address line for better geocoding. */
  function cleanAddressForGeocode(addr) {
    if (!addr || !addr.trim()) return '';
    return addr
      .trim()
      .replace(/\s+(BLDG|BUILDING|STE|SUITE|UNIT|APT|#)\s*[\dA-Z-]*/gi, '')
      .replace(/\s+/g, ' ')
      .replace(/,\s*,/g, ',')
      .replace(/^\s*,|,\s*$/g, '')
      .trim();
  }

  /** Geocode one polling location: US-only, try full then cleaned then city+state+zip. */
  async function geocodeLocation(loc) {
    const q = (loc.fullAddress || '').trim();
    if (!q) return null;

    const withUs = (s) => (s.match(/\b(USA|US|U\.S\.)\b/i) ? s : s + ', USA');

    let result = await geocode(withUs(q), { countrycodes: 'us' });
    if (result) return result;

    const cleaned = cleanAddressForGeocode(q);
    if (cleaned && cleaned !== q) {
      result = await geocode(withUs(cleaned), { countrycodes: 'us' });
      if (result) return result;
    }

    if (loc.city || loc.state || loc.zip) {
      result = await geocodeStructured({
        street: loc.street ? cleanAddressForGeocode(loc.street) : '',
        city: loc.city,
        state: loc.state,
        postalcode: loc.zip,
      });
      if (result) return result;
    }

    const cityStateZip = [loc.city, loc.state, loc.zip].filter(Boolean).join(', ');
    if (cityStateZip) {
      result = await geocode(withUs(cityStateZip), { countrycodes: 'us' });
      if (result) return result;
    }

    if (loc.city && loc.state) {
      result = await geocode(withUs(`${loc.city}, ${loc.state}`), { countrycodes: 'us' });
      if (result) return result;
    }

    return null;
  }

  /** Structured US address (no q=). More reliable for street + city + state + zip. */
  async function geocodeStructured(opts) {
    const params = new URLSearchParams({
      format: 'json',
      limit: '1',
      addressdetails: '0',
      countrycodes: 'us',
    });
    if (opts.street && opts.street.trim()) params.set('street', opts.street.trim());
    if (opts.city && opts.city.trim()) params.set('city', opts.city.trim());
    if (opts.state && opts.state.trim()) params.set('state', opts.state.trim());
    if (opts.postalcode && opts.postalcode.trim()) params.set('postalcode', opts.postalcode.trim().replace(/\s+/g, ''));
    params.set('country', 'United States');
    const res = await fetch(`${NOMINATIM_URL}?${params}`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || !data[0]) return null;
    return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
  }

  /** Geocode user address: try structured first, then fallbacks (no street → city+state → zip → free-form). */
  async function geocodeUserAddress(street, city, state, zip) {
    const s = (v) => (v && v.trim()) || '';
    street = s(street);
    city = s(city);
    state = s(state);
    zip = s(zip);

    let result = await geocodeStructured({ street, city, state, postalcode: zip });
    if (result) return result;

    if (street) {
      result = await geocodeStructured({ city, state, postalcode: zip });
      if (result) return result;
    }

    const cityStateZip = [city, state, zip].filter(Boolean).join(', ');
    if (cityStateZip) {
      result = await geocode(cityStateZip + ', USA', { countrycodes: 'us' });
      if (result) return result;
    }
    if (city && state) {
      result = await geocode(`${city}, ${state}, USA`, { countrycodes: 'us' });
      if (result) return result;
    }
    if (zip) {
      result = await geocodeStructured({ postalcode: zip });
      if (result) return result;
    }
    const full = [street, city, state, zip].filter(Boolean).join(', ');
    if (full) return await geocode(full + (full.match(/\b(USA|US|U\.S\.)\b/i) ? '' : ', USA'), { countrycodes: 'us' });
    return null;
  }

  /** Multiple results for address suggestions (limit 5). */
  async function geocodeSuggestions(query) {
    if (!query || !query.trim()) return [];
    const params = new URLSearchParams({
      q: query.trim() + (query.match(/\b(USA|US|U\.S\.)\b/i) ? '' : ', USA'),
      format: 'json',
      limit: '5',
      addressdetails: '0',
      countrycodes: 'us',
    });
    const res = await fetch(`${NOMINATIM_URL}?${params}`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data) || !data.length) return [];
    return data.map((r) => ({
      display_name: r.display_name || '',
      lat: parseFloat(r.lat),
      lon: parseFloat(r.lon),
    }));
  }

  function parseCityStateZip(line2) {
    const s = (line2 || '').trim();
    const match = s.match(/^(.+?),\s*([A-Z]{2})\s*(\d{5}(-\d{4})?)?$/i);
    if (match) {
      return {
        city: match[1].trim(),
        state: match[2].trim().toUpperCase(),
        zip: (match[3] || '').trim(),
      };
    }
    if (/^[A-Z]{2}\s*\d{5}/i.test(s)) {
      const [state, ...zipParts] = s.split(/\s+/);
      return { city: '', state: state.toUpperCase(), zip: zipParts.join(' ') };
    }
    return { city: s, state: '', zip: '' };
  }

  function getCardHours(card) {
    const items = card.querySelectorAll('.mat-mdc-card-content ul li');
    const hours = [];
    items.forEach((li) => {
      const h3 = li.querySelector('h3');
      const div = li.querySelector('div');
      const date = h3 ? (h3.textContent || '').trim() : '';
      const time = div ? (div.textContent || '').trim() : '';
      if (date || time) hours.push({ date, time });
    });
    return hours;
  }

  function parseCard(card) {
    const content = card.querySelector('.mat-mdc-card-content');
    if (!content) return null;
    const h2 = content.querySelector('h2');
    const name = h2 ? (h2.textContent || '').trim() : '';
    const allP = content.querySelectorAll('p');
    let street = '';
    let city = '';
    let state = '';
    let zip = '';
    const parts = [];
    for (const p of allP) {
      const t = (p.textContent || '').trim().replace(/\s+/g, ' ');
      if (!t) continue;
      if (/^\(\d{3}\)\s*\d{3}[- ]?\d{4}$/.test(t.replace(/\s/g, ''))) continue;
      if (t.length > 60) continue;
      parts.push(t);
      if (parts.length >= 2) break;
    }
    if (parts.length >= 2) {
      street = parts[0];
      const csz = parseCityStateZip(parts[1]);
      city = csz.city;
      state = csz.state;
      zip = csz.zip;
    } else if (parts.length === 1) {
      street = parts[0];
    }
    const fullAddress = [street, city, state, zip].filter(Boolean).join(', ');
    const hours = getCardHours(card);
    return {
      name,
      street,
      city,
      state,
      zip,
      fullAddress: fullAddress || name,
      hours,
      distance: null,
      element: card,
    };
  }

  function findLocationCards() {
    const cards = document.querySelectorAll('.location-card');
    return Array.from(cards);
  }

  function findCardsContainer() {
    const container = document.querySelector('.view-all-container');
    return container || document.querySelector('.locations-container') || null;
  }

  function getFieldValue(id) {
    const el = document.getElementById(id);
    return (el && el.value) || '';
  }

  function buildAddressFromFields() {
    return [getFieldValue('vlh-street'), getFieldValue('vlh-city'), getFieldValue('vlh-state'), getFieldValue('vlh-zip')]
      .filter(Boolean)
      .join(', ');
  }

  function getFilteredAndSortedLocations() {
    const q = currentFilter.trim().toLowerCase();
    let list = q
      ? locations.filter(
          (loc) =>
            (loc.name && loc.name.toLowerCase().includes(q)) ||
            (loc.fullAddress && loc.fullAddress.toLowerCase().includes(q))
        )
      : locations.slice();
    if (currentSort === 'name-asc') list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    else if (currentSort === 'name-desc') list.sort((a, b) => (b.name || '').localeCompare(a.name || ''));
    else if (currentSort === 'distance-asc') list.sort((a, b) => (a.distance ?? 1e9) - (b.distance ?? 1e9));
    else if (currentSort === 'distance-desc') list.sort((a, b) => (b.distance ?? -1) - (a.distance ?? -1));
    return list;
  }

  /** Set of location ids that are in the top 3 by distance (for row highlight). */
  function getTopThreeClosestIds() {
    const withDist = locations.filter((l) => l.distance != null);
    if (!withDist.length) return new Set();
    withDist.sort((a, b) => a.distance - b.distance);
    return new Set(withDist.slice(0, 3).map((l) => l.id));
  }

  function renderTableBody() {
    const tbody = document.getElementById('vlh-table-body');
    if (!tbody) return;
    const list = getFilteredAndSortedLocations();
    const topThreeIds = getTopThreeClosestIds();
    const tableWrap = tbody.closest('.vlh-table-wrap');
    const countEl = tableWrap && tableWrap.querySelector('.vlh-count');
    if (countEl) countEl.textContent = `${list.length} location${list.length !== 1 ? 's' : ''}`;

    tbody.innerHTML = list
      .map(
        (loc, idx) => {
          const hasHours = loc.hours && loc.hours.length > 0;
          const distText =
            loc.distance != null ? `📍 ${loc.distance.toFixed(1)} mi` : '—';
          const isTopThree = topThreeIds.has(loc.id);
          const hoursHtml =
            hasHours &&
            loc.hours
              .map(
                (h, i) =>
                  `<div class="vlh-hour-row"><span class="vlh-hour-date">${escapeHtml(h.date)}</span><span class="vlh-hour-time">${escapeHtml(h.time)}</span></div>`
              )
              .join('');
          const detailLabel = hasHours ? `<div class="vlh-detail-label">Hours for ${escapeHtml(loc.name)}</div>` : '';
          const rowClasses = ['vlh-row'];
          if (loc.distance != null) rowClasses.push('vlh-has-distance');
          if (isTopThree) rowClasses.push('vlh-top-three');
          const mapsQuery = encodeURIComponent(loc.fullAddress || loc.name || '');
          const mapsHref = mapsQuery ? `https://www.google.com/maps/place/${mapsQuery}` : '#';
          const mapLink = mapsQuery
            ? `<a href="${mapsHref}" class="vlh-map-link" target="_blank" rel="noopener noreferrer" title="Open in Google Maps"><span class="material-icons vlh-map-icon" aria-hidden="true">assistant_direction</span></a>`
            : '';
          return `
          <tr class="${rowClasses.join(' ')}" data-idx="${idx}" data-loc-id="${loc.id}">
            <td class="vlh-cell-name">${escapeHtml(loc.name)}</td>
            <td class="vlh-cell-address"><span class="vlh-cell-text">${escapeHtml(loc.fullAddress)}</span> ${mapLink}</td>
            <td class="vlh-cell-distance">${distText}</td>
            <td class="vlh-cell-expand">
              ${hasHours ? '<button type="button" class="vlh-expand-btn" aria-label="Toggle hours"><span class="vlh-expand-icon">➕</span></button>' : '<span class="vlh-no-details">—</span>'}
            </td>
          </tr>
          ${hasHours ? `<tr class="vlh-detail-row" data-idx="${idx}" hidden><td colspan="4"><div class="vlh-detail-cell">${detailLabel}${hoursHtml}</div></td></tr>` : ''}
        `;
        }
      )
      .join('');

    tbody.querySelectorAll('.vlh-expand-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const row = btn.closest('tr');
        const idx = row.getAttribute('data-idx');
        const detailRow = tbody.querySelector(`.vlh-detail-row[data-idx="${idx}"]`);
        if (!detailRow) return;
        const isHidden = detailRow.hidden;
        detailRow.hidden = !isHidden;
        const icon = btn.querySelector('.vlh-expand-icon');
        if (icon) {
          icon.textContent = isHidden ? '➖' : '➕';
          btn.classList.toggle('vlh-expanded', !isHidden);
        }
        btn.setAttribute('aria-label', isHidden ? 'Collapse hours' : 'Expand hours');
      });
    });

    if (tableWrap) {
      const table = tableWrap.querySelector('.vlh-table');
      if (table) {
        const applyMin = (w) => {
          if (w > 0) tableWrap.style.minWidth = w + 'px';
        };
        if (!currentFilter.trim()) {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              const w = Math.max(table.scrollWidth, 720);
              capturedTableMinWidth = w;
              applyMin(w);
            });
          });
        } else if (capturedTableMinWidth > 0) {
          applyMin(capturedTableMinWidth);
        }
      }
    }
  }

  function escapeHtml(s) {
    if (!s) return '';
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  function ensureMaterialIconsLoaded() {
    if (document.getElementById('vlh-material-icons')) return;
    const link = document.createElement('link');
    link.id = 'vlh-material-icons';
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/icon?family=Material+Icons';
    document.head.appendChild(link);
  }

  function buildTableView() {
    if (!cardsContainer) return;
    ensureMaterialIconsLoaded();
    originalContainerContent = cardsContainer.innerHTML;
    cardsContainer.classList.add('vlh-table-container');
    const filterId = 'vlh-filter-input';
    const sortId = 'vlh-sort-select';
    cardsContainer.innerHTML = `
      <div class="vlh-table-wrap">
        <div class="vlh-toolbar">
          <label class="vlh-toolbar-label">🔍 Filter</label>
          <input type="text" id="${filterId}" class="vlh-filter-input" placeholder="Name or address..." />
          <label class="vlh-toolbar-label">↕️ Sort</label>
          <select id="${sortId}" class="vlh-sort-select">
            <option value="name-asc">Name A → Z</option>
            <option value="name-desc">Name Z → A</option>
            <option value="distance-asc">Nearest first</option>
            <option value="distance-desc">Farthest first</option>
          </select>
          <span class="vlh-count">${locations.length} locations</span>
        </div>
        <div class="vlh-table-scroll">
          <table class="vlh-table">
            <thead>
              <tr>
                <th class="vlh-th-name">Location</th>
                <th class="vlh-th-address">Address</th>
                <th class="vlh-th-distance">Distance</th>
                <th class="vlh-th-expand">Hours</th>
              </tr>
            </thead>
            <tbody id="vlh-table-body"></tbody>
          </table>
        </div>
      </div>
    `;
    const filterInput = document.getElementById(filterId);
    const sortSelect = document.getElementById(sortId);
    filterInput.addEventListener('input', () => {
      currentFilter = filterInput.value;
      renderTableBody();
    });
    sortSelect.addEventListener('change', () => {
      currentSort = sortSelect.value;
      renderTableBody();
    });
    renderTableBody();
  }

  function buildPanel() {
    if (document.getElementById('vlh-panel')) return;
    const panel = document.createElement('div');
    panel.id = 'vlh-panel';
    panel.className = 'vlh-panel';
    panel.innerHTML = `
      <div class="vlh-panel-head">
        <h3 class="vlh-panel-title">🗳️ Voting Helper</h3>
        <button type="button" class="vlh-panel-minimize" aria-label="Minimize panel">−</button>
      </div>
      <div class="vlh-panel-section vlh-address-section">
        <label class="vlh-label">📍 Your address</label>
        <input type="text" id="vlh-street" class="vlh-input" placeholder="Street" autocomplete="off" />
        <input type="text" id="vlh-city" class="vlh-input" placeholder="City" autocomplete="off" />
        <div class="vlh-row-fields">
          <input type="text" id="vlh-state" class="vlh-input vlh-state" placeholder="State" maxlength="2" autocomplete="off" />
          <input type="text" id="vlh-zip" class="vlh-input vlh-zip" placeholder="ZIP" autocomplete="off" />
        </div>
        <div class="vlh-using" id="vlh-using" style="display:none;"></div>
        <div class="vlh-suggestions" id="vlh-suggestions" role="listbox" aria-label="Address suggestions"></div>
      </div>
      <div class="vlh-panel-actions">
        <button type="button" id="vlh-find" class="vlh-btn vlh-btn-primary">🎯 Find 3 closest</button>
        <button type="button" id="vlh-clear" class="vlh-btn vlh-btn-secondary">✨ Clear & show all</button>
        <button type="button" id="vlh-cleanup" class="vlh-btn vlh-btn-secondary" title="Re-apply table view if the page was reverted (e.g. after session expiry)">🧹 Clean up this page</button>
      </div>
      <div class="vlh-status" id="vlh-status"></div>
      <div class="vlh-geocode-progress" id="vlh-geocode-progress" style="display:none;">
        <div class="vlh-progress-bar-wrap">
          <div class="vlh-progress-bar-fill" id="vlh-progress-bar-fill"></div>
        </div>
        <div class="vlh-progress-current" id="vlh-progress-current"></div>
        <p class="vlh-progress-message">Please bear with us—this process may take a little bit of time, but we want to help you find the closest locations to you.</p>
      </div>
      <div class="vlh-closest-list" id="vlh-closest-list" style="display:none;">
        <h4 class="vlh-closest-title">🏆 Closest to you</h4>
        <div id="vlh-closest-items"></div>
      </div>
    `;
    document.body.appendChild(panel);

    const toggle = document.createElement('button');
    toggle.className = 'vlh-toggle';
    toggle.innerHTML = '<span class="vlh-toggle-emoji">🗳️</span><span class="vlh-toggle-text">Helper</span>';
    toggle.setAttribute('aria-label', 'Show Voting Locations Helper panel');
    toggle.style.display = 'none';
    toggle.addEventListener('click', () => {
      panel.classList.remove('vlh-hidden');
      toggle.style.display = 'none';
    });
    document.body.appendChild(toggle);
    const minimizeBtn = panel.querySelector('.vlh-panel-minimize');
    if (minimizeBtn) {
      minimizeBtn.addEventListener('click', () => {
        panel.classList.add('vlh-hidden');
        toggle.style.display = '';
      });
    }

    const setStatus = (msg) => {
      const el = document.getElementById('vlh-status');
      if (el) el.textContent = msg;
    };

    document.getElementById('vlh-find').addEventListener('click', () => runFindClosest(setStatus));
    document.getElementById('vlh-clear').addEventListener('click', () => runClear(setStatus));
    document.getElementById('vlh-cleanup').addEventListener('click', () => {
      if (cleanupPage()) {
        setStatus('✅ Page cleaned up. Table view re-applied.');
      } else {
        setStatus('⚠️ No voting locations found on this page. Open the voting locations list and try again.');
      }
    });
    const usingEl = document.getElementById('vlh-using');
    const suggestionsEl = document.getElementById('vlh-suggestions');

    function clearSelectedAndSuggest() {
      selectedUserCoords = null;
      if (usingEl) usingEl.style.display = 'none';
      if (suggestionsEl) suggestionsEl.innerHTML = '';
      suggestionsEl && suggestionsEl.classList.remove('vlh-suggestions-visible');
    }

    function showSuggestions(items) {
      if (!suggestionsEl) return;
      suggestionsEl.innerHTML = '';
      suggestionsEl.classList.remove('vlh-suggestions-visible');
      if (!items || !items.length) return;
      items.forEach((item, i) => {
        const opt = document.createElement('div');
        opt.className = 'vlh-suggest-item';
        opt.setAttribute('role', 'option');
        opt.textContent = item.display_name;
        opt.addEventListener('click', () => {
          selectedUserCoords = { lat: item.lat, lon: item.lon };
          if (usingEl) {
            usingEl.textContent = '📍 Using: ' + item.display_name;
            usingEl.style.display = 'block';
          }
          suggestionsEl.innerHTML = '';
          suggestionsEl.classList.remove('vlh-suggestions-visible');
        });
        suggestionsEl.appendChild(opt);
      });
      suggestionsEl.classList.add('vlh-suggestions-visible');
    }

    function scheduleSuggest() {
      if (suggestDebounce) clearTimeout(suggestDebounce);
      suggestDebounce = setTimeout(async () => {
        suggestDebounce = null;
        const q = buildAddressFromFields();
        if (!q.trim()) {
          showSuggestions([]);
          return;
        }
        const items = await geocodeSuggestions(q);
        showSuggestions(items);
      }, SUGGEST_DEBOUNCE_MS);
    }

    ['vlh-street', 'vlh-city', 'vlh-state', 'vlh-zip'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('input', () => {
          clearSelectedAndSuggest();
          scheduleSuggest();
        });
        el.addEventListener('focus', scheduleSuggest);
      }
    });

    document.addEventListener('click', (e) => {
      if (suggestionsEl && suggestionsEl.classList.contains('vlh-suggestions-visible') && !panel.contains(e.target)) {
        suggestionsEl.classList.remove('vlh-suggestions-visible');
      }
    });

    document.body.classList.add('vlh-active');
  }

  function runClear(setStatus) {
    selectedUserCoords = null;
    const usingEl = document.getElementById('vlh-using');
    if (usingEl) usingEl.style.display = 'none';
    locations.forEach((loc) => (loc.distance = null));
    const listEl = document.getElementById('vlh-closest-list');
    const itemsEl = document.getElementById('vlh-closest-items');
    if (listEl) listEl.style.display = 'none';
    if (itemsEl) itemsEl.innerHTML = '';
    const sortSelect = document.getElementById('vlh-sort-select');
    if (sortSelect) sortSelect.value = 'name-asc';
    currentSort = 'name-asc';
    currentFilter = '';
    const filterInput = document.getElementById('vlh-filter-input');
    if (filterInput) filterInput.value = '';
    renderTableBody();
    setStatus('');
  }

  async function runFindClosest(setStatus) {
    if (!isTableActive() && cleanupPage()) {
      setStatus('🔄 Page re-applied. Finding closest…');
    }
    let startCoords = selectedUserCoords;
    if (!startCoords) {
      const startAddress = buildAddressFromFields();
      if (!startAddress.trim()) {
        setStatus('✏️ Enter at least city, state, or ZIP (or pick a suggestion below).');
        return;
      }
      setStatus('🔄 Geocoding your address…');
      startCoords = await geocodeUserAddress(
        getFieldValue('vlh-street'),
        getFieldValue('vlh-city'),
        getFieldValue('vlh-state'),
        getFieldValue('vlh-zip')
      );
      await sleep(GEOCODE_DELAY_MS);
      if (!startCoords) {
        setStatus('❌ Could not find that address. Try city + state or ZIP, or pick a suggestion.');
        return;
      }
    }

    const toGeocode = locations.filter((loc) => loc.fullAddress);
    const total = toGeocode.length;
    const progressEl = document.getElementById('vlh-geocode-progress');
    const progressFillEl = document.getElementById('vlh-progress-bar-fill');
    const progressCurrentEl = document.getElementById('vlh-progress-current');
    if (progressEl) progressEl.style.display = 'block';
    if (progressFillEl) progressFillEl.style.width = '0%';
    if (progressCurrentEl) progressCurrentEl.textContent = 'Starting…';
    let done = 0;
    for (const loc of toGeocode) {
      if (progressFillEl) progressFillEl.style.width = total ? (100 * done / total) + '%' : '0%';
      if (progressCurrentEl) progressCurrentEl.textContent = loc.name || loc.fullAddress || '';
      const coords = await geocodeLocation(loc);
      await sleep(GEOCODE_DELAY_MS);
      loc.distance = coords
        ? haversineMi(startCoords.lat, startCoords.lon, coords.lat, coords.lon)
        : null;
      done += 1;
    }
    if (progressFillEl) progressFillEl.style.width = total ? '100%' : '0%';
    if (progressEl) progressEl.style.display = 'none';
    if (progressCurrentEl) progressCurrentEl.textContent = '';

    const withDistance = locations.filter((e) => e.distance != null);
    withDistance.sort((a, b) => a.distance - b.distance);
    const closest = withDistance.slice(0, 3);

    const sortSelect = document.getElementById('vlh-sort-select');
    if (sortSelect) {
      sortSelect.value = 'distance-asc';
      currentSort = 'distance-asc';
    }
    renderTableBody();

    const listEl = document.getElementById('vlh-closest-list');
    const itemsEl = document.getElementById('vlh-closest-items');
    if (listEl && itemsEl) {
      itemsEl.innerHTML = closest
        .map(
          (e, i) =>
            `<button type="button" class="vlh-closest-item vlh-closest-item-btn" data-loc-id="${e.id}" title="Scroll to this location"><span class="vlh-closest-num">#${i + 1}</span> <strong>${escapeHtml(e.name || e.fullAddress)}</strong> <span class="vlh-closest-dist">${e.distance.toFixed(1)} mi</span></button>`
        )
        .join('');
      listEl.style.display = 'block';
      itemsEl.querySelectorAll('.vlh-closest-item-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.getAttribute('data-loc-id');
          const row = document.querySelector(`#vlh-table-body tr[data-loc-id="${id}"]`);
          if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
      });
    }

    const firstRow = document.querySelector('.vlh-row.vlh-has-distance');
    if (firstRow) firstRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setStatus(`✅ Found ${closest.length} closest! Sorted by distance.`);
  }

  /** Re-detect cards/container and rebuild the table view. Use after session expiry or when page re-renders. */
  function cleanupPage() {
    const cards = findLocationCards();
    const container = findCardsContainer();
    if (!cards.length || !container) return false;
    cardsContainer = container;
    locations = cards.map((card) => parseCard(card)).filter(Boolean);
    locations.forEach((loc, i) => { loc.id = i; });
    if (!locations.length) return false;
    buildTableView();
    return true;
  }

  /** True if our table view is currently in the DOM. */
  function isTableActive() {
    return !!document.getElementById('vlh-table-body');
  }

  function init() {
    const cards = findLocationCards();
    const container = findCardsContainer();
    if (!cards.length || !container || document.getElementById('vlh-panel')) return false;

    cardsContainer = container;
    locations = cards.map((card) => parseCard(card)).filter(Boolean);
    locations.forEach((loc, i) => { loc.id = i; });
    if (!locations.length) return false;

    buildPanel();
    buildTableView();
    return true;
  }

  function tryInit() {
    if (init()) return;
    let attempts = 0;
    const id = setInterval(() => {
      attempts++;
      if (init() || attempts >= 25) clearInterval(id);
    }, 600);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(tryInit, 400));
  } else {
    setTimeout(tryInit, 600);
  }

  const observer = new MutationObserver(() => {
    if (!document.getElementById('vlh-panel') && findLocationCards().length && findCardsContainer()) tryInit();
  });
  observer.observe(document.body, { childList: true, subtree: true });
})();
