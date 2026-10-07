// Busca STAC (com fetch simulado) e ordenação das cenas candidatas
const test = require('node:test');
const assert = require('node:assert/strict');
const { Core, mockFetch } = require('./helpers/core');

test('addDays / isoDay', () => {
  assert.equal(Core.addDays('2025-03-01', -1), '2025-02-28');
  assert.equal(Core.addDays('2024-12-31', 1), '2025-01-01');
  assert.equal(Core.addDays('2024-03-01', -1), '2024-02-29', 'ano bissexto');
  assert.equal(Core.isoDay(new Date('2025-07-23T13:45:00Z')), '2025-07-23');
});

const geo = { bboxLL: [-52.6, -21.75, -52.57, -21.732] };
const fp = { type: 'Polygon', coordinates: [[[-53, -22], [-52, -22], [-52, -21], [-53, -21], [-53, -22]]] };
const fpParcial = { type: 'Polygon', coordinates: [[[-53, -22], [-52.58, -22], [-52.58, -21], [-53, -21], [-53, -22]]] };
const s2 = (id, day, cloud, geometry = fp) => ({ id, geometry, properties: { datetime: day + 'T13:30:00Z', 'eo:cloud_cover': cloud, platform: 'sentinel-2b' } });

test('orderCandidates: anteriores primeiro (mais próximas), depois posteriores', () => {
  const items = [
    s2('S2B_22KDV_20250805_0_L2A', '2025-08-05', 0),
    s2('S2B_22KDV_20250720_0_L2A', '2025-07-20', 0),
    s2('S2B_22KDV_20250801_0_L2A', '2025-08-01', 0),
    s2('S2B_22KDV_20250728_0_L2A', '2025-07-28', 0),
    s2('S2B_22KDV_20250802_0_L2A', '2025-08-02', 0),
  ];
  const c = Core.orderCandidates(items, 'sentinel2', '2025-08-01', geo);
  assert.deepEqual(c.map(x => x.day), ['2025-08-01', '2025-07-28', '2025-07-20', '2025-08-02', '2025-08-05']);
  assert.deepEqual(c.map(x => x.delta), [0, -4, -12, 1, 4]);
});

test('orderCandidates: mesma data prioriza cena que cobre a área e depois menos nuvem', () => {
  const items = [
    s2('S2B_22KDA_20250728_0_L2A', '2025-07-28', 1, fpParcial),
    s2('S2B_22KDB_20250728_0_L2A', '2025-07-28', 50),
    s2('S2B_22KDC_20250728_0_L2A', '2025-07-28', 10),
  ];
  const c = Core.orderCandidates(items, 'sentinel2', '2025-08-01', geo);
  assert.deepEqual(c.map(x => x.item.id), ['S2B_22KDC_20250728_0_L2A', 'S2B_22KDB_20250728_0_L2A', 'S2B_22KDA_20250728_0_L2A']);
  assert.equal(c[2].covers, false);
});

test('orderCandidates: Sentinel-2 mantém só o reprocessamento mais novo da mesma cena', () => {
  const items = [s2('S2B_22KDV_20250728_0_L2A', '2025-07-28', 5), s2('S2B_22KDV_20250728_1_L2A', '2025-07-28', 5)];
  const c = Core.orderCandidates(items, 'sentinel2', '2025-08-01', geo);
  assert.equal(c.length, 1);
  assert.equal(c[0].item.id, 'S2B_22KDV_20250728_1_L2A');
  assert.equal(c[0].satellite, 'Sentinel-2B');
});

test('stacSearch Sentinel-2: corpo da busca e paginação via link next', async () => {
  const f = mockFetch((url, opt, i) => i === 0
    ? { json: { features: [s2('a', '2025-07-01', 0)], links: [{ rel: 'next', href: 'https://next', method: 'POST', body: { next: 'tok' }, merge: true }] } }
    : { json: { features: [s2('b', '2025-07-02', 0)], links: [] } });
  try {
    const items = await Core.stacSearch('sentinel2', geo.bboxLL, '2025-06-01', '2025-08-01');
    assert.deepEqual(items.map(i => i.id), ['a', 'b']);
    assert.equal(f.calls[0].url, Core.SENSORS.sentinel2.stac);
    assert.deepEqual(f.calls[0].body.collections, ['sentinel-2-l2a']);
    assert.deepEqual(f.calls[0].body.bbox, geo.bboxLL);
    assert.equal(f.calls[0].body.datetime, '2025-06-01T00:00:00Z/2025-08-01T23:59:59Z');
    assert.equal(f.calls[1].url, 'https://next');
    assert.equal(f.calls[1].body.next, 'tok');
    assert.deepEqual(f.calls[1].body.collections, ['sentinel-2-l2a'], 'merge mantém o corpo original');
  } finally { f.restore(); }
});

test('stacSearch Landsat: filtra plataformas landsat-8/9', async () => {
  const f = mockFetch(() => ({ json: { features: [], links: [] } }));
  try {
    await Core.stacSearch('landsat', geo.bboxLL, '2025-06-01', '2025-08-01');
    assert.deepEqual(f.calls[0].body.collections, ['landsat-c2-l2']);
    assert.deepEqual(f.calls[0].body.query, { platform: { in: ['landsat-8', 'landsat-9'] } });
  } finally { f.restore(); }
});

test('stacSearch: erro HTTP vira mensagem legível', async () => {
  const f = mockFetch(() => ({ status: 502, json: { error: 'bad gateway' } }));
  try {
    await assert.rejects(Core.stacSearch('sentinel2', geo.bboxLL, '2025-06-01', '2025-08-01'), /HTTP 502/);
  } finally { f.restore(); }
});
