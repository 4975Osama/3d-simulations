/* Digital Twin — a rainfall/flood scenario mode for the whole country.
   Pick rainfall intensity + duration + a mitigation, press play, and the real
   water engine (window.water.setGrow) spreads the flood sheets across Pakistan
   while a live panel reports rainfall, flooded area, population exposed and
   city alerts. Zoomed into a city, a rainfall-runoff model (hydro-worker.js)
   floods the streets over real terrain and colours OSM buildings by depth;
   the ponds are drawn by a second instance of the shared water engine
   (waterSurface.js), so street water flows and ripples like the river floods.
   Everything is driven through existing globals: window.map, window.water,
   window.floodDatasets, window.setFloodDataset and the legacy #bodies /
   #terrain3d controls — no rendering logic lives here. */

import { createWaterSurface } from '../waterSurface.js';
import earcut from './vendor/earcut.js';

const $ = (id) => document.getElementById(id);

const REGIONS = {
  country:    { label: 'All Pakistan', bbox: null, cam: { center: [69.6, 30.2], zoom: 4.9, pitch: 50, bearing: 0 } },
  punjab:     { label: 'Punjab', bbox: [69.3, 27.7, 75.4, 34.0], cam: { center: [72.3, 31.0], zoom: 6.5, pitch: 50, bearing: 0 } },
  sindh:      { label: 'Sindh', bbox: [66.6, 23.6, 71.2, 28.6], cam: { center: [68.6, 26.0], zoom: 6.8, pitch: 50, bearing: 0 } },
  kp:         { label: 'Khyber Pakhtunkhwa', bbox: [69.2, 31.0, 74.1, 36.9], cam: { center: [71.7, 34.0], zoom: 6.8, pitch: 50, bearing: 0 } },
  balochistan:{ label: 'Balochistan', bbox: [60.9, 24.8, 70.3, 32.1], cam: { center: [65.8, 28.4], zoom: 5.8, pitch: 45, bearing: 0 } },
  gb:         { label: 'Gilgit-Baltistan', bbox: [72.4, 34.5, 77.9, 37.1], cam: { center: [74.8, 35.9], zoom: 7.0, pitch: 55, bearing: 0 } },
  karachi:    { label: 'Karachi (city)', city: true, bbox: [66.6, 24.6, 67.6, 25.3], cam: { center: [67.05, 24.88], zoom: 14.2, pitch: 62, bearing: -20 } },
  lahore:     { label: 'Lahore (city)', city: true, bbox: [74.0, 31.3, 74.7, 31.7], cam: { center: [74.33, 31.55], zoom: 14.2, pitch: 62, bearing: 15 } },
  islamabad:  { label: 'Islamabad (city)', city: true, bbox: [72.8, 33.5, 73.4, 33.9], cam: { center: [73.06, 33.69], zoom: 14.2, pitch: 62, bearing: -30 } },
  peshawar:   { label: 'Peshawar (city)', city: true, bbox: [71.3, 33.8, 71.8, 34.2], cam: { center: [71.57, 34.01], zoom: 14.2, pitch: 62, bearing: 10 } },
  hyderabad:  { label: 'Hyderabad (city)', city: true, bbox: [68.2, 25.2, 68.7, 25.6], cam: { center: [68.37, 25.39], zoom: 14.2, pitch: 62, bearing: 0 } },
  sukkur:     { label: 'Sukkur (city)', city: true, bbox: [68.6, 27.5, 69.2, 28.0], cam: { center: [68.87, 27.7], zoom: 14.2, pitch: 62, bearing: -25 } },
};

const MITIGATIONS = {
  // cut = river-flood reduction; drain = storm-drain capacity (mm/h); store = detention storage (mm)
  none:     { label: 'No intervention', cut: 0, drain: 15, store: 0 },
  drainage: { label: 'Improved drainage (drains 15→35 mm/h)', cut: 0.25, drain: 35, store: 0 },
  basins:   { label: 'Drainage + detention basins (+40 mm storage)', cut: 0.45, drain: 35, store: 40 },
};

const FULL_SPREAD_MM = 600;   // effective rainfall that inundates every sheet
const PLAY_SECONDS = 90;      // wall-clock length of one full replay at normal speed
const CITY_FLOW_SPEED = 0.55; // city water ripple speed vs the engine default (calmer drift)
const FILL_EASE_S = 0.6;      // pond fills glide to the simulated level over ~this many seconds
const WINDOW = 0.16;          // engine fill window after a sheet's reveal delay
const RECESSION = 0.5;        // timeline runs on past the storm by this fraction so drainage shows
const GRID = 100;             // urban model: GRID x GRID cells
const HALF_DEG = 0.027;       // domain half-height (~3 km) around the camera
const SNAP_DEG = 0.005;       // domain centre snap, so revisits reuse cached DEM + buildings
const FRAMES = 120;           // depth snapshots returned per run
const WET_M = 0.05;           // ground counted as flooded (5 cm)
const BLD_WET_M = 0.15;       // water around a building deep enough to enter it
const RUNOFF_OPEN = 0.45;     // runoff coefficient: roads / compacted open ground
const RUNOFF_ROOF = 0.9;      // ... fully roofed cell
const MIN_POND_CELLS = 3;     // smaller wet patches are not drawn as water bodies
const MAX_PONDS = 220;        // largest ponds handed to the water engine
const NEAR_DEG = 0.1;         // "threatened" distance (~11 km) from a flood sheet
const TINT_FADE = 0.04;       // flood tint fades in over this much of the reveal front
/* critical facilities (portal/public/facilities.json, built by data/build_facilities.py) */
const FAC_KIND = {                      // OSM kind -> label, colour, shown in the alerts list
  hospital: ['Hospital', '#f43f5e', true], clinic: ['Clinic', '#fb7185', false], school: ['School', '#facc15', false],
  college: ['College', '#fbbf24', false], police: ['Police station', '#60a5fa', true], fire: ['Fire station', '#f97316', true],
  power: ['Power station', '#a78bfa', true],
};
const FAC_GROUPS = [
  { id: 'health', label: 'Hospitals & clinics', color: '#f43f5e', kinds: ['hospital', 'clinic'] },
  { id: 'edu', label: 'Schools & colleges', color: '#facc15', kinds: ['school', 'college'] },
  { id: 'emer', label: 'Police & fire', color: '#60a5fa', kinds: ['police', 'fire'] },
  { id: 'power', label: 'Power stations & grid', color: '#a78bfa', kinds: ['power'] },
];
const MAX_FAC_ALERTS = 40;    // facility rows in the alerts list (earliest first)
const HUD_MS = 120;           // while playing, panel text/chart refresh at most this often

