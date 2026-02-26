# 🗳️ Voting Locations Helper – Chrome Extension

Restyle voting locations into a **compact table** with sort & filter, and find the **three closest** locations using your full address (street, city, state, ZIP).

### Go From This
<img width="1512" height="949" alt="Screenshot 2026-02-26 at 12 08 21 AM" src="https://github.com/user-attachments/assets/69b20a4b-ae4d-4484-a9dd-0c88faecccff" />


### TO THIS
<img width="1512" height="949" alt="Screenshot 2026-02-26 at 12 08 50 AM" src="https://github.com/user-attachments/assets/ee9dcecc-cd55-4f98-a0e8-909b2ac436c8" />

## ✨ Features

- **Table-like view**  
  Locations appear as compact rows instead of huge cards. Columns: Location name, Address, Distance (after you run “Find 3 closest”), and an expand control for hours.

- **Expandable hours**  
  Rows with multiple date/time slots have a **➕** button. Click to expand and see all hours; click **➖** to collapse.

- **Sort**  
  Sort by: Name A→Z, Name Z→A, Nearest first, Farthest first. “Nearest first” / “Farthest first” apply after you run “Find 3 closest.”

- **Filter**  
  Type in the filter box to show only locations whose name or address matches (case-insensitive).

- **Your address in 4 fields**  
  Street, City, State, and ZIP each have their own input so you can enter a full address clearly.

- **Find 3 closest**  
  Uses your address (any combination of street, city, state, ZIP) to geocode and then geocode every polling place. The three nearest (straight-line distance in miles) are highlighted and listed in the panel; the table can be sorted by distance.

- **Smarter geocoding**  
  Your address is sent to Nominatim in **structured form** (street, city, state, ZIP separately) for better matches. If that fails, the extension tries fallbacks: city+state+ZIP, then city+state, then ZIP only, then a single free-form query. That reduces “Could not find that address” when the street is fuzzy or missing.

- **Address suggestions**  
  As you type, the helper fetches **suggestions** (up to 5) from Nominatim. Click a suggestion to lock that location; “Find 3 closest” then uses it without geocoding again. Handy when the exact street doesn’t match but a suggested one does.

- **Clean minimal panel**  
  Light background, simple typography, and a few emojis (🗳️ 🎯 ✨ 🏆 📍 🔍) to keep the helper easy to scan.

## 📦 Install (unpacked)

1. Open Chrome → `chrome://extensions/`
2. Turn **Developer mode** on (top right)
3. Click **Load unpacked** and select the `voting-locations-extension` folder
4. Reload the voting locations page when needed

## 🎯 How to use

1. Open the county voting locations page (the one that lists all polling places).
2. The extension turns the list into a table and shows the **Voting Helper** panel (or click the **🗳️ Helper** tab on the right to open it).
3. Enter your address in **Street**, **City**, **State**, and **ZIP** (at least city/state or ZIP).
4. Click **🎯 Find 3 closest**. Wait while it geocodes (about 1 second per location).
5. The table sorts by distance by default; the three closest are listed under **🏆 Closest to you** in the panel.
6. Use **🔍 Filter** and **↕️ Sort** above the table to narrow or reorder the list.
7. Click **➕** on any row to expand and see all hours; click **➖** to collapse.
8. Click **✨ Clear & show all** to clear distances and reset to an alphabetical view.

## 🛠 Technical notes

- **Geocoding:** OpenStreetMap Nominatim (free, 1 request/second). User address is sent as **structured** params (`street`, `city`, `state`, `postalcode`, `country=United States`, `countrycodes=us`); if that returns nothing, fallbacks are tried (no street, then city+state+ZIP, city+state, ZIP only, then free-form `q=`).
- **Suggestions:** Same API with `limit=5` and `countrycodes=us`; picking a suggestion stores its lat/lon so “Find 3 closest” doesn’t need to geocode again.
- **Distance:** Straight-line (Haversine) miles, not driving distance.
- **Activation:** The script only runs when it finds `.location-card` elements on the page.

## 📁 Files

- `manifest.json` – Extension manifest (Manifest V3)
- `content.js` – Parses cards, builds table with sort/filter/expand, panel with 4 address fields, geocoding and “Find 3 closest”
- `styles.css` – Minimal panel, table, toolbar, and expandable rows
- `README.md` – This file
