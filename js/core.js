// ======================= Núcleo (sem DOM) =======================
// Cada sensor descreve onde buscar (STAC), quais bandas baixar e como achar nuvem/sem dado.
//   group       'main' (sempre visível) ou 'secondary' (em "Outros")
//   res/since/about  resolução (m), início dos dados e para que o satélite foi criado (mostrados na escolha)
//   collections coleções STAC; o asset de uma banda pode variar por coleção ({ coleção: asset })
//   dtype       tipo do .tif gerado ('uint16' | 'int16' | 'float32'); nodata = valor sem dado
//   maskAsset   raster usado para nuvem/sem dado; classify(v) => 'clear' | 'cloud' | 'nodata' (v NaN = fora da cena)
//   mosaic      junta os tiles da mesma data (groupKey) num único recorte
//   static      produto sem data (DEM): busca sem filtro de data
//   period      período real de aquisição dos produtos static (a data do STAC é só nominal); mostrado como "Data"
//   cloudFree   sem nuvem no produto (radar, DEM): a máscara só indica sem dado
//   minWindowDays janela mínima de busca (produtos anuais)
const PC_STAC = 'https://planetarycomputer.microsoft.com/api/stac/v1/search';
const ES_STAC = 'https://earth-search.aws.element84.com/v1/search';
const MODIS_SINU = 'MODIS-SINUSOIDAL';

const isNum = v => typeof v === 'number' && !Number.isNaN(v);
const landsatQA = v => !isNum(v) || (v & 1) ? 'nodata' : (v & 0b11110) ? 'cloud' : 'clear';
const landsatScale = (it, b) => b.name === 'thermal' ? { scale: 0.00341802, offset: 149.0, unit: 'K' } : { scale: 0.0000275, offset: -0.2 };
// 'sentinel-2c' => 'Sentinel-2C', 'landsat-8' => 'Landsat-8'
const platformLabel = it => (it.properties.platform || '').replace(/^(\w)/, c => c.toUpperCase()).replace(/-(\d)([a-z])$/, (m, d, l) => '-' + d + l.toUpperCase());

