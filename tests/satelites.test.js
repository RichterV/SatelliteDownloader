// Testes específicos de cada satélite secundário (Landsat 4/5/7, HLS, Sentinel-1, PALSAR, DEM, MODIS)
// e da assinatura de URLs do Planetary Computer. Sem rede: busca e COGs são simulados.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { Core, GeoTIFFLib, FIX, registerCog, mockFetch } = require('./helpers/core');

const geo = Core.parseGeoJSON(JSON.parse(fs.readFileSync(path.join(FIX, 'talhoes.geojson'), 'utf8')));
const SPLIT_LON = -52.585; // entre o talhão A (oeste) e o B (leste)

// Extensão em torno dos talhões no CRS pedido, alinhada a `step`
function extentFor(crs, margin, step) {
  const ps = Core.projectPolys(geo.polygons, crs).flat(2);
  const xs = ps.map(p => p[0]), ys = ps.map(p => p[1]);
  return {
    x0: Math.floor((Math.min(...xs) - margin) / step) * step, x1: Math.ceil((Math.max(...xs) + margin) / step) * step,
    y0: Math.ceil((Math.max(...ys) + margin) / step) * step, y1: Math.floor((Math.min(...ys) - margin) / step) * step,
  };
}
// Raster sintético: fn(x, y) dá o valor do pixel (x, y no CRS); Arr define o tipo
function raster(href, { crs, res, ext, Arr = Uint16Array, nodata = 0, fn }) {
  const W = Math.round((ext.x1 - ext.x0) / res), H = Math.round((ext.y0 - ext.y1) / res), data = new Arr(W * H);
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) data[r * W + c] = fn(ext.x0 + (c + 0.5) * res, ext.y0 - (r + 0.5) * res);
  registerCog(href, { W, H, X0: ext.x0, Y0: ext.y0, res, epsg: crs, data, nodata });
}
const item = (id, collection, assets, props = {}) => ({
  id, collection, geometry: null,
  properties: { datetime: '2025-07-23T13:00:00Z', ...props },
  assets: Object.fromEntries(Object.entries(assets).map(([k, h]) => [k, { href: h }])),
});
const tileFp = (x0, x1, y0, y1) => ({ type: 'Polygon', coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] });
const allValues = (data, pred) => Array.from(data).every(pred);

// ======================= Landsat 4/5/7 =======================
test('Landsat 4/5/7: busca filtra landsat-4, 5 e 7 na coleção C2 L2', async () => {
  const f = mockFetch(() => ({ json: { features: [], links: [] } }));
  try {
    await Core.stacSearch('landsat457', geo.bboxLL, '2005-01-01', '2005-12-31');
    assert.deepEqual(f.calls[0].body.collections, ['landsat-c2-l2']);
    assert.deepEqual(f.calls[0].body.query.platform.in, ['landsat-4', 'landsat-5', 'landsat-7']);
  } finally { f.restore(); }
});

test('Landsat 4/5/7: faixa sem dado do Landsat 7 (SLC-off) sobre o talhão => sem dado', async () => {
  const ext = extentFor(32722, 2000, 30);
  raster('mem://l7/qa', { crs: 32722, res: 30, ext, fn: x => (Math.floor(x / 300) % 3 === 0 ? 1 : 21824) });
  const r = await Core.checkCandidate({ item: item('LE07', 'landsat-c2-l2', { qa_pixel: 'mem://l7/qa' }, { 'proj:epsg': 32722 }) }, 'landsat457', geo);
  assert.ok(r.nodataPct > 10, 'nodataPct=' + r.nodataPct);
  assert.equal(r.cloudPct, 0);
});

test('Landsat 4/5/7: bandas TM/ETM+ (sem coastal, térmica ST_B6 em lwir)', async () => {
  const ext = extentFor(32722, 2000, 30);
  for (const a of ['blue', 'green', 'red', 'nir08', 'swir16', 'swir22', 'lwir']) raster('mem://l5/' + a, { crs: 32722, res: 30, ext, fn: () => 9000 });
  const it = item('LT05', 'landsat-c2-l2', Object.fromEntries(['blue', 'green', 'red', 'nir08', 'swir16', 'swir22', 'lwir'].map(a => [a, 'mem://l5/' + a])), { platform: 'landsat-5' });
  const img = await Core.loadImage({ item: it }, 'landsat457', geo, 100);
  assert.deepEqual(img.bands.map(b => b.code), ['SR_B1', 'SR_B2', 'SR_B3', 'SR_B4', 'SR_B5', 'SR_B7', 'ST_B6']);
  assert.equal(img.bands.at(-1).unit, 'K');
  assert.equal(Core.SENSORS.landsat457.satellite(it), 'Landsat-5');
});

