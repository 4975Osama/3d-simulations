/* Tech-EW Hazards: sidebar submenu only (no dedicated page — the group
   header just expands/collapses this list in place), proxying the real,
   already-working hazard system in effects.js (AdvancedHazardAnimationSystem
   + hazardData + #hazsel/#haz-show/#haz-fly/#haz-place/#haz-clear/#hazcount,
   all wired inside effects.js's initFX()). This file duplicates none of
   that engine logic — it only builds the new visible UI and drives those
   exact hidden elements, the same proxy pattern app.js's controls use. */

const $ = (id) => document.getElementById(id);

const HAZ_ICON_SVG = {
  'floods': '<path d="M3 16q4.5-4 9 0t9 0M3 11q4.5-4 9 0t9 0" opacity=".85"/>',
  'fire-emergencies': '<path d="M12 2c1 4-3 5-3 9a3 3 0 0 0 6 0c0-1-.5-2-1-2 1 3-1 4-2 2"/>',
  'snow-emergencies': '<path d="M12 2v20M4.2 7l15.6 10M19.8 7 4.2 17"/>',
  'landslide-mudslide': '<path d="M3 20l6-12 4 6 3-4 5 10z"/><path d="M2 20h20" opacity=".5"/>',
  'drought': '<circle cx="12" cy="7.5" r="3"/><path d="M12 2v1.6M6.9 7.5H5.3M18.7 7.5h-1.6M8.3 3.9 7.1 2.7M15.7 3.9l1.2-1.2" opacity=".85"/><path d="M3 19.5l4-4.5 3 3.5 4-5.5 3 4.5 4-3.5" opacity=".9"/>',
  'heatwave': '<path d="M12 14.2V5.2a2 2 0 1 0-4 0v9a4 4 0 1 0 4 0z"/><path d="M10 6.5v7" opacity=".55"/>',
  'glof-emergencies': '<path d="M4 15.5l4-8 3 4.5 2.5-3 3 6z"/><path d="M3.5 19q4-3.2 8 0t9 0" opacity=".9"/>',
  'coastal-emergencies': '<path d="M4 8a8 8 0 0 1 16 0" opacity=".55"/><path d="M3 14q4.5-4 9 0t9 0M3 18.5q4.5-4 9 0t9 0" opacity=".9"/>',
  'earthquake': '<path d="M2 16l4-4 3 3 3-6 3 5 3-2 4 4" />',
  'smog-fog': '<path d="M4 9h16M3 13h18M5 17h14" opacity=".85"/>',
};
/* Real icon artwork (rowHTML() below uses these automatically instead of
   the built-in SVG glyph when present). Hotlinked per the user's direct
   links; smog-fog has no replacement yet so it keeps the local file. */
const HAZ_ICON_IMG = {
  'floods': 'https://i.postimg.cc/cLqzdWZ3/flood-ic.png',
  'fire-emergencies': 'https://i.postimg.cc/bNSMXrXL/fires-ic.png',
  'earthquake': 'https://i.postimg.cc/dtZXM3Mm/earthquake-ic.png',
  'landslide-mudslide': 'https://i.postimg.cc/3xMq3h7Z/Landslide-ic.png',
  'drought': 'https://i.postimg.cc/4NHMCyCv/drought-ic.png',
  'heatwave': 'https://i.postimg.cc/QdLzjDs1/heatwave-ic.png',
  'glof-emergencies': 'https://i.postimg.cc/2SptCYmn/glof-ic.png',
  'coastal-emergencies': 'https://i.postimg.cc/L6g7d5d3/coastal-ic.png',
  'snow-emergencies': 'https://i.postimg.cc/YCcPt7kV/snow-emg.png',
  'smog-fog': './icons/smog_ic.png',
};
window.HAZ_ICON_IMG = HAZ_ICON_IMG;   // shared with effects.js's map-marker chips

/* one fixed two-stop gradient per hazard *type* (not per severity) — severity
   already varies within a category, so colouring by severity made almost
   every row the same red/orange. Distinct jewel-tone gradients per type give
   real visual variety and double as a legend once you've seen the map
   markers a few times. */
