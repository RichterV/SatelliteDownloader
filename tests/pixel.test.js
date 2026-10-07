// Inspeção de pixel na prévia: clique => pixel, valores por banda e coordenada
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { Core, ROOT } = require('./helpers/core');

const W = 4, H = 3;
const img = {
  W, H, X0: 500000, Y0: 7600000, res: 10, epsg: 32722, nodata: 0,
  bands: [
    { name: 'red', code: 'B04', scale: 0.0001, offset: -0.1, data: Uint16Array.from({ length: W * H }, (_, i) => 1000 + i) },
    { name: 'thermal', code: 'ST_B10', scale: 0.00341802, offset: 149, unit: 'K', data: new Uint16Array(W * H).fill(44000) },
    { name: 'vv', code: 'VV', scale: 1, offset: 0, data: new Float32Array(W * H).fill(0.25) },
  ],
};

test('canvasToPixel: posição no canvas ampliado vira linha/coluna da imagem', () => {
  // imagem 4x3 desenhada com 50 px por pixel
  assert.deepEqual(Core.canvasToPixel(0, 0, 50, 50, W, H), { c: 0, r: 0 });
  assert.deepEqual(Core.canvasToPixel(49.9, 99.9, 50, 50, W, H), { c: 0, r: 1 });
  assert.deepEqual(Core.canvasToPixel(199, 149, 50, 50, W, H), { c: 3, r: 2 });
  assert.equal(Core.canvasToPixel(200, 10, 50, 50, W, H), null, 'à direita da imagem');
  assert.equal(Core.canvasToPixel(-1, 10, 50, 50, W, H), null);
  // imagem reduzida (0,5 px de canvas por pixel)
  assert.deepEqual(Core.canvasToPixel(1.2, 0.6, 0.5, 0.5, W, H), { c: 2, r: 1 });
});

test('pixelValues: valor bruto de cada banda, na ordem do arquivo, sem conversão', () => {
  const v = Core.pixelValues(img, 2, 1); // índice 1*4+2 = 6
  assert.deepEqual(v.map(b => b.name), ['red', 'thermal', 'vv']);
  assert.deepEqual(v.map(b => b.raw), [1006, 44000, 0.25], 'valores como estão no .tif, sem escala/offset');
  assert.ok(v.every(b => !b.nodata));
  assert.ok(v.every(b => !('value' in b)));
});

test('pixelValues: pixel sem dado (nodata ou NaN) é sinalizado', () => {
  const m = { ...img, bands: img.bands.map(b => ({ ...b, data: b.data.slice() })) };
  m.bands[0].data[0] = 0;
  m.bands[2].data[0] = NaN;
  const v = Core.pixelValues(m, 0, 0);
  assert.equal(v[0].nodata, true);
  assert.equal(v[2].nodata, true);
  assert.equal(v[1].nodata, false);
});

test('pixelLonLat: centro do pixel em lon/lat (UTM e graus)', () => {
  const [lon, lat] = Core.pixelLonLat(img, 0, 0);
  const back = proj4('EPSG:4326', 'EPSG:32722', [lon, lat]);
  assert.ok(Math.abs(back[0] - 500005) < 1e-3 && Math.abs(back[1] - 7599995) < 1e-3, 'centro do pixel (meio pixel do canto)');
  const geo = { ...img, epsg: 4326, X0: -52.6, Y0: -21.7, res: 0.001 };
  const [lon2, lat2] = Core.pixelLonLat(geo, 1, 2);
  assert.ok(Math.abs(lon2 - -52.5985) < 1e-9 && Math.abs(lat2 - -21.7025) < 1e-9);
});

test('interface: balão do pixel existe dentro da prévia e o clique está ligado', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
  assert.match(html, /id="viewWrap"[\s\S]*id="view"[\s\S]*id="pixelPop"/);
  assert.match(app, /\$\('view'\)\.addEventListener\('pointerup'/, 'clique sem arrastar seleciona o pixel');
  assert.match(app, /strokeStyle = '#ff2d2d'/, 'borda vermelha na seleção');
  assert.match(app, /e\.key === 'Escape'/, 'Esc fecha o balão');
  assert.doesNotMatch(app, /Convertido/, 'balão mostra só valores brutos');
});
