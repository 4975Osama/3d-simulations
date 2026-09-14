const puppeteer = require('puppeteer');
const fs = require('fs');

const W = 1120, H = 700, FPS = 24;
const out = '/home/user/shots';
const frames = '/home/user/shots/frames';
fs.mkdirSync(frames, { recursive: true });
for (const f of fs.readdirSync(frames)) fs.unlinkSync(`${frames}/${f}`);

const ease = (t) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
const lerp = (a, b, t) => a + (b - a) * t;

(async () => {
  const browser = await puppeteer.launch({ headless: 'new',
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto('http://127.0.0.1:8080/demo/index.html', { waitUntil: 'networkidle2', timeout: 90000 });
  await new Promise((r) => setTimeout(r, 5000));

  const setStyle = async (name) => {
    await page.evaluate((n) => document.querySelector(`button[data-style="${n}"]`).click(), name);
    await new Promise((r) => setTimeout(r, 2500));
  };
  const jump = (v) => page.evaluate((vv) => window.map.jumpTo(vv), v);
  const settle = (ms = 1600) => new Promise((r) => setTimeout(r, ms));

  /* ---------------------------------------------------------- QA screenshots */
  const QA = [
    ['qa-terrain-ghazi',  'terrain',   { center: [72.540, 34.003], zoom: 12.4, pitch: 50, bearing: -35 }],
    ['qa-dark-sukkur',    'dark',      { center: [68.935, 27.828], zoom: 11.9, pitch: 45, bearing: -20 }],
    ['qa-streets-panjnad','streets',   { center: [70.874, 29.227], zoom: 10.6, pitch: 50, bearing: 10 }],
    ['qa-satellite-mangla','satellite',{ center: [73.685, 33.232], zoom: 10.7, pitch: 50, bearing: 25 }],
    ['qa-dark-basin',     'dark',      { center: [70.550, 29.050], zoom: 5.2, pitch: 0, bearing: 0 }],
    ['qa-terrain-hizoom', 'terrain',   { center: [68.938, 27.836], zoom: 15.2, pitch: 62, bearing: -20 }],
  ];
  let cur = 'terrain';
  for (const [name, style, view] of QA) {
    if (style !== cur) { await setStyle(style); cur = style; }
    await jump(view);
    await settle(2200);
    await page.screenshot({ path: `${out}/${name}.png` });
    const s = await page.evaluate(() => window.water.stats());
    console.log(name.padEnd(22), 'drawn', String(s.drawn).padStart(3), 'projMs', s.lastProjectMs.toFixed(1));
  }

  // the "coarse projection" failure mode, side by side
  await setStyle('terrain'); cur = 'terrain';
  await jump({ center: [68.935, 27.828], zoom: 12.6, pitch: 55, bearing: -20 });
  await settle(2000);
  await page.screenshot({ path: `${out}/qa-projection-exact.png` });
  await page.evaluate(() => document.getElementById('coarse').click());
  await settle(2500);
  await page.screenshot({ path: `${out}/qa-projection-coarse.png` });
  await page.evaluate(() => document.getElementById('coarse').click());
  await settle(1500);

  /* -------------------------------------------------- deterministic animation */
  await page.addStyleTag({ content: '#ui,#hud,#legend,.maplibregl-ctrl{display:none!important}' });
  await page.evaluate(() => { window.water.setPaused(true); window.water.setRain(false); });

  const SCENES = [
    { style: 'satellite', n: 110, t0: 0,
      a: { center: [68.928, 27.822], zoom: 11.80, pitch: 46, bearing: -28 },
      b: { center: [68.952, 27.840], zoom: 12.10, pitch: 46, bearing: 2 } },
    { style: 'satellite', n: 100, t0: 24,
      a: { center: [72.545, 34.006], zoom: 12.20, pitch: 52, bearing: -44 },
      b: { center: [72.527, 33.997], zoom: 12.50, pitch: 52, bearing: -16 } },
    { style: 'dark', n: 110, t0: 46,
      a: { center: [72.812, 34.196], zoom: 10.40, pitch: 54, bearing: -22 },
      b: { center: [72.842, 34.212], zoom: 10.70, pitch: 54, bearing: 8 } },
  ];

  let idx = 0;
  for (const sc of SCENES) {
    if (sc.style !== cur) { await setStyle(sc.style); cur = sc.style; }
    await page.evaluate((v) => window.map.jumpTo(v), sc.a);
    // let basemap tiles finish loading before the scene starts
    for (let k = 0; k < 40; k++) {
      if (await page.evaluate(() => window.map.areTilesLoaded())) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    await new Promise((r) => setTimeout(r, 1500));
    for (let i = 0; i < sc.n; i++) {
      const t = ease(i / (sc.n - 1));
      await page.evaluate((v, tm) => {
        window.map.jumpTo(v);
        window.water.setTime(tm);
      }, {
        center: [lerp(sc.a.center[0], sc.b.center[0], t), lerp(sc.a.center[1], sc.b.center[1], t)],
        zoom: lerp(sc.a.zoom, sc.b.zoom, t),
        pitch: lerp(sc.a.pitch, sc.b.pitch, t),
        bearing: lerp(sc.a.bearing, sc.b.bearing, t),
      }, sc.t0 + (i / FPS) * 1.6);
      await new Promise((r) => setTimeout(r, 45));   // let the rAF loop paint
      await page.screenshot({ path: `${frames}/f${String(idx).padStart(4, '0')}.png` });
      idx++;
      if (idx % 40 === 0) console.log('captured', idx);
    }
  }
  console.log('frames captured:', idx);
  await browser.close();
})();