const SENSORS = {
  sentinel2: {
    label: 'Sentinel-2 L2A', short: 'S2', group: 'main', res: 10, since: 2015,
    about: 'Missão europeia (Copernicus) criada para monitorar vegetação, agricultura e uso do solo. Imagem a cada ~5 dias.',
    stac: ES_STAC, collections: ['sentinel-2-l2a'],
    dtype: 'uint16', nodata: 0, refAsset: 'blue', maskAsset: 'scl',
    bands: [
      { asset: 'coastal',  name: 'coastal',      code: 'B01' },
      { asset: 'blue',     name: 'blue',         code: 'B02' },
      { asset: 'green',    name: 'green',        code: 'B03' },
      { asset: 'red',      name: 'red',          code: 'B04' },
      { asset: 'rededge1', name: 'red_edge_1',   code: 'B05' },
      { asset: 'rededge2', name: 'red_edge_2',   code: 'B06' },
      { asset: 'rededge3', name: 'red_edge_3',   code: 'B07' },
      { asset: 'nir',      name: 'nir',          code: 'B08' },
      { asset: 'nir08',    name: 'nir_narrow',   code: 'B8A' },
      { asset: 'nir09',    name: 'water_vapour', code: 'B09' },
      { asset: 'swir16',   name: 'swir_1',       code: 'B11' },
      { asset: 'swir22',   name: 'swir_2',       code: 'B12' },
    ],
    // SCL: 0 sem dado, 1 saturado/defeituoso, 3 sombra de nuvem, 8/9 nuvem, 10 cirrus
    classify: v => (!isNum(v) || v === 0 || v === 1) ? 'nodata' : (v === 3 || v === 8 || v === 9 || v === 10) ? 'cloud' : 'clear',
    satellite: it => (it.properties.platform || '').replace('sentinel-', 'Sentinel-').toUpperCase().replace('SENTINEL', 'Sentinel'),
    scaleFor: (it, b) => {
      const applied = it.properties['earthsearch:boa_offset_applied'];
      const baseline = parseFloat(it.properties['s2:processing_baseline'] || '0');
      return { scale: 0.0001, offset: (applied === false && baseline >= 4) ? -0.1 : 0 };
    },
    dedupeKey: it => it.id.replace(/_\d+_L2A$/, ''),
    version: it => parseInt((it.id.match(/_(\d+)_L2A$/) || [0, 0])[1], 10),
    composites: [
      { label: 'Cor verdadeira', b: ['red', 'green', 'blue'] },
      { label: 'Falsa cor', b: ['nir', 'red', 'green'] },
      { label: 'Agricultura', b: ['swir_1', 'nir', 'blue'] },
      { label: 'Red edge', b: ['nir', 'red_edge_1', 'red'] },
    ],
  },
  landsat: {
    label: 'Landsat 8/9', short: 'LS', group: 'main', res: 30, since: 2013,
    about: 'Missão da NASA/USGS para acompanhar mudanças na superfície da Terra; tem banda térmica. Imagem a cada ~8 dias.',
    stac: PC_STAC, collections: ['landsat-c2-l2'],
    query: { platform: { in: ['landsat-8', 'landsat-9'] } },
    dtype: 'uint16', nodata: 0, refAsset: 'red', maskAsset: 'qa_pixel',
    bands: [
      { asset: 'coastal', name: 'coastal', code: 'SR_B1' },
      { asset: 'blue',    name: 'blue',    code: 'SR_B2' },
      { asset: 'green',   name: 'green',   code: 'SR_B3' },
      { asset: 'red',     name: 'red',     code: 'SR_B4' },
      { asset: 'nir08',   name: 'nir',     code: 'SR_B5' },
      { asset: 'swir16',  name: 'swir_1',  code: 'SR_B6' },
      { asset: 'swir22',  name: 'swir_2',  code: 'SR_B7' },
      { asset: 'lwir11',  name: 'thermal', code: 'ST_B10' },
    ],
    // QA_PIXEL: bit0 fill; bit1 nuvem dilatada; bit2 cirrus; bit3 nuvem; bit4 sombra de nuvem
    classify: landsatQA,
    satellite: it => (it.properties.platform || '').replace('landsat-', 'Landsat-'),
    scaleFor: landsatScale,
    dedupeKey: it => it.id,
    version: it => 0,
    composites: [
      { label: 'Cor verdadeira', b: ['red', 'green', 'blue'] },
      { label: 'Falsa cor', b: ['nir', 'red', 'green'] },
      { label: 'Agricultura', b: ['swir_1', 'nir', 'blue'] },
    ],
  },

  // ---------- secundários ----------
  landsat457: {
    label: 'Landsat 4/5/7', short: 'LS457', group: 'secondary', res: 30, since: 1982,
    about: 'Gerações anteriores do Landsat. Servem para ver a área antes de 2013, como plantios antigos.',
    stac: PC_STAC, collections: ['landsat-c2-l2'],
    query: { platform: { in: ['landsat-4', 'landsat-5', 'landsat-7'] } },
    dtype: 'uint16', nodata: 0, refAsset: 'red', maskAsset: 'qa_pixel',
    bands: [
      { asset: 'blue',   name: 'blue',    code: 'SR_B1' },
      { asset: 'green',  name: 'green',   code: 'SR_B2' },
      { asset: 'red',    name: 'red',     code: 'SR_B3' },
      { asset: 'nir08',  name: 'nir',     code: 'SR_B4' },
      { asset: 'swir16', name: 'swir_1',  code: 'SR_B5' },
      { asset: 'swir22', name: 'swir_2',  code: 'SR_B7' },
      { asset: 'lwir',   name: 'thermal', code: 'ST_B6' },
    ],
    classify: landsatQA, // Landsat 7 após 2003 tem faixas sem dado (SLC-off): aparecem como "sem dado"
    satellite: it => (it.properties.platform || '').replace('landsat-', 'Landsat-'),
    scaleFor: landsatScale,
    dedupeKey: it => it.id,
    version: it => 0,
    composites: [
      { label: 'Cor verdadeira', b: ['red', 'green', 'blue'] },
      { label: 'Falsa cor', b: ['nir', 'red', 'green'] },
      { label: 'Agricultura', b: ['swir_1', 'nir', 'blue'] },
    ],
  },
  hls: {
    label: 'HLS', short: 'HLS', group: 'secondary', res: 30, since: 2013,
    about: 'Produto da NASA que põe Landsat e Sentinel-2 na mesma grade e calibração, para ter mais datas comparáveis.',
    stac: PC_STAC, collections: ['hls2-s30', 'hls2-l30'],
    dtype: 'int16', nodata: -9999, refAsset: 'B04', maskAsset: 'Fmask',
    // só as bandas comuns às duas coleções; o asset muda entre S30 (Sentinel) e L30 (Landsat)
    bands: [
      { asset: 'B01', name: 'coastal', code: 'B01' },
      { asset: 'B02', name: 'blue',    code: 'B02' },
      { asset: 'B03', name: 'green',   code: 'B03' },
      { asset: 'B04', name: 'red',     code: 'B04' },
      { asset: { 'hls2-s30': 'B8A', 'hls2-l30': 'B05' }, name: 'nir',    code: 'S30:B8A L30:B05' },
      { asset: { 'hls2-s30': 'B11', 'hls2-l30': 'B06' }, name: 'swir_1', code: 'S30:B11 L30:B06' },
      { asset: { 'hls2-s30': 'B12', 'hls2-l30': 'B07' }, name: 'swir_2', code: 'S30:B12 L30:B07' },
    ],
    // Fmask: 255 sem dado; bit1 nuvem, bit2 adjacente a nuvem/sombra, bit3 sombra
    classify: v => (!isNum(v) || v === 255) ? 'nodata' : (v & 0b1110) ? 'cloud' : 'clear',
    satellite: it => 'HLS ' + platformLabel(it),
    scaleFor: () => ({ scale: 0.0001, offset: 0 }),
    dedupeKey: it => it.id,
    version: it => 0,
    composites: [
      { label: 'Cor verdadeira', b: ['red', 'green', 'blue'] },
      { label: 'Falsa cor', b: ['nir', 'red', 'green'] },
      { label: 'Agricultura', b: ['swir_1', 'nir', 'blue'] },
    ],
  },
  sentinel1: {
    label: 'Sentinel-1', short: 'S1', group: 'secondary', res: 10, since: 2014,
    about: 'Radar europeu criado para enxergar a superfície com qualquer tempo, inclusive com nuvem e à noite.',
    stac: PC_STAC, collections: ['sentinel-1-rtc'],
    dtype: 'float32', nodata: -32768, refAsset: 'vv', maskAsset: 'vv', cloudFree: true,
    bands: [
      { asset: 'vv', name: 'vv', code: 'VV' },
      { asset: 'vh', name: 'vh', code: 'VH' },
    ],
    classify: v => (!isNum(v) || v === -32768) ? 'nodata' : 'clear',
    satellite: platformLabel,
    scaleFor: () => ({ scale: 1, offset: 0, unit: 'gamma0 linear' }),
    dedupeKey: it => it.id,
    version: it => 0,
    composites: [{ label: 'Radar (VV, VH, VV)', b: ['vv', 'vh', 'vv'] }],
  },
  palsar: {
    label: 'ALOS-2 PALSAR-2', short: 'PALSAR', group: 'secondary', res: 25, since: 2015,
    about: 'Radar japonês de banda L, que penetra no dossel; criado para mapear florestas. Um mosaico por ano (até 2021).',
    stac: PC_STAC, collections: ['alos-palsar-mosaic'],
    dtype: 'uint16', nodata: 0, refAsset: 'HH', maskAsset: 'mask', cloudFree: true,
    mosaic: true, minWindowDays: 3650, // mosaicos anuais (2015 em diante); acha o ano mais próximo
    bands: [
      { asset: 'HH', name: 'hh', code: 'HH' },
      { asset: 'HV', name: 'hv', code: 'HV' },
    ],
    // mask: 0 sem dado; demais (terra, água, layover, sombra) contam como dado
    classify: v => (!isNum(v) || v === 0) ? 'nodata' : 'clear',
    satellite: () => 'ALOS-2',
    scaleFor: () => ({ scale: 1, offset: 0, unit: 'DN; gamma0 (dB) = 10*log10(DN^2) - 83' }),
    dedupeKey: it => it.id,
    version: it => 0,
    composites: [{ label: 'Radar (HH, HV, HH)', b: ['hh', 'hv', 'hh'] }],
  },
  dem: {
    label: 'Copernicus DEM', short: 'DEM', group: 'secondary', res: 30, since: null,
    about: 'Modelo de elevação global feito com a missão TanDEM-X. Dá a altitude do terreno, sem data.',
    stac: PC_STAC, collections: ['cop-dem-glo-30'],
    dtype: 'float32', nodata: -9999, refAsset: 'data', maskAsset: 'data',
    mosaic: true, static: true, cloudFree: true, period: '2011 a 2015', // TanDEM-X; o STAC traz 2021-04-22 (publicação)
    bands: [{ asset: 'data', name: 'elevation', code: 'DEM' }],
    classify: v => isNum(v) ? 'clear' : 'nodata',
    satellite: () => 'Copernicus DEM',
    scaleFor: () => ({ scale: 1, offset: 0, unit: 'm' }),
    dedupeKey: it => it.id,
    version: it => 0,
    composites: [{ label: 'Altitude', b: ['elevation', 'elevation', 'elevation'] }],
  },
  srtm: {
    label: 'SRTM (NASADEM)', short: 'SRTM', group: 'secondary', res: 30, since: null,
    about: 'Altitude medida por radar do ônibus espacial em 2000, reprocessada pela NASA. Alternativa ao Copernicus DEM.',
    stac: PC_STAC, collections: ['nasadem'],
    // tiles de 1° em EPSG:4326, int16 em metros, RasterPixelIsPoint
    dtype: 'int16', nodata: -32768, refAsset: 'elevation', maskAsset: 'elevation',
    mosaic: true, static: true, cloudFree: true, period: '11 a 22/02/2000', // voo do Endeavour; o STAC traz só 2000-02-20
    bands: [{ asset: 'elevation', name: 'elevation', code: 'SRTM' }],
    classify: v => (!isNum(v) || v === -32768) ? 'nodata' : 'clear',
    satellite: () => 'SRTM',
    scaleFor: () => ({ scale: 1, offset: 0, unit: 'm' }),
    dedupeKey: it => it.id,
    version: it => 0,
    composites: [{ label: 'Altitude', b: ['elevation', 'elevation', 'elevation'] }],
  },
  modis: {
    label: 'MODIS', short: 'MODIS', group: 'secondary', res: 250, since: 2000,
    about: 'Sensor da NASA para monitoramento global diário; bom para tendências regionais. Composição de 8 dias.',
    stac: PC_STAC, collections: ['modis-09Q1-061'],
    dtype: 'int16', nodata: -28672, refAsset: 'sur_refl_b01', maskAsset: 'sur_refl_state_250m',
    mosaic: true, groupKey: it => it.properties.start_datetime.slice(0, 10) + '|' + it.properties.platform,
    bands: [
      { asset: 'sur_refl_b01', name: 'red', code: 'B01' },
      { asset: 'sur_refl_b02', name: 'nir', code: 'B02' },
    ],
    // state: 65535 sem dado; bits 0-1 estado da nuvem (1 nublado, 2 misto); bit 2 sombra
    classify: v => (!isNum(v) || v === 65535) ? 'nodata' : ((v & 3) === 1 || (v & 3) === 2 || (v & 4)) ? 'cloud' : 'clear',
    satellite: it => it.properties.platform === 'aqua' ? 'Aqua' : 'Terra',
    scaleFor: () => ({ scale: 0.0001, offset: 0 }),
    dedupeKey: it => it.id,
    version: it => 0,
    composites: [{ label: 'Falsa cor', b: ['nir', 'red', 'red'] }],
  },
};