const CAT_GRADIENT = {
  'floods': ['#2dd4bf', '#0d9488'],
  'fire-emergencies': ['#fb923c', '#ea580c'],
  'earthquake': ['#3fa7a0', '#1d6f6a'],
  'landslide-mudslide': ['#d08a52', '#a0582b'],
  'drought': ['#e3bd7e', '#b88a4a'],
  'heatwave': ['#fbbf24', '#d97706'],
  'glof-emergencies': ['#b07ccf', '#7c4dab'],
  'coastal-emergencies': ['#4fbf85', '#23874f'],
  'snow-emergencies': ['#60a5fa', '#2563eb'],
  'smog-fog': ['#a8b0bb', '#727b87'],
};
const CAT_ORDER = ['floods', 'fire-emergencies', 'earthquake', 'landslide-mudslide', 'drought',
  'heatwave', 'glof-emergencies', 'coastal-emergencies', 'snow-emergencies', 'smog-fog'];

function catGradient(cat) {
  const g = CAT_GRADIENT[cat] || ['#666', '#333'];
  return `linear-gradient(135deg, ${g[0]}, ${g[1]})`;
}

/* The submenu is split by year: "2026 Hazards" and "2027 Hazards" each
   expand to the full hazard list. A category is on the map while it is
   ticked under either year. */
const YEARS = ['2026', '2027'];
const picked = new Set();  // "year|category" rows switched on
const onSet = new Set();   // categories currently shown on the map

/* rebuild every currently-on category from scratch — the underlying engine
   only exposes "show one" (additive) + "clear everything", not "hide just
   this one", so a single-category hide is implemented as clear-all + replay
   the remaining set. Cheap: markers are inexpensive DOM elements. */
function rebuild() {
  $('haz-clear').click();
  onSet.forEach((cat) => {
    $('hazsel').value = cat;
    $('haz-show').click();
  });
}

function toggleRow(year, cat, on) {
  if (on) picked.add(year + '|' + cat); else picked.delete(year + '|' + cat);
  onSet.clear();
  picked.forEach((k) => onSet.add(k.split('|')[1]));
  rebuild();
}

function iconMarkup(cat) {
  const icon = HAZ_ICON_SVG[cat] || '<circle cx="12" cy="12" r="8"/>';
  if (HAZ_ICON_IMG[cat]) {
    // several of these are hotlinked to a third-party host — fall back to the
    // built-in glyph instead of leaving a blank icon if one is ever slow/down.
    return `<img src="${HAZ_ICON_IMG[cat]}" alt="" onerror="window.__hazIconFallback(this,'${cat}')" />`;
  }
  return `<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.8">${icon}</svg>`;
}
window.__hazIconFallback = (img, cat) => {
  const icon = HAZ_ICON_SVG[cat] || '<circle cx="12" cy="12" r="8"/>';
  img.outerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.8">${icon}</svg>`;
};

function rowHTML(year, cat) {
  const info = window.hazardData[cat];
  const grad = catGradient(cat);
  const on = picked.has(year + '|' + cat);
  return `<button class="subrow${on ? ' active' : ''}" data-year="${year}" data-cat="${cat}" type="button" style="--catgrad:${grad}">
    <span class="cicon">${iconMarkup(cat)}</span>
    <span class="subname">${info.name}</span>
    <span class="cnt">${info.locations.length}</span>
  </button>`;
}

const CAL_ICON = '<svg class="ycal" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>';
const CHEV = '<svg class="chev" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>';

function yearHTML(year) {
  return `<div class="yeargroup" data-year="${year}">
    <button class="yearbtn" type="button">${CAL_ICON}<span>${year} Hazards</span><span class="ycnt" hidden></span>${CHEV}</button>
    <div class="yearlist">${CAT_ORDER.map((cat) => rowHTML(year, cat)).join('')}</div>
  </div>`;
}

/* "3 on" badge on a year button while any of its hazards are shown */
function updateYearCounts() {
  document.querySelectorAll('#techew-sub .yeargroup').forEach((g) => {
    const n = [...picked].filter((k) => k.startsWith(g.dataset.year + '|')).length;
    const b = g.querySelector('.ycnt');
    b.hidden = !n;
    b.textContent = n + ' on';
  });
}

function renderSubnav() {
  const sub = $('techew-sub');
  sub.innerHTML = YEARS.map(yearHTML).join('');
  sub.querySelectorAll('.yearbtn').forEach((btn) => {
    btn.addEventListener('click', () => btn.closest('.yeargroup').classList.toggle('open'));
  });
  sub.querySelectorAll('.subrow').forEach((row) => {
    row.addEventListener('click', () => {
      row.classList.toggle('active');
      toggleRow(row.dataset.year, row.dataset.cat, row.classList.contains('active'));
      updateYearCounts();
    });
  });
}

function ready() { return window.hazardData && $('hazsel') && $('hazsel').options.length > 0; }
function boot() {
  if (!ready()) { setTimeout(boot, 150); return; }
  renderSubnav();
}
boot();
