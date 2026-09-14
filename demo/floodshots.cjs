const puppeteer = require('puppeteer');
(async () => {
  const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
  const p = await b.newPage(); await p.setViewport({ width: 1120, height: 700 });
  p.on('pageerror', e => console.log('[err]', e.message));
  p.on('console', m => { const t = m.text(); if (t.includes('setPolygons') || t.includes('[demo]')) console.log('  ', t); });
  await p.goto('http://127.0.0.1:8080/demo/index.html', { waitUntil: 'networkidle2', timeout: 90000 });
  await new Promise(r => setTimeout(r, 9000));

  // switch to floods (heavy: triangulate + SDF for ~3.6k polygons)
  await p.evaluate(() => document.querySelector('button[data-bodies="floods"]').click());
  console.log('clicked floods, rebuilding...');
  await new Promise(r => setTimeout(r, 25000));

  await p.addStyleTag({ content: '#ui,#hud,#legend,.maplibregl-ctrl,.marker{display:none!important}' });

  // 1 — Sindh floodplain overview, terrain, flat
  await p.evaluate(() => window.map.jumpTo({ center: [68.20, 27.75], zoom: 8.7, pitch: 0, bearing: 0 }));
  await new Promise(r => setTimeout(r, 3500));
  await p.screenshot({ path: '/home/user/shots/flood-terrain-flat.png' }); console.log('shot terrain flat');

  // 2 — same area, dark, pitched: grazing sky over the flood sheets
  await p.evaluate(() => document.querySelector('button[data-style="dark"]').click());
  await new Promise(r => setTimeout(r, 2500));
  await p.evaluate(() => window.map.jumpTo({ center: [68.20, 27.75], zoom: 8.6, pitch: 55, bearing: 20 }));
  await new Promise(r => setTimeout(r, 3500));
  await p.screenshot({ path: '/home/user/shots/flood-dark-pitched.png' }); console.log('shot dark pitched');

  // 3 — close-up on the flood blobs near Sukkur/Rohri
  await p.evaluate(() => window.map.jumpTo({ center: [68.90, 27.85], zoom: 11.2, pitch: 0, bearing: 0 }));
  await new Promise(r => setTimeout(r, 3500));
  await p.screenshot({ path: '/home/user/shots/flood-dark-closeup.png' }); console.log('shot dark closeup');

  // 4 — "both": rivers + floods at Panjnad
  await p.evaluate(() => window.map.jumpTo({ center: [70.55, 29.05], zoom: 7.4, pitch: 0, bearing: 0 }));
  await p.evaluate(() => document.querySelector('button[data-bodies="both"]').click());
  console.log('clicked both, rebuilding...');
  await new Promise(r => setTimeout(r, 30000));
  await p.screenshot({ path: '/home/user/shots/flood-both-panjnad.png' }); console.log('shot both panjnad');

  await b.close();
})();