const DTYPES = {
  uint16: { Array: Uint16Array, bits: 16, format: 1 },
  int16: { Array: Int16Array, bits: 16, format: 2 },
  float32: { Array: Float32Array, bits: 32, format: 3 },
};

// asset de uma banda (ou do refAsset/maskAsset) para um item, considerando a coleção
function assetOf(spec, item) {
  const a = spec && typeof spec === 'object' && !Array.isArray(spec) && 'asset' in spec ? spec.asset : spec;
  return typeof a === 'object' ? a[item.collection] : a;
}

// ---------- projeções ----------
// crs: número EPSG ou MODIS_SINU (sinusoidal do MODIS, sem código EPSG)
function ensureProj(crs) {
  if (crs === MODIS_SINU) {
    if (!proj4.defs(MODIS_SINU)) proj4.defs(MODIS_SINU, '+proj=sinu +lon_0=0 +x_0=0 +y_0=0 +R=6371007.181 +units=m +no_defs');
    return MODIS_SINU;
  }
  const epsg = crs;
  const key = 'EPSG:' + epsg;
  if (proj4.defs(key)) return key;
  let def = null;
  if (epsg >= 32601 && epsg <= 32660) def = `+proj=utm +zone=${epsg - 32600} +datum=WGS84 +units=m +no_defs`;
  else if (epsg >= 32701 && epsg <= 32760) def = `+proj=utm +zone=${epsg - 32700} +south +datum=WGS84 +units=m +no_defs`;
  else if (epsg >= 31978 && epsg <= 31985) def = `+proj=utm +zone=${epsg - 31960} +south +ellps=GRS80 +towgs84=0,0,0 +units=m +no_defs`; // SIRGAS 2000 / UTM 18S–25S
  else if (epsg >= 31965 && epsg <= 31976) def = `+proj=utm +zone=${epsg - 31954} +ellps=GRS80 +towgs84=0,0,0 +units=m +no_defs`; // SIRGAS 2000 / UTM 11N–22N
  else if (epsg === 4674) def = '+proj=longlat +ellps=GRS80 +towgs84=0,0,0 +no_defs';
  if (!def) throw new Error(`Sistema de coordenadas EPSG:${epsg} não suportado.`);
  proj4.defs(key, def);
  return key;
}
const isGeographic = crs => crs === 4326 || crs === 4674;
const crsLabel = crs => crs === MODIS_SINU ? 'Sinusoidal (MODIS)' : 'EPSG:' + crs;

// ---------- leitura dos arquivos vetoriais ----------
// Aceita um GeoJSON, um .zip com shapefile, ou os arquivos soltos do shapefile (.shp + .dbf + .prj [+ .cpg]).
// Shapefiles são lidos com shpjs, que já reprojeta para lon/lat usando o .prj.
async function readVectorFiles(files) {
  files = [...files];
  const ext = f => (f.name.match(/\.([^.]+)$/) || [])[1]?.toLowerCase() || '';
  const byExt = e => files.find(f => ext(f) === e);
  const base = f => f.name.replace(/\.[^.]+$/, '');
  const json = files.find(f => ext(f) === 'geojson' || ext(f) === 'json');
  if (json) return { obj: JSON.parse(await json.text()), base: base(json) };

  const kml = byExt('kml');
  if (kml) return { obj: parseKML(await kml.text()), base: base(kml) };
  const kmz = byExt('kmz');
  if (kmz) {
    // KMZ = zip com o .kml (normalmente doc.kml na raiz)
    let entries;
    try { entries = fflate.unzipSync(new Uint8Array(await kmz.arrayBuffer())); }
    catch (e) { throw new Error('Não foi possível abrir o .kmz (arquivo corrompido ou não é um KMZ).'); }
    const names = Object.keys(entries).filter(n => /\.kml$/i.test(n));
    const main = names.find(n => /^doc\.kml$/i.test(n)) || names[0];
    if (!main) throw new Error('O .kmz não contém um arquivo .kml.');
    return { obj: parseKML(new TextDecoder().decode(entries[main])), base: base(kmz) };
  }

  const zip = byExt('zip');
  if (zip) {
    let res = await shp(await zip.arrayBuffer());
    if (Array.isArray(res)) res = { type: 'FeatureCollection', features: res.flatMap(fc => fc.features) };
    return { obj: res, base: base(zip) };
  }

  const shpFile = byExt('shp');
  if (!shpFile) throw new Error('Selecione um .geojson, um .kml/.kmz, um .zip com shapefile ou os arquivos .shp + .dbf + .prj.');
  const prj = byExt('prj'), dbf = byExt('dbf'), cpg = byExt('cpg');
  const geoms = shp.parseShp(await shpFile.arrayBuffer(), prj ? await prj.text() : undefined);
  const obj = dbf ? shp.combine([geoms, shp.parseDbf(await dbf.arrayBuffer(), cpg ? (await cpg.text()).trim() : undefined)])
    : { type: 'FeatureCollection', features: geoms.map(g => ({ type: 'Feature', properties: {}, geometry: g })) };
  return { obj, base: base(shpFile), noPrj: !prj };
}

