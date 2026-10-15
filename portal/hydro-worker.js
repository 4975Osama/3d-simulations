/* Urban rainfall-runoff model for the Digital Twin (runs as a Web Worker).

   Terrain: SRTM elevation from the public Terrarium tiles (zoom 14), sampled
   onto an nx x ny grid of cells and lightly smoothed. Each time step:
     1. rain falls; the runoff coefficient C (from roof / paved cover) decides
        how much becomes surface water, the rest soaks in,
     2. detention basins (if any) capture runoff until their storage is full,
     3. storm drains remove up to `drainMMh` from every cell,
     4. water is routed to lower neighbours (4-connected cellular automaton):
        a cell sheds at most half its head difference per step, scaled by a
        Manning's-equation velocity, split in proportion to the head drop.
        Grid edges are open: the ground is extrapolated outward, so water
        leaves the domain wherever the terrain slopes out of it.
   The run spans the storm plus a recession period so drainage is visible.

   in : { id, bbox:[w,s,e,n], nx, ny, C:Float32Array, run:{...}, baseline:{...}|null }
   out: { id, z, frames:[Float32Array], stats:[{wetKm2,avgDepth,maxDepth}],
          maxD, tWet, base:{ maxD, peakKm2 }|null, relief, ms } */

const DEM_Z = 14;
const MANNING_N = 0.035;     // overland flow over mixed urban surfaces
const WET_M = 0.05;          // depth counted as "flooded" (5 cm)
const tileCache = new Map();

const lon2px = (lng) => ((lng + 180) / 360) * 256 * 2 ** DEM_Z;
const lat2px = (lat) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 256 * 2 ** DEM_Z;
};