const css = `
#twinBtn svg{width:14px;height:14px;stroke:currentColor;fill:none;stroke-width:1.6;margin-right:5px}
#twin{left:14px;top:112px;width:318px;max-height:calc(100% - 190px);overflow:auto;z-index:7;padding:0;font-size:12px;display:none;
  background:linear-gradient(165deg,rgba(7,20,40,.94),rgba(3,9,22,.9));border:1px solid rgba(34,211,238,.32);
  box-shadow:0 0 0 1px rgba(34,211,238,.06),0 18px 50px -18px #000,inset 0 0 40px rgba(34,211,238,.06);scrollbar-width:thin;scrollbar-color:rgba(34,211,238,.3) transparent}
#twin.show{display:block;animation:twIn .5s cubic-bezier(.2,.8,.2,1)}
@keyframes twIn{from{opacity:0;transform:translateX(-14px)}to{opacity:1;transform:none}}
#twin::before,#twin::after{content:'';position:absolute;width:14px;height:14px;border:2px solid #22d3ee;pointer-events:none}
#twin::before{top:-1px;left:-1px;border-right:0;border-bottom:0;border-top-left-radius:14px}
#twin::after{bottom:-1px;right:-1px;border-left:0;border-top:0;border-bottom-right-radius:14px}
#twin .tw-head{padding:12px 13px 10px;border-bottom:1px solid rgba(34,211,238,.16);background:linear-gradient(180deg,rgba(34,211,238,.08),transparent)}
#twin h3{margin:0;font-size:13px;letter-spacing:.14em;text-transform:uppercase;display:flex;align-items:center;gap:8px;color:#e6fbff}
#twin h3 .dot{width:8px;height:8px;border-radius:50%;background:#22d3ee;box-shadow:0 0 0 0 rgba(34,211,238,.7);animation:twPulse 1.8s infinite}
@keyframes twPulse{0%{box-shadow:0 0 0 0 rgba(34,211,238,.7)}70%{box-shadow:0 0 0 8px rgba(34,211,238,0)}100%{box-shadow:0 0 0 0 rgba(34,211,238,0)}}
#twin h3 .live{margin-left:auto;font-size:9px;font-weight:800;letter-spacing:.12em;color:#fda4af;background:rgba(244,63,94,.14);border:1px solid rgba(244,63,94,.35);padding:2px 7px;border-radius:99px}
#twin .coord{margin-top:4px;font:10px ui-monospace,Consolas,monospace;color:#5eead4;letter-spacing:.06em;opacity:.85}
#twin .tw-body{padding:10px 13px 12px}
#twin .clock{display:flex;align-items:baseline;justify-content:space-between;margin-top:9px}
#twin .clock b{font:700 22px ui-monospace,Consolas,monospace;color:#fff;letter-spacing:.04em;text-shadow:0 0 14px rgba(34,211,238,.55)}
#twin .clock span{font:10px ui-monospace,Consolas,monospace;color:#7dd3fc;text-transform:uppercase;letter-spacing:.08em}
#twin label{display:block;color:#7fa6c4;font-size:9.5px;margin:9px 0 4px;text-transform:uppercase;letter-spacing:.12em}
#twin select,#twin input[type=range]{width:100%;accent-color:#22d3ee}
#twin select{background:rgba(34,211,238,.05);border:1px solid rgba(34,211,238,.22);border-radius:8px;padding:5px 7px;color:#e6fbff;font-size:12px}
#twin select:focus{outline:none;border-color:#22d3ee;box-shadow:0 0 0 2px rgba(34,211,238,.2)}
#twin select option{color:#111}
#twin .vrow{display:flex;justify-content:space-between;color:#e6fbff;font:600 10.5px ui-monospace,Consolas,monospace;letter-spacing:0}
#twin .btns{display:flex;gap:6px;margin-top:10px}
#twin .btns button{flex:1;border:1px solid rgba(34,211,238,.25);background:rgba(34,211,238,.06);color:#e6fbff;border-radius:9px;padding:7px 0;cursor:pointer;font-weight:700;letter-spacing:.06em;transition:background .2s,box-shadow .2s}
#twin .btns button:hover{background:rgba(34,211,238,.14)}
#twin .btns button.primary{background:linear-gradient(135deg,#0891b2,#2563eb);border-color:#22d3ee;box-shadow:0 0 18px -4px rgba(34,211,238,.8)}
#twin .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:5px;margin-top:10px}
#twin .stat{background:rgba(34,211,238,.05);border:1px solid rgba(34,211,238,.13);border-radius:8px;padding:6px 7px;min-width:0}
#twin .stat b{display:block;font:700 13px ui-monospace,Consolas,monospace;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#twin .stat span{display:block;color:#7fa6c4;font-size:8.5px;text-transform:uppercase;letter-spacing:.08em;margin-top:2px;line-height:1.25}
#twin .chartbox{margin-top:10px;border:1px solid rgba(34,211,238,.16);border-radius:9px;background:rgba(2,8,20,.55);padding:4px}
#twin canvas#twChart{display:block;width:100%;height:92px}
#twin .tabs{display:flex;gap:4px;margin-top:11px;border-bottom:1px solid rgba(34,211,238,.16)}
#twin .tabs button{flex:1;background:none;border:0;border-bottom:2px solid transparent;color:#7fa6c4;font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;padding:6px 0;cursor:pointer}
#twin .tabs button.on{color:#e6fbff;border-bottom-color:#22d3ee;text-shadow:0 0 10px rgba(34,211,238,.6)}
#twin .tabs button em{font-style:normal;background:#e11d48;color:#fff;border-radius:99px;padding:0 5px;margin-left:4px;font-size:9px}
#twin .pane{display:none}#twin .pane.on{display:block}
#twin .fac{margin-top:10px;border:1px solid rgba(34,211,238,.16);border-radius:9px;background:rgba(2,8,20,.55);padding:7px 9px}
#twin .fac .fh{display:flex;justify-content:space-between;align-items:baseline;font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;color:#5eead4;margin-bottom:4px}
#twin .fac .fh span{font-size:8.5px;letter-spacing:.04em;text-transform:none;color:#5f7f99}
#twin .fac .fr{display:flex;align-items:center;gap:7px;padding:3px 0;border-top:1px solid rgba(34,211,238,.07)}
#twin .fac .fr i{width:8px;height:8px;border-radius:50%;background:var(--c);box-shadow:0 0 6px var(--c);flex:none}
#twin .fac .fr span{flex:1;color:#9cc3dc}
#twin .fac .fr b{font:700 11px ui-monospace,Consolas,monospace;color:#e6fbff}
#twin .fac .fr b.hit{color:#f87171}
#twin .fix{margin-top:9px;font-size:11px;color:#a5f3fc;line-height:1.45}
#twin ul{list-style:none;margin:8px 0 0;padding:0;max-height:180px;overflow:auto}
#twin li{display:flex;gap:6px;padding:5px 0;border-top:1px solid rgba(34,211,238,.1);font-size:11px}
#twin li i{font:10.5px ui-monospace,Consolas,monospace;font-style:normal;color:#7fa6c4;min-width:52px}
#twin li.flood b{color:#fb7185}#twin li.warn b{color:#fbbf24}
#twin .legend{display:flex;align-items:center;gap:5px;margin-top:9px;font-size:10.5px;color:#cbd5e1}
#twin .legend i{width:10px;height:10px;border-radius:2px;display:inline-block;margin-left:4px}
#twin .model{margin-top:6px;font:10px ui-monospace,Consolas,monospace;color:#7fa6c4;line-height:1.5}
#twin .hint{margin-top:9px;font-size:10.5px;color:#7fa6c4;line-height:1.4}
#twin .none{color:#7fa6c4;font-size:11px;padding-top:6px}
#twinBoot{position:absolute;inset:0;z-index:20;display:none;align-items:center;justify-content:center;pointer-events:none;
  background:radial-gradient(ellipse at center,rgba(4,18,36,.86),rgba(2,6,16,.94));color:#a5f3fc;font:600 12px ui-monospace,Consolas,monospace;letter-spacing:.14em}
#twinBoot.show{display:flex}
#twinBoot .core{display:flex;flex-direction:column;align-items:center;gap:10px}
#twinBoot svg{width:120px;height:120px}
#twinBoot .r1{animation:twSpin 2.4s linear infinite;transform-origin:60px 60px}
#twinBoot .r2{animation:twSpin 3.6s linear infinite reverse;transform-origin:60px 60px}
@keyframes twSpin{to{transform:rotate(360deg)}}
#twinBoot .t{font-size:16px;color:#fff;letter-spacing:.32em;text-shadow:0 0 16px rgba(34,211,238,.8)}
#twinBoot .st{font-size:9.5px;color:#5eead4;letter-spacing:.24em}
#twinBoot ul{list-style:none;margin:6px 0 0;padding:0;min-width:250px}
#twinBoot li{font-size:10.5px;color:#7fa6c4;opacity:0;animation:twStep .3s forwards;display:flex;justify-content:space-between;padding:2px 0}
#twinBoot li::after{content:'OK';color:#34d399}
@keyframes twStep{to{opacity:1}}
#twinBoot .bar{width:250px;height:3px;background:rgba(34,211,238,.15);border-radius:3px;overflow:hidden}
#twinBoot .bar i{display:block;height:100%;width:0;background:linear-gradient(90deg,#22d3ee,#818cf8);box-shadow:0 0 10px #22d3ee;animation:twBar 1.5s ease-in-out forwards}
@keyframes twBar{to{width:100%}}
#twinScan{position:absolute;inset:0;z-index:3;pointer-events:none;overflow:hidden;display:none}
#twinScan.go{display:block}
#twinScan::before{content:'';position:absolute;left:50%;top:55%;width:40px;height:40px;border-radius:50%;transform:translate(-50%,-50%);
  border:2px solid rgba(34,211,238,.9);box-shadow:0 0 30px rgba(34,211,238,.7),inset 0 0 30px rgba(34,211,238,.4);animation:twScan 1.8s ease-out forwards}
#twinScan::after{content:'';position:absolute;inset:0;background:repeating-linear-gradient(0deg,rgba(34,211,238,.06) 0 1px,transparent 1px 4px);animation:twFade 1.8s ease-out forwards}
@keyframes twScan{to{width:2600px;height:2600px;opacity:0;border-width:1px}}
@keyframes twFade{to{opacity:0}}
.twin-probe .mapboxgl-popup-content{background:linear-gradient(165deg,rgba(7,20,40,.96),rgba(3,9,22,.94))!important;border:1px solid rgba(34,211,238,.45)!important;
  box-shadow:0 0 24px -6px rgba(34,211,238,.6)!important;color:#e6fbff!important;padding:10px 12px!important;border-radius:10px!important;font:11px ui-sans-serif,Segoe UI,sans-serif}
.twin-probe .mapboxgl-popup-tip{border-top-color:rgba(34,211,238,.45)!important;border-bottom-color:rgba(34,211,238,.45)!important}
.twin-probe h4{margin:0 0 6px;font-size:10px;letter-spacing:.16em;color:#5eead4;text-transform:uppercase}
.twin-probe .row{display:flex;justify-content:space-between;gap:14px;padding:2px 0;border-top:1px solid rgba(34,211,238,.08)}
.twin-probe .row span{color:#7fa6c4}.twin-probe .row b{font-family:ui-monospace,Consolas,monospace}
.twin-probe .big{font:700 20px ui-monospace,Consolas,monospace;color:#fff;text-shadow:0 0 12px rgba(34,211,238,.6)}
.twin-probe svg{display:block;margin-top:6px}
.tw-crosshair{width:34px;height:34px;pointer-events:none}
.tw-crosshair::before,.tw-crosshair::after{content:'';position:absolute;inset:0;border:1.5px solid #22d3ee;border-radius:50%;animation:twRing 1.6s ease-out infinite}
.tw-crosshair::after{animation-delay:.8s}
@keyframes twRing{from{transform:scale(.3);opacity:1}to{transform:scale(1.6);opacity:0}}
.tw-beacon{display:flex;flex-direction:column;align-items:center;pointer-events:none}
.tw-beacon .tag{background:rgba(3,9,22,.88);border:1px solid var(--bc,#22d3ee);border-radius:6px;padding:3px 7px;text-align:center;box-shadow:0 0 14px -2px var(--bc,#22d3ee)}
.tw-beacon .tag b{display:block;font:700 13px ui-monospace,Consolas,monospace;color:#fff}
.tw-beacon .tag span{display:block;font-size:8px;letter-spacing:.14em;color:var(--bc,#22d3ee)}
.tw-beacon .beam{width:2px;height:46px;background:linear-gradient(180deg,var(--bc,#22d3ee),transparent);box-shadow:0 0 8px var(--bc,#22d3ee)}
.tw-beacon .base{width:16px;height:16px;border-radius:50%;border:2px solid var(--bc,#22d3ee);margin-top:-8px;animation:twRing 1.8s ease-out infinite}
#twLoc{position:absolute;left:346px;right:14px;margin:0 auto;width:fit-content;bottom:118px;transform:translateY(10px);z-index:4;pointer-events:none;opacity:0;
  transition:opacity .45s,transform .6s cubic-bezier(.2,.8,.2,1);text-align:center;min-width:260px;max-width:min(560px,80%);padding:10px 26px 11px;
  background:linear-gradient(90deg,transparent,rgba(3,9,22,.86) 16%,rgba(3,9,22,.86) 84%,transparent);color:#e6fbff;font:12px ui-sans-serif,Segoe UI,sans-serif}
#twLoc.show{opacity:1;transform:none}
@media (max-width:760px){#twLoc{left:14px;bottom:96px}}
#twLoc .k{font-size:9.5px;letter-spacing:.28em;color:#5eead4;text-transform:uppercase}
#twLoc .n{font:700 22px/1.2 ui-sans-serif,Segoe UI,sans-serif;letter-spacing:.03em;color:#fff;text-shadow:0 0 14px rgba(34,211,238,.55);margin:3px 0 1px;overflow-wrap:anywhere}
#twLoc .s{font-size:11px;color:#9cc3dc}
#twLoc .m{margin-top:6px;padding-top:5px;border-top:1px solid rgba(34,211,238,.25);font:11px ui-monospace,Consolas,monospace;color:#a5f3fc}
.tw-zone{--bc:#a5f3fc}
.tw-zone .tag b{font:700 12px ui-sans-serif,Segoe UI,sans-serif;max-width:180px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.marker.twin-warn{background:#b45309!important;color:#fff!important}
.marker.twin-flood{background:#b91c1c!important;color:#fff!important;box-shadow:0 0 14px #ef4444}
`;

function ready() {
  return window.map && window.mapboxgl && window.water && window.floodDatasets && window.setFloodDataset;
}
(function boot() { if (!ready()) { setTimeout(boot, 120); return; } init(); })();