// ---------- KML ----------
// KML => FeatureCollection GeoJSON. Cada Placemark vira um Feature com seus polígonos (inclusive dentro de
// MultiGeometry); Placemark sem polígono (ponto, linha) vira geometria ignorada. KML é sempre lon,lat[,alt] em WGS84.
// Feito com regex (sem DOMParser) para rodar igual no navegador e nos testes; aceita prefixo de namespace (kml:Polygon).
function parseKML(text) {
  const blocks = (s, name) => [...s.matchAll(new RegExp(`<(?:[\\w-]+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:[\\w-]+:)?${name}\\s*>`, 'g'))].map(m => m[1]);
  const ring = s => {
    const c = blocks(s, 'coordinates')[0];
    if (!c) return null;
    const pts = c.trim().split(/\s+/).map(t => t.split(',').slice(0, 2).map(Number)).filter(p => p.length === 2 && p.every(Number.isFinite));
    if (pts.length < 3) return null;
    const [f, l] = [pts[0], pts.at(-1)];
    if (f[0] !== l[0] || f[1] !== l[1]) pts.push([...f]); // fecha o anel
    return pts;
  };
  const polygon = s => {
    const outer = ring(blocks(s, 'outerBoundaryIs')[0] || '');
    return outer && [outer, ...blocks(s, 'innerBoundaryIs').map(ring).filter(Boolean)];
  };
  text = text.replace(/<!--[\s\S]*?-->/g, ''); // polígono comentado não é talhão
  const features = blocks(text, 'Placemark').map(pm => {
    const name = (blocks(pm, 'name')[0] || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
    const polys = blocks(pm, 'Polygon').map(polygon).filter(Boolean);
    const geometry = polys.length > 1 ? { type: 'MultiPolygon', coordinates: polys }
      : polys.length ? { type: 'Polygon', coordinates: polys[0] }
      : { type: /<(?:[\w-]+:)?Point\b/.test(pm) ? 'Point' : 'LineString', coordinates: [] };
    return { type: 'Feature', properties: name ? { name } : {}, geometry };
  });
  return { type: 'FeatureCollection', features };
}

// ---------- GeoJSON ----------
function parseGeoJSON(obj) {
  const crsName = obj && obj.crs && obj.crs.properties && obj.crs.properties.name || '';
  let srcEpsg = 4326;
  const m = crsName.match(/EPSG:{1,2}(\d+)/i);
  if (m) srcEpsg = parseInt(m[1], 10);
  if (/CRS84/i.test(crsName)) srcEpsg = 4326;

  const geoms = [];
  const walk = g => {
    if (!g) return;
    if (g.type === 'FeatureCollection') g.features.forEach(walk);
    else if (g.type === 'Feature') walk(g.geometry);
    else if (g.type === 'GeometryCollection') g.geometries.forEach(walk);
    else geoms.push(g);
  };
  walk(obj);
  const polys = []; let ignored = 0;
  for (const g of geoms) {
    if (g.type === 'Polygon') polys.push(g.coordinates);
    else if (g.type === 'MultiPolygon') polys.push(...g.coordinates);
    else ignored++;
  }
  if (!polys.length) throw new Error('Nenhum polígono encontrado no arquivo.');

  let toLL = c => c;
  if (srcEpsg !== 4326) {
    const k = ensureProj(srcEpsg);
    toLL = c => proj4(k, 'EPSG:4326', [c[0], c[1]]);
  }
  const polygons = polys.map(p => p.map(r => r.map(toLL)));
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const p of polygons) for (const r of p) for (const [x, y] of r) {
    if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y;
  }
  if (Math.abs(minx) > 180 || Math.abs(maxy) > 90)
    throw new Error('As coordenadas não parecem ser lon/lat. Informe o "crs" no GeoJSON (ex.: EPSG:31982) ou inclua o .prj do shapefile.');
  const nFeat = obj.type === 'FeatureCollection' ? obj.features.length : 1;
  return { polygons, bboxLL: [minx, miny, maxx, maxy], nFeatures: nFeat, nPolygons: polygons.length, ignored, srcEpsg };
}

function projectPolys(polygons, crs) {
  const k = ensureProj(crs);
  return polygons.map(p => p.map(r => r.map(c => proj4('EPSG:4326', k, [c[0], c[1]]))));
}
function boundsOf(polys) {
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const p of polys) for (const r of p) for (const [x, y] of r) {
    if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y;
  }
  return [minx, miny, maxx, maxy];
}

// ---------- geometria simples ----------
function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function footprintContains(geom, pts) {
  if (!geom) return false;
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : [];
  return pts.every(([x, y]) => polys.some(p => pointInRing(x, y, p[0]) && !p.slice(1).some(h => pointInRing(x, y, h))));
}
// Rasteriza polígonos (coords em pixel, float) por scanline no centro do pixel + dilatação de 1 px
function rasterize(polysPx, W, H) {
  const m = new Uint8Array(W * H);
  for (const poly of polysPx) {
    const edges = [];
    for (const ring of poly) for (let i = 0; i < ring.length - 1; i++) edges.push([ring[i], ring[i + 1]]);
    for (let row = 0; row < H; row++) {
      const y = row + 0.5, xs = [];
      for (const [[x1, y1], [x2, y2]] of edges)
        if ((y1 > y) !== (y2 > y)) xs.push(x1 + (y - y1) * (x2 - x1) / (y2 - y1));
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const c0 = Math.max(0, Math.ceil(xs[k] - 0.5)), c1 = Math.min(W - 1, Math.floor(xs[k + 1] - 0.5));
        for (let c = c0; c <= c1; c++) m[row * W + c] = 1;
      }
    }
    // garante que vértices (talhões muito pequenos) marquem pelo menos o pixel onde caem
    for (const ring of poly) for (const [x, y] of ring) {
      const c = Math.floor(x), r = Math.floor(y);
      if (c >= 0 && c < W && r >= 0 && r < H) m[r * W + c] = 1;
    }
  }
  const d = new Uint8Array(m);
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) if (m[r * W + c]) {
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const rr = r + dr, cc = c + dc;
      if (rr >= 0 && rr < H && cc >= 0 && cc < W) d[rr * W + cc] = 1;
    }
  }
  return d;
}

