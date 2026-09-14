const puppeteer = require('puppeteer');
(async () => {
  const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
  const p = await b.newPage(); await p.setViewport({ width: 1400, height: 900 });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://127.0.0.1:8080/portal/index.html', { waitUntil: 'networkidle2', timeout: 120000 });
  await new Promise(r => setTimeout(r, 13000));

  const has = await p.evaluate(() => ({
    fx: !!window.hazardFX, data: !!window.hazardData,
    cats: Object.keys(window.hazardData || {}).length,
  }));
  console.log('api:', JSON.stringify(has), 'errors:', JSON.stringify(errs));

  // floods: show 13 sites + fly to their zone
  await p.evaluate(() => {
    document.getElementById('hazsel').value = 'floods';
    document.getElementById('haz-show').click();
    document.getElementById('haz-fly').click();
    document.getElementById('bdy-pro').click();
  });
  await new Promise(r => setTimeout(r, 5000));
  await p.screenshot({ path: '/home/user/shots/portal-fx-floods.png' });
  const n1 = await p.evaluate(() => document.getElementById('hazcount').textContent);
  console.log('floods chip:', n1);

  // heatwave: add its 3 sites over Lahore/Karachi/Peshawar
  await p.evaluate(() => {
    document.getElementById('hazsel').value = 'heatwave';
    document.getElementById('haz-show').click();
    document.getElementById('haz-fly').click();
  });
  await new Promise(r => setTimeout(r, 5000));
  await p.screenshot({ path: '/home/user/shots/portal-fx-heatwave.png' });
  const n2 = await p.evaluate(() => document.getElementById('hazcount').textContent);
  console.log('heatwave chip:', n2, '| errors:', JSON.stringify(errs));
  await b.close();
})();
