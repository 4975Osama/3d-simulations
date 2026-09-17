/* Map chrome: 2D/3D tabs, basemap dropdown, the floating control stack,
   coordinate/zoom HUD, Quick Actions, Pro Tools (Distance/Area/Clear/
   Snapshot/3D Tour/Locate + Camera Tilt + Time of Day + HD rendering).
   Everything here drives the real, already-working engine on window.map /
   window.water / window.tour (exposed by app.js / portal/tour.js), or the
   hidden legacy control elements app.js is wired to (see index.html's
   #legacy-controls) — no engine logic is duplicated. */

const $ = (id) => document.getElementById(id);

const HERO = { center: [72.86, 34.13], zoom: 11.0, pitch: 28, bearing: 10, offset: [150, -15] };

function ready() { return window.map instanceof maplibregl.Map && window.water; }
function boot() {
  if (!ready()) { setTimeout(boot, 100); return; }
  init();
}
boot();

function init() {
  const map = window.map;

  /* -------------------------------------------------------- 2D/3D tabs */
  function setView(is3D) {
    $('tab2d').classList.toggle('on', !is3D);
    $('tab3d').classList.toggle('on', is3D);
    if (is3D) {
      if (!$('terrain3d').classList.contains('on')) $('terrain3d').click();
      else map.easeTo({ pitch: Math.max(45, map.getPitch()), duration: 900 });
    } else {
      if ($('terrain3d').classList.contains('on')) $('terrain3d').click();
      map.easeTo({ pitch: 0, bearing: 0, duration: 900 });
    }
  }
  $('tab2d').addEventListener('click', () => setView(false));
  $('tab3d').addEventListener('click', () => setView(true));

  /* -------------------------------------------------------- basemap dropdown */
  $('basemapSelect').addEventListener('change', (e) => {
    const b = document.querySelector(`#styles button[data-style="${e.target.value}"]`);
    if (b) b.click();
  });

  /* -------------------------------------------------------- Quick Actions */
  $('qa-3d').addEventListener('click', () => setView(true));
  $('qa-reset').addEventListener('click', () => {
    if (window.tour.isRunning()) window.tour.stop();
    map.flyTo({ ...HERO, duration: 2600, essential: true });
  });
  $('qa-rotate').addEventListener('click', (e) => {
    $('spin').click();
    e.target.classList.toggle('on', $('spin').classList.contains('on'));
  });
  $('qa-fullscreen').addEventListener('click', () => toggleFullscreen());

  /* -------------------------------------------------------- HD rendering */
  $('hdToggle').addEventListener('change', (e) => {
    window.setRenderQuality(e.target.checked);
    $('hdState').textContent = e.target.checked ? 'ON' : 'OFF';
    $('hud-quality').textContent = e.target.checked ? 'HD' : 'SD';
  });

  /* -------------------------------------------------------- Camera Tilt */
  $('tiltSlider').addEventListener('input', (e) => {
    const v = +e.target.value;
    $('tiltval').textContent = v + '°';
    map.setPitch(v);
  });
  map.on('pitch', () => {
    if (document.activeElement !== $('tiltSlider')) {
      const p = Math.round(map.getPitch());
      $('tiltSlider').value = p;
      $('tiltval').textContent = p + '°';
    }
  });

  /* -------------------------------------------------------- Time of Day */
  const todOverlay = document.createElement('div');
  todOverlay.id = 'todoverlay';
  todOverlay.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:2;mix-blend-mode:multiply;transition:background .25s;';
  $('mapwrap').appendChild(todOverlay);

  const TOD_STOPS = [
    [0, '10,18,54', .45], [5, '10,18,54', .45], [7, '255,150,80', .26],
    [9.5, '255,255,255', 0], [16, '255,255,255', 0], [18, '255,140,60', .3],
    [20, '10,18,54', .45], [24, '10,18,54', .45],
  ];
  function lerpTod(h) {
    for (let i = 0; i < TOD_STOPS.length - 1; i++) {
      const [h0, c0, a0] = TOD_STOPS[i], [h1, c1, a1] = TOD_STOPS[i + 1];
      if (h >= h0 && h <= h1) {
        const t = h1 === h0 ? 0 : (h - h0) / (h1 - h0);
        const a = a0 + (a1 - a0) * t;
        const rgb0 = c0.split(',').map(Number), rgb1 = c1.split(',').map(Number);
        const rgb = rgb0.map((v, k) => Math.round(v + (rgb1[k] - v) * t));
        return `rgba(${rgb.join(',')},${a.toFixed(2)})`;
      }
    }
    return 'rgba(0,0,0,0)';
  }
  function applyTod(h) {
    todOverlay.style.background = lerpTod(h);
  }
  $('todSlider').addEventListener('input', (e) => {
    const v = +e.target.value;
    const hh = Math.floor(v), mm = Math.round((v - hh) * 60);
    $('todval').textContent = String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
    applyTod(v);
  });
  applyTod(+$('todSlider').value);

  /* -------------------------------------------------------- floating control stack */
  $('mapctrl').insertAdjacentHTML('afterbegin',
    `<button id="ctl-zin" title="Zoom in"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button>
     <button id="ctl-zout" title="Zoom out"><svg viewBox="0 0 24 24"><path d="M5 12h14"/></svg></button>
     <button id="ctl-compass" title="Reset bearing"><svg viewBox="0 0 24 24"><path d="M12 2l3 9-3 9-3-9z"/></svg></button>`);
  $('ctl-zin').addEventListener('click', () => map.zoomIn({ duration: 300 }));
  $('ctl-zout').addEventListener('click', () => map.zoomOut({ duration: 300 }));
  $('ctl-compass').addEventListener('click', () => map.easeTo({ bearing: 0, duration: 500 }));
  $('ctl-compass').style.transformOrigin = '50% 50%';

  /* the big compass rose under the map toolbar — same behaviour as the small
     control-stack button, but always visible and readable at a glance */
  $('compass').addEventListener('click', () => map.easeTo({ bearing: 0, duration: 500 }));
  const spinCompasses = () => {
    const r = `rotate(${-map.getBearing()}deg)`;
    $('ctl-compass').firstElementChild.style.transform = r;
    $('compass').firstElementChild.style.transform = r;
  };
  map.on('rotate', spinCompasses);
  spinCompasses();

  $('ctl-layers').addEventListener('click', () => {
    document.querySelector('[data-toggle="techew"]').click();
  });
  $('ctl-edit').addEventListener('click', () => $('pt-distance').click());
  $('ctl-refresh').addEventListener('click', () => $('qa-reset').click());

  const SPEEDS = [0.5, 1, 2];
  let speedIdx = 1;
  $('ctl-speed').addEventListener('click', () => {
    speedIdx = (speedIdx + 1) % SPEEDS.length;
    const v = SPEEDS[speedIdx];
    $('speed').value = v;
    $('speed').dispatchEvent(new Event('input'));
    $('ctl-speed-badge').textContent = v + 'x';
  });
  $('ctl-locate').addEventListener('click', () => locateMe());
  $('ctl-fullscreen').addEventListener('click', () => toggleFullscreen());

  /* -------------------------------------------------------- coordinate HUD */
  map.on('mousemove', (e) => {
    $('hud-lon').textContent = e.lngLat.lng.toFixed(4);
    $('hud-lat').textContent = e.lngLat.lat.toFixed(4);
  });
  function syncCam() {
    $('hud-zoom').textContent = map.getZoom().toFixed(1);
    $('hud-pitch').textContent = map.getPitch().toFixed(0);
    $('hud-bearing').textContent = map.getBearing().toFixed(0);
  }
  ['move', 'zoom', 'rotate', 'pitch'].forEach((ev) => map.on(ev, syncCam));
  syncCam();
  const c = map.getCenter();
  $('hud-lon').textContent = c.lng.toFixed(4);
  $('hud-lat').textContent = c.lat.toFixed(4);

  /* -------------------------------------------------------- fullscreen */
  function toggleFullscreen() {
    const el = $('mapwrap');
    if (!document.fullscreenElement) {
      (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el)
        .catch((err) => alert('Fullscreen unavailable: ' + err.message));
    } else {
      (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
    }
  }
  document.addEventListener('fullscreenchange', () => {
    const on = !!document.fullscreenElement;
    $('qa-fullscreen').classList.toggle('on', on);
    $('ctl-fullscreen').classList.toggle('on', on);
  });

  /* -------------------------------------------------------- locate */
  let userMarker = null;
  function locateMe() {
    if (!navigator.geolocation) { alert('Geolocation is not available in this browser.'); return; }
    $('ctl-locate').classList.add('on');
    navigator.geolocation.getCurrentPosition((pos) => {
      $('ctl-locate').classList.remove('on');
      const { longitude, latitude } = pos.coords;
      if (userMarker) userMarker.remove();
      const el = document.createElement('div');
      el.style.cssText = 'width:16px;height:16px;border-radius:50%;background:#38b6ff;border:3px solid #fff;box-shadow:0 0 0 4px rgba(56,182,255,.35)';
      userMarker = new maplibregl.Marker({ element: el }).setLngLat([longitude, latitude]).addTo(map);
      map.flyTo({ center: [longitude, latitude], zoom: 12.5, pitch: 45, duration: 2200, essential: true });
      if (window.setWeatherLocation) window.setWeatherLocation(latitude, longitude, 'My location');
    }, (err) => {
      $('ctl-locate').classList.remove('on');
      alert('Could not get your location: ' + err.message);
    }, { enableHighAccuracy: true, timeout: 10000 });
  }
  $('pt-locate').addEventListener('click', locateMe);

  /* -------------------------------------------------------- 3D Tour proxy */
  $('pt-tour').addEventListener('click', () => $('tour').click());

  /* -------------------------------------------------------- Snapshot */
  $('pt-snapshot').addEventListener('click', () => {
    map.triggerRepaint();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const base = map.getCanvas();
      const water = document.getElementById('water');
      const out = document.createElement('canvas');
      out.width = base.width; out.height = base.height;
      const ctx = out.getContext('2d');
      ctx.drawImage(base, 0, 0, out.width, out.height);
      if (water) ctx.drawImage(water, 0, 0, out.width, out.height);
      const a = document.createElement('a');
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      a.download = `3d-simulation-portal-${ts}.png`;
      a.href = out.toDataURL('image/png');
      document.body.appendChild(a); a.click(); a.remove();
    }));
  });

  /* -------------------------------------------------------- Distance / Area */
  let tool = null;              // null | 'distance' | 'area'
  let pts = [];
  let measureLabel = null;

  function ensureMeasureLayers() {
    if (map.getSource('measure-src')) return;
    map.addSource('measure-src', { type: 'geojson', data: emptyFC() });
    map.addLayer({ id: 'measure-fill', type: 'fill', source: 'measure-src',
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: { 'fill-color': '#38b6ff', 'fill-opacity': 0.15 } });
    map.addLayer({ id: 'measure-line', type: 'line', source: 'measure-src',
      paint: { 'line-color': '#38b6ff', 'line-width': 2.4, 'line-dasharray': [1, 1.4] } });
    map.addSource('measure-pts', { type: 'geojson', data: emptyFC() });
    map.addLayer({ id: 'measure-pts-l', type: 'circle', source: 'measure-pts',
      paint: { 'circle-radius': 4.5, 'circle-color': '#fff', 'circle-stroke-color': '#38b6ff', 'circle-stroke-width': 2 } });
  }
  function emptyFC() { return { type: 'FeatureCollection', features: [] }; }

  function haversineKm(a, b) {
    const R = 6371.0088, toRad = Math.PI / 180;
    const dLat = (b[1] - a[1]) * toRad, dLon = (b[0] - a[0]) * toRad;
    const la1 = a[1] * toRad, la2 = b[1] * toRad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  function totalDistanceKm(coords) {
    let d = 0; for (let i = 1; i < coords.length; i++) d += haversineKm(coords[i - 1], coords[i]);
    return d;
  }
  function areaKm2(coords) {
    if (coords.length < 3) return 0;
    const R = 6371.0088, toRad = Math.PI / 180;
    let sum = 0;
    for (let i = 0; i < coords.length; i++) {
      const [lng1, lat1] = coords[i], [lng2, lat2] = coords[(i + 1) % coords.length];
      sum += (lng2 - lng1) * toRad * (2 + Math.sin(lat1 * toRad) + Math.sin(lat2 * toRad));
    }
    return Math.abs(sum * R * R / 2);
  }

  function ensureLabel() {
    if (measureLabel) return measureLabel;
    measureLabel = document.createElement('div');
    measureLabel.className = 'panel';
    measureLabel.style.cssText = 'top:56px;left:50%;transform:translateX(-50%);padding:7px 13px;z-index:7;font-size:12px;';
    $('mapwrap').appendChild(measureLabel);
    return measureLabel;
  }
  function useMiles() { return false; }   // km/mi preference lived on the removed Settings page
  function updateLabel() {
    const lbl = ensureLabel();
    const mi = useMiles();
    if (tool === 'distance') {
      let d = totalDistanceKm(pts), unit = 'km';
      if (mi) { d *= 0.621371; unit = 'mi'; }
      const small = mi ? d < 0.189 : d < 1;   // ~1000 ft or 1 km
      lbl.innerHTML = `<b>${small ? (d * (mi ? 5280 : 1000)).toFixed(0) + (mi ? ' ft' : ' m') : d.toFixed(2) + ' ' + unit}</b> &nbsp;· click to add a point · Enter to finish · Esc to cancel`;
    } else if (tool === 'area') {
      let a = areaKm2(pts), unit = 'km²';
      if (mi) { a *= 0.386102; unit = 'mi²'; }
      lbl.innerHTML = `<b>${a.toFixed(a < 10 ? 3 : 1)} ${unit}</b> &nbsp;· click to add a point (min. 3) · Enter to finish · Esc to cancel`;
    }
  }
  function paint() {
    ensureMeasureLayers();
    const ptsFC = { type: 'FeatureCollection', features: pts.map((p) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: p }, properties: {} })) };
    map.getSource('measure-pts').setData(ptsFC);
    let shapeFC = emptyFC();
    if (pts.length >= 2) {
      if (tool === 'distance') {
        shapeFC = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: pts }, properties: {} }] };
      } else if (tool === 'area' && pts.length >= 3) {
        shapeFC = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[...pts, pts[0]]] }, properties: {} }] };
      } else if (tool === 'area') {
        shapeFC = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: pts }, properties: {} }] };
      }
    }
    map.getSource('measure-src').setData(shapeFC);
  }

  function onMapClick(e) {
    pts.push([e.lngLat.lng, e.lngLat.lat]);
    paint();
    updateLabel();
  }
  function onKey(e) {
    if (e.key === 'Escape') stopTool(true);
    else if (e.key === 'Enter') stopTool(false);
  }
  function startTool(name) {
    if (tool === name) { stopTool(true); return; }
    stopTool(true);
    tool = name; pts = [];
    map.doubleClickZoom.disable();
    map.getCanvasContainer().style.cursor = 'crosshair';
    map.on('click', onMapClick);
    window.addEventListener('keydown', onKey);
    $(name === 'distance' ? 'pt-distance' : 'pt-area').classList.add('on');
    ensureLabel().hidden = false;
    updateLabel();
  }
  function stopTool(discardLabel) {
    if (!tool) return;
    map.off('click', onMapClick);
    window.removeEventListener('keydown', onKey);
    map.doubleClickZoom.enable();
    map.getCanvasContainer().style.cursor = '';
    $('pt-distance').classList.remove('on');
    $('pt-area').classList.remove('on');
    tool = null; pts = [];
    if (discardLabel) { paint(); if (measureLabel) measureLabel.hidden = true; }
  }
  $('pt-distance').addEventListener('click', () => startTool('distance'));
  $('pt-area').addEventListener('click', () => startTool('area'));
  $('pt-clear').addEventListener('click', () => {
    stopTool(true);
    if (map.getSource('measure-src')) map.getSource('measure-src').setData(emptyFC());
    if (map.getSource('measure-pts')) map.getSource('measure-pts').setData(emptyFC());
  });
}
