// Entrada de arquivos: GeoJSON, shapefile em .zip e shapefile em arquivos soltos
const test = require('node:test');
const assert = require('node:assert/strict');
const { Core, fixtureFile } = require('./helpers/core');

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} != ${b}`);
const BBOX = [-52.6, -21.75, -52.57, -21.732];
function assertBBox(g) {
  g.bboxLL.forEach((v, i) => near(v, BBOX[i], 1e-6, 'bbox[' + i + ']'));
}

test('GeoJSON: nome base sem extensão', async () => {
  const r = await Core.readVectorFiles([fixtureFile('talhoes.geojson')]);
  assert.equal(r.base, 'talhoes');
  assert.equal(Core.parseGeoJSON(r.obj).nPolygons, 2);
});

test('Shapefile .zip (UTM com .prj): reprojeta e mantém atributos', async () => {
  const r = await Core.readVectorFiles([fixtureFile('talhoes_utm.zip')]);
  assert.equal(r.base, 'talhoes_utm');
  const g = Core.parseGeoJSON(r.obj);
  assert.equal(g.nFeatures, 2);
  assertBBox(g);
  assert.deepEqual(r.obj.features.map(f => f.properties.cod), ['A', 'B']);
});

test('Shapefile solto .shp + .dbf + .prj: igual ao .zip', async () => {
  const r = await Core.readVectorFiles(['talhoes_utm.shp', 'talhoes_utm.dbf', 'talhoes_utm.prj', 'talhoes_utm.shx'].map(fixtureFile));
  assert.equal(r.noPrj, false);
  const g = Core.parseGeoJSON(r.obj);
  assert.equal(g.nFeatures, 2);
  assertBBox(g);
  assert.equal(r.obj.features[1].properties.cod, 'B');
});

test('Shapefile solto sem .dbf: funciona sem atributos', async () => {
  const r = await Core.readVectorFiles(['talhoes_utm.shp', 'talhoes_utm.prj'].map(fixtureFile));
  assertBBox(Core.parseGeoJSON(r.obj));
  assert.deepEqual(r.obj.features[0].properties, {});
});

test('Shapefile projetado sem .prj: sinaliza noPrj e o parse recusa as coordenadas', async () => {
  const r = await Core.readVectorFiles([fixtureFile('talhoes_utm.shp')]);
  assert.equal(r.noPrj, true);
  assert.throws(() => Core.parseGeoJSON(r.obj), /\.prj/);
});

test('Arquivo sem .geojson/.zip/.shp: erro explicativo', async () => {
  await assert.rejects(Core.readVectorFiles([fixtureFile('talhoes_utm.dbf')]), /Selecione/);
});
