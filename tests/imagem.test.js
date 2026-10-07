// Verificação de nuvem nos talhões e montagem das bandas, usando COGs sintéticos em memória (sem rede)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { Core, FIX, registerCog, requested, mockFetch } = require('./helpers/core');

const EPSG = 32722;
const geo = Core.parseGeoJSON(JSON.parse(fs.readFileSync(path.join(FIX, 'talhoes.geojson'), 'utf8')));
const polys = Core.projectPolys(geo.polygons, EPSG);
const xs = polys.flat(2).map(c => c[0]), ys = polys.flat(2).map(c => c[1]);
const B = { minx: Math.min(...xs), maxx: Math.max(...xs), miny: Math.min(...ys), maxy: Math.max(...ys) };
// x que separa o talhão A (oeste) do B (leste)
const splitX = (Math.max(...polys[0].flat().map(c => c[0])) + Math.min(...polys[1].flat().map(c => c[0]))) / 2;

// Grade comum alinhada a 60 m (múltiplo de 10, 20 e 30) cobrindo os talhões com folga
const MARGIN = 3000;
const GX0 = Math.floor((B.minx - MARGIN) / 60) * 60, GY0 = Math.ceil((B.maxy + MARGIN) / 60) * 60;
const GX1 = Math.ceil((B.maxx + MARGIN) / 60) * 60, GY1 = Math.floor((B.miny - MARGIN) / 60) * 60;

// Cria um raster na grade comum; fn(x, y, col, row) dá o valor de cada pixel
function raster(href, res, fn, extent = [GX0, GY0, GX1, GY1]) {
  const [x0, y0, x1, y1] = extent;
  const W = Math.round((x1 - x0) / res), H = Math.round((y0 - y1) / res), data = new Uint16Array(W * H);
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) data[r * W + c] = fn(x0 + (c + 0.5) * res, y0 - (r + 0.5) * res, c, r);
  registerCog(href, { W, H, X0: x0, Y0: y0, res, epsg: EPSG, data });
  return { W, H };
}

const cand = (id, assets, props = {}) => ({
  item: { id, properties: { 'proj:epsg': EPSG, ...props }, assets: Object.fromEntries(Object.entries(assets).map(([k, h]) => [k, { href: h }])) },
});

// ---------- checkCandidate ----------
test('checkCandidate S2: cena toda limpa => 0% nuvem, 0% sem dado', async () => {
  raster('mem://clear/scl', 20, () => 4);
  const r = await Core.checkCandidate(cand('clear', { scl: 'mem://clear/scl' }), 'sentinel2', geo);
  assert.ok(r.n > 100, 'pixels dentro dos talhões');
  assert.equal(r.cloudPct, 0);
  assert.equal(r.nodataPct, 0);
});

test('checkCandidate S2: nuvem (SCL 9) em tudo => 100%', async () => {
  raster('mem://cloud/scl', 20, () => 9);
  const r = await Core.checkCandidate(cand('cloud', { scl: 'mem://cloud/scl' }), 'sentinel2', geo);
  assert.equal(r.cloudPct, 100);
});

test('checkCandidate S2: nuvem só sobre o talhão A => fração parcial', async () => {
  raster('mem://half/scl', 20, x => x < splitX ? 9 : 4);
  const r = await Core.checkCandidate(cand('half', { scl: 'mem://half/scl' }), 'sentinel2', geo);
  assert.ok(r.cloudPct > 30 && r.cloudPct < 70, 'cloudPct=' + r.cloudPct);
  assert.equal(r.nodataPct, 0);
});

test('checkCandidate S2: nuvem fora dos talhões não conta', async () => {
  raster('mem://outside/scl', 20, (x, y) => (y > B.maxy + 100 || x > B.maxx + 100) ? 9 : 4);
  const r = await Core.checkCandidate(cand('outside', { scl: 'mem://outside/scl' }), 'sentinel2', geo);
  assert.equal(r.cloudPct, 0);
});

test('checkCandidate S2: cena que não cobre o talhão B => sem dado > 0', async () => {
  raster('mem://partial/scl', 20, () => 4, [GX0, GY0, Math.round(splitX / 60) * 60, GY1]);
  const r = await Core.checkCandidate(cand('partial', { scl: 'mem://partial/scl' }), 'sentinel2', geo);
  assert.ok(r.nodataPct > 30 && r.nodataPct < 70, 'nodataPct=' + r.nodataPct);
});

