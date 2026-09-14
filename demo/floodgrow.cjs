const puppeteer = require('puppeteer');
(async () => {
  const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
  const p = await b.newPage(); await p.setViewport({ width: 1120, height: 720 });
  p.on('pageerror', e => console.log('[err]', e.message));
  await p.goto('http://127.0.0.1:8080/demo/index.html', { waitUntil: 'networkidle2', timeout: 90000 });
  await new Promise(r => setTimeout(r, 11000));

  // straight to the spread scene: rebuild floods + fly (~9 s) then grow starts
  await p.evaluate(() => { window.tour.start(); window.tour.play(7); });

  // wait until the grow clock starts, then sample the spread
  let t0grow = 0;
  for (let i = 0; i < 80; i++) {
    const g = await p.evaluate(() => (window.water.getGrow ? window.water.getGrow() : 1));
    if (g < 0.02) { t0grow = Date.now(); break; }
    await new Promise(r => setTimeout(r, 500));
  }
  console.log('grow clock running:', t0grow !== 0);
  const marks = [2500, 8000, 13500, 19500];      // ≈ t 0.13 / 0.42 / 0.71 / full
  const names = ['a-start', 'b-rising', 'c-late', 'd-full'];
  for (let k = 0; k < marks.length; k++) {
    const wait = t0grow + marks[k] - Date.now();
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    const g = await p.evaluate(() => window.water.getGrow());
    await p.screenshot({ path: `/home/user/shots/spread-${names[k]}.png` });
    console.log(`shot spread-${names[k]}  grow=${g}`);
  }

  // let the scene finish and the next one load, then end and check restore
  await p.evaluate(() => window.tour.stop());
  await new Promise(r => setTimeout(r, 1200));
  const st = await p.evaluate(() => ({
    grow: window.water.getGrow(),
    look: window.water.getLook().name,
    style: document.querySelector('#styles .on')?.dataset.style,
    card: !!document.getElementById('tourcard'),
  }));
  console.log('after stop:', JSON.stringify(st));
  await b.close();
})();
