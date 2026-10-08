// Entrada em KML/KMZ (Core.parseKML e Core.readVectorFiles): casos de borda além do básico de arquivos.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const fflate = require('fflate');
const { Core, FIX, fixtureFile } = require('./helpers/core');

const kmlText = fs.readFileSync(path.join(FIX, 'talhoes.kml'), 'utf8');
const kmzOf = entries => fflate.zipSync(Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, fflate.strToU8(v)])));
const fileOf = (content, name) => new File([content], name);
// Placemark com um polígono de anel externo `pts` (lista de [lon, lat])
const placemark = (pts, { name, attrs = '', inner = [] } = {}) =>
  `<Placemark${attrs}>${name ? `<name>${name}</name>` : ''}<Polygon><outerBoundaryIs><LinearRing><coordinates>${pts.map(p => p.join(',')).join(' ')}</coordinates></LinearRing></outerBoundaryIs>` +
  inner.map(h => `<innerBoundaryIs><LinearRing><coordinates>${h.map(p => p.join(',')).join(' ')}</coordinates></LinearRing></innerBoundaryIs>`).join('') +
  '</Polygon></Placemark>';
const kml = body => `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>${body}</Document></kml>`;
const SQ = [[-52.6, -21.75], [-52.59, -21.75], [-52.59, -21.74], [-52.6, -21.74], [-52.6, -21.75]];

test('KML e GeoJSON dos mesmos talhões dão exatamente a mesma geometria', async () => {
  const k = Core.parseGeoJSON((await Core.readVectorFiles([fixtureFile('talhoes.kml')])).obj);
  const g = Core.parseGeoJSON((await Core.readVectorFiles([fixtureFile('talhoes.geojson')])).obj);
  assert.deepEqual(k.polygons, g.polygons);
  assert.deepEqual(k.bboxLL, g.bboxLL);
  assert.deepEqual([k.nFeatures, k.nPolygons, k.ignored, k.srcEpsg], [g.nFeatures, g.nPolygons, g.ignored, g.srcEpsg]);
});

test('KML: talhões rasterizados iguais aos do GeoJSON (mesma máscara na grade UTM)', async () => {
  const mask = async name => {
    const g = Core.parseGeoJSON((await Core.readVectorFiles([fixtureFile(name)])).obj);
    const polys = Core.projectPolys(g.polygons, 32722), pts = polys.flat(2);
    const x0 = Math.min(...pts.map(p => p[0])), y1 = Math.max(...pts.map(p => p[1]));
    return Core.rasterize(polys.map(p => p.map(r => r.map(([x, y]) => [(x - x0) / 10 + 2, (y1 - y) / 10 + 2]))), 120, 120);
  };
  const a = await mask('talhoes.kml'), b = await mask('talhoes.geojson');
  assert.ok(a.some(v => v));
  assert.deepEqual(a, b);
});

test('KML/KMZ com extensão em maiúsculas', async () => {
  const r1 = await Core.readVectorFiles([fileOf(kmlText, 'FAZENDA.KML')]);
  assert.equal(r1.base, 'FAZENDA');
  assert.equal(Core.parseGeoJSON(r1.obj).nPolygons, 2);
  const r2 = await Core.readVectorFiles([fileOf(fs.readFileSync(path.join(FIX, 'talhoes.kmz')), 'FAZENDA.KMZ')]);
  assert.equal(Core.parseGeoJSON(r2.obj).nPolygons, 2);
});

test('vários arquivos selecionados: GeoJSON tem prioridade sobre KML, e KML sobre shapefile', async () => {
  const r1 = await Core.readVectorFiles([fixtureFile('talhoes.kml'), fixtureFile('talhoes.geojson')]);
  assert.equal(r1.obj.features[0].properties.cod, 'A', 'veio do GeoJSON');
  const r2 = await Core.readVectorFiles([fixtureFile('talhoes_utm.shp'), fixtureFile('talhoes_utm.prj'), fixtureFile('talhoes.kml')]);
  assert.equal(r2.base, 'talhoes');
  assert.equal(r2.obj.features[0].properties.name, 'Talhão A', 'veio do KML');
});

test('KMZ: prefere o doc.kml quando há outros .kml no zip', async () => {
  const outro = kml(placemark(SQ.map(([x, y]) => [x + 10, y]), { name: 'Errado' }));
  const zip = kmzOf({ 'a_primeiro.kml': outro, 'doc.kml': kml(placemark(SQ, { name: 'Certo' })) });
  const r = await Core.readVectorFiles([fileOf(zip, 'area.kmz')]);
  assert.deepEqual(r.obj.features.map(f => f.properties.name), ['Certo']);
});

