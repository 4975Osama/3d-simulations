const puppeteer=require('puppeteer');
(async()=>{
const b=await puppeteer.launch({headless:'new',args:['--no-sandbox','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader']});
const p=await b.newPage(); await p.setViewport({width:900,height:760});
p.on('pageerror',e=>console.log('[err]',e.message));
await p.goto('http://127.0.0.1:8080/demo/index.html',{waitUntil:'networkidle2',timeout:90000});
await new Promise(r=>setTimeout(r,6000));
await p.click('button[data-style="dark"]'); await new Promise(r=>setTimeout(r,2500));
await p.addStyleTag({content:'#ui,#hud,#legend,.maplibregl-ctrl,.marker{display:none!important}'});
// the user's view: deep zoom on the braided Ghazi reach
await p.evaluate(()=>window.map.jumpTo({center:[72.5365,34.0005],zoom:14.6,pitch:0,bearing:-35}));
await new Promise(r=>setTimeout(r,2500));
for (const look of ['spec','realistic','glassy']) {
  await p.evaluate((l)=>window.water.setLook(l), look);
  await new Promise(r=>setTimeout(r,1800));
  await p.screenshot({path:`/home/user/shots/look-${look}.png`});
  console.log('shot', look);
}
await b.close();})();