function loadTile(x, y) {
  const key = x + '/' + y;
  if (!tileCache.has(key)) {
    tileCache.set(key, (async () => {
      const res = await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${DEM_Z}/${x}/${y}.png`);
      if (!res.ok) throw new Error('DEM tile ' + key + ' HTTP ' + res.status);
      const bmp = await createImageBitmap(await res.blob());
      const cv = new OffscreenCanvas(256, 256), ctx = cv.getContext('2d');
      ctx.drawImage(bmp, 0, 0);
      const px = ctx.getImageData(0, 0, 256, 256).data, el = new Float32Array(256 * 256);
      for (let i = 0; i < el.length; i++) el[i] = px[i * 4] * 256 + px[i * 4 + 1] + px[i * 4 + 2] / 256 - 32768;
      return el;
    })().catch((err) => { tileCache.delete(key); throw err; }));
  }
  return tileCache.get(key);
}

async function loadDEM([w, s, e, n], nx, ny) {
  const x0 = Math.floor(lon2px(w) / 256), x1 = Math.floor(lon2px(e) / 256);
  const y0 = Math.floor(lat2px(n) / 256), y1 = Math.floor(lat2px(s) / 256);
  const tiles = new Map();
  await Promise.all([...Array((x1 - x0 + 1) * (y1 - y0 + 1)).keys()].map(async (k) => {
    const x = x0 + (k % (x1 - x0 + 1)), y = y0 + Math.floor(k / (x1 - x0 + 1));
    tiles.set(x + '/' + y, await loadTile(x, y));
  }));
  const at = (gx, gy) => {          // elevation at a global pixel (clamped inside its tile)
    const tx = Math.floor(gx / 256), ty = Math.floor(gy / 256);
    const t = tiles.get(tx + '/' + ty);
    const px = Math.min(255, Math.max(0, Math.floor(gx - tx * 256))), py = Math.min(255, Math.max(0, Math.floor(gy - ty * 256)));
    return t[py * 256 + px];
  };
  const z = new Float32Array(nx * ny), dx = (e - w) / nx, dy = (n - s) / ny;
  for (let r = 0; r < ny; r++) for (let c = 0; c < nx; c++) {
    const gx = lon2px(w + (c + 0.5) * dx) - 0.5, gy = lat2px(n - (r + 0.5) * dy) - 0.5;
    const fx = Math.floor(gx), fy = Math.floor(gy), tx = gx - fx, ty = gy - fy;   // bilinear
    z[r * nx + c] = (at(fx, fy) * (1 - tx) + at(fx + 1, fy) * tx) * (1 - ty) + (at(fx, fy + 1) * (1 - tx) + at(fx + 1, fy + 1) * tx) * ty;
  }
  // 3x3 mean filter: SRTM in dense cities carries ~±3 m radar noise from roofs,
  // which otherwise shows up as hundreds of tiny false ponds
  const sm = new Float32Array(z.length);
  for (let r = 0; r < ny; r++) for (let c = 0; c < nx; c++) {
    let sum = 0, n = 0;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const rr = r + dr, cc = c + dc;
      if (rr >= 0 && rr < ny && cc >= 0 && cc < nx) { sum += z[rr * nx + cc]; n++; }
    }
    sm[r * nx + c] = sum / n;
  }
  return sm;
}

function simulate(z, nx, ny, cellW, cellH, C, run, keepFrames) {
  const N = nx * ny, L = Math.min(cellW, cellH), cellKm2 = (cellW * cellH) / 1e6;
  const d = new Float32Array(N), out = new Float32Array(N), inflow = new Float32Array(N);
  const store = new Float32Array(N).fill(run.storeMM / 1000);
  const maxD = new Float32Array(N), tWet = new Float32Array(N).fill(-1);
  const steps = Math.min(1500, Math.max(300, Math.ceil(run.totalH * 40)));
  const dtH = run.totalH / steps, dtS = dtH * 3600;
  const rainStep = (run.rainMMh / 1000) * dtH, drainStep = (run.drainMMh / 1000) * dtH;
  const frames = [], stats = [];
  let nextFrame = 0;
  const nb = new Int32Array(4), dh = new Float32Array(4);

  const record = (s) => {
    let wet = 0, sum = 0, mx = 0;
    for (let i = 0; i < N; i++) { const v = d[i]; if (v >= WET_M) { wet++; sum += v; if (v > mx) mx = v; } }
    stats.push({ wetKm2: wet * cellKm2, avgDepth: wet ? sum / wet : 0, maxDepth: mx, h: s * dtH });
    if (keepFrames) frames.push(d.slice());
  };

  for (let s = 0; s <= steps; s++) {
    if (s >= (nextFrame * steps) / (run.frames - 1) - 1e-9) { record(s); nextFrame++; }
    if (s === steps) break;
    const raining = s * dtH < run.stormH;
    for (let i = 0; i < N; i++) {
      let add = raining ? rainStep * C[i] : 0;
      if (add > 0 && store[i] > 0) { const k = Math.min(store[i], add); store[i] -= k; add -= k; }
      const v = d[i] + add - drainStep;
      d[i] = v > 0 ? v : 0;
    }
    out.fill(0); inflow.fill(0);
    let lost = 0;
    for (let r = 0; r < ny; r++) for (let c = 0; c < nx; c++) {
      const i = r * nx + c, di = d[i];
      if (di < 1e-4) continue;
      const H = z[i] + di;
      // neighbours W,E,N,S; -1 = outside (ground extrapolated from the inner neighbour)
      nb[0] = c > 0 ? i - 1 : -1; nb[1] = c < nx - 1 ? i + 1 : -1;
      nb[2] = r > 0 ? i - nx : -1; nb[3] = r < ny - 1 ? i + nx : -1;
      let sum = 0, mx = 0;
      for (let k = 0; k < 4; k++) {
        let hj;
        if (nb[k] >= 0) hj = z[nb[k]] + d[nb[k]];
        else { const opp = nb[k ^ 1]; hj = opp >= 0 ? 2 * z[i] - z[opp] : z[i]; }
        const v = H - hj; dh[k] = v > 0 ? v : 0; sum += dh[k]; if (dh[k] > mx) mx = dh[k];
      }
      if (mx <= 0) continue;
      const vel = (1 / MANNING_N) * Math.pow(di, 2 / 3) * Math.sqrt(mx / L);
      const move = Math.min(di, mx / 2) * Math.min(0.5, (vel * dtS) / L);
      out[i] = move;
      for (let k = 0; k < 4; k++) {
        if (!dh[k]) continue;
        const q = (move * dh[k]) / sum;
        if (nb[k] >= 0) inflow[nb[k]] += q; else lost += q;
      }
    }
    const t = (s + 1) * dtH;
    for (let i = 0; i < N; i++) {
      const v = d[i] - out[i] + inflow[i];
      d[i] = v > 0 ? v : 0;
      if (v > maxD[i]) maxD[i] = v;
      if (tWet[i] < 0 && v >= WET_M) tWet[i] = t;
    }
  }
  let peakKm2 = 0; for (const st of stats) if (st.wetKm2 > peakKm2) peakKm2 = st.wetKm2;
  return { frames, stats, maxD, tWet, peakKm2 };
}

let demKey = '', dem = null;
self.onmessage = async (ev) => {
  const { id, bbox, nx, ny, C, run, baseline } = ev.data;
  try {
    const t0 = performance.now();
    const key = bbox.join(',') + '|' + nx + 'x' + ny;
    if (key !== demKey) { dem = await loadDEM(bbox, nx, ny); demKey = key; }
    const latMid = (bbox[1] + bbox[3]) / 2;
    const cellW = ((bbox[2] - bbox[0]) / nx) * 111320 * Math.cos((latMid * Math.PI) / 180);
    const cellH = ((bbox[3] - bbox[1]) / ny) * 110570;
    const main = simulate(dem, nx, ny, cellW, cellH, C, run, true);
    const base = baseline ? simulate(dem, nx, ny, cellW, cellH, C, baseline, false) : null;
    let lo = Infinity, hi = -Infinity; for (const v of dem) { if (v < lo) lo = v; if (v > hi) hi = v; }
    const msg = {
      id, z: dem.slice(), frames: main.frames, stats: main.stats, maxD: main.maxD, tWet: main.tWet,
      peakKm2: main.peakKm2, base: base && { maxD: base.maxD, peakKm2: base.peakKm2 },
      relief: hi - lo, cellW, cellH, ms: Math.round(performance.now() - t0),
    };
    const transfer = [...main.frames.map((f) => f.buffer), main.maxD.buffer, main.tWet.buffer, msg.z.buffer];
    if (base) transfer.push(base.maxD.buffer);
    self.postMessage(msg, transfer);
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message || err) });
  }
};
