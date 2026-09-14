const puppeteer = require('puppeteer');
(async () => {
  const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
  const p = await b.newPage(); await p.setViewport({ width: 900, height: 760 });
  p.on('pageerror', e => console.log('[err]', e.message));
  await p.goto('http://127.0.0.1:8080/demo/index.html', { waitUntil: 'networkidle2', timeout: 90000 });
  await new Promise(r => setTimeout(r, 6000));
  await p.click('button[data-style="dark"]'); await new Promise(r => setTimeout(r, 2500));
  await p.addStyleTag({ content: '#ui,#hud,#legend,.maplibregl-ctrl,.marker{display:none!important}' });
  // the user's view: deep zoom on the braided Ghazi reach
  await p.evaluate(() => window.map.jumpTo({ center: [72.5365, 34.0005], zoom: 14.6, pitch: 0, bearing: -35 }));
  await new Promise(r => setTimeout(r, 2500));

  // 1 — realistic look WITH refraction + reflection (new defaults)
  await p.evaluate(() => { window.water.setOpacity(1); window.water.setLook('realistic'); });
  await new Promise(r => setTimeout(r, 1800));
  await p.screenshot({ path: '/home/user/shots/fx-refr-reflect-on.png' }); console.log('shot fx on');

  // 2 — same look with both effects disabled (proves they are the visible difference)
  await p.evaluate(() => window.water.setLook({ refract: 0, reflect: 0 }));
  await new Promise(r => setTimeout(r, 1800));
  await p.screenshot({ path: '/home/user/shots/fx-off.png' }); console.log('shot fx off');

  // 3 — opacity option: 55% and 25%
  await p.evaluate(() => { window.water.setLook('realistic'); window.water.setOpacity(0.55); });
  await new Promise(r => setTimeout(r, 900));
  await p.screenshot({ path: '/home/user/shots/fx-opacity-55.png' }); console.log('shot opacity 55');
  await p.evaluate(() => window.water.setOpacity(0.25));
  await new Promise(r => setTimeout(r, 900));
  await p.screenshot({ path: '/home/user/shots/fx-opacity-25.png' }); console.log('shot opacity 25');
  await p.evaluate(() => window.water.setOpacity(1));

  // 4 — glassy look (strongest reflection) at Mangla reservoir, flat
  await p.evaluate(() => {
    window.water.setLook('glassy');
    window.map.jumpTo({ center: [73.685, 33.232], zoom: 11.2, pitch: 0, bearing: 0 });
  });
  await new Promise(r => setTimeout(r, 2500));
  await p.screenshot({ path: '/home/user/shots/fx-glassy-reservoir.png' }); console.log('shot glassy reservoir');

  // 5 — grazing acceptance test: same reservoir pitched 55° on satellite style
  // (daytime blue sky, refl 1.0) — sky reflection must grow towards the horizon
  await p.evaluate(() => document.querySelector('button[data-style="satellite"]').click());
  await new Promise(r => setTimeout(r, 3500));
  await p.evaluate(() => {
    window.water.setLook('realistic');
    window.map.jumpTo({ center: [73.685, 33.232], zoom: 10.7, pitch: 55, bearing: 25 });
  });
  await new Promise(r => setTimeout(r, 3500));
  await p.screenshot({ path: '/home/user/shots/fx-grazing-satellite.png' }); console.log('shot grazing satellite');

  // 6 — same pitched view on dark style (dim night sky, refl 0.8)
  await p.evaluate(() => document.querySelector('button[data-style="dark"]').click());
  await new Promise(r => setTimeout(r, 2500));
  await p.screenshot({ path: '/home/user/shots/fx-grazing-dark.png' }); console.log('shot grazing dark');

  await b.close();
})();
