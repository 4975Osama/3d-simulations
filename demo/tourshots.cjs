const puppeteer = require('puppeteer');
(async () => {
  const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
  const p = await b.newPage(); await p.setViewport({ width: 1120, height: 720 });
  p.on('pageerror', e => console.log('[err]', e.message));
  await p.goto('http://127.0.0.1:8080/demo/index.html', { waitUntil: 'networkidle2', timeout: 90000 });
  await new Promise(r => setTimeout(r, 11000));

  const api = await p.evaluate(() => ({ ok: !!window.tour, scenes: window.tour.sceneCount }));
  console.log('tour api:', JSON.stringify(api));
  if (!api.ok) { await b.close(); process.exit(1); }

  // start the tour: scene 1 caption over the whole-country overview
  await p.evaluate(() => window.tour.start());
  await new Promise(r => setTimeout(r, 5500));
  await p.screenshot({ path: '/home/user/shots/tour-1-intro.png' }); console.log('shot intro');

  // scene 3: depth from the distance field (Mangla)
  await p.evaluate(() => window.tour.play(2));
  await new Promise(r => setTimeout(r, 6800));
  await p.screenshot({ path: '/home/user/shots/tour-3-depth.png' }); console.log('shot depth');

  // scene 6: refraction, boosted 3x (dark)
  await p.evaluate(() => window.tour.play(5));
  await new Promise(r => setTimeout(r, 6800));
  await p.screenshot({ path: '/home/user/shots/tour-6-refraction.png' }); console.log('shot refraction');

  // scene 7: reflection over Mangla, pitched + orbiting (satellite)
  await p.evaluate(() => window.tour.play(6));
  await new Promise(r => setTimeout(r, 9000));
  await p.screenshot({ path: '/home/user/shots/tour-7-reflection.png' }); console.log('shot reflection');

  // scene 8: floods 2022 (includes the geometry rebuild)
  await p.evaluate(() => window.tour.play(7));
  await new Promise(r => setTimeout(r, 12000));
  await p.screenshot({ path: '/home/user/shots/tour-8-floods.png' }); console.log('shot floods');

  // scene 10: finale, dark pitch + orbit
  await p.evaluate(() => window.tour.play(9));
  await new Promise(r => setTimeout(r, 9000));
  await p.screenshot({ path: '/home/user/shots/tour-10-finale.png' }); console.log('shot finale');

  // stop: caption must disappear, user settings restored
  await p.evaluate(() => window.tour.stop());
  await new Promise(r => setTimeout(r, 2500));
  const st = await p.evaluate(() => ({
    card: !!document.getElementById('tourcard'),
    style: document.querySelector('#styles .on')?.dataset.style,
    look: window.water.getLook().name,
  }));
  console.log('after stop:', JSON.stringify(st));
  await b.close();
})();
