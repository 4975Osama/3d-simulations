/* Boundaries: sidebar submenu only, proxying the real boundary-layer code
   already wired inside effects.js's initFX() (#bdy-pro / #bdy-dis /
   #bdy-state — fetches portal/geojson/Provincial.geojson + District.geojson,
   toggles MapLibre layer visibility). No engine duplication here. */

const $ = (id) => document.getElementById(id);

const ROWS = [
  { key: 'pro', btn: 'bdy-pro', name: 'Provincial Boundary' },
  { key: 'dis', btn: 'bdy-dis', name: 'District Boundary' },
];

const ROW_GRADIENT = {
  pro: 'linear-gradient(135deg, #34d399, #059669)',
  dis: 'linear-gradient(135deg, #818cf8, #4f46e5)',
};

function subnavHTML() {
  return ROWS.map((r) => `<div class="subrow" data-bdy="${r.key}" style="--catgrad:${ROW_GRADIENT[r.key]}">
    <span class="dotcat" style="background:${$(r.btn) && $(r.btn).classList.contains('on') ? '#fff' : 'rgba(255,255,255,.35)'}"></span>
    <span>${r.name}</span>
    <label class="switch small swi" onclick="event.stopPropagation()">
      <input type="checkbox" data-bdy-toggle="${r.key}" ${$(r.btn) && $(r.btn).classList.contains('on') ? 'checked' : ''} />
      <span class="sl"></span>
    </label>
  </div>`).join('');
}

function wire(root, rerender) {
  root.querySelectorAll('[data-bdy-toggle]').forEach((inp) => {
    inp.addEventListener('change', () => {
      $('bdy-' + inp.dataset.bdyToggle).click();
      setTimeout(rerender, 260);   // let the fetch/message settle before re-reading state
    });
  });
}

function renderSubnav() {
  const sub = $('boundaries-sub');
  sub.innerHTML = subnavHTML();
  wire(sub, renderSubnav);
}

function ready() { return $('bdy-pro') && $('bdy-state'); }
function boot() {
  if (!ready()) { setTimeout(boot, 150); return; }
  renderSubnav();
}
boot();
