// Arquivos gerados: GeoTIFF multibanda (lido de volta com a lib geotiff) e .zip
const test = require('node:test');
const assert = require('node:assert/strict');
const { Core, GeoTIFFLib } = require('./helpers/core');

function sampleImage(epsg = 32722) {
  const W = 5, H = 3;
  const band = (k, name, code) => ({ name, code, scale: 0.0001, offset: -0.1, data: Uint16Array.from({ length: W * H }, (_, i) => k * 100 + i) });
  return { W, H, X0: 500000, Y0: 7600000, res: 10, epsg, bands: [band(1, 'blue', 'B02'), band(2, 'red', 'B04'), band(3, 'nir', 'B08')] };
}

test('buildGeoTIFF: dimensões, georreferência e valores', async () => {
  const img = sampleImage();
  const tif = await GeoTIFFLib.fromArrayBuffer(Core.buildGeoTIFF(img, {}));
  const im = await tif.getImage();
  assert.equal(im.getWidth(), 5);
  assert.equal(im.getHeight(), 3);
  assert.equal(im.getSamplesPerPixel(), 3);
  assert.deepEqual(im.getOrigin(), [500000, 7600000, 0]);
  assert.deepEqual(im.getResolution(), [10, -10, 0]);
  assert.equal(im.getGeoKeys().ProjectedCSTypeGeoKey, 32722);
  assert.equal(im.getGDALNoData(), 0);
  const ras = await im.readRasters();
  img.bands.forEach((b, i) => assert.deepEqual(Array.from(ras[i]), Array.from(b.data), b.name));
});

test('buildGeoTIFF: nome de cada banda (DESCRIPTION), código, escala e metadados da cena', async () => {
  const tif = await GeoTIFFLib.fromArrayBuffer(Core.buildGeoTIFF(sampleImage(), { ITEM_ID: 'S2B_teste', TARGET_DATE: '2025-08-01', NOTA: 'a<b & "c"' }));
  const im = await tif.getImage();
  const names = [0, 1, 2].map(i => im.getGDALMetadata(i).DESCRIPTION);
  assert.deepEqual(names, ['blue', 'red', 'nir']);
  assert.equal(im.getGDALMetadata(2).BAND_CODE, 'B08');
  assert.equal(Number(im.getGDALMetadata(0).PHYSICAL_SCALE), 0.0001);
  const meta = im.getGDALMetadata();
  assert.equal(meta.ITEM_ID, 'S2B_teste');
  // a lib geotiff não decodifica entidades XML (o GDAL decodifica); confere o escape correto
  const unescape = t => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  assert.equal(unescape(meta.NOTA), 'a<b & "c"');
});

test('buildGeoTIFF: CRS geográfico (EPSG:4674) usa GeographicTypeGeoKey', async () => {
  const im = await (await GeoTIFFLib.fromArrayBuffer(Core.buildGeoTIFF({ ...sampleImage(4674), X0: -52.6, Y0: -21.7, res: 0.0001 }, {}))).getImage();
  const gk = im.getGeoKeys();
  assert.equal(gk.GeographicTypeGeoKey, 4674);
  assert.equal(gk.GTModelTypeGeoKey, 2);
  assert.equal(gk.ProjectedCSTypeGeoKey, undefined);
});

test('zipFile: .zip contém o .tif com o mesmo nome e conteúdo', async () => {
  const buf = Core.buildGeoTIFF(sampleImage(), {});
  const zip = await Core.zipFile('area_S2_2025-07-23.tif', buf);
  assert.equal(String.fromCharCode(zip[0], zip[1]), 'PK');
  const files = fflate.unzipSync(zip);
  assert.deepEqual(Object.keys(files), ['area_S2_2025-07-23.tif']);
  assert.deepEqual(Buffer.from(files['area_S2_2025-07-23.tif']), Buffer.from(buf));
});

test('percentiles: ignora zeros (sem dado) e evita intervalo vazio', () => {
  const d = Uint16Array.from({ length: 1000 }, (_, i) => (i % 10 === 0 ? 0 : i));
  const [lo, hi] = Core.percentiles(d, 0.02, 0.98);
  assert.ok(lo > 0 && lo < 50 && hi > 950 && hi < 1000);
  assert.deepEqual(Core.percentiles(new Uint16Array(10).fill(7), 0.02, 0.98), [7, 8]);
  assert.deepEqual(Core.percentiles(new Uint16Array(10), 0.02, 0.98), [0, 1]);
});