test('checkCandidate Landsat: assina a URL com o token do Planetary Computer e lê QA_PIXEL', async () => {
  const href = 'https://landsateuwest.blob.core.windows.net/landsat-c2/teste/qa.tif';
  raster(href, 30, x => x < splitX ? (1 << 3) : 21824);
  const f = mockFetch(url => {
    assert.equal(url, 'https://planetarycomputer.microsoft.com/api/sas/v1/token/landsateuwest/landsat-c2');
    return { json: { token: 'sv=1&sig=abc', 'msft:expiry': new Date(Date.now() + 3600e3).toISOString() } };
  });
  try {
    const r = await Core.checkCandidate(cand('ls', { qa_pixel: href }), 'landsat', geo);
    assert.ok(r.cloudPct > 30 && r.cloudPct < 70, 'cloudPct=' + r.cloudPct);
    assert.equal(requested.at(-1), href + '?sv=1&sig=abc');
    assert.equal(f.calls.length, 1);
  } finally { f.restore(); }
});

// ---------- loadImage ----------
test('loadImage S2: recorte = bbox dos talhões + buffer, bandas na ordem do sensor, 20 m reamostrado para 10 m', async () => {
  raster('mem://img/blue', 10, () => 1000);
  raster('mem://img/red', 10, () => 2000);
  raster('mem://img/nir', 10, () => 3000);
  raster('mem://img/rededge1', 20, (x, y, c) => c + 1);
  const c = cand('img', { nir: 'mem://img/nir', rededge1: 'mem://img/rededge1', blue: 'mem://img/blue', red: 'mem://img/red' },
    { 's2:processing_baseline': '05.10', 'earthsearch:boa_offset_applied': false });
  const progress = [];
  const img = await Core.loadImage(c, 'sentinel2', geo, 500, (k, n) => progress.push([k, n]));

  assert.deepEqual(img.bands.map(b => b.name), ['blue', 'red', 'red_edge_1', 'nir'], 'ordem de SENSORS, só assets existentes');
  assert.deepEqual(img.bands.map(b => b.code), ['B02', 'B04', 'B05', 'B08']);
  assert.equal(img.res, 10);
  assert.equal(img.epsg, EPSG);
  assert.equal(img.bands[0].offset, -0.1);
  assert.equal(progress.length, 4);

  // extensão: alinhada à grade de 10 m e cobrindo bbox + 500 m
  assert.equal((img.X0 - GX0) % 10, 0);
  assert.ok(img.X0 <= B.minx - 500 && img.X0 > B.minx - 510);
  assert.ok(img.Y0 >= B.maxy + 500 && img.Y0 < B.maxy + 510);
  assert.ok(img.X0 + img.W * 10 >= B.maxx + 500);
  assert.ok(img.Y0 - img.H * 10 <= B.miny - 500);

  // os talhões ficam dentro da imagem com ~50 px de margem
  const px = img.polysPx.flat(2);
  assert.ok(Math.min(...px.map(p => p[0])) >= 49 && Math.max(...px.map(p => p[0])) <= img.W - 49);

  for (const b of img.bands) assert.equal(b.data.length, img.W * img.H);
  assert.ok(img.bands[0].data.every(v => v === 1000), 'blue constante');
  assert.ok(img.bands[3].data.every(v => v === 3000), 'nir constante');

  // banda de 20 m: cada valor repete em 2 pixels de 10 m e cresce de 1 em 1
  const re = img.bands[2].data.slice(0, img.W);
  for (let i = 1; i < re.length; i++) assert.ok(re[i] - re[i - 1] === 0 || re[i] - re[i - 1] === 1);
  const runs = new Map(); for (const v of re) runs.set(v, (runs.get(v) || 0) + 1);
  assert.ok([...runs.values()].slice(1, -1).every(n => n === 2));
});

test('loadImage: área grande demais dá erro antes de baixar', async () => {
  raster('mem://big/blue', 10, () => 1);
  const c = cand('big', Object.fromEntries(Core.SENSORS.sentinel2.bands.map(b => [b.asset, 'mem://big/blue'])));
  await assert.rejects(Core.loadImage(c, 'sentinel2', geo, 200000), /grande demais/);
});
