# 🗳️ Fabbot Voting Locations Helper for the State of Texas – Chrome Extension

Restyle voting locations into a **compact table** with sort & filter, and find the **three closest** locations using your full address (street, city, state, ZIP).

### Go From This
<img width="1512" height="949" alt="Screenshot 2026-02-26 at 12 08 21 AM" src="https://github.com/user-attachments/assets/69b20a4b-ae4d-4484-a9dd-0c88faecccff" />


### TO THIS
<img width="1512" height="949" alt="Screenshot 2026-02-26 at 12 08 50 AM" src="https://github.com/user-attachments/assets/ee9dcecc-cd55-4f98-a0e8-909b2ac436c8" />

## ✨ Features

- **Table-like view**  
  Locations appear as compact rows instead of huge cards. Columns: Location name, Address, Distance (after you run “Find 3 closest”), and an expand control for hours.

- **Expandable hours**  
  Rows with multiple date/time slots have a **➕** button that expands to see all dates and hours for a given location.

- **Sort**  
  Sort by: Name A→Z, Name Z→A, Nearest first, Farthest first. “Nearest first” / “Farthest first” apply after you run “Find 3 closest.”

- **Filter**  
  Type in the filter box to show only locations whose name or address matches (case-insensitive).

- **Find 3 closest**  
  Uses your address (any combination of street, city, state, ZIP) to see your distance from every relevant polling place. The three nearest (straight-line distance in miles) are highlighted and listed in the panel; the table can be sorted by distance.

- **Clean minimal panel**  
  Light background, simple typography, and a few emojis (🗳️ 🎯 ✨ 🏆 📍 🔍) to keep the helper easy to scan.

## 📦 Install (unpacked)

1. Open Chrome → `chrome://extensions/`
2. Turn **Developer mode** on (top right)
3. Click **Load unpacked** and select the `voting-locations-extension` folder
4. Reload the voting locations page when needed

## 🎯 How to use

1. Open the county voting locations page (the one that lists all polling places) after you have provided your voter registration information on the [My Voter Portal](https://goelect.txelections.civixapps.com/ivis-mvp-ui/#/login) and then navigate to the [polling locations page](https://goelect.txelections.civixapps.com/ivis-mvp-ui/dashboard).
2. The extension turns the list into a table and shows the **Voting Helper** panel (or click the **🗳️ Helper** tab on the right to open it).
3. Enter your address in **Street**, **City**, **State**, and **ZIP** (at least city/state or ZIP).
4. Click **🎯 Find 3 closest**. Wait while it geocodes (about 1 second per location).
5. The table sorts by distance by default; the three closest are listed under **🏆 Closest to you** in the panel.
6. Use **🔍 Filter** and **↕️ Sort** above the table to narrow or reorder the list.
7. Click **➕** on any row to expand and see all hours; click **➖** to collapse.
8. Click **✨ Clear & show all** to clear distances and reset to an alphabetical view.

## 📁 Files

- `manifest.json` – Extension manifest (Manifest V3)
- `content.js` – Parses cards, builds table with sort/filter/expand, panel with 4 address fields, geocoding and “Find 3 closest”
- `styles.css` – Minimal panel, table, toolbar, and expandable rows
- `README.md` – This file
