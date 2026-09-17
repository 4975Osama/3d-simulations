/* Dashboard glue: clock, and the topbar search (flies to river/reservoir
   spots from app.js's #spots, and to Tech-EW hazard sites once hazardData
   is ready). Page routing lives in nav.js; engine wiring lives in
   measure.js/floodpanel.js/hazards.js/boundaries.js. */

const $ = (id) => document.getElementById(id);

/* ------------------------------------------------------- clock */
function tz() { return 'Asia/Karachi'; }
function tickClock() {
  const now = new Date();
  try {
    $('clock').textContent = new Intl.DateTimeFormat('en-PK', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: tz() }).format(now);
    $('date').textContent = new Intl.DateTimeFormat('en-PK', { day: 'numeric', month: 'short', year: 'numeric', timeZone: tz() }).format(now);
  } catch (_) { /* unknown tz — keep last good value */ }
}
tickClock();
setInterval(tickClock, 15000);

/* ------------------------------------------------------- search: spots + hazard sites */
function candidates() {
  const list = [];
  document.querySelectorAll('#spots > button').forEach((b) => list.push({ label: b.textContent, kind: 'Water spot', fly: () => b.click() }));
  if (window.hazardData) {
    Object.entries(window.hazardData).forEach(([cat, info]) => {
      info.locations.forEach((loc) => list.push({
        label: loc.name, kind: info.name,
        fly: () => window.map.flyTo({ center: loc.coordinates, zoom: 10.5, pitch: 45, duration: 2200, essential: true }),
      }));
    });
  }
  return list;
}

let searchResults = null;
function ensureResults() {
  if (searchResults) return searchResults;
  searchResults = document.createElement('div');
  searchResults.className = 'panel results';
  searchResults.style.cssText = 'max-height:280px;overflow-y:auto;padding:6px;display:none;';
  $('search').appendChild(searchResults);
  return searchResults;
}

$('q').addEventListener('input', (e) => {
  const s = e.target.value.trim().toLowerCase();
  const box = ensureResults();
  if (!s) { box.style.display = 'none'; return; }
  const hits = candidates().filter((c) => c.label.toLowerCase().includes(s)).slice(0, 8);
  if (!hits.length) { box.innerHTML = '<div style="padding:8px;color:var(--dim);font-size:12px">No matches</div>'; box.style.display = 'block'; return; }
  box.innerHTML = hits.map((h, i) => `<button data-i="${i}" style="display:flex;justify-content:space-between;gap:8px;width:100%;text-align:left;background:none;border:none;color:var(--txt);padding:7px 9px;border-radius:7px;cursor:pointer;font-size:12px"><span>${h.label}</span><span style="color:var(--dim);font-size:10.5px">${h.kind}</span></button>`).join('');
  [...box.children].forEach((btn, i) => btn.addEventListener('click', () => { hits[i].fly(); box.style.display = 'none'; e.target.blur(); }));
  box.style.display = 'block';
});
$('q').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const s = e.target.value.trim().toLowerCase();
  if (!s) return;
  const hit = candidates().find((c) => c.label.toLowerCase().includes(s));
  if (hit) { hit.fly(); ensureResults().style.display = 'none'; }
});
document.addEventListener('click', (e) => {
  if (searchResults && !$('search').contains(e.target)) searchResults.style.display = 'none';
});
