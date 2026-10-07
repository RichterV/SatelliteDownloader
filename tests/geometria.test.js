// Leitura do GeoJSON, projeções e geometria (rasterização dos talhões, footprint da cena)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { Core, FIX } = require('./helpers/core');

const load = name => JSON.parse(fs.readFileSync(path.join(FIX, name), 'utf8'));
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} != ${b}`);

test('parseGeoJSON: lê Polygon e MultiPolygon e ignora pontos', () => {
  const g = Core.parseGeoJSON(load('talhoes.geojson'));
  assert.equal(g.nFeatures, 3);
  assert.equal(g.nPolygons, 2);
  assert.equal(g.ignored, 1);
  assert.equal(g.srcEpsg, 4326);
  assert.deepEqual(g.bboxLL, [-52.6, -21.75, -52.57, -21.732]);
});

test('parseGeoJSON: reprojeta GeoJSON com crs SIRGAS 2000 / UTM 22S para lon/lat', () => {
  const g = Core.parseGeoJSON(load('talhoes_31982.geojson'));
  assert.equal(g.srcEpsg, 31982);
  const [x0, y0, x1, y1] = g.bboxLL;
  near(x0, -52.6, 1e-6, 'minx'); near(y0, -21.75, 1e-6, 'miny');
  near(x1, -52.59, 1e-6, 'maxx'); near(y1, -21.742, 1e-6, 'maxy');
});

test('parseGeoJSON: aceita Feature e geometria soltas', () => {
  const fc = load('talhoes.geojson');
  assert.equal(Core.parseGeoJSON(fc.features[0]).nPolygons, 1);
  assert.equal(Core.parseGeoJSON(fc.features[1].geometry).nPolygons, 1);
});

test('parseGeoJSON: erro quando não há polígonos', () => {
  assert.throws(() => Core.parseGeoJSON({ type: 'Point', coordinates: [0, 0] }), /Nenhum polígono/);
});

test('parseGeoJSON: erro quando coordenadas projetadas vêm sem crs', () => {
  const fc = load('talhoes_31982.geojson');
  delete fc.crs;
  assert.throws(() => Core.parseGeoJSON(fc), /não parecem ser lon\/lat/);
});

test('ensureProj: suporta UTM WGS84, SIRGAS 2000 UTM e 4674; recusa EPSG desconhecido', () => {
  for (const e of [32722, 32622, 31982, 31976, 4674]) assert.equal(Core.ensureProj(e), 'EPSG:' + e);
  assert.throws(() => Core.ensureProj(2154), /não suportado/);
});

test('projectPolys: lon/lat para UTM 22S e volta', () => {
  const ring = [[-52.6, -21.75], [-52.59, -21.75], [-52.59, -21.742], [-52.6, -21.75]];
  const [[utm]] = Core.projectPolys([[ring]], 32722);
  assert.ok(utm[0][0] > 100000 && utm[0][0] < 900000, 'easting plausível');
  assert.ok(utm[0][1] > 7000000 && utm[0][1] < 10000000, 'northing do hemisfério sul');
  const back = proj4('EPSG:32722', 'EPSG:4326', utm[0]);
  near(back[0], -52.6, 1e-7, 'lon'); near(back[1], -21.75, 1e-7, 'lat');
});

test('pointInRing e footprintContains (com buraco)', () => {
  const outer = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
  const hole = [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]];
  assert.equal(Core.pointInRing(5, 5, outer), true);
  assert.equal(Core.pointInRing(11, 5, outer), false);
  const geom = { type: 'Polygon', coordinates: [outer, hole] };
  assert.equal(Core.footprintContains(geom, [[1, 1], [9, 9]]), true);
  assert.equal(Core.footprintContains(geom, [[1, 1], [5, 5]]), false, 'ponto no buraco');
  assert.equal(Core.footprintContains(geom, [[1, 1], [11, 1]]), false, 'ponto fora');
  assert.equal(Core.footprintContains(null, [[1, 1]]), false);
});

test('rasterize: marca o interior do polígono com dilatação de 1 px', () => {
  const W = 10, H = 10;
  // vértices fracionários: centros de pixel 2,5..5,5 ficam dentro (4x4)
  const m = Core.rasterize([[[[2.2, 2.2], [5.8, 2.2], [5.8, 5.8], [2.2, 5.8], [2.2, 2.2]]]], W, H);
  const on = (c, r) => m[r * W + c] === 1;
  assert.ok(on(4, 4), 'centro');
  assert.ok(on(1, 1) && on(6, 6), 'dilatação');
  assert.ok(!on(0, 0) && !on(8, 8), 'fora');
  // 4x4 pixels internos + 1 px de borda = 6x6
  assert.equal(m.reduce((a, v) => a + v, 0), 36);
});

test('rasterize: talhão menor que 1 pixel ainda marca o pixel onde cai', () => {
  const m = Core.rasterize([[[[3.2, 3.2], [3.4, 3.2], [3.4, 3.4], [3.2, 3.2]]]], 8, 8);
  assert.equal(m[3 * 8 + 3], 1);
});
