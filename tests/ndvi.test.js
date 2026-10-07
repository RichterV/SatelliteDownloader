// NDVI na prévia e no balão do pixel (visualização; o .tif continua com as bandas originais)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { Core, ROOT } = require('./helpers/core');

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} != ${b}`);
const img = (bands, nodata = 0) => ({ W: bands[0].data.length, H: 1, nodata, bands });

test('ndvi: usa a reflectância (escala e offset de cada banda), não o valor bruto', () => {
  // Landsat: reflectância = DN * 0,0000275 - 0,2. nir 0,40 e red 0,05 => NDVI 0,35/0,45 = 0,7778
  const dn = r => Math.round((r + 0.2) / 0.0000275);
  const ls = img([
    { name: 'red', scale: 0.0000275, offset: -0.2, data: Uint16Array.of(dn(0.05)) },
    { name: 'nir', scale: 0.0000275, offset: -0.2, data: Uint16Array.of(dn(0.40)) },
  ]);
  near(Core.ndviAt(ls, 0), 0.35 / 0.45, 1e-3, 'NDVI Landsat');
  // com o valor bruto daria ~0,32 (bem diferente): garante que a conversão é aplicada
  const raw = (dn(0.40) - dn(0.05)) / (dn(0.40) + dn(0.05));
  assert.ok(Math.abs(Core.ndviAt(ls, 0) - raw) > 0.3);
  // Sentinel-2 (escala 0,0001, sem offset)
  const s2 = img([{ name: 'red', scale: 0.0001, offset: 0, data: Uint16Array.of(500) }, { name: 'nir', scale: 0.0001, offset: 0, data: Uint16Array.of(3500) }]);
  near(Core.ndviAt(s2, 0), 3000 / 4000, 1e-9, 'NDVI S2');
});

test('ndvi: sem dado (nodata, NaN, soma zero) vira NaN; valores limitados a -1..1', () => {
  const m = img([
    { name: 'red', scale: 1, offset: 0, data: Int16Array.of(-9999, 10, 0, 5, -3) },
    { name: 'nir', scale: 1, offset: 0, data: Int16Array.of(100, -9999, 0, 5, 1) },
  ], -9999);
  const v = Core.ndvi(m);
  assert.ok(Number.isNaN(v[0]) && Number.isNaN(v[1]), 'nodata');
  assert.ok(Number.isNaN(v[2]), 'soma zero');
  assert.equal(v[3], 0);
  assert.ok(v[4] >= -1 && v[4] <= 1, 'limitado');
  assert.ok(v instanceof Float32Array && v.length === 5);
});

test('ndviColor: água azul, solo marrom, vegetação densa verde-escuro; sem dado transparente', () => {
  assert.equal(Core.ndviColor(NaN), null);
  const [r1, g1, b1] = Core.ndviColor(-0.6);
  assert.ok(b1 > r1, 'negativo (água) azulado');
  assert.deepEqual(Core.ndviColor(0), [160, 82, 45], 'solo exposto');
  const [r9, g9, b9] = Core.ndviColor(0.9);
  assert.ok(g9 > r9 && g9 > b9 && g9 < 130, 'floresta densa: verde escuro');
  assert.deepEqual(Core.ndviColor(5), Core.ndviColor(1), 'acima de 1 satura');
  // cor varia de forma contínua (sem saltos)
  for (let v = -1; v < 1; v += 0.01) {
    const a = Core.ndviColor(v), b = Core.ndviColor(v + 0.01);
    assert.ok(a.every((c, i) => Math.abs(c - b[i]) <= 12), `salto de cor em ${v.toFixed(2)}`);
  }
});

test('hasNdvi: ópticos com red e nir têm NDVI; radar e DEM não', () => {
  const sensorImg = s => ({ bands: Core.SENSORS[s].bands.map(b => ({ name: b.name })) });
  for (const s of ['sentinel2', 'landsat', 'landsat457', 'hls', 'modis']) assert.ok(Core.hasNdvi(sensorImg(s)), s);
  for (const s of ['sentinel1', 'palsar', 'dem']) assert.ok(!Core.hasNdvi(sensorImg(s)), s);
});

test('interface: opção NDVI na prévia, legenda e linha de NDVI no balão do pixel', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
  const css = fs.readFileSync(path.join(ROOT, 'css', 'style.css'), 'utf8');
  assert.match(app, /if \(Core\.hasNdvi\(img\)\) list\.push\(\{ label: 'NDVI', ndvi: true/, 'opção NDVI só quando há red e nir');
  assert.match(app, /if \(cp\.ndvi\) return renderNdvi\(\)/);
  assert.match(html, /id="viewWrap"[\s\S]*id="ndviLegend"/, 'legenda dentro da prévia');
  assert.match(app, /\$\('ndviLegend'\)\.classList\.toggle\('hidden', !cp\.ndvi\)/, 'legenda só com NDVI');
  assert.match(app, /\$\{rows\}\$\{ndviRow\(img, c, r\)\}/, 'NDVI no balão do pixel');
  // legenda usa as mesmas cores da escala (pontos 0, 0,2, 0,4, 0,6, 0,8 e 1)
  for (const v of [0, 0.2, 0.4, 0.6, 0.8, 1]) assert.ok(css.includes(`rgb(${Core.ndviColor(v).join(', ')})`), `cor ${v} na legenda`);
});
