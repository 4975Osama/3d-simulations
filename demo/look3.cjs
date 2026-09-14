const puppeteer=require('puppeteer');
(async()=>{
const b=await puppeteer.launch({headless:'new',args:['--no-sandbox','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader']});
const p=await b.newPage(); await p.setViewport({width:900,height:620});
p.on('pageerror',e=>console.log('[err]',e.message));
await p.goto('http://127.0.0.1:8080/demo/index.html',{waitUntil:'networkidle2',timeout:90000});
await new Promise(r=>setTimeout(r,6000));
const views=[
 ['z15-terrain','terrain',{center:[68.938,27.836],zoom:15.2,pitch:62,bearing:-20}],
 ['z14-dark','dark',{center:[72.5365,34.0005],zoom:14.6,pitch:0,bearing:-35}],
 ['z12-dark','dark',{center:[68.935,27.828],zoom:11.9,pitch:45,bearing:-20}],
 ['z10-terrain','terrain',{center:[72.824,34.202],zoom:10.5,pitch:40,bearing:0}],
];
let cur='terrain';
for(const [n,st,v] of views){
 if(st!==cur){ await p.evaluate(st=>document.querySelector(`button[data-style="${st}"]`).click(),st); cur=st; await new Promise(r=>setTimeout(r,2500)); }
 await p.evaluate(v=>window.map.jumpTo(v),v);
 for(let k=0;k<20;k++){ if(await p.evaluate(()=>window.map.areTilesLoaded())) break; await new Promise(r=>setTimeout(r,500)); }
 await new Promise(r=>setTimeout(r,2200));
 await p.evaluate(()=>{const s=document.createElement('style');s.textContent='#ui,#hud,#legend,.maplibregl-ctrl,.mk{display:none!important}';document.head.appendChild(s);});
 await new Promise(r=>setTimeout(r,300));
 await p.screenshot({path:`/home/user/shots/v3-${n}.png`}); console.log('shot',n);
}
await b.close();})();
