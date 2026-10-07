// Teste de ponta a ponta COM REDE (fora do `npm test`): `npm run test:rede [sensor]`.
// Para cada sensor: busca no STAC real, verifica nuvem, monta o recorte e gera o .tif em <tmp>/satellite-downloader-rede.
// Use quando suspeitar que um catálogo mudou (assets, tokens, formato). Pode levar alguns minutos.
const fs = require('fs'), os = require('os'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..', '..');
globalThis.proj4 = require('proj4'); globalThis.shp = require('shpjs'); globalThis.fflate = require('fflate'); globalThis.GeoTIFF = require('geotiff');
vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'js', 'core.js'), 'utf8'), { filename: 'js/core.js' });

const geo = Core.parseGeoJSON(JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'talhoes.geojson'), 'utf8')));
// data de referência por sensor (Landsat 4/5/7 só tem cenas até ~2022)
const DAY = { landsat457: '2005-08-01' };
const OUT = path.join(os.tmpdir(), 'satellite-downloader-rede');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  let falhas = 0;
  for (const sensor of Object.keys(Core.SENSORS)) {
    if (process.argv[2] && process.argv[2] !== sensor) continue;
    const day = DAY[sensor] || '2025-08-01', t0 = Date.now();
    try {
      const [a, b] = Core.searchRange(sensor, day, 60);
      const cands = Core.orderCandidates(await Core.stacSearch(sensor, geo.bboxLL, a, b), sensor, day, geo);
      let ok = null;
      for (const c of cands.slice(0, 10)) {
        if ((c.sceneCloud ?? 0) >= 99) continue;
        const r = await Core.checkCandidate(c, sensor, geo);
        if (r.nodataPct === 0 && r.cloudPct === 0) { ok = c; break; }
      }
      if (!ok) throw new Error(`nenhuma cena limpa entre ${cands.length} candidatas`);
      const img = await Core.loadImage(ok, sensor, geo, 300);
      const vazias = img.bands.filter(bd => bd.data.every(v => v === img.nodata || Number.isNaN(v))).map(bd => bd.name);
      if (vazias.length) throw new Error('bandas sem dado: ' + vazias.join(', '));
      const file = path.join(OUT, sensor + '.tif');
      fs.writeFileSync(file, Buffer.from(Core.buildGeoTIFF(img, { ITEM_ID: ok.item.id })));
      console.log(`ok    ${sensor.padEnd(11)} ${ok.day} ${ok.satellite.padEnd(16)} ${img.W}x${img.H} ${img.bands.length} bandas ${img.dtype} ${Core.crsLabel(img.epsg)} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    } catch (e) { falhas++; console.log(`FALHA ${sensor.padEnd(11)} ${e.message}`); }
  }
  console.log(`\n.tif gerados em ${OUT}`);
  process.exit(falhas ? 1 : 0);
})();
