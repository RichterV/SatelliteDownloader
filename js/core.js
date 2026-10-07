// ======================= Núcleo (sem DOM) =======================
const SENSORS = {
  sentinel2: {
    label: 'Sentinel-2 L2A', short: 'S2',
    stac: 'https://earth-search.aws.element84.com/v1/search', collection: 'sentinel-2-l2a',
    res: 10, refAsset: 'blue', maskAsset: 'scl',
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
    classify: v => (v === 0 || v === 1) ? 'nodata' : (v === 3 || v === 8 || v === 9 || v === 10) ? 'cloud' : 'clear',
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
    label: 'Landsat 8/9 C2 L2', short: 'LS',
    stac: 'https://planetarycomputer.microsoft.com/api/stac/v1/search', collection: 'landsat-c2-l2',
    query: { platform: { in: ['landsat-8', 'landsat-9'] } },
    sign: true, tokenUrl: 'https://planetarycomputer.microsoft.com/api/sas/v1/token/landsat-c2-l2',
    res: 30, refAsset: 'red', maskAsset: 'qa_pixel',
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
    classify: v => (v & 1) ? 'nodata' : (v & 0b11110) ? 'cloud' : 'clear',
    satellite: it => (it.properties.platform || '').replace('landsat-', 'Landsat-'),
    scaleFor: (it, b) => b.name === 'thermal' ? { scale: 0.00341802, offset: 149.0, unit: 'K' } : { scale: 0.0000275, offset: -0.2 },
    dedupeKey: it => it.id,
    version: it => 0,
    composites: [
      { label: 'Cor verdadeira', b: ['red', 'green', 'blue'] },
      { label: 'Falsa cor', b: ['nir', 'red', 'green'] },
      { label: 'Agricultura', b: ['swir_1', 'nir', 'blue'] },
    ],
  },
};