// ======================= HLS =======================
test('HLS: busca nas duas coleções (S30 e L30)', async () => {
  const f = mockFetch(() => ({ json: { features: [], links: [] } }));
  try {
    await Core.stacSearch('hls', geo.bboxLL, '2025-07-01', '2025-08-01');
    assert.deepEqual(f.calls[0].body.collections, ['hls2-s30', 'hls2-l30']);
  } finally { f.restore(); }
});

test('HLS: nir vem de B8A no S30 e de B05 no L30; int16 com valores negativos e nodata -9999', async () => {
  const ext = extentFor(32722, 1500, 30);
  const assets = {};
  for (const a of ['B01', 'B02', 'B03', 'B04', 'B05', 'B06', 'B07', 'B8A', 'B11', 'B12']) {
    raster('mem://hls/' + a, { crs: 32722, res: 30, ext, Arr: Int16Array, nodata: -9999, fn: (x, y) => a === 'B02' ? -50 : 1000 + parseInt(a.slice(1), 16) });
    assets[a] = 'mem://hls/' + a;
  }
  const s30 = await Core.loadImage({ item: item('S30', 'hls2-s30', assets, { platform: 'sentinel-2b' }) }, 'hls', geo, 0);
  const l30 = await Core.loadImage({ item: item('L30', 'hls2-l30', assets, { platform: 'landsat-8' }) }, 'hls', geo, 0);
  const nir = img => img.bands.find(b => b.name === 'nir').data;
  assert.ok(allValues(nir(s30), v => v === 1000 + 0x8A), 'S30 usa B8A');
  assert.ok(allValues(nir(l30), v => v === 1000 + 0x05), 'L30 usa B05');
  assert.equal(s30.dtype, 'int16');
  assert.ok(s30.bands[0].data instanceof Int16Array);
  assert.ok(allValues(s30.bands.find(b => b.name === 'blue').data, v => v === -50), 'reflectância negativa preservada');
  assert.equal(Core.SENSORS.hls.satellite({ properties: { platform: 'sentinel-2b' } }), 'HLS Sentinel-2B');
});

test('HLS: Fmask (255 sem dado; bits 1-3 nuvem/sombra; água e neve contam como limpo)', () => {
  const c = Core.SENSORS.hls.classify;
  assert.equal(c(255), 'nodata');
  assert.equal(c(1 << 1), 'cloud');
  assert.equal(c(1 << 2), 'cloud');
  assert.equal(c(1 << 3), 'cloud');
  assert.equal(c(1 << 4), 'clear', 'neve');
  assert.equal(c(1 << 5), 'clear', 'água');
  assert.equal(c(0), 'clear');
});

// ======================= Sentinel-1 =======================
test('Sentinel-1: float32 preservado; -32768 sobre o talhão B => sem dado; nunca "nuvem"', async () => {
  const ext = extentFor(32722, 1500, 10);
  raster('mem://s1/vv', { crs: 32722, res: 10, ext, Arr: Float32Array, nodata: -32768, fn: x => x > 0 ? 0.125 : 0 });
  const vvHalf = 'mem://s1/vv-half';
  const xs = Core.projectPolys([[[[SPLIT_LON, -21.74]]]], 32722)[0][0][0][0];
  raster(vvHalf, { crs: 32722, res: 10, ext, Arr: Float32Array, nodata: -32768, fn: x => x > xs ? -32768 : 0.2 });
  raster('mem://s1/vh', { crs: 32722, res: 10, ext, Arr: Float32Array, nodata: -32768, fn: () => 0.03125 });

  const ok = await Core.checkCandidate({ item: item('S1', 'sentinel-1-rtc', { vv: 'mem://s1/vv' }) }, 'sentinel1', geo);
  assert.deepEqual([ok.cloudPct, ok.nodataPct], [0, 0]);
  const half = await Core.checkCandidate({ item: item('S1h', 'sentinel-1-rtc', { vv: vvHalf }) }, 'sentinel1', geo);
  assert.ok(half.nodataPct > 30 && half.nodataPct < 70, 'nodataPct=' + half.nodataPct);
  assert.equal(half.cloudPct, 0);

  const img = await Core.loadImage({ item: item('S1', 'sentinel-1-rtc', { vv: 'mem://s1/vv', vh: 'mem://s1/vh' }) }, 'sentinel1', geo, 200);
  assert.ok(img.bands[0].data instanceof Float32Array);
  assert.ok(allValues(img.bands[0].data, v => v === 0.125));
  assert.ok(allValues(img.bands[1].data, v => v === 0.03125));

  const im = await (await GeoTIFFLib.fromArrayBuffer(Core.buildGeoTIFF(img, {}))).getImage();
  assert.equal(im.fileDirectory.SampleFormat[0], 3, 'float');
  assert.equal(im.fileDirectory.BitsPerSample[0], 32);
  assert.equal(im.getGDALNoData(), -32768);
  const ras = await im.readRasters();
  assert.equal(ras[1][0], 0.03125);
});