// ---------- STAC ----------
// Arquivos no Azure Blob (Planetary Computer) precisam de token SAS da conta/container do arquivo.
const pcTokens = new Map();
async function signHref(href) {
  const m = href.match(/^https:\/\/([^.]+)\.blob\.core\.windows\.net\/([^/?]+)\//);
  if (!m) return href;
  const key = m[1] + '/' + m[2];
  let tok = pcTokens.get(key);
  if (!tok || Date.parse(tok.expiry) - Date.now() < 5 * 60e3) {
    tok = null;
    let lastErr;
    for (let i = 0; i < 6; i++) {
      try {
        const r = await fetch('https://planetarycomputer.microsoft.com/api/sas/v1/token/' + key);
        if (r.ok) { const j = await r.json(); tok = { token: j.token, expiry: j['msft:expiry'] }; break; }
        lastErr = new Error('Token do Planetary Computer: HTTP ' + r.status);
      } catch (e) { lastErr = e; }
      await new Promise(res => setTimeout(res, 2000 * (i + 1)));
    }
    if (!tok) throw lastErr;
    pcTokens.set(key, tok);
  }
  return href + (href.includes('?') ? '&' : '?') + tok.token;
}

// Data mostrada de uma cena (dd/mm/aaaa) ou, nos produtos sem data, o período real de aquisição
function sceneDate(sensor, cand) { return SENSORS[sensor].period || cand.day.split('-').reverse().join('/'); }

function isoDay(d) { return d.toISOString().slice(0, 10); }
function addDays(day, n) { const d = new Date(day + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return isoDay(d); }

// Intervalo de datas da busca (produtos anuais exigem janela mínima maior)
function searchRange(sensor, day, win) {
  const w = Math.max(win, SENSORS[sensor].minWindowDays || 0);
  return [addDays(day, -w), addDays(day, w)];
}

async function stacSearch(sensor, bboxLL, startDay, endDay) {
  const s = SENSORS[sensor];
  let body = { collections: s.collections, bbox: bboxLL, limit: 100 };
  if (!s.static) body.datetime = `${startDay}T00:00:00Z/${endDay}T23:59:59Z`;
  if (s.query) body.query = s.query;
  let url = s.stac, method = 'POST';
  const items = [];
  for (let page = 0; page < 30; page++) {
    const opt = method === 'POST' ? { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {};
    const r = await fetch(url, opt);
    if (!r.ok) throw new Error(`Busca STAC falhou (HTTP ${r.status}): ${(await r.text()).slice(0, 200)}`);
    const j = await r.json();
    items.push(...(j.features || []));
    const next = (j.links || []).find(l => l.rel === 'next');
    if (!next || !(j.features || []).length) break;
    url = next.href;
    if (next.body) { body = next.merge ? { ...body, ...next.body } : next.body; method = next.method || 'POST'; }
    else method = 'GET';
  }
  return items;
}

// Data de um item e distância em dias até a data alvo (0 se a data alvo cai no período do item)
function itemDates(it, targetDay) {
  const p = it.properties;
  const start = (p.start_datetime || p.datetime).slice(0, 10), end = (p.end_datetime || p.datetime || p.start_datetime).slice(0, 10);
  const day = (p.datetime || p.start_datetime).slice(0, 10);
  const t = Date.parse(targetDay + 'T00:00:00Z'), d = s => Date.parse(s + 'T00:00:00Z');
  const delta = t < d(start) ? Math.round((d(start) - t) / 86400e3) : t > d(end) ? Math.round((d(end) - t) / 86400e3) : 0;
  return { day, delta };
}

// Ordena: anteriores (≤ data X) do mais próximo ao mais distante; depois posteriores.
// Sensores com mosaic juntam os tiles da mesma data num único candidato.
function orderCandidates(items, sensor, targetDay, geo) {
  const s = SENSORS[sensor];
  const best = new Map();
  for (const it of items) {
    const k = s.dedupeKey(it), cur = best.get(k);
    if (!cur || s.version(it) > s.version(cur)) best.set(k, it);
  }
  let groups = [...best.values()].map(it => [it]);
  if (s.mosaic) {
    const byKey = new Map();
    for (const it of best.values()) {
      const k = s.groupKey ? s.groupKey(it) : itemDates(it, targetDay).day;
      byKey.set(k, [...(byKey.get(k) || []), it]);
    }
    groups = [...byKey.values()];
  }
  const [a, b, c, d] = geo.bboxLL;
  const corners = [[a, b], [a, d], [c, b], [c, d]];
  return groups.map(items => {
    const it = items[0];
    const { day, delta } = itemDates(it, targetDay);
    return {
      item: it, items, day, delta,
      sceneCloud: it.properties['eo:cloud_cover'],
      covers: corners.every(pt => items.some(i => footprintContains(i.geometry, [pt]))),
      satellite: s.satellite(it),
    };
  }).sort((x, y) =>
    ((x.delta > 0) - (y.delta > 0)) || (Math.abs(x.delta) - Math.abs(y.delta)) ||
    (y.covers - x.covers) || ((x.sceneCloud ?? 100) - (y.sceneCloud ?? 100)));
}

function gridOf(img) {
  let [ox, oy] = img.getOrigin();
  const [rx, ry] = img.getResolution();
  // RasterPixelIsPoint (Landsat, DEM): o tiepoint é o centro do pixel, então desloca meio pixel (como o GDAL faz)
  const gk = img.getGeoKeys ? img.getGeoKeys() : img.geoKeys;
  if (gk && gk.GTRasterTypeGeoKey === 2) { ox -= rx / 2; oy -= ry / 2; }
  return { ox, oy, rx, ry: Math.abs(ry), w: img.getWidth(), h: img.getHeight() };
}
function epsgOf(img, item) {
  const gk = img.getGeoKeys ? img.getGeoKeys() : img.geoKeys;
  if (gk && gk.ProjCoordTransGeoKey === 24 && Math.round(gk.GeogSemiMajorAxisGeoKey) === 6371007) return MODIS_SINU;
  const e = gk && (gk.ProjectedCSTypeGeoKey || gk.GeographicTypeGeoKey);
  if (e && e !== 32767) return e;
  const p = item.properties['proj:epsg'] || parseInt(String(item.properties['proj:code'] || '').split(':')[1], 10);
  if (!p) throw new Error('Não foi possível descobrir o EPSG da cena ' + item.id);
  return p;
}
async function openCog(item, assetKey) {
  const a = item.assets[assetKey];
  if (!a) throw new Error(`A cena ${item.id} não tem o asset "${assetKey}".`);
  const tif = await GeoTIFF.fromUrl(await signHref(a.href), { allowFullFile: false });
  return tif.getImage(0);
}

// Reamostra (vizinho mais próximo) uma imagem para a grade T = {X0, Y0, rx, ry, W, H}, preenchendo em `out`
// só os pixels que ainda estão vazios (isEmpty) com valores válidos da imagem (isValid). Usado para mosaicar tiles.
async function sampleInto(img, T, out, isEmpty, isValid) {
  const bg = gridOf(img);
  const colMap = new Int32Array(T.W), rowMap = new Int32Array(T.H);
  for (let i = 0; i < T.W; i++) colMap[i] = Math.floor((T.X0 + (i + 0.5) * T.rx - bg.ox) / bg.rx);
  for (let j = 0; j < T.H; j++) rowMap[j] = Math.floor((bg.oy - (T.Y0 - (j + 0.5) * T.ry)) / bg.ry);
  const a0 = Math.max(0, colMap[0]), a1 = Math.min(bg.w, colMap[T.W - 1] + 1);
  const b0 = Math.max(0, rowMap[0]), b1 = Math.min(bg.h, rowMap[T.H - 1] + 1);
  if (a1 <= a0 || b1 <= b0) return;
  const src = (await img.readRasters({ window: [a0, b0, a1, b1], samples: [0] }))[0], sw = a1 - a0;
  for (let j = 0; j < T.H; j++) {
    const r = rowMap[j];
    if (r < b0 || r >= b1) continue;
    const so = (r - b0) * sw;
    for (let i = 0; i < T.W; i++) {
      const c = colMap[i], k = j * T.W + i;
      if (c < a0 || c >= a1 || !isEmpty(out[k])) continue;
      const v = src[so + c - a0];
      if (isValid(v)) out[k] = v;
    }
  }
}

const itemsOf = cand => cand.items || [cand.item];

// Verifica nuvem/sombra e ausência de dado dentro dos talhões usando a máscara da cena
async function checkCandidate(cand, sensor, geo) {
  const s = SENSORS[sensor], items = itemsOf(cand);
  const img0 = await openCog(items[0], assetOf(s.maskAsset, items[0]));
  const g = gridOf(img0), crs = epsgOf(img0, items[0]);
  const polys = projectPolys(geo.polygons, crs);
  const [minx, miny, maxx, maxy] = boundsOf(polys);
  // grade da máscara do 1º item, recortada nos talhões (+1 px)
  const c0 = Math.floor((minx - g.ox) / g.rx) - 1, c1 = Math.ceil((maxx - g.ox) / g.rx) + 1;
  const r0 = Math.floor((g.oy - maxy) / g.ry) - 1, r1 = Math.ceil((g.oy - miny) / g.ry) + 1;
  const T = { X0: g.ox + c0 * g.rx, Y0: g.oy - r0 * g.ry, rx: g.rx, ry: g.ry, W: c1 - c0, H: r1 - r0 };
  // NaN = fora de todas as cenas; o valor de nodata da máscara é tratado pelo classify
  const data = new Float32Array(T.W * T.H).fill(NaN);
  const empty = v => Number.isNaN(v) || s.classify(v) === 'nodata';
  for (let i = 0; i < items.length; i++) {
    const img = i === 0 ? img0 : await openCog(items[i], assetOf(s.maskAsset, items[i]));
    if (i > 0 && epsgOf(img, items[i]) !== crs) continue;
    await sampleInto(img, T, data, empty, v => s.classify(v) !== 'nodata');
  }
  const polysPx = polys.map(p => p.map(r => r.map(([x, y]) => [(x - T.X0) / T.rx, (T.Y0 - y) / T.ry])));
  const mask = rasterize(polysPx, T.W, T.H);
  let n = 0, cloud = 0, nodata = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) {
    n++;
    const k = s.classify(data[i]);
    if (k === 'cloud') cloud++; else if (k === 'nodata') nodata++;
  }
  return { n, cloudPct: 100 * cloud / n, nodataPct: 100 * nodata / n };
}

// Percorre as candidatas a partir de `from` até achar uma limpa e conseguir exibi-la (show).
// Erro na verificação ou no download marca a cena como 'error' e segue para a próxima.
// Devolve o índice exibido, -1 se nenhuma serviu, ou null se a busca foi substituída (alive() falso):
// nesse caso não mexe em mais nada nem chama show.
async function pickCandidate(cands, from, { tol, check, show, alive, onUpdate = () => {} }) {
  for (let i = from; i < cands.length; i++) {
    if (!alive()) return null;
    const c = cands[i];
    if ((c.sceneCloud ?? 0) >= 99 && tol < 99) { c.status = 'skip'; onUpdate(c, i); continue; }
    c.status = 'checking'; onUpdate(c, i);
    try {
      const r = await check(c);
      if (!alive()) return null;
      c.check = r;
      c.status = r.nodataPct > 0 ? 'nodata' : r.cloudPct > tol ? 'cloud' : 'ok';
      onUpdate(c, i);
      if (c.status !== 'ok') continue;
      await show(c, i);
      return alive() ? i : null;
    } catch (err) {
      if (!alive()) return null;
      c.status = 'error'; c.error = err.message; onUpdate(c, i, err);
    }
  }
  return -1;
}

// Texto seguro dentro de HTML (inclusive em atributos entre aspas)
function escHtml(t) { return String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
// Dia no fuso do usuário (toISOString daria o dia UTC: no Brasil, depois das 21h já seria amanhã)
function localDay(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

async function pool(tasks, k) {
  const res = new Array(tasks.length); let i = 0;
  await Promise.all(Array.from({ length: k }, async () => { while (i < tasks.length) { const j = i++; res[j] = await tasks[j](); } }));
  return res;
}

// Baixa todas as bandas no recorte (bbox dos talhões + buffer), alinhadas à grade da banda de referência
async function loadImage(cand, sensor, geo, bufferM, onProgress) {
  const s = SENSORS[sensor], items = itemsOf(cand), item = items[0], dt = DTYPES[s.dtype];
  const ref = await openCog(item, assetOf(s.refAsset, item));
  const g = gridOf(ref), crs = epsgOf(ref, item);
  const polys = projectPolys(geo.polygons, crs);
  const [minx, miny, maxx, maxy] = boundsOf(polys);
  // buffer em metros; em CRS geográfico converte para graus na latitude da área
  let bx = bufferM, by = bufferM;
  if (isGeographic(crs)) { by = bufferM / 110574; bx = bufferM / (111320 * Math.cos((miny + maxy) / 2 * Math.PI / 180)); }
  const c0 = Math.floor((minx - bx - g.ox) / g.rx), c1 = Math.ceil((maxx + bx - g.ox) / g.rx);
  const r0 = Math.floor((g.oy - (maxy + by)) / g.ry), r1 = Math.ceil((g.oy - (miny - by)) / g.ry);
  const T = { X0: g.ox + c0 * g.rx, Y0: g.oy - r0 * g.ry, rx: g.rx, ry: g.ry, W: c1 - c0, H: r1 - r0 };
  const bands = s.bands.filter(b => item.assets[assetOf(b, item)]);
  if (T.W * T.H * bands.length * dt.bits / 8 > 1.5e9) throw new Error('Área grande demais para montar no navegador. Reduza o buffer ou divida o GeoJSON.');
  const nod = s.nodata;
  const isEmpty = v => v === nod || Number.isNaN(v);
  const isValid = v => v !== nod && !Number.isNaN(v);
  let done = 0;
  const datas = await pool(bands.map(b => async () => {
    const out = new dt.Array(T.W * T.H).fill(nod);
    for (let i = 0; i < items.length; i++) {
      const it = items[i], key = assetOf(b, it);
      if (!it.assets[key]) continue;
      const img = i === 0 && key === assetOf(s.refAsset, item) ? ref : await openCog(it, key);
      if (i > 0 && epsgOf(img, it) !== crs) continue;
      await sampleInto(img, T, out, isEmpty, isValid);
    }
    onProgress && onProgress(++done, bands.length, b.name);
    return out;
  }), 4);
  const polysPx = polys.map(p => p.map(r => r.map(([x, y]) => [(x - T.X0) / T.rx, (T.Y0 - y) / T.ry])));
  return {
    W: T.W, H: T.H, X0: T.X0, Y0: T.Y0, res: T.rx, resY: T.ry, epsg: crs, dtype: s.dtype, nodata: nod, polysPx,
    bands: bands.map((b, i) => ({ ...b, ...s.scaleFor(item, b), data: datas[i] })),
  };
}

// ---------- escrita do GeoTIFF (bandas separadas, sem compressão) ----------
function xmlEsc(t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

// GeoKeys: [chave, local (0 = valor curto, 34736 = double), valor]
function geoKeysFor(crs) {
  let keys;
  if (crs === MODIS_SINU) {
    keys = [[1024, 0, 1], [1025, 0, 1], [2048, 0, 32767], [2050, 0, 32767], [2054, 0, 9102], [2056, 0, 32767],
      [2057, 34736, 6371007.181], [2058, 34736, 6371007.181], [3072, 0, 32767], [3074, 0, 32767], [3075, 0, 24],
      [3076, 0, 9001], [3082, 34736, 0], [3083, 34736, 0], [3088, 34736, 0]];
  } else if (isGeographic(crs)) {
    keys = [[1024, 0, 2], [1025, 0, 1], [2048, 0, crs], [2054, 0, 9102]];
  } else {
    keys = [[1024, 0, 1], [1025, 0, 1], [3072, 0, crs], [3076, 0, 9001]];
  }
  const dir = [1, 1, 0, keys.length], doubles = [];
  for (const [k, loc, v] of keys) {
    if (loc) { dir.push(k, loc, 1, doubles.length); doubles.push(v); } else dir.push(k, 0, 1, v);
  }
  return { dir, doubles };
}

function buildGeoTIFF(img, meta) {
  const { W, H, X0, Y0, res, epsg, bands } = img, n = bands.length;
  const resY = img.resY || res, dt = DTYPES[img.dtype || 'uint16'], nodata = img.nodata ?? 0;
  let xml = '<GDALMetadata>\n';
  for (const [k, v] of Object.entries(meta)) xml += `  <Item name="${xmlEsc(k)}">${xmlEsc(v)}</Item>\n`;
  bands.forEach((b, i) => {
    xml += `  <Item name="DESCRIPTION" sample="${i}" role="description">${xmlEsc(b.name)}</Item>\n`;
    xml += `  <Item name="BAND_CODE" sample="${i}">${xmlEsc(b.code)}</Item>\n`;
    xml += `  <Item name="PHYSICAL_SCALE" sample="${i}">${b.scale}</Item>\n`;
    xml += `  <Item name="PHYSICAL_OFFSET" sample="${i}">${b.offset}</Item>\n`;
    if (b.unit) xml += `  <Item name="PHYSICAL_UNIT" sample="${i}">${xmlEsc(b.unit)}</Item>\n`;
  });
  xml += '</GDALMetadata>\0';
  const gk = geoKeysFor(epsg);
  const enc = new TextEncoder();
  // tag: [id, type, values]; type 3 SHORT, 4 LONG, 12 DOUBLE, 2 ASCII
  const SIZE = { 2: 1, 3: 2, 4: 4, 12: 8 };
  const planeBytes = W * H * dt.bits / 8;
  const tags = [
    [256, 4, [W]], [257, 4, [H]], [258, 3, Array(n).fill(dt.bits)], [259, 3, [1]], [262, 3, [1]],
    [273, 4, Array(n).fill(0)], [277, 3, [n]], [278, 4, [H]], [279, 4, Array(n).fill(planeBytes)],
    [284, 3, [2]],
    ...(n > 1 ? [[338, 3, Array(n - 1).fill(0)]] : []),
    [339, 3, Array(n).fill(dt.format)],
    [33550, 12, [res, resY, 0]], [33922, 12, [0, 0, 0, X0, Y0, 0]],
    [34735, 3, gk.dir],
    ...(gk.doubles.length ? [[34736, 12, gk.doubles]] : []),
    [42112, 2, enc.encode(xml)], [42113, 2, enc.encode(String(nodata) + '\0')],
  ];
  const ifdSize = 2 + tags.length * 12 + 4;
  let extra = 8 + ifdSize;
  const placed = tags.map(([id, type, vals]) => {
    const bytes = vals.length * SIZE[type];
    let off = null;
    if (bytes > 4) { if (extra % 2) extra++; off = extra; extra += bytes; }
    return { id, type, vals, bytes, off };
  });
  let dataStart = extra + (8 - extra % 8) % 8;
  const stripOffsets = bands.map((_, i) => dataStart + i * planeBytes);
  placed.find(t => t.id === 273).vals = stripOffsets;
  const total = dataStart + n * planeBytes;
  if (total > 4294967295) throw new Error('Arquivo maior que 4 GB; reduza a área.');
  const buf = new ArrayBuffer(total), dv = new DataView(buf);
  dv.setUint16(0, 0x4949); dv.setUint16(2, 42, true); dv.setUint32(4, 8, true);
  dv.setUint16(8, tags.length, true);
  const writeVals = (pos, t) => {
    t.vals.forEach((v, i) => {
      const p = pos + i * SIZE[t.type];
      if (t.type === 3) dv.setUint16(p, v, true);
      else if (t.type === 4) dv.setUint32(p, v, true);
      else if (t.type === 12) dv.setFloat64(p, v, true);
      else if (t.type === 2) dv.setUint8(p, v);
    });
  };
  placed.forEach((t, i) => {
    const e = 10 + i * 12;
    dv.setUint16(e, t.id, true); dv.setUint16(e + 2, t.type, true); dv.setUint32(e + 4, t.vals.length, true);
    if (t.off === null) writeVals(e + 8, t); else { dv.setUint32(e + 8, t.off, true); writeVals(t.off, t); }
  });
  dv.setUint32(10 + tags.length * 12, 0, true);
  bands.forEach((b, i) => new dt.Array(buf, stripOffsets[i], W * H).set(b.data));
  return buf;
}

// ---------- realce para visualização ----------
// Escala da prévia: ocupa toda a área disponível (largura e altura), ampliando sem limite
// imagens de poucos pixels (MODIS) e reduzindo as grandes.
function previewScale(W, H, maxW, maxH) {
  return Math.min(maxW / W, maxH / H);
}
function percentiles(data, lo, hi, nodata = 0) {
  const step = Math.max(1, Math.floor(data.length / 200000)), s = [];
  for (let i = 0; i < data.length; i += step) { const v = data[i]; if (v !== nodata && !Number.isNaN(v)) s.push(v); }
  if (!s.length) return [0, 1];
  s.sort((a, b) => a - b);
  const q = p => s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))];
  const a = q(lo), b = q(hi);
  return [a, b > a ? b : a + 1];
}

// ---------- navegação da prévia (zoom e arraste) ----------
// view = { z, cx, cy }: zoom (1 = imagem inteira) e centro da tela em coordenadas de pixel da imagem.
// g = { W, H, cw, ch, k0 }: tamanho da imagem, tamanho do canvas e escala base (imagem inteira encaixada).
// No canvas: x = ix * s + tx, com s = k0 * z.
function maxZoom(g) { return Math.max(8, 64 / g.k0); } // até um pixel da imagem ocupar ~64 px (mín. 8x)
function fitView(g) { return { z: 1, cx: g.W / 2, cy: g.H / 2 }; }
function clampView(v, g) {
  const z = Math.min(maxZoom(g), Math.max(1, v.z)), s = g.k0 * z;
  if (z === 1) return fitView(g);
  // como no QGIS: o ponto sob o cursor fica fixo no zoom; o arraste só não deixa a imagem sair da tela
  // (o centro da vista fica sempre dentro da imagem)
  return { z, cx: Math.min(g.W, Math.max(0, v.cx)), cy: Math.min(g.H, Math.max(0, v.cy)) };
}
function viewTransform(v, g) {
  const s = g.k0 * v.z;
  return { s, tx: g.cw / 2 - v.cx * s, ty: g.ch / 2 - v.cy * s };
}
// Zoom mantendo fixo o ponto da imagem sob o cursor (x, y no canvas)
function zoomAt(v, x, y, factor, g) {
  const { s, tx, ty } = viewTransform(v, g);
  const ix = (x - tx) / s, iy = (y - ty) / s;
  const z = Math.min(maxZoom(g), Math.max(1, v.z * factor)), s2 = g.k0 * z;
  return clampView({ z, cx: ix - (x - g.cw / 2) / s2, cy: iy - (y - g.ch / 2) / s2 }, g);
}
// Arraste: a imagem acompanha o mouse (dx, dy em px de canvas)
function panBy(v, dx, dy, g) {
  const s = g.k0 * v.z;
  return clampView({ z: v.z, cx: v.cx - dx / s, cy: v.cy - dy / s }, g);
}

// ---------- inspeção de pixel ----------
// Posição (x, y) no canvas da prévia => pixel (c, r) da imagem; null se fora. sx/sy = px de canvas por pixel da imagem.
function canvasToPixel(x, y, sx, sy, W, H) {
  const c = Math.floor(x / sx), r = Math.floor(y / sy);
  return c >= 0 && c < W && r >= 0 && r < H ? { c, r } : null;
}
// Valor bruto (como está no .tif) de cada banda no pixel, indicando sem dado
function pixelValues(img, c, r) {
  const i = r * img.W + c;
  return img.bands.map(b => {
    const raw = b.data[i];
    return { name: b.name, code: b.code, raw, nodata: raw === img.nodata || Number.isNaN(raw) };
  });
}
// Centro do pixel em lon/lat (WGS84)
function pixelLonLat(img, c, r) {
  const x = img.X0 + (c + 0.5) * img.res, y = img.Y0 - (r + 0.5) * (img.resY || img.res);
  return proj4(ensureProj(img.epsg), 'EPSG:4326', [x, y]);
}

// ---------- NDVI ----------
// NDVI = (nir - red) / (nir + red), calculado sobre a REFLECTÂNCIA (valor * escala + offset de cada banda).
// Usar o valor bruto daria errado onde há offset (Landsat: -0,2). NaN onde falta dado.
function hasNdvi(img) { return ['nir', 'red'].every(n => img.bands.some(b => b.name === n)); }
function ndviAt(img, i) {
  const nir = img.bands.find(b => b.name === 'nir'), red = img.bands.find(b => b.name === 'red');
  const n = nir.data[i], r = red.data[i];
  if (n === img.nodata || r === img.nodata || Number.isNaN(n) || Number.isNaN(r)) return NaN;
  const nr = n * nir.scale + nir.offset, rr = r * red.scale + red.offset, s = nr + rr;
  return s === 0 ? NaN : Math.max(-1, Math.min(1, (nr - rr) / s));
}
function ndvi(img) {
  const out = new Float32Array(img.W * img.H);
  for (let i = 0; i < out.length; i++) out[i] = ndviAt(img, i);
  return out;
}
// escala de cores: água (azul) -> solo (marrom) -> amarelo -> verdes -> floresta densa
const NDVI_STOPS = [[-1, [30, 70, 130]], [-0.15, [110, 140, 165]], [0, [160, 82, 45]], [0.2, [217, 180, 95]], [0.4, [232, 227, 107]], [0.6, [124, 195, 90]], [0.8, [31, 122, 58]], [1, [11, 77, 36]]];
function ndviColor(v) {
  if (Number.isNaN(v)) return null;
  v = Math.max(-1, Math.min(1, v));
  for (let k = 1; k < NDVI_STOPS.length; k++) if (v <= NDVI_STOPS[k][0]) {
    const [a, ca] = NDVI_STOPS[k - 1], [b, cb] = NDVI_STOPS[k], t = (v - a) / (b - a);
    return ca.map((c, j) => Math.round(c + (cb[j] - c) * t));
  }
  return NDVI_STOPS.at(-1)[1];
}

// ---------- zip ----------
function zipFile(name, buf) {
  return new Promise((resolve, reject) =>
    fflate.zip({ [name]: [new Uint8Array(buf), { level: 6 }] }, (err, out) => err ? reject(err) : resolve(out)));
}

globalThis.Core = {
  SENSORS, MODIS_SINU, readVectorFiles, zipFile, parseKML, parseGeoJSON, stacSearch, searchRange, orderCandidates, checkCandidate, pickCandidate, loadImage,
  escHtml, localDay, sceneDate,
  buildGeoTIFF, percentiles, previewScale, maxZoom, fitView, clampView, viewTransform, zoomAt, panBy, canvasToPixel, pixelValues, pixelLonLat, hasNdvi, ndvi, ndviAt, ndviColor, NDVI_STOPS, addDays, isoDay, crsLabel, isGeographic,
  // expostos para os testes
  ensureProj, projectPolys, pointInRing, footprintContains, rasterize, signHref, assetOf, gridOf, epsgOf, itemDates,
};