// ---------- projeções ----------
function ensureProj(epsg) {
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

  const zip = byExt('zip');
  if (zip) {
    let res = await shp(await zip.arrayBuffer());
    if (Array.isArray(res)) res = { type: 'FeatureCollection', features: res.flatMap(fc => fc.features) };
    return { obj: res, base: base(zip) };
  }

  const shpFile = byExt('shp');
  if (!shpFile) throw new Error('Selecione um .geojson, um .zip com shapefile ou os arquivos .shp + .dbf + .prj.');
  const prj = byExt('prj'), dbf = byExt('dbf'), cpg = byExt('cpg');
  const geoms = shp.parseShp(await shpFile.arrayBuffer(), prj ? await prj.text() : undefined);
  const obj = dbf ? shp.combine([geoms, shp.parseDbf(await dbf.arrayBuffer(), cpg ? await cpg.arrayBuffer() : undefined)])
    : { type: 'FeatureCollection', features: geoms.map(g => ({ type: 'Feature', properties: {}, geometry: g })) };
  return { obj, base: base(shpFile), noPrj: !prj };
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
  if (!polys.length) throw new Error('Nenhum polígono encontrado no GeoJSON.');

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

function projectPolys(polygons, epsg) {
  const k = ensureProj(epsg);
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
let pcToken = null;
async function signHref(href, sensor) {
  const s = SENSORS[sensor];
  if (!s.sign) return href;
  if (!pcToken || Date.parse(pcToken.expiry) - Date.now() < 5 * 60e3) {
    let lastErr;
    for (let i = 0; i < 6; i++) {
      try {
        const r = await fetch(s.tokenUrl);
        if (r.ok) { const j = await r.json(); pcToken = { token: j.token, expiry: j['msft:expiry'] }; break; }
        lastErr = new Error('Token do Planetary Computer: HTTP ' + r.status);
      } catch (e) { lastErr = e; }
      await new Promise(res => setTimeout(res, 2000 * (i + 1)));
    }
    if (!pcToken) throw lastErr;
  }
  return href + (href.includes('?') ? '&' : '?') + pcToken.token;
}

function isoDay(d) { return d.toISOString().slice(0, 10); }
function addDays(day, n) { const d = new Date(day + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return isoDay(d); }

async function stacSearch(sensor, bboxLL, startDay, endDay) {
  const s = SENSORS[sensor];
  let body = { collections: [s.collection], bbox: bboxLL, datetime: `${startDay}T00:00:00Z/${endDay}T23:59:59Z`, limit: 100 };
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

// Ordena: anteriores (≤ data X) do mais próximo ao mais distante; depois posteriores.
function orderCandidates(items, sensor, targetDay, geo) {
  const s = SENSORS[sensor];
  const best = new Map();
  for (const it of items) {
    const k = s.dedupeKey(it), cur = best.get(k);
    if (!cur || s.version(it) > s.version(cur)) best.set(k, it);
  }
  const [a, b, c, d] = geo.bboxLL;
  const corners = [[a, b], [a, d], [c, b], [c, d]];
  const t0 = Date.parse(targetDay + 'T00:00:00Z');
  return [...best.values()].map(it => {
    const day = it.properties.datetime.slice(0, 10);
    const delta = Math.round((Date.parse(day + 'T00:00:00Z') - t0) / 86400e3);
    return {
      item: it, day, delta,
      sceneCloud: it.properties['eo:cloud_cover'],
      covers: footprintContains(it.geometry, corners),
      satellite: s.satellite(it),
    };
  }).sort((x, y) =>
    ((x.delta > 0) - (y.delta > 0)) || (Math.abs(x.delta) - Math.abs(y.delta)) ||
    (y.covers - x.covers) || ((x.sceneCloud ?? 100) - (y.sceneCloud ?? 100)));
}

function gridOf(img) {
  let [ox, oy] = img.getOrigin();
  const [rx, ry] = img.getResolution();
  // Landsat usa RasterPixelIsPoint: o tiepoint é o centro do pixel, então desloca meio pixel (como o GDAL faz)
  const gk = img.getGeoKeys ? img.getGeoKeys() : img.geoKeys;
  if (gk && gk.GTRasterTypeGeoKey === 2) { ox -= rx / 2; oy -= ry / 2; }
  return { ox, oy, rx, ry: Math.abs(ry), w: img.getWidth(), h: img.getHeight() };
}
function epsgOf(img, item) {
  const gk = img.getGeoKeys ? img.getGeoKeys() : img.geoKeys;
  const e = gk && (gk.ProjectedCSTypeGeoKey || gk.GeographicTypeGeoKey);
  if (e && e !== 32767) return e;
  const p = item.properties['proj:epsg'] || parseInt(String(item.properties['proj:code'] || '').split(':')[1], 10);
  if (!p) throw new Error('Não foi possível descobrir o EPSG da cena ' + item.id);
  return p;
}
async function openCog(item, assetKey, sensor) {
  const a = item.assets[assetKey];
  if (!a) throw new Error(`A cena ${item.id} não tem o asset "${assetKey}".`);
  const tif = await GeoTIFF.fromUrl(await signHref(a.href, sensor), { allowFullFile: false });
  return tif.getImage(0);
}
// Lê uma janela [c0,r0,c1,r1) da imagem; o que cai fora da imagem recebe `fill`.
async function readWindow(img, g, c0, r0, c1, r1, fill) {
  const W = c1 - c0, H = r1 - r0, out = new Uint16Array(W * H).fill(fill);
  const a0 = Math.max(0, c0), b0 = Math.max(0, r0), a1 = Math.min(g.w, c1), b1 = Math.min(g.h, r1);
  if (a1 <= a0 || b1 <= b0) return out;
  const ras = await img.readRasters({ window: [a0, b0, a1, b1], samples: [0] });
  const src = ras[0], sw = a1 - a0;
  for (let r = b0; r < b1; r++) {
    const so = (r - b0) * sw, doff = (r - r0) * W + (a0 - c0);
    for (let c = 0; c < sw; c++) out[doff + c] = src[so + c];
  }
  return out;
}

// Verifica nuvem/sombra e ausência de dado dentro dos talhões usando a máscara da cena
async function checkCandidate(cand, sensor, geo) {
  const s = SENSORS[sensor];
  const img = await openCog(cand.item, s.maskAsset, sensor);
  const g = gridOf(img), epsg = epsgOf(img, cand.item);
  const polys = projectPolys(geo.polygons, epsg);
  const [minx, miny, maxx, maxy] = boundsOf(polys);
  const c0 = Math.floor((minx - g.ox) / g.rx) - 1, c1 = Math.ceil((maxx - g.ox) / g.rx) + 1;
  const r0 = Math.floor((g.oy - maxy) / g.ry) - 1, r1 = Math.ceil((g.oy - miny) / g.ry) + 1;
  const W = c1 - c0, H = r1 - r0;
  const OUT = 65535;
  const data = await readWindow(img, g, c0, r0, c1, r1, OUT);
  const polysPx = polys.map(p => p.map(r => r.map(([x, y]) => [(x - g.ox) / g.rx - c0, (g.oy - y) / g.ry - r0])));
  const mask = rasterize(polysPx, W, H);
  let n = 0, cloud = 0, nodata = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) {
    n++;
    const v = data[i];
    const k = v === OUT ? 'nodata' : s.classify(v);
    if (k === 'cloud') cloud++; else if (k === 'nodata') nodata++;
  }
  return { n, cloudPct: 100 * cloud / n, nodataPct: 100 * nodata / n };
}

async function pool(tasks, k) {
  const res = new Array(tasks.length); let i = 0;
  await Promise.all(Array.from({ length: k }, async () => { while (i < tasks.length) { const j = i++; res[j] = await tasks[j](); } }));
  return res;
}

// Baixa todas as bandas no recorte (bbox dos talhões + buffer), alinhadas à grade da banda de referência
async function loadImage(cand, sensor, geo, bufferM, onProgress) {
  const s = SENSORS[sensor], item = cand.item;
  const ref = await openCog(item, s.refAsset, sensor);
  const g = gridOf(ref), epsg = epsgOf(ref, item), res = g.rx;
  const polys = projectPolys(geo.polygons, epsg);
  const [minx, miny, maxx, maxy] = boundsOf(polys);
  const c0 = Math.floor((minx - bufferM - g.ox) / res), c1 = Math.ceil((maxx + bufferM - g.ox) / res);
  const r0 = Math.floor((g.oy - (maxy + bufferM)) / res), r1 = Math.ceil((g.oy - (miny - bufferM)) / res);
  const W = c1 - c0, H = r1 - r0, X0 = g.ox + c0 * res, Y0 = g.oy - r0 * res;
  if (W * H * s.bands.length * 2 > 1.5e9) throw new Error('Área grande demais para montar no navegador. Reduza o buffer ou divida o GeoJSON.');
  const bands = s.bands.filter(b => item.assets[b.asset]);
  let done = 0;
  const datas = await pool(bands.map(b => async () => {
    const img = b.asset === s.refAsset ? ref : await openCog(item, b.asset, sensor);
    const bg = gridOf(img);
    const colMap = new Int32Array(W), rowMap = new Int32Array(H);
    for (let i = 0; i < W; i++) colMap[i] = Math.floor((X0 + (i + 0.5) * res - bg.ox) / bg.rx);
    for (let j = 0; j < H; j++) rowMap[j] = Math.floor((bg.oy - (Y0 - (j + 0.5) * res)) / bg.ry);
    const sc0 = colMap[0], sc1 = colMap[W - 1] + 1, sr0 = rowMap[0], sr1 = rowMap[H - 1] + 1;
    const src = await readWindow(img, bg, sc0, sr0, sc1, sr1, 0);
    const sw = sc1 - sc0, out = new Uint16Array(W * H);
    for (let j = 0; j < H; j++) {
      const so = (rowMap[j] - sr0) * sw;
      for (let i = 0; i < W; i++) out[j * W + i] = src[so + colMap[i] - sc0];
    }
    onProgress && onProgress(++done, bands.length, b.name);
    return out;
  }), 4);
  const polysPx = polys.map(p => p.map(r => r.map(([x, y]) => [(x - X0) / res, (Y0 - y) / res])));
  return {
    W, H, X0, Y0, res, epsg, polysPx,
    bands: bands.map((b, i) => ({ ...b, ...s.scaleFor(item, b), data: datas[i] })),
  };
}

// ---------- escrita do GeoTIFF (uint16, bandas separadas, sem compressão) ----------
function xmlEsc(t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function buildGeoTIFF(img, meta) {
  const { W, H, X0, Y0, res, epsg, bands } = img, n = bands.length;
  let xml = '<GDALMetadata>\n';
  for (const [k, v] of Object.entries(meta)) xml += `  <Item name="${xmlEsc(k)}">${xmlEsc(v)}</Item>\n`;
  bands.forEach((b, i) => {
    xml += `  <Item name="DESCRIPTION" sample="${i}" role="description">${xmlEsc(b.name)}</Item>\n`;
    xml += `  <Item name="BAND_CODE" sample="${i}">${xmlEsc(b.code)}</Item>\n`;
    xml += `  <Item name="PHYSICAL_SCALE" sample="${i}">${b.scale}</Item>\n`;
    xml += `  <Item name="PHYSICAL_OFFSET" sample="${i}">${b.offset}</Item>\n`;
    if (b.unit) xml += `  <Item name="PHYSICAL_UNIT" sample="${i}">${b.unit}</Item>\n`;
  });
  xml += '</GDALMetadata>\0';
  const geoKeys = [1, 1, 0, 4, 1024, 0, 1, 1, 1025, 0, 1, 1, 3072, 0, 1, epsg, 3076, 0, 1, 9001];
  const isGeographic = epsg === 4326 || epsg === 4674;
  if (isGeographic) geoKeys.splice(4, 16, 1024, 0, 1, 2, 1025, 0, 1, 1, 2048, 0, 1, epsg, 2054, 0, 1, 9102);
  const enc = new TextEncoder();
  // tag: [id, type, values]; type 3 SHORT, 4 LONG, 12 DOUBLE, 2 ASCII
  const SIZE = { 2: 1, 3: 2, 4: 4, 12: 8 };
  const planeBytes = W * H * 2;
  const tags = [
    [256, 4, [W]], [257, 4, [H]], [258, 3, Array(n).fill(16)], [259, 3, [1]], [262, 3, [1]],
    [273, 4, Array(n).fill(0)], [277, 3, [n]], [278, 4, [H]], [279, 4, Array(n).fill(planeBytes)],
    [284, 3, [2]],
    ...(n > 1 ? [[338, 3, Array(n - 1).fill(0)]] : []),
    [339, 3, Array(n).fill(1)],
    [33550, 12, [res, res, 0]], [33922, 12, [0, 0, 0, X0, Y0, 0]],
    [34735, 3, geoKeys],
    [42112, 2, enc.encode(xml)], [42113, 2, enc.encode('0\0')],
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
  const buf = new ArrayBuffer(total), dv = new DataView(buf), u8 = new Uint8Array(buf);
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
  bands.forEach((b, i) => {
    const plane = new Uint16Array(buf, stripOffsets[i], W * H);
    plane.set(b.data);
  });
  return buf;
}

// ---------- realce para visualização ----------
function percentiles(data, lo, hi) {
  const step = Math.max(1, Math.floor(data.length / 200000)), s = [];
  for (let i = 0; i < data.length; i += step) if (data[i]) s.push(data[i]);
  if (!s.length) return [0, 1];
  s.sort((a, b) => a - b);
  const q = p => s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))];
  const a = q(lo), b = q(hi);
  return [a, b > a ? b : a + 1];
}

// ---------- zip ----------
function zipFile(name, buf) {
  return new Promise((resolve, reject) =>
    fflate.zip({ [name]: [new Uint8Array(buf), { level: 6 }] }, (err, out) => err ? reject(err) : resolve(out)));
}

globalThis.Core = { SENSORS, readVectorFiles, zipFile, parseGeoJSON, stacSearch, orderCandidates, checkCandidate, loadImage, buildGeoTIFF, percentiles, addDays, isoDay };