test('Sentinel-1: sem nuvem na busca nem no rótulo do satélite', () => {
  assert.equal(Core.SENSORS.sentinel1.satellite({ properties: { platform: 'sentinel-1c' } }), 'Sentinel-1C');
  assert.equal(Core.SENSORS.sentinel1.classify(0.3), 'clear');
});

// ======================= ALOS-2 PALSAR-2 (mosaico anual, EPSG:4326) =======================
const palsarItem = (id, year, x0, x1, assets) => ({
  ...item(id, 'alos-palsar-mosaic', assets, { datetime: `${year}-01-01T00:00:00Z`, start_datetime: `${year}-01-01T00:00:00Z`, end_datetime: `${year}-12-31T23:59:59Z` }),
  geometry: tileFp(x0, x1, -22, -21),
});

test('PALSAR: janela mínima de ~10 anos e tiles do mesmo ano viram um único candidato', () => {
  const [a, b] = Core.searchRange('palsar', '2025-08-01', 60);
  assert.ok(a <= '2015-12-31' && b >= '2035-01-01');
  const its = [palsarItem('W21', 2021, -53, SPLIT_LON, {}), palsarItem('E21', 2021, SPLIT_LON, -52, {}),
    palsarItem('W20', 2020, -53, -52, {}), palsarItem('W22', 2022, -53, -52, {})];
  const c = Core.orderCandidates(its, 'palsar', '2021-06-15', geo);
  assert.equal(c.length, 3);
  assert.equal(c[0].day, '2021-01-01');
  assert.equal(c[0].delta, 0, 'data alvo dentro do ano do mosaico');
  assert.deepEqual(c[0].items.map(i => i.id).sort(), ['E21', 'W21']);
  assert.equal(c[0].covers, true, 'os dois tiles juntos cobrem a área');
  assert.equal(c[1].day, '2020-01-01', 'ano anterior antes do posterior');
});

test('PALSAR: mosaico de 2 tiles em EPSG:4326 e buffer convertido para graus', async () => {
  const step = 1 / 4500, ext = extentFor(4326, 0.03, step);
  const W = { x0: ext.x0, x1: SPLIT_LON, y0: ext.y0, y1: ext.y1 }, E = { x0: SPLIT_LON, x1: ext.x1, y0: ext.y0, y1: ext.y1 };
  for (const [t, e, v] of [['w', W, 100], ['e', E, 200]]) {
    raster(`mem://pal/${t}/HH`, { crs: 4326, res: step, ext: e, fn: () => v });
    raster(`mem://pal/${t}/HV`, { crs: 4326, res: step, ext: e, fn: () => v / 2 });
    raster(`mem://pal/${t}/mask`, { crs: 4326, res: step, ext: e, fn: () => 255 });
  }
  const its = ['w', 'e'].map(t => palsarItem(t, 2021, 0, 0, { HH: `mem://pal/${t}/HH`, HV: `mem://pal/${t}/HV`, mask: `mem://pal/${t}/mask` }));

  const only = await Core.checkCandidate({ item: its[0], items: [its[0]] }, 'palsar', geo);
  assert.ok(only.nodataPct > 30, 'só o tile oeste não cobre o talhão B');
  const both = await Core.checkCandidate({ item: its[0], items: its }, 'palsar', geo);
  assert.equal(both.nodataPct, 0, 'mosaico cobre os dois talhões');

  const img = await Core.loadImage({ item: its[0], items: its }, 'palsar', geo, 500);
  assert.equal(img.epsg, 4326);
  const hh = img.bands[0].data;
  assert.ok(hh.includes(100) && hh.includes(200), 'valores dos dois tiles');
  assert.ok(allValues(hh, v => v === 100 || v === 200), 'sem buracos entre os tiles');
  const lat = (geo.bboxLL[1] + geo.bboxLL[3]) / 2, bx = 500 / (111320 * Math.cos(lat * Math.PI / 180));
  assert.ok(img.X0 <= geo.bboxLL[0] - bx && img.X0 > geo.bboxLL[0] - bx - 2 * step, 'buffer de 500 m em graus');
  assert.ok(img.Y0 >= geo.bboxLL[3] + 500 / 110574);
});