test('KMZ sem doc.kml: usa o .kml que estiver dentro, mesmo em subpasta', async () => {
  const zip = kmzOf({ 'imagens/logo.png': 'x', 'dados/talhoes.kml': kml(placemark(SQ, { name: 'Sub' })) });
  const r = await Core.readVectorFiles([fileOf(zip, 'area.kmz')]);
  assert.deepEqual(r.obj.features.map(f => f.properties.name), ['Sub']);
});

test('KMZ: nomes com acento (UTF-8) preservados', async () => {
  const zip = kmzOf({ 'doc.kml': kml(placemark(SQ, { name: 'Talhão Açaí nº 3' })) });
  const r = await Core.readVectorFiles([fileOf(zip, 'area.kmz')]);
  assert.equal(r.obj.features[0].properties.name, 'Talhão Açaí nº 3');
});

test('KMZ corrompido: mensagem em português', async () => {
  await assert.rejects(Core.readVectorFiles([fileOf('isto não é um zip', 'quebrado.kmz')]), /Não foi possível abrir o \.kmz/);
});

test('KML: polígono dentro de comentário XML é ignorado', () => {
  const fc = Core.parseKML(kml(`<!-- ${placemark(SQ.map(([x, y]) => [x + 1, y]), { name: 'Velho' })} -->${placemark(SQ, { name: 'Atual' })}`));
  assert.deepEqual(fc.features.map(f => f.properties.name), ['Atual']);
});

test('KML: atributos nas tags, quebras de linha e tabulações entre as coordenadas', () => {
  const coords = SQ.map(p => p.join(',') + ',0').join('\n\t\t  ');
  const fc = Core.parseKML(kml(`<Placemark id="t1"><Polygon id="p1"><outerBoundaryIs><LinearRing id="r1"><coordinates>\n\t\t  ${coords}\n\t\t</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>`));
  assert.deepEqual(fc.features[0].geometry, { type: 'Polygon', coordinates: [SQ] });
});

test('KML: Placemark sem nome fica com properties vazias', () => {
  assert.deepEqual(Core.parseKML(kml(placemark(SQ))).features[0].properties, {});
});

test('KML: anel com menos de 3 pontos ou coordenadas inválidas é descartado', () => {
  const fc = Core.parseKML(kml(
    placemark([[-52.6, -21.75], [-52.59, -21.75]], { name: 'Dois pontos' }) +
    placemark([['abc', -21.75], [-52.59, 'x'], [-52.59, -21.74]], { name: 'Lixo' }) +
    `<Placemark><name>Sem anel externo</name><Polygon><innerBoundaryIs><LinearRing><coordinates>${SQ.join(' ')}</coordinates></LinearRing></innerBoundaryIs></Polygon></Placemark>` +
    placemark(SQ, { name: 'Bom' })));
  assert.deepEqual(fc.features.map(f => [f.properties.name, f.geometry.type]),
    [['Dois pontos', 'LineString'], ['Lixo', 'LineString'], ['Sem anel externo', 'LineString'], ['Bom', 'Polygon']]);
  const g = Core.parseGeoJSON(fc);
  assert.equal(g.nPolygons, 1);
  assert.equal(g.ignored, 3);
});

test('KML: buraco inválido é descartado, mas o anel externo fica', () => {
  const fc = Core.parseKML(kml(placemark(SQ, { inner: [[[-52.595, -21.745], [-52.594, -21.745]]] })));
  assert.deepEqual(fc.features[0].geometry.coordinates, [SQ]);
});

test('KML: Placemark com um polígono válido e outro inválido vira Polygon simples', () => {
  const pm = `<Placemark><MultiGeometry><Polygon><outerBoundaryIs><LinearRing><coordinates>${SQ.map(p => p.join(',')).join(' ')}</coordinates></LinearRing></outerBoundaryIs></Polygon>` +
    '<Polygon><outerBoundaryIs><LinearRing><coordinates>-52,-21</coordinates></LinearRing></outerBoundaryIs></Polygon></MultiGeometry></Placemark>';
  assert.equal(Core.parseKML(kml(pm)).features[0].geometry.type, 'Polygon');
});

test('KML: Placemarks em pastas aninhadas são todos lidos', () => {
  const fc = Core.parseKML(kml(`<Folder><Folder>${placemark(SQ, { name: 'a' })}</Folder>${placemark(SQ, { name: 'b' })}</Folder>${placemark(SQ, { name: 'c' })}`));
  assert.deepEqual(fc.features.map(f => f.properties.name), ['a', 'b', 'c']);
});

test('KML sem nenhum Placemark: coleção vazia e erro "nenhum polígono" no parse', () => {
  const fc = Core.parseKML(kml('<name>vazio</name>'));
  assert.deepEqual(fc.features, []);
  assert.throws(() => Core.parseGeoJSON(fc), /Nenhum polígono/);
});

test('arquivo não suportado: a mensagem cita KML/KMZ', async () => {
  await assert.rejects(Core.readVectorFiles([fileOf('x', 'talhoes.gpx')]), /\.kml\/\.kmz/);
});
