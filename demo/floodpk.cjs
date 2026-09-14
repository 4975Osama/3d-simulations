const puppeteer = require('puppeteer');
(async () => {
  const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
  const p = await b.newPage(); await p.setViewport({ width: 1120, height: 760 });
  p.on('pageerror', e => console.log('[err]', e.message));
  await p.goto('http://127.0.0.1:8080/demo/index.html', { waitUntil: 'networkidle2', timeout: 90000 });
  await new Promise(r => setTimeout(r, 9000));
  await p.evaluate(() => document.querySelector('button[data-bodies="floods"]').click());
  await new Promise(r => setTimeout(r, 22000));
  await p.addStyleTag({ content: '#ui,#hud,#legend,.maplibregl-ctrl,.marker{display:none!important}' });
  await p.evaluate(() => window.map.jumpTo({ center: [69.4, 29.9], zoom: 5.35, pitch: 0, bearing: 0 }));
  await new Promise(r => setTimeout(r, 4000));
  await p.screenshot({ path: '/home/user/shots/flood-pakistan-overview.png' });
  console.log('overview shot done');
  await b.close();
})();