// ======================= Copernicus DEM =======================
test('DEM: busca sem filtro de data', async () => {
  const f = mockFetch(() => ({ json: { features: [], links: [] } }));
  try {
    await Core.stacSearch('dem', geo.bboxLL, '2025-01-01', '2025-12-31');
    assert.deepEqual(f.calls[0].body.collections, ['cop-dem-glo-30']);
    assert.equal(f.calls[0].body.datetime, undefined);
  } finally { f.restore(); }
});

test('DEM: todos os tiles num candidato e altitude float32 mosaicada', async () => {
  const step = 1 / 3600, ext = extentFor(4326, 0.02, step);
  raster('mem://dem/w', { crs: 4326, res: step, ext: { ...ext, x1: SPLIT_LON }, Arr: Float32Array, nodata: -9999, fn: () => 312.5 });
  raster('mem://dem/e', { crs: 4326, res: step, ext: { ...ext, x0: SPLIT_LON }, Arr: Float32Array, nodata: -9999, fn: () => 0 });
  const its = ['w', 'e'].map(t => ({ ...item('dem-' + t, 'cop-dem-glo-30', { data: 'mem://dem/' + t }, { datetime: '2021-04-22T00:00:00Z' }), geometry: tileFp(-53, -52, -22, -21) }));
  const c = Core.orderCandidates(its, 'dem', '2025-08-01', geo);
  assert.equal(c.length, 1);
  assert.equal(c[0].items.length, 2);
  const chk = await Core.checkCandidate(c[0], 'dem', geo);
  assert.deepEqual([chk.cloudPct, chk.nodataPct], [0, 0]);
  const img = await Core.loadImage(c[0], 'dem', geo, 100);
  assert.deepEqual(img.bands.map(b => [b.name, b.unit]), [['elevation', 'm']]);
  const d = img.bands[0].data;
  assert.ok(d.includes(312.5) && d.includes(0), 'altitude 0 (válida) não vira sem dado');
  assert.ok(!d.includes(-9999));
});

test('gridOf: RasterPixelIsPoint (DEM, Landsat) desloca meio pixel', () => {
  const fake = (rt) => ({ getOrigin: () => [-53, -21], getResolution: () => [0.5, -0.5], getGeoKeys: () => ({ GTRasterTypeGeoKey: rt }), getWidth: () => 2, getHeight: () => 2 });
  assert.deepEqual([Core.gridOf(fake(1)).ox, Core.gridOf(fake(1)).oy], [-53, -21]);
  assert.deepEqual([Core.gridOf(fake(2)).ox, Core.gridOf(fake(2)).oy], [-53.25, -20.75]);
});

// ======================= MODIS (sinusoidal) =======================
test('MODIS: projeção sinusoidal conferida com a fórmula', () => {
  const R = 6371007.181, lon = -52.6, lat = -21.75;
  const [[[[x, y]]]] = Core.projectPolys([[[[lon, lat]]]], Core.MODIS_SINU);
  const rad = Math.PI / 180;
  assert.ok(Math.abs(x - R * lon * rad * Math.cos(lat * rad)) < 0.01);
  assert.ok(Math.abs(y - R * lat * rad) < 0.01);
});

test('MODIS: GeoKeys sinusoidais escritas no .tif são reconhecidas de volta', async () => {
  const buf = Core.buildGeoTIFF({ W: 2, H: 2, X0: -5e6, Y0: -2.4e6, res: 231.656, epsg: Core.MODIS_SINU, dtype: 'int16', nodata: -28672,
    bands: [{ name: 'red', code: 'B01', scale: 0.0001, offset: 0, data: new Int16Array([1, 2, 3, -28672]) }] }, {});
  const im = await (await GeoTIFFLib.fromArrayBuffer(buf)).getImage();
  const gk = im.getGeoKeys();
  assert.equal(gk.ProjCoordTransGeoKey, 24, 'CT_Sinusoidal');
  assert.equal(gk.GeogSemiMajorAxisGeoKey, 6371007.181);
  assert.equal(Core.epsgOf(im, { properties: {} }), Core.MODIS_SINU);
  assert.equal(im.getGDALNoData(), -28672);
  assert.deepEqual(Array.from((await im.readRasters())[0]), [1, 2, 3, -28672]);
});