function init() {
  const map = window.map, water = window.water;
  const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);

  /* ----------------------------------------------------------------- DOM */
  const toolbar = $('maptoolbar'), wrap = $('mapwrap');
  const btn = document.createElement('button');
  btn.className = 'tabbtn'; btn.id = 'twinBtn';
  btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 8v8M8.5 10l3.5 2 3.5-2" opacity=".7"/></svg>Digital Twin';
  const divider = toolbar.querySelector('.divider');
  toolbar.insertBefore(btn, divider);

  const opts = (o) => Object.entries(o).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
  const panel = document.createElement('div');
  panel.id = 'twin'; panel.className = 'panel';
  panel.innerHTML = `
    <div class="tw-head">
      <h3><span class="dot"></span>Digital Twin <span class="live">LIVE · PAKISTAN</span></h3>
      <div class="coord" id="twCoord">—</div>
      <div class="clock"><b id="twClockBig">T+00:00</b><span id="twPhase">Standby</span></div>
      <input id="twTime" type="range" min="0" max="1000" step="1" value="0" style="margin-top:6px">
      <div class="btns"><button class="primary" id="twPlay">▶ Play</button><button id="twReset">Reset</button></div>
    </div>
    <div class="tw-body">
      <div class="grid">
        <div class="stat"><b id="twRain">0 mm</b><span>Rain fallen</span></div>
        <div class="stat"><b id="twArea">0 km²</b><span id="twAreaL">Flooded area</span></div>
        <div class="stat"><b id="twBld">–</b><span id="twBldL">Buildings flooded</span></div>
        <div class="stat"><b id="twDepth">–</b><span id="twDepthL">Average depth</span></div>
        <div class="stat" title="Residents inside the flooded area · WorldPop 2020 (UN-adjusted, 1 km)"><b id="twPop">0</b><span id="twPopL">People in flooded area</span></div>
        <div class="stat"><b id="twCities">0</b><span>Cities alerted</span></div>
      </div>
      <div class="chartbox"><canvas id="twChart"></canvas></div>
      <div class="fac" title="OpenStreetMap facilities inside the flood water (in the selected region) / all mapped there">
        <div class="fh">Critical facilities in water <span id="twFacSrc">OpenStreetMap</span></div>
        ${FAC_GROUPS.map((g) => `<div class="fr"><i style="--c:${g.color}"></i><span>${g.label}</span><b id="twFac-${g.id}">–</b></div>`).join('')}
      </div>
      <div class="tabs" id="twTabs">
        <button data-tab="scn" class="on">Scenario</button><button data-tab="ana">Analysis</button><button data-tab="alr">Alerts<em id="twAlertN" hidden>0</em></button>
      </div>
      <div class="pane on" data-pane="scn">
        <label>Region</label><select id="twRegion">${opts(REGIONS)}</select>
        <label>Flood dataset</label>
        <select id="twYear"><option value="2022">2022 monsoon floods</option><option value="2026">2026 river scenario</option></select>
        <label>Rainfall intensity <span class="vrow" style="display:inline;float:right"><span id="twIntV">50 mm/h</span></span></label>
        <input id="twInt" type="range" min="5" max="150" step="5" value="50">
        <label>Duration <span class="vrow" style="display:inline;float:right"><span id="twDurV">8 h</span></span></label>
        <input id="twDur" type="range" min="1" max="72" step="1" value="8">
        <label>Test a fix</label><select id="twFix">${opts(MITIGATIONS)}</select>
        <label>Camera</label>
        <select id="twCam"><option value="overview">Overview (static)</option><option value="drone">Drone route (follows the flood)</option></select>
        <label>Drone zoom level <span class="vrow" style="display:inline;float:right"><span id="twZoomV">11</span></span></label>
        <input id="twZoom" type="range" min="7" max="17" step="0.5" value="11">
        <label>Playback speed</label>
        <select id="twSpeed"><option value="0.5">Slow (3 min)</option><option value="1" selected>Normal (90 s)</option><option value="2">Fast (45 s)</option></select>
      </div>
      <div class="pane" data-pane="ana">
        <div class="fix" id="twFixOut"></div>
        <div id="twUrban">
          <div class="legend"><i style="background:#facc15"></i>15–50 cm <i style="background:#f97316"></i>0.5–1 m <i style="background:#dc2626"></i>&gt;1 m</div>
          <div class="model" id="twModel"></div>
        </div>
        <div class="hint">Click anywhere on the map to probe the water depth there.</div>
      </div>
      <div class="pane" data-pane="alr">
        <ul id="twAlerts"></ul>
      </div>
      <span id="twClock" hidden></span>
    </div>`;
  wrap.appendChild(panel);
  const boot = document.createElement('div');
  boot.id = 'twinBoot';
  const scan = document.createElement('div');
  scan.id = 'twinScan';
  wrap.appendChild(scan);
  const locCard = document.createElement('div');   // "now over" title for the drone's flood zone
  locCard.id = 'twLoc';
  wrap.appendChild(locCard);
  function bootMarkup() {
    const steps = ['Satellite basemap', 'SRTM terrain model', 'Flood datasets 2022 · 2026', 'Hydrology engine', 'Water renderer'];
    boot.innerHTML = `<div class="core">
      <svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="54" fill="none" stroke="rgba(34,211,238,.18)" stroke-width="1"/>
        <circle class="r1" cx="60" cy="60" r="54" fill="none" stroke="#22d3ee" stroke-width="2" stroke-dasharray="60 280" stroke-linecap="round"/>
        <circle class="r2" cx="60" cy="60" r="42" fill="none" stroke="#818cf8" stroke-width="1.5" stroke-dasharray="20 30"/>
        <path d="M60 38l19 11v22L60 82 41 71V49z" fill="none" stroke="#a5f3fc" stroke-width="1.5"/>
        <path d="M60 50v18M53 54l7 4 7-4" fill="none" stroke="#a5f3fc" stroke-width="1.2" opacity=".7"/></svg>
      <div class="t">DIGITAL TWIN</div><div class="st">PAKISTAN FLOOD INTELLIGENCE</div>
      <div class="bar"><i></i></div>
      <ul>${steps.map((x, i) => `<li style="animation-delay:${0.15 + i * 0.25}s">${x}</li>`).join('')}</ul></div>`;
  }
  wrap.appendChild(boot);

  /* ---------------------------------------------------------------- state */
  let active = false, playing = false, p = 0;            // p = timeline 0..1
  let raf = 0, lastTs = 0;
  let prevFlood = false, prevRivers = false, prevTerrain = false, prevYear = '2022';
  let sheets = [], places = [];
  let route = [], camHold = 0;   // drone waypoints + time until which the intro fly owns the camera
  let droneMoving = false;   // true while the drone moves the map (its moveend must not re-render)
  let hudAt = 0;             // last panel text/chart refresh

  const rain = () => +$('twInt').value;
  const dur = () => +$('twDur').value;
  const cut = () => MITIGATIONS[$('twFix').value].cut;
  const spread = (c) => Math.min(1, (rain() * dur() * (1 - c)) / FULL_SPREAD_MM);   // final grow value
  const growAt = (pp, c) => spread(c) * pp;

  /* ------------------------------------------------------- precompute data */
  function inRegion(lng, lat, bbox) { return !bbox || (lng >= bbox[0] && lng <= bbox[2] && lat >= bbox[1] && lat <= bbox[3]); }
  const rings = (g) => g.type === 'MultiPolygon' ? g.coordinates.map((poly) => poly[0]) : [g.coordinates[0]];
  function inside(ring, x, y) {
    let c = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  }
  function prepare() {
    const fc = window.floodDatasets[$('twYear').value];
    sheets = fc.features.map((f) => {
      const rs = rings(f.geometry);
      let w = 180, s = 90, e = -180, n = -90;
      for (const r of rs) for (const [x, y] of r) { if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y; }
      return { f, rs, bbox: [w, s, e, n], area: f.properties.area_km2 || 0, pop: f.properties.pop || 0, r: f.properties.reveal != null ? f.properties.reveal : 0, cx: (w + e) / 2, cy: (s + n) / 2 };
    });
    window.fetch('./public/places.geojson').then((r) => r.json()).then((pc) => {
      places = pc.features.filter((f) => f.properties.country === 'Pakistan').map((f) => {
        const [x, y] = f.geometry.coordinates;
        let flood = Infinity, warn = Infinity;
        for (const sh of sheets) {
          const b = sh.bbox;
          if (x < b[0] - NEAR_DEG || x > b[2] + NEAR_DEG || y < b[1] - NEAR_DEG || y > b[3] + NEAR_DEG) continue;
          if (sh.rs.some((r) => inside(r, x, y))) { if (sh.r < flood) flood = sh.r; continue; }
          if (sh.r >= warn) continue;
          outer: for (const r of sh.rs) for (let i = 0; i < r.length; i += 2) {
            const dx = r[i][0] - x, dy = r[i][1] - y;
            if (dx * dx + dy * dy < NEAR_DEG * NEAR_DEG) { warn = sh.r; break outer; }
          }
        }
        const level = flood < Infinity ? 'flood' : warn < Infinity ? 'warn' : null;
        return { name: f.properties.name, xy: [x, y], pop: f.properties.pop || 0, level, trig: level === 'flood' ? flood : warn };
      }).filter((pl) => pl.level);
      render();
    });
  }
  /* residents (WorldPop 2020, 1 km, area-weighted per sheet) under water at grow g */
  function popAt(g, bbox) {
    let n = 0;
    for (const sh of sheets) {
      if (!inRegion(sh.cx, sh.cy, bbox)) continue;
      const k = (g - sh.r) / WINDOW;
      n += sh.pop * (k <= 0 ? 0 : k >= 1 ? 1 : k);
    }
    return n;
  }
  function areaAt(g, bbox) {
    let a = 0;
    for (const sh of sheets) {
      if (!inRegion(sh.cx, sh.cy, bbox)) continue;
      const k = (g - sh.r) / WINDOW;
      a += sh.area * (k <= 0 ? 0 : k >= 1 ? 1 : k);
    }
    return a;
  }

  /* --------------------------------------------------------------- render */
  const fmt = (n) => Math.round(n).toLocaleString();
  const hhmm = (h) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;
  function render() {
    const c = cut(), bbox = REGIONS[$('twRegion').value].bbox;
    const hours = p * totalH(), g = growAt(Math.min(1, hours / dur()), c);   // rivers peak when the storm ends
    water.setGrow(g); updateFloodLayers(g);
    const urbanKm2 = updateUrban(p);
    $('twClock').textContent = 'T+' + hhmm(hours) + (hours > dur() ? ' · rain stopped' : '');
    $('twClockBig').textContent = 'T+' + hhmm(hours);
    $('twPhase').textContent = p <= 0 ? 'Standby' : hours < dur() ? `Storm · ${rain()} mm/h` : p >= 1 ? 'Scenario complete' : 'Recession · rain stopped';
    $('twTime').value = Math.round(p * 1000);
    const now = performance.now();
    if (playing && now - hudAt < HUD_MS) return;   // water + clock every frame, the rest ~8x/s
    hudAt = now;
    $('twRain').textContent = fmt(rain() * Math.min(hours, dur())) + ' mm';
    // city mode: the tile shows the simulated street flooding; river sheets are in the fix line
    const city = urbanOn() && hydro.status === 'ready', area = city ? urbanKm2 : areaAt(g, bbox);
    $('twAreaL').textContent = city ? 'Street flooding (model area)' : 'Flooded area';
    $('twArea').textContent = (area < 10 ? area.toFixed(2) : fmt(area)) + ' km²';
    // alerts: places whose flood/near trigger the clock has passed
    const fired = places.filter((pl) => g >= pl.trig && g > 0 && inRegion(pl.xy[0], pl.xy[1], bbox));
    $('twPop').textContent = city ? (hydro.popCell ? fmt(urbanPeople) : popGrid === false ? 'n/a' : 'loading…') : fmt(popAt(g, bbox));
    $('twPopL').textContent = city ? 'People in flooded streets' : 'People in flooded area';
    $('twCities').textContent = fired.length;
    const sorted = fired.slice().sort((a, b) => a.trig - b.trig);
    const facAlerts = updateFacilities(g, bbox, city ? hydro.cur : null) || [];
    const rows = sorted.map((pl) => {
      const t = spread(c) > 0 ? (pl.trig / spread(c)) * dur() : 0;
      return { t, html: `<li class="${pl.level}"><i>T+${hhmm(t)}</i><b>${pl.level === 'flood' ? 'FLOOD' : 'WARNING'}</b> ${esc(pl.name)}</li>` };
    }).concat(facAlerts.slice(0, MAX_FAC_ALERTS).map((a) => ({ t: a.t,
      html: `<li class="flood"><i>T+${hhmm(a.t)}</i><b>${FAC_KIND[a.kind][0].toUpperCase()}</b> ${esc(a.name || 'unnamed (OSM)')}</li>` })))
      .sort((a, b) => a.t - b.t);
    const more = facAlerts.length - MAX_FAC_ALERTS;
    $('twAlerts').innerHTML = rows.length ? rows.map((x) => x.html).join('') + (more > 0 ? `<div class="none">+ ${fmt(more)} more flooded facilities</div>` : '')
      : '<div class="none">No alerts yet</div>';
    const nAlerts = sorted.length + facAlerts.length;
    $('twAlertN').hidden = !nAlerts; $('twAlertN').textContent = nAlerts;
    document.querySelectorAll('.marker').forEach((el) => {
      const hit = fired.find((pl) => pl.name === el.textContent);
      el.classList.toggle('twin-flood', !!hit && hit.level === 'flood');
      el.classList.toggle('twin-warn', !!hit && hit.level === 'warn');
    });
    const base = areaAt(growAt(1, 0), bbox), fixed = areaAt(growAt(1, c), bbox);
    const basePop = popAt(growAt(1, 0), bbox), fixedPop = popAt(growAt(1, c), bbox);
    $('twFixOut').textContent = (c > 0
      ? `River flooding: ${fmt(base)} → ${fmt(fixed)} km², ${fmt(basePop)} → ${fmt(fixedPop)} residents with this fix (spares ${fmt(basePop - fixedPop)} people).`
      : `River flooding if the storm runs its full course: ${fmt(base)} km², ${fmt(basePop)} residents.`) + (urbanOn() ? urbanFixText() : '');
    drawChart(); updateProbe(); updateCoord();
  }

  /* =================================================================== HUD
     Telemetry chart, click-to-probe readout, hotspot beacons, live camera
     readout. All values come from the running scenario (hydrology frames in
     city mode, the river-sheet replay elsewhere). */
  const chart = $('twChart'), cctx = chart.getContext('2d');
  let series = null, seriesKey = '';
  function getSeries() {
    const city = urbanOn() && hydro.status === 'ready' && hydro.res;
    const key = city ? 'c' + hydro.req + '|' + (hydro.bldCell ? hydro.bldCell.length : 0)
      : ['r', $('twRegion').value, $('twYear').value, rain(), dur(), $('twFix').value, sheets.length].join('|');
    if (key === seriesKey) return series;
    seriesKey = key;
    if (city) {
      const fr = hydro.res.frames, cell = hydro.bldCell;
      series = { city: true, area: hydro.res.stats.map((st) => st.wetKm2),
        bld: cell ? fr.map((f) => { let n = 0; for (const c of cell) if (c >= 0 && f[c] >= BLD_WET_M) n++; return n; }) : null };
    } else {
      const bbox = REGIONS[$('twRegion').value].bbox, c = cut(), N = 120, area = [];
      for (let i = 0; i < N; i++) { const h = (i / (N - 1)) * totalH(); area.push(areaAt(growAt(Math.min(1, h / dur()), c), bbox)); }
      series = { city: false, area, bld: null };
    }
    return series;
  }
  function drawChart() {
    if (!active || !chart.clientWidth) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1), W = chart.clientWidth, H = chart.clientHeight;
    if (chart.width !== Math.round(W * dpr)) { chart.width = Math.round(W * dpr); chart.height = Math.round(H * dpr); }
    const g = cctx; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    const S = getSeries(), L = 6, R = W - 6, T = 16, B = H - 13, cw = R - L, ch = B - T;
    const x = (t) => L + t * cw, stormX = x(dur() / totalH());
    g.font = '9px ui-monospace,Consolas,monospace';
    // grid
    g.strokeStyle = 'rgba(34,211,238,.08)'; g.lineWidth = 1;
    for (let i = 0; i <= 4; i++) { const y = T + (ch * i) / 4 + 0.5; g.beginPath(); g.moveTo(L, y); g.lineTo(R, y); g.stroke(); }
    // rainfall band (hyetograph) across the storm
    g.fillStyle = 'rgba(56,189,248,.16)'; g.fillRect(L, T - 6, stormX - L, 4);
    g.setLineDash([3, 3]); g.strokeStyle = 'rgba(165,243,252,.35)'; g.beginPath(); g.moveTo(stormX + 0.5, T - 6); g.lineTo(stormX + 0.5, B); g.stroke(); g.setLineDash([]);
    const plot = (arr, color, fill, dashed) => {
      const mx = Math.max(1e-9, ...arr), n = arr.length;
      const pt = (i) => [x(i / (n - 1)), B - (arr[i] / mx) * ch];
      g.beginPath(); arr.forEach((_, i) => { const [px, py] = pt(i); i ? g.lineTo(px, py) : g.moveTo(px, py); });
      if (fill) {
        g.save(); g.lineTo(R, B); g.lineTo(L, B); g.closePath();
        const gr = g.createLinearGradient(0, T, 0, B); gr.addColorStop(0, 'rgba(34,211,238,.45)'); gr.addColorStop(1, 'rgba(34,211,238,0)');
        g.fillStyle = gr; g.fill(); g.restore();
        g.beginPath(); arr.forEach((_, i) => { const [px, py] = pt(i); i ? g.lineTo(px, py) : g.moveTo(px, py); });
      }
      g.strokeStyle = color; g.lineWidth = 1.6; if (dashed) g.setLineDash([4, 3]);
      g.shadowColor = color; g.shadowBlur = 8; g.stroke(); g.shadowBlur = 0; g.setLineDash([]);
      return { mx, pt, n };
    };
    const A = plot(S.area, '#22d3ee', true, false);
    if (S.bld) plot(S.bld, '#fbbf24', false, true);
    // peak marker
    let pk = 0; S.area.forEach((v, i) => { if (v > S.area[pk]) pk = i; });
    if (S.area[pk] > 0) {
      const [px, py] = A.pt(pk);
      g.fillStyle = '#fff'; g.beginPath(); g.moveTo(px, py - 3); g.lineTo(px - 3.5, py - 9); g.lineTo(px + 3.5, py - 9); g.closePath(); g.fill();
      const v = S.area[pk], txt = 'PEAK ' + (v < 10 ? v.toFixed(2) : fmt(v)) + ' km²';
      g.fillStyle = '#e6fbff'; g.textAlign = px > W * 0.6 ? 'right' : 'left'; g.fillText(txt, px + (px > W * 0.6 ? -6 : 6), Math.max(T + 2, py - 4));
    }
    // playhead
    const hx = x(p), fi = p * (A.n - 1), i0 = Math.floor(fi), i1 = Math.min(A.n - 1, i0 + 1);
    const yv = A.pt(i0)[1] + (A.pt(i1)[1] - A.pt(i0)[1]) * (fi - i0);
    g.strokeStyle = 'rgba(255,255,255,.75)'; g.lineWidth = 1; g.beginPath(); g.moveTo(hx + 0.5, T - 6); g.lineTo(hx + 0.5, B); g.stroke();
    g.fillStyle = '#fff'; g.shadowColor = '#22d3ee'; g.shadowBlur = 10; g.beginPath(); g.arc(hx, yv, 3.2, 0, Math.PI * 2); g.fill(); g.shadowBlur = 0;
    // labels
    g.textAlign = 'left'; g.fillStyle = '#22d3ee'; g.fillText(S.city ? 'STREET FLOOD km²' : 'FLOODED km²', L, 8);
    if (S.bld) { g.fillStyle = '#fbbf24'; g.fillText('BUILDINGS', L + 104, 8); }
    g.textAlign = 'right'; g.fillStyle = '#7dd3fc'; g.fillText('RAIN ' + rain() + ' mm/h', R, 8);
    g.fillStyle = '#5b7a94'; g.textAlign = 'left'; g.fillText('T+0', L, H - 2);
    g.textAlign = 'right'; g.fillText('T+' + Math.round(totalH()) + 'h', R, H - 2);
    g.textAlign = 'center'; g.fillText('rain stops', Math.min(R - 30, Math.max(L + 30, stormX)), H - 2);
  }

  /* ---- live camera readout */
  function updateCoord() {
    const c = map.getCenter();
    $('twCoord').textContent = `${c.lat.toFixed(4)}°N  ${c.lng.toFixed(4)}°E  ·  Z${map.getZoom().toFixed(1)}  ·  P${Math.round(map.getPitch())}°  ·  B${Math.round((map.getBearing() + 360) % 360)}°`;
  }
  let coordRaf = 0;
  map.on('move', () => { if (active && !coordRaf) coordRaf = requestAnimationFrame(() => { coordRaf = 0; updateCoord(); }); });

  /* ---- click-to-probe */
  let probe = null, probeT = 0;
  map.on('click', (e) => {
    if (!active) return;
    const t = e.originalEvent && e.originalEvent.target;
    if (t && t.closest && t.closest('.mapboxgl-popup,.mapboxgl-marker,.panel')) return;
    setProbe(e.lngLat);
  });
  function clearProbe() {
    if (!probe) return;
    const pr = probe; probe = null;
    pr.marker.remove(); pr.popup.remove();
  }
  function setProbe(ll) {
    clearProbe();
    const el = document.createElement('div'); el.className = 'tw-crosshair';
    const marker = new window.mapboxgl.Marker({ element: el }).setLngLat(ll).addTo(map);
    const popup = new window.mapboxgl.Popup({ className: 'twin-probe', closeButton: true, closeOnClick: false, offset: 18, maxWidth: '250px' })
      .setLngLat(ll).setHTML('').addTo(map);
    probe = { ll, marker, popup };
    popup.on('close', () => { if (probe && probe.popup === popup) { probe.marker.remove(); probe = null; } });
    probeT = 0; updateProbe(true);
  }
  function probeHTML(ll) {
    const row = (k, v) => `<div class="row"><span>${k}</span><b>${v}</b></div>`;
    const head = `<h4>◎ Probe · ${ll.lat.toFixed(4)}, ${ll.lng.toFixed(4)}</h4>`;
    const dom = hydro.dom, r = hydro.res;
    if (urbanOn() && hydro.status === 'ready' && r && dom) {
      const [w, s0, e, n] = dom.bbox;
      if (ll.lng >= w && ll.lng <= e && ll.lat >= s0 && ll.lat <= n) {
        const c = Math.min(GRID - 1, Math.floor(((ll.lng - w) / (e - w)) * GRID)), rr = Math.min(GRID - 1, Math.floor(((n - ll.lat) / (n - s0)) * GRID));
        const k = rr * GRID + c, now = hydro.cur ? hydro.cur[k] : 0, series = r.frames.map((f) => f[k]);
        let pk = 0; series.forEach((v, i) => { if (v > series[pk]) pk = i; });
        const pkH = (pk / (series.length - 1)) * totalH(), mx = Math.max(0.05, series[pk]);
        const W = 220, H = 44, path = series.map((v, i) => `${i ? 'L' : 'M'}${((i / (series.length - 1)) * W).toFixed(1)},${(H - (v / mx) * (H - 4)).toFixed(1)}`).join('');
        const status = now >= 1 ? '<span style="color:#f87171">SEVERE</span>' : now >= 0.5 ? '<span style="color:#fb923c">DEEP</span>'
          : now >= BLD_WET_M ? '<span style="color:#facc15">FLOODED</span>' : now >= WET_M ? '<span style="color:#7dd3fc">PONDING</span>' : '<span style="color:#34d399">DRY</span>';
        return head + `<div style="display:flex;justify-content:space-between;align-items:baseline"><span class="big">${now.toFixed(2)} m</span><b>${status}</b></div>`
          + row('Ground elevation', r.z[k].toFixed(1) + ' m')
          + row('Peak depth', series[pk].toFixed(2) + ' m @ T+' + hhmm(pkH))
          + row('First wet', r.tWet[k] >= 0 ? 'T+' + hhmm(r.tWet[k]) : 'never')
          + (popGrid ? row('Population density', fmt(densityAt(ll.lng, ll.lat)) + ' /km²') : '')
          + `<svg width="${W}" height="${H}"><path d="${path}L${W},${H}L0,${H}Z" fill="rgba(34,211,238,.18)"/><path d="${path}" fill="none" stroke="#22d3ee" stroke-width="1.5"/>`
          + `<line x1="${(p * W).toFixed(1)}" x2="${(p * W).toFixed(1)}" y1="0" y2="${H}" stroke="#fff" stroke-width="1" opacity=".8"/></svg>`;
      }
    }
    // outside the city model: river flood sheets
    const hit = sheets.find((sh) => ll.lng >= sh.bbox[0] && ll.lng <= sh.bbox[2] && ll.lat >= sh.bbox[1] && ll.lat <= sh.bbox[3] && sh.rs.some((ring) => inside(ring, ll.lng, ll.lat)));
    if (!hit) return head + `<div class="big" style="font-size:15px">NO RIVER FLOOD</div>` + row('Dataset', $('twYear').value + ' flood extent')
      + (isCity() ? row('Street model', 'zoom in past 12.5') : '');
    const sp = spread(cut()), reach = hit.r <= sp;
    const tFlood = sp > 0 ? (hit.r / sp) * dur() : 0, g = growAt(Math.min(1, (p * totalH()) / dur()), cut());
    const fillNow = Math.max(0, Math.min(1, (g - hit.r) / WINDOW));
    return head + `<div class="big" style="font-size:15px">${!reach ? 'SPARED BY SCENARIO' : fillNow >= 1 ? 'INUNDATED' : fillNow > 0 ? 'FLOODING · ' + Math.round(fillNow * 100) + '%' : 'IN FLOOD PATH'}</div>`
      + row('Flood sheet', hit.f.properties.name || 'Flood extent')
      + row('Sheet area', fmt(hit.area) + ' km²')
      + row('Residents (WorldPop)', fmt(hit.pop))
      + row('Water arrives', reach ? 'T+' + hhmm(tFlood) : 'not this storm');
  }
  function updateProbe(force) {
    if (!probe) return;
    const now = performance.now();
    if (!force && now - probeT < 120) return;           // ~8 updates/s while playing
    probeT = now;
    probe.popup.setHTML(probeHTML(probe.ll));
  }

  /* ---- hotspot beacons: the three deepest simulated ponds */
  let beacons = [];
  function clearBeacons() { beacons.forEach((b) => b.marker.remove()); beacons = []; }
  function buildBeacons() {
    clearBeacons();
    const r = hydro.res; if (!r || !ponds.length) return;
    const [w, , e, n] = hydro.dom.bbox, dx = (e - w) / GRID, dy = (n - hydro.dom.bbox[1]) / GRID;
    const ranked = ponds.map((pd, i) => { let k = pd.cells[0]; for (const c of pd.cells) if (r.maxD[c] > r.maxD[k]) k = c; return { i, k, peak: r.maxD[k] }; })
      .sort((a, b) => b.peak - a.peak).slice(0, 3);
    beacons = ranked.map((h, j) => {
      const el = document.createElement('div'); el.className = 'tw-beacon';
      el.innerHTML = `<div class="tag"><b>0.00 m</b><span>HOTSPOT ${j + 1}</span></div><div class="beam"></div><div class="base"></div>`;
      const xy = [w + ((h.k % GRID) + 0.5) * dx, n - (Math.floor(h.k / GRID) + 0.5) * dy];
      return { pond: ponds[h.i], el, val: el.querySelector('b'), marker: new window.mapboxgl.Marker({ element: el, anchor: 'bottom' }).setLngLat(xy).addTo(map) };
    });
  }
  function updateBeacons(d, show) {
    for (const b of beacons) {
      let mx = 0; if (show) for (const k of b.pond.cells) if (d[k] > mx) mx = d[k];
      const on = show && mx >= WET_M;
      b.el.style.display = on ? '' : 'none';
      if (!on) continue;
      b.val.textContent = mx.toFixed(2) + ' m';
      b.el.style.setProperty('--bc', mx >= 1 ? '#f87171' : mx >= 0.5 ? '#fb923c' : mx >= BLD_WET_M ? '#facc15' : '#22d3ee');
    }
  }

  /* ---- tabs */
  $('twTabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tab]'); if (!b) return;
    $('twTabs').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    panel.querySelectorAll('.pane').forEach((x) => x.classList.toggle('on', x.dataset.pane === b.dataset.tab));
    drawChart();
  });

  /* ------------------------------------------- flood depth tint + front glow */
  let lastFilterG = -1;
  function addFloodLayers() {
    try {
      const data = window.floodDatasets[$('twYear').value];
      if (map.getSource('twin-flood')) { map.getSource('twin-flood').setData(data); return; }
      map.addSource('twin-flood', { type: 'geojson', data });
      // earliest-inundated sheets read as deepest; the late edge reads as shallow
      map.addLayer({ id: 'twin-flood-tint', type: 'fill', source: 'twin-flood', filter: ['<=', ['get', 'reveal'], 0],
        paint: { 'fill-color': ['interpolate', ['linear'], ['coalesce', ['get', 'reveal'], 0], 0, '#0a2f7a', 0.42, '#1b78c8', 0.84, '#5fd4f4'], 'fill-opacity': 0.34 } });
      map.addLayer({ id: 'twin-flood-front', type: 'line', source: 'twin-flood', filter: ['<=', ['get', 'reveal'], 0],
        paint: { 'line-color': '#a5f3fc', 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.6, 12, 2.2], 'line-blur': 1.2, 'line-opacity': 0.75 } });
      lastFilterG = -1; lastPaintG = -1;
    } catch (err) { /* style mid-swap */ }
  }
  /* sheets fade in over the last TINT_FADE of the reveal front instead of
     popping; the filter runs a step ahead so upcoming sheets are already laid out */
  let lastPaintG = -1;
  function updateFloodLayers(g) {
    if (!map.getLayer('twin-flood-tint')) return;
    if (lastFilterG < 0 || g > lastFilterG - 0.01 || g < lastFilterG - 0.06) {
      lastFilterG = g + 0.05;
      const f = ['<=', ['get', 'reveal'], lastFilterG];
      map.setFilter('twin-flood-tint', f); map.setFilter('twin-flood-front', f);
    }
    if (Math.abs(g - lastPaintG) < 0.003) return;
    lastPaintG = g;
    const fade = (op) => ['interpolate', ['linear'], ['coalesce', ['get', 'reveal'], 0], g - TINT_FADE, op, g, 0];
    map.setPaintProperty('twin-flood-tint', 'fill-opacity', fade(0.34));
    map.setPaintProperty('twin-flood-front', 'line-opacity', fade(0.75));
  }
  function removeFloodLayers() {
    try {
      ['twin-flood-front', 'twin-flood-tint'].forEach((id) => map.getLayer(id) && map.removeLayer(id));
      if (map.getSource('twin-flood')) map.removeSource('twin-flood');
    } catch (err) { /* style mid-swap */ }
  }

  /* ------------------------------------------------------------- rain
     Full-view storm built from the same elements and CSS animations as the
     dashboard's flood points (effects.js: .rain-drop, .splash, .ripple-ring;
     no lightning), scattered across the whole map instead of
     one 280x220 patch. Density follows the rainfall intensity. */
  const rainLayer = document.createElement('div');
  rainLayer.id = 'twinRain';
  rainLayer.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:4;display:none';
  wrap.appendChild(rainLayer);
  let rainKey = '';
  function buildRain() {
    const w = wrap.clientWidth, h = wrap.clientHeight, mm = rain();
    const key = w + 'x' + h + '|' + mm;
    if (rainKey === key) return;
    rainKey = key;
    rainLayer.textContent = '';
    const area = (w * h) / (280 * 220);              // how many flood-point patches fit in the view
    const sev = mm >= 90 ? 'Very High' : mm >= 40 ? 'High' : 'Medium';
    const perPatch = sev === 'Very High' ? 110 : sev === 'High' ? 85 : 60;   // effects.js densities
    const frag = document.createDocumentFragment();
    const el = (cls, css) => { const d = document.createElement('div'); d.className = cls; Object.assign(d.style, css); frag.appendChild(d); return d; };
    for (let i = 0, n = Math.min(1600, Math.round(area * perPatch)); i < n; i++) {
      const d = el('rain-drop', {
        left: Math.random() * 100 + '%', top: (Math.random() * (h + 140) - 140) + 'px',
        height: 8 + Math.random() * 12 + 'px',
        animationDuration: 0.4 + Math.random() * 0.3 + 's', animationDelay: Math.random() * 1.5 + 's',
      });
      d.style.setProperty('--windOffset', -5 + Math.random() * 10 + 'px');
    }
    for (let i = 0, n = Math.round(area * 8); i < n; i++) {
      el('splash', { left: Math.random() * 100 + '%', top: Math.random() * 100 + '%', bottom: 'auto', animationDelay: Math.random() * 1 + 's' });
    }
    const rings = Math.round(area * (sev === 'Very High' ? 1.2 : sev === 'High' ? 0.9 : 0.6));
    for (let i = 0; i < rings; i++) {
      el('ripple-ring', { left: Math.random() * 100 + '%', top: 15 + Math.random() * 85 + '%', transform: 'translate(-50%, -50%)', animationDelay: Math.random() * 2 + 's' });
    }
    rainLayer.appendChild(frag);
  }
  function startRain() { buildRain(); rainLayer.style.display = ''; }
  function stopRain() { rainLayer.style.display = 'none'; }
  window.addEventListener('resize', () => { if (rainLayer.style.display !== 'none') buildRain(); });

  /* ---------------------------------------------- urban (city) rainfall-runoff
     Flood sheets only cover rivers, so inside a city the flood is simulated:
     hydro-worker.js runs a rainfall-runoff model on a GRID x GRID cell domain
     around the camera (SRTM terrain, runoff from OSM roof cover, storm drains,
     detention storage, downhill routing). Frames come back for the whole storm
     + recession; the timeline scrubs through them. */
  const isCity = () => !!REGIONS[$('twRegion').value].city;
  const urbanOn = () => active && isCity() && map.getZoom() >= 12.5;
  const totalH = () => dur() * (1 + RECESSION);
  const hydro = {
    worker: null, req: 0, dom: null, res: null, cur: null, status: '',
    bld: null, bldKey: '', bldSrc: '', bldCell: null, bldState: null, imperv: null,
  };
  let ponds = [];          // [{ cells:Int32Array, max }] — one water-engine polygon each
  /* WorldPop 2020 1 km density for the city boxes (data/build_population.py) */
  let popGrid = null, urbanPeople = 0;
  fetch('./public/pop_grid.json').then((r) => r.json()).then((j) => { popGrid = j.cities; if (active) render(); })
    .catch((err) => { popGrid = false; console.warn('[twin] population grid:', err.message); });
  function densityAt(lng, lat) {                       // people per km²
    for (const g of Object.values(popGrid || {})) {
      const c = Math.floor((lng - g.west) / g.dx), r = Math.floor((g.north - lat) / g.dy);
      if (c >= 0 && c < g.w && r >= 0 && r < g.h) return g.density[r * g.w + c];
    }
    return 0;
  }
  /* residents per model cell for the current domain */
  function cellPeople() {
    if (!popGrid || !hydro.res || !hydro.dom) return null;
    const [w, , e, n] = hydro.dom.bbox, dx = (e - w) / GRID, dy = (n - hydro.dom.bbox[1]) / GRID;
    const km2 = (hydro.res.cellW * hydro.res.cellH) / 1e6, out = new Float32Array(GRID * GRID);
    for (let k = 0; k < out.length; k++) out[k] = densityAt(w + ((k % GRID) + 0.5) * dx, n - (Math.floor(k / GRID) + 0.5) * dy) * km2;
    return out;
  }
  const fills = new Float32Array(MAX_PONDS), fillTarget = new Float32Array(MAX_PONDS);

  function domainAround(c) {
    // snap the centre so revisits reuse the cached DEM + OSM download
    const lng = Math.round(c.lng / SNAP_DEG) * SNAP_DEG, lat = Math.round(c.lat / SNAP_DEG) * SNAP_DEG;
    const hx = HALF_DEG / Math.cos((lat * Math.PI) / 180);
    const r3 = (v) => +v.toFixed(3);
    return { bbox: [r3(lng - hx), r3(lat - HALF_DEG), r3(lng + hx), r3(lat + HALF_DEG)], center: [lng, lat] };
  }

  /* ---- buildings: OSM via server cache -> Overpass direct -> Mapbox fallback */
  function overpassToGeoJSON(elements) {
    const features = [];
    for (const el of elements) {
      if (el.type !== 'way' || !el.geometry || el.geometry.length < 4) continue;
      const t = el.tags || {};
      const h = parseFloat(t.height) || parseFloat(t['building:levels']) * 3.2 || 7;
      features.push({ type: 'Feature', id: features.length + 1, properties: { h: Math.min(300, h) },
        geometry: { type: 'Polygon', coordinates: [el.geometry.map((q) => [q.lon, q.lat])] } });
    }
    return { type: 'FeatureCollection', features };
  }
  async function fetchBuildings([w, s, e, n]) {
    try {
      const r = await fetch(`/api/osm-buildings?s=${s}&w=${w}&n=${n}&e=${e}`);
      if (r.ok) return { fc: await r.json(), src: 'OpenStreetMap' };
    } catch (err) { /* no local server (static hosting) */ }
    try {
      const q = `[out:json][timeout:60];way["building"](${s},${w},${n},${e});out tags geom;`;
      const r = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: new URLSearchParams({ data: q }) });
      if (r.ok) return { fc: overpassToGeoJSON((await r.json()).elements || []), src: 'OpenStreetMap' };
    } catch (err) { /* Overpass busy / offline */ }
    // last resort: whatever Mapbox Streets building tiles are loaded (sparse in Pakistan)
    const seen = new Map();
    for (const f of map.querySourceFeatures('twin-streets', { sourceLayer: 'building' })) {
      if (f.geometry.type !== 'Polygon') continue;
      const ring = f.geometry.coordinates[0], k = ring[0][0].toFixed(5) + ',' + ring[0][1].toFixed(5);
      if (!seen.has(k)) seen.set(k, { type: 'Feature', id: seen.size + 1, properties: { h: f.properties.height || 7 }, geometry: f.geometry });
    }
    return { fc: { type: 'FeatureCollection', features: [...seen.values()] }, src: 'Mapbox' };
  }
  /* roof cover per cell -> runoff coefficient; building centroid -> cell */
  function indexBuildings() {
    const dom = hydro.dom, fc = hydro.bld;
    hydro.imperv = null; hydro.bldCell = null; hydro.bldState = null;
    if (!dom || !fc) return;
    const [w, s, e, n] = dom.bbox, dx = (e - w) / GRID, dy = (n - s) / GRID;
    const mx = 111320 * Math.cos((dom.center[1] * Math.PI) / 180), my = 110570;
    const roof = new Float32Array(GRID * GRID), cell = new Int32Array(fc.features.length);
    fc.features.forEach((f, k) => {
      const ring = f.geometry.coordinates[0];
      let x = 0, y = 0, a = 0;
      for (let i = 0; i < ring.length; i++) {
        x += ring[i][0]; y += ring[i][1];
        const j = (i + 1) % ring.length;
        a += ring[i][0] * mx * ring[j][1] * my - ring[j][0] * mx * ring[i][1] * my;
      }
      x /= ring.length; y /= ring.length;
      const c = Math.floor((x - w) / dx), r = Math.floor((n - y) / dy);
      if (c < 0 || c >= GRID || r < 0 || r >= GRID) { cell[k] = -1; return; }
      cell[k] = r * GRID + c;
      roof[r * GRID + c] += Math.abs(a) / 2;
    });
    const cellM2 = dx * mx * dy * my, C = new Float32Array(GRID * GRID);
    for (let i = 0; i < C.length; i++) C[i] = RUNOFF_OPEN + (RUNOFF_ROOF - RUNOFF_OPEN) * Math.min(1, roof[i] / cellM2 / 0.5);
    hydro.imperv = C; hydro.bldCell = cell; hydro.bldState = new Uint8Array(fc.features.length);
  }
  async function loadBuildings() {
    const dom = hydro.dom, key = dom.bbox.join(',');
    if (hydro.bldKey === key) return;
    hydro.bldKey = key; hydro.bld = null; setBldData(null);
    setModelLine('Loading building footprints…');
    const { fc, src } = await fetchBuildings(dom.bbox);
    if (hydro.bldKey !== key) return;                   // camera moved on meanwhile
    hydro.bld = fc; hydro.bldSrc = src;
    indexBuildings(); setBldData(fc);
    runSim();                                           // rerun with real roof cover
  }

  /* ---- worker round trip */
  function runSim() {
    if (!hydro.dom) return;
    clearTimeout(runSim.t);
    runSim.t = setTimeout(() => {
      if (!hydro.worker) {
        hydro.worker = new Worker('./hydro-worker.js');
        hydro.worker.onmessage = onSim;
      }
      const m = MITIGATIONS[$('twFix').value];
      const run = (mm) => ({ rainMMh: rain(), stormH: dur(), totalH: totalH(), drainMMh: mm.drain, storeMM: mm.store, frames: FRAMES });
      const C = hydro.imperv ? hydro.imperv.slice() : new Float32Array(GRID * GRID).fill(RUNOFF_OPEN + 0.15);
      hydro.status = 'computing';
      setModelLine('Running hydrology…');
      hydro.worker.postMessage({ id: ++hydro.req, bbox: hydro.dom.bbox, nx: GRID, ny: GRID, C, run: run(m),
        baseline: m === MITIGATIONS.none ? null : run(MITIGATIONS.none) }, [C.buffer]);
    }, 180);
  }
  function onSim(ev) {
    const r = ev.data;
    if (r.id !== hydro.req) return;                     // superseded by a newer request
    if (r.error) { hydro.status = 'error'; setModelLine('Hydrology failed: ' + r.error); return; }
    hydro.res = r; hydro.status = 'ready';
    hydro.cur = new Float32Array(GRID * GRID);
    buildPonds(); buildBeacons();
    if ($('twCam').value === 'drone') setRoute();
    render();
  }

  /* ---- per-frame: interpolate depth, paint water, colour buildings, stats */
  function frameDepth(pp) {
    const fr = hydro.res.frames, f = Math.min(fr.length - 1, pp * (fr.length - 1)), i = Math.floor(f), t = f - i;
    const a = fr[i], b = fr[Math.min(fr.length - 1, i + 1)], out = hydro.cur;
    for (let k = 0; k < out.length; k++) out[k] = a[k] + (b[k] - a[k]) * t;
    return out;
  }
  /* ---- simulated ponds -> water-engine polygons
     Every 4-connected patch of cells that is ever wet becomes one polygon: its
     cell outline is traced into rings (outer + holes), the staircase rounded
     off with Chaikin smoothing, and its flow bearing/speed taken from the
     terrain slope underneath. Per frame, fill = wet share of the patch, which
     the engine paints interior-out (lowest ground first), like the 2022 sheets. */
  function traceRings(inComp, cells) {
    const out = new Map(), key = (x, y) => y * (GRID + 1) + x;
    const add = (x0, y0, x1, y1) => { const k = key(x0, y0); (out.get(k) || out.set(k, []).get(k)).push([x1, y1, x1 - x0, y1 - y0]); };
    for (const k of cells) {          // clockwise (y down) edges where the neighbour is outside
      const c = k % GRID, r = (k - c) / GRID;
      if (r === 0 || !inComp(k - GRID)) add(c, r, c + 1, r);
      if (c === GRID - 1 || !inComp(k + 1)) add(c + 1, r, c + 1, r + 1);
      if (r === GRID - 1 || !inComp(k + GRID)) add(c + 1, r + 1, c, r + 1);
      if (c === 0 || !inComp(k - 1)) add(c, r + 1, c, r);
    }
    const rings = [];
    for (const [k0, list] of out) {
      while (list.length) {
        let x = k0 % (GRID + 1), y = (k0 - x) / (GRID + 1), e = list.pop();
        const ring = [[x, y]];
        while (true) {
          x = e[0]; y = e[1];
          const k = key(x, y);
          if (k === k0 && ring.length > 2) break;
          ring.push([x, y]);
          const opts = out.get(k);
          if (!opts || !opts.length) break;
          // at a pinch (two exits) take the right turn so diagonal-touching parts stay separate
          let pick = 0;
          if (opts.length > 1) { const rx = -e[3], ry = e[2]; pick = Math.max(0, opts.findIndex((o) => o[2] === rx && o[3] === ry)); }
          e = opts.splice(pick, 1)[0];
        }
        if (ring.length >= 4) rings.push(ring);
      }
    }
    return rings;
  }
  function simplify(ring) {        // drop collinear vertices of the staircase
    return ring.filter((q, i) => {
      const a = ring[(i - 1 + ring.length) % ring.length], b = ring[(i + 1) % ring.length];
      return (q[0] - a[0]) * (b[1] - q[1]) - (q[1] - a[1]) * (b[0] - q[0]) !== 0;
    });
  }
  function chaikin(ring, iter) {
    for (let n = 0; n < iter; n++) {
      const o = [];
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length];
        o.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
      }
      ring = o;
    }
    return ring;
  }
  const ringArea = (r) => { let a = 0; for (let i = 0; i < r.length; i++) { const p0 = r[i], p1 = r[(i + 1) % r.length]; a += p0[0] * p1[1] - p1[0] * p0[1]; } return a / 2; };
  function buildPonds() {
    const { maxD, z } = hydro.res, [w, s0, e, n] = hydro.dom.bbox, dx = (e - w) / GRID, dy = (n - s0) / GRID;
    const comp = new Int32Array(GRID * GRID).fill(-1), groups = [];
    for (let k0 = 0; k0 < comp.length; k0++) {
      if (comp[k0] >= 0 || maxD[k0] < WET_M) continue;
      const cells = [k0]; comp[k0] = groups.length;
      for (let i = 0; i < cells.length; i++) {
        const k = cells[i], c = k % GRID;
        for (const j of [c > 0 ? k - 1 : -1, c < GRID - 1 ? k + 1 : -1, k - GRID, k + GRID]) {
          if (j >= 0 && j < comp.length && comp[j] < 0 && maxD[j] >= WET_M) { comp[j] = groups.length; cells.push(j); }
        }
      }
      groups.push(cells);
    }
    const keep = groups.map((cells, id) => ({ cells, id })).filter((g) => g.cells.length >= MIN_POND_CELLS)
      .sort((a, b) => b.cells.length - a.cells.length).slice(0, MAX_PONDS);
    const features = [];
    ponds = keep.map((g, i) => {
      const rings = traceRings((k) => comp[k] === g.id, g.cells)
        .map((r) => chaikin(simplify(r), 3))
        .sort((a, b) => Math.abs(ringArea(b)) - Math.abs(ringArea(a)))
        .map((r) => { const ll = r.map(([x, y]) => [w + x * dx, n - y * dy]); ll.push(ll[0]); return ll; });
      // flow: mean downslope direction of the terrain under the pond
      let gx = 0, gy = 0;
      for (const k of g.cells) {
        const c = k % GRID, r = (k - c) / GRID;
        gx += (z[r * GRID + Math.max(0, c - 1)] - z[r * GRID + Math.min(GRID - 1, c + 1)]);   // + = falls toward east
        gy += (z[Math.min(GRID - 1, r + 1) * GRID + c] - z[Math.max(0, r - 1) * GRID + c]);   // + = falls toward north
      }
      const slope = Math.hypot(gx, gy) / g.cells.length / (2 * hydro.res.cellW);
      features.push({ type: 'Feature', properties: {
        name: 'Urban pond ' + (i + 1), kind: 'flood',
        bearing: ((Math.atan2(gx, gy) * 180) / Math.PI + 360) % 360,
        speed: Math.min(0.5, 0.15 + slope * 40),   // 0.15 = the 2022 sheets' calm drift; steeper ground runs faster
      }, geometry: { type: 'Polygon', coordinates: rings } });
      let cx = 0, cy = 0;
      for (const k of g.cells) { cx += k % GRID; cy += Math.floor(k / GRID); }
      const xy = [w + (cx / g.cells.length + 0.5) * dx, n - (cy / g.cells.length + 0.5) * dy];
      return { cells: Int32Array.from(g.cells), max: g.cells.length, xy };
    });
    const eng = cityEngine();
    if (eng) { eng.water.setPolygons({ type: 'FeatureCollection', features }); fills.fill(0); fillTarget.fill(0); eng.water.setFills(fills); }
  }

  /* ---- the second water-engine instance, on its own overlay canvas */
  let engine = null, engOn = false;
  function cityEngine() {
    if (engine) return engine;
    const canvas = document.createElement('canvas');
    canvas.id = 'twinWater';
    canvas.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;z-index:1';
    map.getCanvasContainer().appendChild(canvas);
    const gl = canvas.getContext('webgl', { alpha: true, stencil: true, antialias: true, premultipliedAlpha: true, depth: false });
    if (!gl) { console.warn('[twin] no WebGL for city water'); return null; }
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = createWaterSurface({ look: 'realistic' });
    w.init(gl, canvas, { earcut, pixelRatio: dpr });
    engine = { canvas, water: w, dpr };
    const resize = () => {
      const { clientWidth: cw, clientHeight: ch } = map.getContainer();
      canvas.style.width = cw + 'px'; canvas.style.height = ch + 'px';
      canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
      w.invalidateProjection();
    };
    resize();
    map.on('resize', resize);
    ['move', 'zoom', 'rotate', 'pitch', 'moveend'].forEach((ev) => map.on(ev, () => w.invalidateProjection()));
    return engine;
  }
  const project = (lon, lat) => map.project([lon, lat]);
  /* drawn by app.js together with the main water (window.waterDrawHooks), so
     both follow the map's paint while the drone steers and never swim */
  function engineFrame(dt) {
    if (!engOn) return;
    if (!engine || !active || !urbanOn() || !ponds.length) { if (engine) engine.canvas.style.display = 'none'; engOn = false; return; }
    engine.canvas.style.display = '';
    dt = Math.min(0.1, dt);
    // follow the main water's palette + look so city and river water match
    if (engine.water.getPalette() !== water.getPalette()) engine.water.setPalette(water.getPalette());
    if (engine.op !== water.getOpacity()) { engine.op = water.getOpacity(); engine.water.setOpacity(engine.op); }
    const lk = water.getLook().name;
    if (engine.lookName !== lk) { engine.water.setLook(lk); engine.lookName = lk; }
    engine.water.setRain(playing && p * totalH() < dur());
    if (playing) {             // ease the drawn fill toward the simulation every display frame
      const k = 1 - Math.exp(-dt / FILL_EASE_S);
      for (let i = 0; i < ponds.length; i++) fills[i] += (fillTarget[i] - fills[i]) * k;
      engine.water.setFills(fills);
    }
    engine.water.render(dt, map.getBearing(), CITY_FLOW_SPEED, project, map.getPitch());
  }
  const startEngine = () => { engOn = true; };
  function setPondFills(d) {
    for (let i = 0; i < ponds.length; i++) {
      // continuous wet share: a cell counts in proportion to its depth up to 15 cm,
      // so the water edge creeps instead of stepping a whole 60 m cell at a time
      const pd = ponds[i]; let wet = 0;
      for (const k of pd.cells) wet += Math.min(1, d[k] / BLD_WET_M);
      fillTarget[i] = wet / pd.max;
    }
    if (!playing) { fills.set(fillTarget); if (engine) engine.water.setFills(fills); }   // scrubbing: jump straight there
  }
  const bucket = (v) => (v >= 1 ? 3 : v >= 0.5 ? 2 : v >= BLD_WET_M ? 1 : 0);
  function colourBuildings(d) {
    const cell = hydro.bldCell, st = hydro.bldState;
    if (!cell || !map.getSource('twin-bld')) return 0;
    let wet = 0;
    for (let k = 0; k < cell.length; k++) {
      const b = cell[k] < 0 ? 0 : bucket(d[cell[k]]);
      if (b) wet++;
      if (b !== st[k]) { st[k] = b; map.setFeatureState({ source: 'twin-bld', id: k + 1 }, { b }); }
    }
    return wet;
  }
  function resetBuildingStates() {
    if (!hydro.bldState || !map.getSource('twin-bld')) return;
    hydro.bldState.fill(0);
    try { map.removeFeatureState({ source: 'twin-bld' }); } catch (err) { /* style mid-swap */ }
  }
  const peakBuildings = (maxD) => {
    const cell = hydro.bldCell; if (!cell) return 0;
    let n = 0; for (const c of cell) if (c >= 0 && maxD[c] >= BLD_WET_M) n++;
    return n;
  };
  function setModelLine(txt) { const el = $('twModel'); if (el) el.textContent = txt; }

  /* called from render(); returns the urban flooded km² for the totals */
  function updateUrban(pp) {
    const show = urbanOn();
    setUrbanVisible(show);
    $('twModel').style.display = show ? '' : 'none';
    if (!show) { $('twBld').textContent = '–'; $('twDepth').textContent = '–'; $('twBldL').textContent = 'Buildings flooded'; $('twDepthL').textContent = 'Average depth'; updateBeacons(null, false); return 0; }
    ensureDomain();
    const r = hydro.res;
    if (!r || hydro.status !== 'ready') return 0;
    const d = frameDepth(pp);
    setPondFills(d);
    startEngine();
    updateBeacons(d, true);
    const wet = colourBuildings(d), nb = hydro.bldCell ? hydro.bldCell.filter((c) => c >= 0).length : 0;
    let wc0 = 0, sum = 0, mx = 0;
    for (const v of d) if (v >= WET_M) { wc0++; sum += v; if (v > mx) mx = v; }
    if (!hydro.popCell) hydro.popCell = cellPeople();
    urbanPeople = 0;                                   // people living where water is deep enough to enter homes
    if (hydro.popCell) for (let k = 0; k < d.length; k++) if (d[k] >= BLD_WET_M) urbanPeople += hydro.popCell[k];
    $('twBld').textContent = hydro.bld ? fmt(wet) : 'loading…';
    $('twBldL').textContent = hydro.bld ? `Buildings flooded / ${fmt(nb)}` : 'Buildings flooded';
    $('twDepth').textContent = wc0 ? (sum / wc0).toFixed(2) + ' m' : '0 m';
    $('twDepthL').textContent = wc0 ? `Avg depth · max ${mx.toFixed(1)} m` : 'Average depth';
    setModelLine(`Hydrology: ${GRID}×${GRID} cells (~${Math.round(r.cellW)} m) · SRTM terrain, ${Math.round(r.relief)} m relief · `
      + (hydro.bld ? `${fmt(hydro.bld.features.length)} ${hydro.bldSrc} buildings` : 'buildings loading') + ` · ${r.ms} ms`);
    return (wc0 * r.cellW * r.cellH) / 1e6;
  }
  function urbanFixText() {
    const r = hydro.res; if (!r || hydro.status !== 'ready') return '';
    const km = (v) => v.toFixed(v < 10 ? 2 : 1);
    const nowA = r.peakKm2, nowB = peakBuildings(r.maxD);
    if (!r.base) return ` City peak: ${km(nowA)} km² flooded, ${fmt(nowB)} buildings wet.`;
    const baseA = r.base.peakKm2, baseB = peakBuildings(r.base.maxD);
    return ` City peak: ${km(baseA)} → ${km(nowA)} km² flooded, ${fmt(baseB)} → ${fmt(nowB)} buildings wet with this fix.`;
  }

  /* re-centre the model domain when the camera leaves its middle */
  function ensureDomain() {
    const c = map.getCenter(), dom = hydro.dom;
    if (dom) {
      // the drone route lies inside the domain: only re-centre if it truly leaves,
      // otherwise the ponds would vanish and re-simulate mid-flight
      const m = $('twCam').value === 'drone' ? 0.06 : 0.3;
      const [w, s, e, n] = dom.bbox, mx = (e - w) * m, my = (n - s) * m;
      if (c.lng > w + mx && c.lng < e - mx && c.lat > s + my && c.lat < n - my) return;
    }
    hydro.dom = domainAround(c); hydro.res = null; hydro.status = ''; hydro.popCell = null;
    resetBuildingStates();
    ponds = []; clearBeacons();
    if (engine) engine.water.setPolygons(null);
    indexBuildings(); runSim(); loadBuildings();
  }

  /* ---- layers */
  function setBldData(fc) {
    const src = map.getSource('twin-bld');
    if (src) src.setData(fc || { type: 'FeatureCollection', features: [] });
    if (map.getLayer('twin-buildings')) map.setLayoutProperty('twin-buildings', 'visibility', fc && fc.features.length && urbanOn() ? 'none' : 'visible');
  }
  function addUrbanLayers() {
    try {
      if (map.getSource('twin-bld')) return;
      map.addSource('twin-bld', { type: 'geojson', data: hydro.bld || { type: 'FeatureCollection', features: [] } });
      const b = ['coalesce', ['feature-state', 'b'], 0];
      map.addLayer({ id: 'twin-bld', type: 'fill-extrusion', source: 'twin-bld', minzoom: 12.5,
        paint: {
          'fill-extrusion-color': ['match', b, 3, '#dc2626', 2, '#f97316', 1, '#facc15',
            ['interpolate', ['linear'], ['get', 'h'], 0, '#a9b8d4', 30, '#d3deef', 120, '#ffffff']],
          'fill-extrusion-height': ['get', 'h'],
          'fill-extrusion-opacity': 0.93,
        } });
      if (hydro.bldState) hydro.bldState.fill(0);       // fresh source: no feature-state yet
    } catch (err) { console.warn('[twin] urban layers:', err.message); }
  }
  function setUrbanVisible(on) {
    const v = on ? 'visible' : 'none';
    if (map.getLayer('twin-bld') && map.getLayoutProperty('twin-bld', 'visibility') !== v) map.setLayoutProperty('twin-bld', 'visibility', v);
    if (engine) engine.canvas.style.display = on && ponds.length ? '' : 'none';
    if (map.getLayer('twin-buildings')) {
      const mb = on && hydro.bld && hydro.bld.features.length ? 'none' : 'visible';
      if (map.getLayoutProperty('twin-buildings', 'visibility') !== mb) map.setLayoutProperty('twin-buildings', 'visibility', mb);
    }
  }
  function removeUrbanLayers() {
    try {
      if (map.getLayer('twin-bld')) map.removeLayer('twin-bld');
      if (map.getSource('twin-bld')) map.removeSource('twin-bld');
    } catch (err) { /* style mid-swap */ }
    if (hydro.bldState) hydro.bldState.fill(0);
  }
  map.on('moveend', () => { if (active && urbanOn() && !playing && !droneMoving) render(); });

  /* -------------------------------------------------------------- 3D bldgs */
  function addBuildings() {
    if (!map.isStyleLoaded() && !map.getStyle()) return;
    try {
      if (!map.getSource('twin-streets')) map.addSource('twin-streets', { type: 'vector', url: 'mapbox://mapbox.mapbox-streets-v8' });
      if (!map.getLayer('twin-buildings')) {
        map.addLayer({
          id: 'twin-buildings', type: 'fill-extrusion', source: 'twin-streets', 'source-layer': 'building', minzoom: 12.5,
          filter: ['!=', ['get', 'underground'], 'true'],
          paint: {
            'fill-extrusion-color': ['interpolate', ['linear'], ['coalesce', ['get', 'height'], 6], 0, '#a9b8d4', 30, '#d3deef', 120, '#ffffff'],
            'fill-extrusion-height': ['coalesce', ['get', 'height'], 6],
            'fill-extrusion-base': ['coalesce', ['get', 'min_height'], 0],
            'fill-extrusion-opacity': 0.92,
          },
        });
      }
    } catch (err) { console.warn('[twin] buildings unavailable:', err.message); }
  }
  function removeBuildings() {
    try {
      if (map.getLayer('twin-buildings')) map.removeLayer('twin-buildings');
      if (map.getSource('twin-streets')) map.removeSource('twin-streets');
    } catch (err) { /* style mid-swap */ }
  }
  map.on('style.load', () => { if (active) { addFloodLayers(); addUrbanLayers(); addBuildings(); addFacLayers(); } });

  /* ------------------------------------------------- critical facilities
     12k OpenStreetMap hospitals, clinics, schools, colleges, police and fire
     stations and power sites. Each knows which flood sheet it sits in (index
     into the dataset, baked offline); in city mode the street model's depth
     under it decides. Flooded ones get a red ring and an alert. */
  let fac = null, facWet = null, facLoad = null;
  function loadFacilities() {
    return facLoad || (facLoad = fetch('./public/facilities.json').then((r) => r.json()).then((j) => {
      fac = j; facWet = new Uint8Array(j.f.length);
      $('twFacSrc').textContent = `OSM ${j.osm_date}`;
      if (active) { addFacLayers(); render(); }
    }).catch((err) => console.warn('[twin] facilities:', err.message)));
  }
  function addFacLayers() {
    if (!fac || map.getSource('twin-fac')) return;
    try {
      map.addSource('twin-fac', { type: 'geojson', data: { type: 'FeatureCollection', features: fac.f.map((r, i) => ({
        type: 'Feature', id: i + 1, properties: { k: fac.kinds[r[2]], n: r[3] }, geometry: { type: 'Point', coordinates: [r[0], r[1]] } })) } });
      const wet = ['boolean', ['feature-state', 'wet'], false];
      const colour = ['match', ['get', 'k'], ...Object.entries(FAC_KIND).flatMap(([k, v]) => [k, v[1]]), '#ffffff'];
      map.addLayer({ id: 'twin-fac', type: 'circle', source: 'twin-fac', minzoom: 6.5,
        paint: {
          'circle-color': colour,
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 6.5, ['case', wet, 3.5, 1.6], 12, ['case', wet, 8, 4.5], 16, ['case', wet, 11, 7]],
          'circle-stroke-color': ['case', wet, '#ef4444', 'rgba(255,255,255,.85)'],
          'circle-stroke-width': ['case', wet, 2.5, 0.8],
          'circle-opacity': 0.95,
        } });
      facWet.fill(0);                                   // fresh source: no feature-state yet
    } catch (err) { console.warn('[twin] facility layers:', err.message); }
  }
  function removeFacLayers() {
    try {
      if (map.getLayer('twin-fac')) map.removeLayer('twin-fac');
      if (map.getSource('twin-fac')) map.removeSource('twin-fac');
    } catch (err) { /* style mid-swap */ }
  }
  /* hover a facility: its name, type and whether it is in the water (the
     basemap style has no glyphs, so names live in this popup, not map labels) */
  const facTip = new window.mapboxgl.Popup({ closeButton: false, closeOnClick: false, offset: 10, className: 'twin-probe' });
  map.on('mousemove', 'twin-fac', (e) => {
    const f = e.features && e.features[0];
    if (!f) return;
    map.getCanvas().style.cursor = 'pointer';
    const wet = facWet && facWet[f.id - 1];
    facTip.setLngLat(f.geometry.coordinates).setHTML(`<h4>${FAC_KIND[f.properties.k][0]}</h4>`
      + `<div class="big" style="font-size:13px">${esc(f.properties.n || 'Unnamed (OpenStreetMap)')}</div>`
      + `<div class="row"><span>Status</span><b style="color:${wet ? '#f87171' : '#34d399'}">${wet ? 'IN FLOOD WATER' : 'DRY'}</b></div>`).addTo(map);
  });
  map.on('mouseleave', 'twin-fac', () => { map.getCanvas().style.cursor = ''; facTip.remove(); });

  /* flags flooded facilities, returns the alert rows (earliest first) */
  function updateFacilities(g, bbox, d) {
    if (!fac) return null;
    const col = $('twYear').value === '2026' ? 5 : 4, sp = spread(cut());
    const r = hydro.res, dom = urbanOn() && hydro.status === 'ready' && r && d ? hydro.dom : null;
    const total = {}, hit = {}, alerts = [];
    const src = map.getSource('twin-fac');
    fac.f.forEach((row, i) => {
      const [x, y, ki, name, s22, s26] = row, kind = fac.kinds[ki], sIdx = col === 5 ? s26 : s22;
      if (!inRegion(x, y, bbox)) { if (facWet[i] && src) { facWet[i] = 0; map.setFeatureState({ source: 'twin-fac', id: i + 1 }, { wet: false }); } return; }
      total[kind] = (total[kind] || 0) + 1;
      let wet = false, at = 0;
      const sh = sIdx >= 0 ? sheets[sIdx] : null;
      if (sh && g >= sh.r + WINDOW * 0.5) { wet = true; at = sp > 0 ? ((sh.r + WINDOW * 0.5) / sp) * dur() : 0; }
      if (!wet && dom) {                                 // inside the street model: depth under the site
        const [w, s0, e, n] = dom.bbox;
        if (x >= w && x < e && y > s0 && y <= n) {
          const k = Math.floor(((n - y) / (n - s0)) * GRID) * GRID + Math.floor(((x - w) / (e - w)) * GRID);
          if (d[k] >= BLD_WET_M) { wet = true; at = Math.max(0, r.tWet[k]); }
        }
      }
      if (wet) {
        hit[kind] = (hit[kind] || 0) + 1;
        if (FAC_KIND[kind][2]) alerts.push({ t: at, kind, name });
      }
      if (src && facWet[i] !== +wet) { facWet[i] = +wet; map.setFeatureState({ source: 'twin-fac', id: i + 1 }, { wet }); }
    });
    for (const gr of FAC_GROUPS) {
      const h = gr.kinds.reduce((a, k) => a + (hit[k] || 0), 0), t = gr.kinds.reduce((a, k) => a + (total[k] || 0), 0);
      const el = $('twFac-' + gr.id);
      el.textContent = `${fmt(h)} / ${fmt(t)}`; el.classList.toggle('hit', h > 0);
    }
    return alerts.sort((a, b) => a.t - b.t);
  }

  /* ------------------------------------------------------- drone route */
  const bearingTo = (a, b) => (Math.atan2(b[0] - a[0], b[1] - a[1]) * 180 / Math.PI + 360) % 360;
  const lerpAngle = (a, b, t) => a + ((((b - a) % 360) + 540) % 360 - 180) * t;
  /* Waypoints = the biggest flood sheets in the chosen region, in the order the
     water reaches them (reveal delay), spaced apart so the drone covers ground. */
  function withBearings(pts) {
    return pts.map((pt, i) => ({ ...pt, bearing: bearingTo(pt.xy, pts[Math.min(i + 1, pts.length - 1)].xy) }));
  }
  const orbit = (c, rad) => withBearings([0, 1, 2, 3, 4].map((i) => ({ xy: [c[0] + Math.sin(i * 1.6) * rad, c[1] + Math.cos(i * 1.6) * rad], r: 0 })));
  /* city: the deepest simulated ponds in the middle of the model domain, in the
     order they flood, spaced at least ~8 cells apart */
  function cityRoute() {
    if (!hydro.res || !hydro.dom) return orbit(REGIONS[$('twRegion').value].cam.center, 0.008);
    const { tWet, maxD } = hydro.res, [w, , , n] = hydro.dom.bbox;
    const dx = (hydro.dom.bbox[2] - w) / GRID, dy = (n - hydro.dom.bbox[1]) / GRID, lo = GRID * 0.32, hi = GRID * 0.68;
    const cand = [];
    for (let k = 0; k < maxD.length; k++) {
      const col = k % GRID, row = Math.floor(k / GRID);
      if (col >= lo && col < hi && row >= lo && row < hi && maxD[k] >= 0.3 && tWet[k] >= 0) cand.push(k);
    }
    cand.sort((a, b) => maxD[b] - maxD[a]);
    const picks = [];
    for (const k of cand) {
      if (picks.every((q) => Math.hypot((q % GRID) - (k % GRID), Math.floor(q / GRID) - Math.floor(k / GRID)) >= 8)) picks.push(k);
      if (picks.length >= 7) break;
    }
    if (picks.length < 2) return orbit(hydro.dom.center, 0.008);
    picks.sort((a, b) => tWet[a] - tWet[b]);
    return withBearings(picks.map((k) => ({ xy: [w + ((k % GRID) + 0.5) * dx, n - (Math.floor(k / GRID) + 0.5) * dy], r: tWet[k],
      zone: { depth: maxD[k], wetH: tWet[k] } })));
  }
  function buildRoute() {
    if (isCity()) return cityRoute();
    const bbox = REGIONS[$('twRegion').value].bbox, reach = spread(cut());
    const pool = sheets.filter((sh) => sh.r <= reach && inRegion(sh.cx, sh.cy, bbox) && sh.area > 0)
      .sort((a, b) => b.area - a.area).slice(0, 60).sort((a, b) => a.r - b.r);
    const pts = [];
    for (const sh of pool) {
      if (pts.every((q) => Math.hypot(q.xy[0] - sh.cx, q.xy[1] - sh.cy) > (bbox ? 0.15 : 0.9))) pts.push({ xy: [sh.cx, sh.cy], r: sh.r, zone: { area: sh.area, pop: sh.pop, river: sh.f.properties.river } });
      if (pts.length >= 8) break;
    }
    if (pts.length < 2) return orbit(REGIONS[$('twRegion').value].cam.center, 0.3);   // no flood to follow
    return withBearings(pts);
  }
  /* ---- flight path: a centripetal Catmull-Rom spline through the waypoints
     (no overshoot or loops at sharp corners), resampled by arc length so the
     drone flies at an even ground speed instead of stopping at every point. */
  let path = null;       // { pts: [[lng, lat]], cum: [ground length], len, kx }
  let cam = null;        // smoothed drone state, eased toward the path every frame
  function buildPath(wps) {
    const P = wps.map((w) => w.xy);
    if (P.length === 1) P.push([P[0][0] + 1e-4, P[0][1]]);
    const kx = Math.cos((P[0][1] * Math.PI) / 180);       // lng degrees -> lat-degree units
    const n = P.length, mirror = (a, b) => [2 * b[0] - a[0], 2 * b[1] - a[1]];
    const C = [mirror(P[1], P[0]), ...P, mirror(P[n - 2], P[n - 1])];
    const knot = (a, b) => Math.max(1e-9, Math.sqrt(Math.hypot((b[0] - a[0]) * kx, b[1] - a[1])));
    const mix = (a, b, ta, tb, u) => { const w = (u - ta) / (tb - ta); return [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w]; };
    const pts = [];
    for (let k = 0; k < n - 1; k++) {
      const [p0, p1, p2, p3] = [C[k], C[k + 1], C[k + 2], C[k + 3]];
      const t1 = knot(p0, p1), t2 = t1 + knot(p1, p2), t3 = t2 + knot(p2, p3);
      for (let q = 0; q < 48; q++) {                     // Barry-Goldman evaluation
        const u = t1 + ((t2 - t1) * q) / 48;
        const a1 = mix(p0, p1, 0, t1, u), a2 = mix(p1, p2, t1, t2, u), a3 = mix(p2, p3, t2, t3, u);
        pts.push(mix(mix(a1, a2, 0, t2, u), mix(a2, a3, t1, t3, u), t1, t2, u));
      }
    }
    pts.push(P[n - 1]);
    const cum = [0];
    for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + Math.hypot((pts[k][0] - pts[k - 1][0]) * kx, pts[k][1] - pts[k - 1][1]));
    const len = cum[cum.length - 1] || 1e-9;
    return { pts, cum, len, kx, wpS: wps.map((_, k) => cum[Math.min(k * 48, cum.length - 1)] / len) };   // waypoint k's s
  }
  function pathAt(s) {                                   // s = 0..1 of the ground length
    const { pts, cum, len } = path, d = Math.min(1, Math.max(0, s)) * len;
    let lo = 0, hi = cum.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= d) lo = mid; else hi = mid; }
    const t = cum[hi] > cum[lo] ? (d - cum[lo]) / (cum[hi] - cum[lo]) : 0;
    return [pts[lo][0] + (pts[hi][0] - pts[lo][0]) * t, pts[lo][1] + (pts[hi][1] - pts[lo][1]) * t];
  }
  const headingAt = (a, b) => (Math.atan2((b[0] - a[0]) * path.kx, b[1] - a[1]) * 180 / Math.PI + 360) % 360;
  const angDiff = (a, b) => ((((b - a) % 360) + 540) % 360) - 180;
  const viewDeg = (z) => 720 / 2 ** z;                  // rough ground width on screen, in degrees
  function setRoute() { route = buildRoute(); path = buildPath(route); nameZones(route); zoneIdx = -2; }

  /* ---- naming the flood zones the drone passes. Mapbox reverse geocoding
     (same token as the basemap) gives the town / neighbourhood; until it
     answers, or if it can't, the nearest town and province from local data. */
  const PROVINCE = { 'Sind': 'Sindh', 'Baluchistan': 'Balochistan', 'K.P.': 'Khyber Pakhtunkhwa', 'F.A.T.A.': 'Khyber Pakhtunkhwa',
    'Northern Areas': 'Gilgit-Baltistan', 'F.C.T.': 'Islamabad Capital Territory' };
  const zoneNames = new Map();          // "lng,lat" -> { name, sub } from the geocoder (null while in flight)
  let towns = [], provinces = [], localLoad = null;
  const zoneKey = (xy) => xy[0].toFixed(3) + ',' + xy[1].toFixed(3);
  function loadLocalNames() {
    return localLoad || (localLoad = Promise.all(['places', 'provinces'].map((f) => fetch(`./public/${f}.geojson`).then((r) => r.json())))
      .then(([pl, pv]) => {
        towns = pl.features.filter((f) => f.properties.country === 'Pakistan').map((f) => ({ name: f.properties.name, xy: f.geometry.coordinates }));
        provinces = pv.features.map((f) => ({ name: PROVINCE[f.properties.name] || f.properties.name, rs: rings(f.geometry) }));
      }).catch(() => {}));
  }
  function localName(xy) {
    const prov = provinces.find((pv) => pv.rs.some((r) => inside(r, xy[0], xy[1])));
    let best = null, bd = Infinity;
    for (const t of towns) {
      const d = Math.hypot((t.xy[0] - xy[0]) * Math.cos((xy[1] * Math.PI) / 180), t.xy[1] - xy[1]) * 111;
      if (d < bd) { bd = d; best = t; }
    }
    const dir = best && ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(bearingTo(best.xy, xy) / 45) % 8];
    return { name: !best ? 'Flood zone' : bd < 6 ? best.name : `${bd < 20 ? bd.toFixed(1) : Math.round(bd)} km ${dir} of ${best.name}`,
      sub: (prov ? prov.name + ', ' : '') + 'Pakistan' };
  }
  async function geocode(xy, city) {
    const types = city ? ['neighborhood', 'locality', 'place'] : ['place', 'locality', 'district'];
    const url = `https://api.mapbox.com/search/geocode/v6/reverse?longitude=${xy[0].toFixed(5)}&latitude=${xy[1].toFixed(5)}`
      + `&types=${types.join(',')}&language=en&access_token=${window.mapboxgl.accessToken}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('geocoder ' + res.status);
    const f = ((await res.json()).features || [])
      .sort((a, b) => types.indexOf(a.properties.feature_type) - types.indexOf(b.properties.feature_type))[0];
    return f && { name: f.properties.name, sub: f.properties.place_formatted || '' };
  }
  function nameZones(wps) {
    loadLocalNames().then(() => { zoneIdx = -2; });     // repaint the card once the fallback is usable
    const city = isCity();
    for (const wp of wps) {
      if (!wp.zone) continue;
      const k = zoneKey(wp.xy);
      if (zoneNames.has(k)) continue;
      zoneNames.set(k, null);
      geocode(wp.xy, city).then((nm) => { if (nm) { zoneNames.set(k, nm); zoneIdx = -2; } })
        .catch((err) => console.warn('[twin] zone name:', err.message));
    }
  }
  const zoneLabel = (wp) => zoneNames.get(zoneKey(wp.xy)) || localName(wp.xy);
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  /* the "now over" card + a pin on the ground for the zone under the drone */
  let zoneIdx = -1, zoneHTML = '', zoneMarker = null, zoneSwap = 0;
  function zoneInfo(i, km) {
    const wp = route[i], z = wp.zone, nm = zoneLabel(wp), n = route.filter((q) => q.zone).length, hours = p * totalH();
    let line;
    if (z.area != null) {
      const at = spread(cut()) > 0 ? (wp.r / spread(cut())) * dur() : 0;
      line = `≈${fmt(z.area)} km² · ${fmt(z.pop)} residents · ` + (hours >= at ? `under water since T+${hhmm(at)}` : `water arrives T+${hhmm(at)}`)
        + (z.river ? ` · ${z.river[0].toUpperCase() + z.river.slice(1)} river` : '');
    } else {
      line = `peak depth ${z.depth.toFixed(1)} m · ` + (hours >= z.wetH ? `flooding since T+${hhmm(z.wetH)}` : `floods at T+${hhmm(z.wetH)}`);
    }
    const what = z.area != null ? 'flood zone' : 'street flooding', k = route.slice(0, i + 1).filter((q) => q.zone).length;
    const kick = km == null ? `Now over · ${what} ${k} / ${n}` : `Heading to · ${what} ${k} / ${n} · ${km < 10 ? km.toFixed(1) : Math.round(km)} km ahead`;
    return { nm, html: `<div class="k">${kick}</div><div class="n">${esc(nm.name)}</div><div class="s">${esc(nm.sub)}</div><div class="m">${line}</div>` };
  }
  function showZone(i, km) {
    if (i < 0) {
      if (zoneIdx !== -1) {
        zoneIdx = -1; zoneHTML = ''; clearTimeout(zoneSwap);
        locCard.classList.remove('show');
        if (zoneMarker) { zoneMarker.remove(); zoneMarker = null; }
      }
      return;
    }
    const { nm, html } = zoneInfo(i, km);
    if (i === zoneIdx && html === zoneHTML) return;
    const fadeOld = zoneIdx >= 0 && i !== zoneIdx && locCard.classList.contains('show');
    zoneIdx = i; zoneHTML = html;
    const apply = () => {
      locCard.innerHTML = html; locCard.classList.add('show');
      if (!zoneMarker) {
        const el = document.createElement('div');
        el.className = 'tw-beacon tw-zone';
        el.innerHTML = '<div class="tag"><span></span><b></b></div><div class="beam"></div><div class="base"></div>';
        zoneMarker = new window.mapboxgl.Marker({ element: el, anchor: 'bottom' });
      }
      zoneMarker.getElement().querySelector('span').textContent = km == null ? 'NOW OVER' : 'NEXT ZONE';
      zoneMarker.getElement().querySelector('b').textContent = nm.name;
      zoneMarker.setLngLat(route[i].xy).addTo(map);
    };
    clearTimeout(zoneSwap);
    if (fadeOld) { locCard.classList.remove('show'); zoneSwap = setTimeout(apply, 450); }   // old title out, new one in
    else apply();
  }
  /* zone under the drone: the nearest named waypoint within ~half a screen;
     in transit, the next one along the route and how far ahead it is */
  function updateZone(zoom) {
    let best = -1, bd = 0.5 * viewDeg(zoom);
    route.forEach((wp, i) => {
      if (!wp.zone) return;
      const d = Math.hypot((wp.xy[0] - cam.x) * path.kx, wp.xy[1] - cam.y);
      if (d < bd) { bd = d; best = i; }
    });
    if (best >= 0) { showZone(best); return; }
    const next = route.findIndex((wp, i) => wp.zone && path.wpS[i] > cam.s);
    if (next < 0) { showZone(-1); return; }
    const km = Math.hypot((route[next].xy[0] - cam.x) * path.kx, route[next].xy[1] - cam.y) * 111;
    showZone(next, km < 10 ? Math.round(km * 10) / 10 : Math.round(km));
  }

  /* where the drone should be for timeline position s: on the path, nose
     pointed down the path ahead, climbing a little and tilting up in turns */
  function droneTarget(s, zoom) {
    const ahead = Math.min(0.3, (0.35 * viewDeg(zoom)) / path.len);
    const here = pathAt(s), back = pathAt(s - ahead * 0.3), front = pathAt(s + ahead), far = pathAt(s + ahead * 2);
    const bearing = headingAt(back, front);
    const turn = Math.min(1, Math.abs(angDiff(bearing, headingAt(front, far))) / 90);
    return { xy: here, bearing, zoom: zoom - 0.45 * turn, pitch: 66 - 6 * turn };
  }

  /* runs every display frame from app.js's loop (window.cameraHooks):
     the drone eases (critically damped) toward its target, so playback,
     scrubbing, route changes and the zoom slider all glide rather than jump */
  function droneFrame(dt, now) {
    if (!active || !path || $('twCam').value !== 'drone' || now < camHold) { showZone(-1); return; }
    dt = Math.min(0.1, dt);
    const ease = (tau) => 1 - Math.exp(-dt / tau);
    const zoomSet = +$('twZoom').value, sGoal = Math.min(1, Math.max(0, p));
    if (!cam) {                                          // take over from the intro fly smoothly
      const c = map.getCenter();
      cam = { s: sGoal, x: c.lng, y: c.lat, b: map.getBearing(), z: map.getZoom(), pt: map.getPitch() };
    }
    cam.s += (sGoal - cam.s) * ease(0.5);
    const tg = droneTarget(cam.s, zoomSet);
    // a long hop (scrub / new route) climbs for the transit, like flyTo, then descends
    const gap = Math.hypot((tg.xy[0] - cam.x) * path.kx, tg.xy[1] - cam.y) + Math.abs(sGoal - cam.s) * path.len;
    tg.zoom -= Math.min(2.5, Math.log2(1 + gap / viewDeg(zoomSet)));
    cam.x += (tg.xy[0] - cam.x) * ease(0.25);
    cam.y += (tg.xy[1] - cam.y) * ease(0.25);
    cam.b += angDiff(cam.b, tg.bearing) * ease(0.9);
    cam.z += (tg.zoom - cam.z) * ease(0.7);
    cam.pt += (tg.pitch - cam.pt) * ease(0.9);
    // hover sway: slow, small, out of phase, so the shot feels held in the air
    const t = now / 1000;
    droneMoving = true;
    map.jumpTo({
      center: [cam.x, cam.y],
      zoom: cam.z + 0.03 * Math.sin(t * 0.29),
      pitch: Math.min(80, Math.max(0, cam.pt + 1.2 * Math.sin(t * 0.37))),
      bearing: cam.b + 0.9 * Math.sin(t * 0.23) + 0.4 * Math.sin(t * 0.61 + 1),
    });
    droneMoving = false;
    updateZone(cam.z);
    return true;               // app.js then draws the water in the map's own paint of this camera
  }
  (window.cameraHooks = window.cameraHooks || []).push(droneFrame);
  (window.waterDrawHooks = window.waterDrawHooks || []).push((dt) => engineFrame(dt));

  function setCamMode() {
    const drone = $('twCam').value === 'drone';
    cam = null;
    if (drone && active) {
      setRoute();
      camHold = performance.now() + 2300;
      const tg = droneTarget(Math.min(1, Math.max(0, p)), +$('twZoom').value);
      map.flyTo({ center: tg.xy, zoom: tg.zoom, pitch: tg.pitch, bearing: tg.bearing, duration: 2200, curve: 1.6, essential: true });
    } else if (active) fly();
  }

  /* ---------------------------------------------------------- playback */
  function tick(ts) {
    if (!playing) return;
    const dt = Math.min(0.1, Math.max(0, (ts - lastTs) / 1000)); lastTs = ts;   // the first frame can predate play
    p = Math.min(1, p + (dt * +$('twSpeed').value) / PLAY_SECONDS);
    if (p * totalH() < dur()) startRain(); else stopRain();
    render();
    if (p >= 1) setPlaying(false); else raf = requestAnimationFrame(tick);
  }
  function setPlaying(on) {
    const wasPlaying = playing;
    playing = on;
    $('twPlay').textContent = on ? '❚❚ Pause' : (p >= 1 ? '↻ Replay' : '▶ Play');
    cancelAnimationFrame(raf);
    if (on && active) startRain(); else stopRain();
    if (on) { if (p >= 1) p = 0; lastTs = performance.now(); raf = requestAnimationFrame(tick); }
    else if (wasPlaying && active) render();   // the panel was throttled during playback: bring it up to date
  }

  function fly() { map.flyTo({ ...REGIONS[$('twRegion').value].cam, duration: 2600, essential: true }); }

  /* the dashboard's Flood Extent / Indus rivers switches own water visibility */
  function setToggle(id, on) {
    const el = $(id);
    if (el.checked !== on) { el.checked = on; el.dispatchEvent(new Event('change')); }
  }

  /* --------------------------------------------------------- enter / exit */
  function enter() {
    active = true;
    btn.classList.add('on');
    bootMarkup(); boot.classList.add('show');
    prevFlood = $('floodToggle').checked; prevRivers = $('chkRivers').checked;
    setToggle('floodToggle', true); setToggle('chkRivers', true);
    prevTerrain = $('terrain3d').classList.contains('on');
    prevYear = window.floodStats?.year || '2022';
    $('twYear').value = prevYear;
    window.setFloodDataset($('twYear').value);
    if (!prevTerrain) $('terrain3d').click();
    prepare();
    p = 0; setPlaying(false);
    addFloodLayers(); addUrbanLayers(); addBuildings(); addFacLayers(); loadFacilities();
    panel.classList.add('show');
    render();
    setTimeout(() => {
      boot.classList.remove('show'); setCamMode(); drawChart();
      scan.classList.remove('go'); void scan.offsetWidth; scan.classList.add('go');   // radar sweep across the map
      setTimeout(() => scan.classList.remove('go'), 1900);
    }, 1700);
  }
  function exit() {
    active = false; setPlaying(false);
    btn.classList.remove('on');
    panel.classList.remove('show');
    document.querySelectorAll('.marker').forEach((el) => el.classList.remove('twin-flood', 'twin-warn'));
    water.setGrow(1);
    removeBuildings(); removeFloodLayers(); removeUrbanLayers(); removeFacLayers(); stopRain(); clearProbe(); clearBeacons();
    window.setFloodDataset(prevYear);
    setToggle('floodToggle', prevFlood); setToggle('chkRivers', prevRivers);
    if (!prevTerrain && $('terrain3d').classList.contains('on')) $('terrain3d').click();
  }
  btn.addEventListener('click', () => (active ? exit() : enter()));

  /* -------------------------------------------------------------- controls */
  $('twPlay').addEventListener('click', () => setPlaying(!playing));
  $('twReset').addEventListener('click', () => { p = 0; setPlaying(false); render(); });
  $('twTime').addEventListener('input', (e) => { setPlaying(false); p = +e.target.value / 1000; render(); });
  $('twInt').addEventListener('input', () => { $('twIntV').textContent = rain() + ' mm/h'; if (urbanOn()) runSim(); reroute(); render(); });
  $('twDur').addEventListener('input', () => { $('twDurV').textContent = dur() + ' h'; if (urbanOn()) runSim(); reroute(); render(); });
  function reroute() { if (active && $('twCam').value === 'drone') setRoute(); }
  $('twFix').addEventListener('change', () => { if (urbanOn()) runSim(); reroute(); render(); });
  $('twRegion').addEventListener('change', () => {
    if (isCity() && +$('twZoom').value < 14.5) { $('twZoom').value = 14.5; $('twZoomV').textContent = '14.5'; }   // street level for the urban model
    render(); setCamMode();
  });
  $('twCam').addEventListener('change', setCamMode);
  $('twZoom').addEventListener('input', () => { $('twZoomV').textContent = $('twZoom').value; });   // the drone eases to it
  /* grabbing the map hands the camera back to the user */
  map.on('dragstart', (e) => { if (active && e.originalEvent && $('twCam').value === 'drone') { $('twCam').value = 'overview'; } });
  $('twYear').addEventListener('change', () => { window.setFloodDataset($('twYear').value); prepare(); addFloodLayers(); lastFilterG = -1; lastPaintG = -1; reroute(); render(); });
}
