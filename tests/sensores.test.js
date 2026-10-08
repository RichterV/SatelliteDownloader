// Consistência da configuração dos sensores (SENSORS em js/core.js).
// Ao adicionar um satélite novo, ele passa automaticamente por estes testes.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Core } = require('./helpers/core');

for (const [key, s] of Object.entries(Core.SENSORS)) {
  test(`${key}: campos obrigatórios`, () => {
    for (const f of ['label', 'short', 'group', 'stac', 'collections', 'res', 'dtype', 'nodata', 'refAsset', 'maskAsset', 'bands', 'classify', 'satellite', 'scaleFor', 'dedupeKey', 'version', 'composites'])
      assert.ok(s[f] !== undefined, `falta ${f}`);
    assert.match(s.stac, /^https:\/\//);
    assert.ok(Array.isArray(s.collections) && s.collections.length > 0);
    assert.ok(['main', 'secondary'].includes(s.group));
    assert.ok(['uint16', 'int16', 'float32'].includes(s.dtype));
    assert.match(s.short, /^[A-Z0-9]+$/, 'short vai no nome do arquivo');
  });

  test(`${key}: resolução, início dos dados e frase de finalidade para a escolha na interface`, () => {
    assert.ok(Number.isFinite(s.res) && s.res > 0);
    assert.ok(s.since === null || (Number.isInteger(s.since) && s.since >= 1972 && s.since <= new Date().getFullYear()), 'since');
    assert.equal(typeof s.about, 'string');
    assert.ok(s.about.length >= 30 && s.about.length <= 140, `about com ${s.about.length} caracteres (frase breve)`);
    assert.ok(!/[<>]/.test(s.about + s.label), 'texto vai no HTML sem escape');
  });

  test(`${key}: nodata cabe no tipo e é classificado como sem dado`, () => {
    const range = { uint16: [0, 65535], int16: [-32768, 32767], float32: [-3.4e38, 3.4e38] }[s.dtype];
    assert.ok(s.nodata >= range[0] && s.nodata <= range[1]);
    assert.equal(s.classify(NaN), 'nodata', 'NaN (fora da cena) precisa ser sem dado');
  });

  test(`${key}: asset de cada banda definido para todas as coleções`, () => {
    for (const col of s.collections) {
      const item = { collection: col };
      for (const b of s.bands) assert.ok(typeof Core.assetOf(b, item) === 'string', `${b.name} em ${col}`);
      assert.ok(typeof Core.assetOf(s.refAsset, item) === 'string');
      assert.ok(typeof Core.assetOf(s.maskAsset, item) === 'string');
    }
  });

  test(`${key}: bandas com nome e código únicos; refAsset é uma banda`, () => {
    const names = s.bands.map(b => b.name), codes = s.bands.map(b => b.code);
    assert.equal(new Set(names).size, names.length, 'nomes repetidos');
    assert.equal(new Set(codes).size, codes.length, 'códigos repetidos');
    for (const col of s.collections) {
      const assets = s.bands.map(b => Core.assetOf(b, { collection: col }));
      assert.equal(new Set(assets).size, assets.length, 'assets repetidos em ' + col);
      assert.ok(assets.includes(Core.assetOf(s.refAsset, { collection: col })), 'refAsset precisa ser uma banda');
    }
  });

  test(`${key}: composições usam bandas existentes e têm 3 canais`, () => {
    const names = new Set(s.bands.map(b => b.name));
    assert.ok(s.composites.length > 0);
    // sensores ópticos com RGB abrem em cor verdadeira
    if (['red', 'green', 'blue'].every(n => names.has(n))) assert.equal(s.composites[0].label, 'Cor verdadeira');
    const labels = s.composites.map(c => c.label);
    assert.equal(new Set(labels).size, labels.length, 'rótulos repetidos');
    for (const c of s.composites) {
      assert.equal(c.b.length, 3, c.label);
      for (const n of c.b) assert.ok(names.has(n), `${c.label}: banda ${n} não existe`);
    }
  });

  if (s.cloudFree) test(`${key}: produto sem nuvem nunca classifica pixel como nuvem`, () => {
    for (const v of [0, 1, 2, 3, 4, 8, 9, 10, 255, 0.5, 21824, 65535, -32768]) assert.notEqual(s.classify(v), 'cloud', 'valor ' + v);
  });

  test(`${key}: produto sem data tem período de aquisição; os demais usam a data da cena`, () => {
    if (s.static) assert.ok(typeof s.period === 'string' && /\d{4}/.test(s.period), 'period com o ano');
    else assert.equal(s.period, undefined);
    const shown = Core.sceneDate(key, { day: '2025-07-23' });
    assert.equal(shown, s.static ? s.period : '23/07/2025');
  });

  test(`${key}: scaleFor devolve escala numérica para todas as bandas`, () => {
    const item = { id: 'x', properties: { 's2:processing_baseline': '05.10', 'earthsearch:boa_offset_applied': true } };
    for (const b of s.bands) {
      const r = s.scaleFor(item, b);
      assert.ok(Number.isFinite(r.scale) && r.scale > 0, b.name);
      assert.ok(Number.isFinite(r.offset), b.name);
    }
  });
}

test('Sentinel-2 e Landsat 8/9 são os principais; os demais são secundários', () => {
  const main = Object.entries(Core.SENSORS).filter(([, s]) => s.group === 'main').map(([k]) => k);
  assert.deepEqual(main, ['sentinel2', 'landsat']);
  assert.ok(Object.keys(Core.SENSORS).length > 2);
});

test('Sentinel-2: classificação SCL', () => {
  const c = Core.SENSORS.sentinel2.classify;
  for (const v of [0, 1]) assert.equal(c(v), 'nodata', 'SCL ' + v);
  for (const v of [3, 8, 9, 10]) assert.equal(c(v), 'cloud', 'SCL ' + v);
  for (const v of [2, 4, 5, 6, 7, 11]) assert.equal(c(v), 'clear', 'SCL ' + v);
});

test('Sentinel-2: offset -0,1 só quando baseline >= 4 e o offset não foi aplicado', () => {
  const sc = (baseline, applied) => Core.SENSORS.sentinel2.scaleFor({ properties: { 's2:processing_baseline': baseline, 'earthsearch:boa_offset_applied': applied } }, {}).offset;
  assert.equal(sc('05.10', false), -0.1);
  assert.equal(sc('05.10', true), 0);
  assert.equal(sc('03.01', false), 0);
});

test('Landsat: classificação QA_PIXEL por bits', () => {
  const c = Core.SENSORS.landsat.classify;
  assert.equal(c(1), 'nodata', 'fill');
  assert.equal(c(1 << 1), 'cloud', 'nuvem dilatada');
  assert.equal(c(1 << 2), 'cloud', 'cirrus');
  assert.equal(c(1 << 3), 'cloud', 'nuvem');
  assert.equal(c(1 << 4), 'cloud', 'sombra');
  assert.equal(c(21824), 'clear', 'valor típico de pixel limpo');
});

test('Landsat: escala de reflectância e de temperatura', () => {
  const s = Core.SENSORS.landsat;
  assert.deepEqual(s.scaleFor({}, { name: 'red' }), { scale: 0.0000275, offset: -0.2 });
  assert.equal(s.scaleFor({}, { name: 'thermal' }).unit, 'K');
});