test('MODIS: composição de 8 dias (sem datetime) e Terra/Aqua em candidatos separados', () => {
  const m = (id, platform, start) => ({ ...item(id, 'modis-09Q1-061', {}, { datetime: null, platform, start_datetime: start + 'T00:00:00Z', end_datetime: Core.addDays(start, 7) + 'T23:59:59Z' }), geometry: tileFp(-60, -45, -30, -10) });
  const its = [m('MOD-h13', 'terra', '2025-07-20'), m('MOD-h12', 'terra', '2025-07-20'), m('MYD-h13', 'aqua', '2025-07-20'), m('MOD-old', 'terra', '2025-07-12')];
  const c = Core.orderCandidates(its, 'modis', '2025-07-24', geo);
  assert.equal(c.length, 3);
  assert.equal(c[0].delta, 0, 'data alvo dentro dos 8 dias');
  const terra = c.find(x => x.satellite === 'Terra' && x.day === '2025-07-20');
  assert.equal(terra.items.length, 2, 'tiles do mesmo dia e plataforma juntos');
  assert.equal(c.at(-1).day, '2025-07-12');
});

test('MODIS: state flags (65535 sem dado; nublado, misto e sombra = nuvem)', () => {
  const c = Core.SENSORS.modis.classify;
  assert.equal(c(65535), 'nodata');
  assert.equal(c(0b00), 'clear');
  assert.equal(c(0b11), 'clear', '"não definido" conta como limpo');
  assert.equal(c(0b01), 'cloud');
  assert.equal(c(0b10), 'cloud');
  assert.equal(c(0b100), 'cloud', 'sombra');
});

test('MODIS: nuvem e recorte em sinusoidal, int16', async () => {
  const res = 231.65635826395834, ext = extentFor(Core.MODIS_SINU, 3000, res);
  raster('mem://modis/state', { crs: Core.MODIS_SINU, res, ext, fn: () => 0 });
  raster('mem://modis/b01', { crs: Core.MODIS_SINU, res, ext, Arr: Int16Array, nodata: -28672, fn: () => 450 });
  raster('mem://modis/b02', { crs: Core.MODIS_SINU, res, ext, Arr: Int16Array, nodata: -28672, fn: () => 3100 });
  const it = item('MOD', 'modis-09Q1-061', { sur_refl_state_250m: 'mem://modis/state', sur_refl_b01: 'mem://modis/b01', sur_refl_b02: 'mem://modis/b02' });
  const chk = await Core.checkCandidate({ item: it }, 'modis', geo);
  assert.deepEqual([chk.cloudPct, chk.nodataPct], [0, 0]);
  const img = await Core.loadImage({ item: it }, 'modis', geo, 500);
  assert.equal(img.epsg, Core.MODIS_SINU);
  assert.equal(Core.crsLabel(img.epsg), 'Sinusoidal (MODIS)');
  assert.ok(allValues(img.bands[1].data, v => v === 3100));
});

// ======================= assinatura (Planetary Computer) =======================
test('signHref: URL fora do Azure não é alterada nem pede token', async () => {
  const f = mockFetch(() => { throw new Error('não deveria buscar token'); });
  try {
    const h = 'https://sentinel-cogs.s3.us-west-2.amazonaws.com/a/B02.tif';
    assert.equal(await Core.signHref(h), h);
    assert.equal(f.calls.length, 0);
  } finally { f.restore(); }
});

test('signHref: um token por conta/container, reaproveitado até perto de expirar', async () => {
  let n = 0;
  const f = mockFetch(url => ({ json: { token: 'sig=' + (++n), 'msft:expiry': new Date(Date.now() + (url.includes('curto') ? 60e3 : 3600e3)).toISOString() } }));
  try {
    const a1 = await Core.signHref('https://contaA.blob.core.windows.net/cont1/x.tif');
    const a2 = await Core.signHref('https://contaA.blob.core.windows.net/cont1/y.tif');
    const b1 = await Core.signHref('https://contaA.blob.core.windows.net/cont2/z.tif');
    assert.equal(a1, 'https://contaA.blob.core.windows.net/cont1/x.tif?sig=1');
    assert.equal(a2, 'https://contaA.blob.core.windows.net/cont1/y.tif?sig=1', 'mesmo token');
    assert.equal(b1, 'https://contaA.blob.core.windows.net/cont2/z.tif?sig=2', 'outro container, outro token');
    assert.deepEqual(f.calls.map(c => c.url.split('/token/')[1]), ['contaA/cont1', 'contaA/cont2']);
    // token que expira em menos de 5 min é renovado
    await Core.signHref('https://curto.blob.core.windows.net/c/a.tif');
    await Core.signHref('https://curto.blob.core.windows.net/c/b.tif');
    assert.equal(f.calls.filter(c => c.url.includes('curto')).length, 2);
  } finally { f.restore(); }
});
