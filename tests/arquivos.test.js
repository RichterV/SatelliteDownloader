// Entrada de arquivos: GeoJSON, shapefile em .zip e shapefile em arquivos soltos
const test = require('node:test');
const assert = require('node:assert/strict');
const { Core, fixtureFile } = require('./helpers/core');
const fflate = require('fflate');

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

// .dbf mínimo (dBase III) com um campo texto "nome" de 10 caracteres, em Latin-1
function dbfLatin1(values) {
  const recLen = 1 + 10, hdrLen = 32 + 32 + 1, buf = Buffer.alloc(hdrLen + values.length * recLen + 1, 0x20);
  buf.fill(0, 0, hdrLen);
  buf[0] = 0x03; buf.writeUInt32LE(values.length, 4); buf.writeUInt16LE(hdrLen, 8); buf.writeUInt16LE(recLen, 10);
  buf.write('nome', 32, 'latin1'); buf[43] = 'C'.charCodeAt(0); buf[48] = 10;
  buf[64] = 0x0d;
  values.forEach((v, i) => buf.write(v.padEnd(10), hdrLen + i * recLen + 1, 'latin1'));
  buf[buf.length - 1] = 0x1a;
  return new File([buf], 'talhoes_utm.dbf');
}

test('Shapefile solto com .cpg: atributos decodificados na codificação indicada', async () => {
  const files = [fixtureFile('talhoes_utm.shp'), fixtureFile('talhoes_utm.prj'), dbfLatin1(['Pinhão', 'Açaí'])];
  const r = await Core.readVectorFiles([...files, new File(['1252\r\n'], 'talhoes_utm.cpg')]);
  assert.deepEqual(r.obj.features.map(f => f.properties.nome), ['Pinhão', 'Açaí']);
  // sem o .cpg o padrão é UTF-8 e os acentos se perdem (mostra que o .cpg foi usado)
  const semCpg = await Core.readVectorFiles(files);
  assert.notEqual(semCpg.obj.features[0].properties.nome, 'Pinhão');
});

// ======================= KML / KMZ =======================
test('KML (exportação do Google Earth): polígonos, MultiGeometry, anel aberto e ponto ignorado', async () => {
  const r = await Core.readVectorFiles([fixtureFile('talhoes.kml')]);
  assert.equal(r.base, 'talhoes');
  assert.deepEqual(r.obj.features.map(f => f.properties.name), ['Talhão A', 'Talhão B', 'Sede'], 'nome com e sem CDATA');
  const g = Core.parseGeoJSON(r.obj);
  assert.equal(g.nFeatures, 3);
  assert.equal(g.nPolygons, 2);
  assert.equal(g.ignored, 1, 'o ponto da sede não é polígono');
  assertBBox(g);
  // altitude descartada; anel do talhão B (aberto no arquivo) fechado
  const b = g.polygons[1][0];
  assert.ok(b.every(p => p.length === 2));
  assert.deepEqual(b[0], b.at(-1));
});

test('KMZ: lê o doc.kml de dentro do zip; mesmo resultado do KML', async () => {
  const r = await Core.readVectorFiles([fixtureFile('talhoes.kmz')]);
  assert.equal(r.base, 'talhoes');
  const g = Core.parseGeoJSON(r.obj);
  assert.equal(g.nPolygons, 2);
  assertBBox(g);
});

test('KMZ sem .kml dentro: erro explicativo', async () => {
  const zip = fflate.zipSync({ 'leia.txt': fflate.strToU8('nada') });
  await assert.rejects(Core.readVectorFiles([new File([zip], 'vazio.kmz')]), /não contém um arquivo \.kml/);
});

test('KML: prefixo de namespace, buracos (innerBoundaryIs) e vários polígonos no mesmo Placemark', () => {
  const ring = pts => `<kml:LinearRing><kml:coordinates>${pts.map(p => p.join(',')).join(' ')}</kml:coordinates></kml:LinearRing>`;
  const outer = [[-52.6, -21.75], [-52.58, -21.75], [-52.58, -21.73], [-52.6, -21.73], [-52.6, -21.75]];
  const hole = [[-52.595, -21.745], [-52.585, -21.745], [-52.585, -21.735], [-52.595, -21.735], [-52.595, -21.745]];
  const kml = `<kml:kml><kml:Placemark><kml:MultiGeometry>
    <kml:Polygon><kml:outerBoundaryIs>${ring(outer)}</kml:outerBoundaryIs><kml:innerBoundaryIs>${ring(hole)}</kml:innerBoundaryIs></kml:Polygon>
    <kml:Polygon><kml:outerBoundaryIs>${ring(outer.map(([x, y]) => [x + 0.05, y]))}</kml:outerBoundaryIs></kml:Polygon>
  </kml:MultiGeometry></kml:Placemark></kml:kml>`;
  const fc = Core.parseKML(kml);
  assert.equal(fc.features.length, 1);
  assert.equal(fc.features[0].geometry.type, 'MultiPolygon');
  const g = Core.parseGeoJSON(fc);
  assert.equal(g.nPolygons, 2);
  assert.equal(g.polygons[0].length, 2, 'anel externo + buraco');
});

test('KML só com pontos e linhas: nenhum polígono', () => {
  const fc = Core.parseKML('<kml><Placemark><Point><coordinates>-52,-21</coordinates></Point></Placemark>' +
    '<Placemark><LineString><coordinates>-52,-21 -52.1,-21.1</coordinates></LineString></Placemark></kml>');
  assert.throws(() => Core.parseGeoJSON(fc), /Nenhum polígono/);
});
