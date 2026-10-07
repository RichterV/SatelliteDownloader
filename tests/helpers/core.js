// Carrega js/core.js no Node com as mesmas bibliotecas que o index.html puxa da CDN
// (versões fixadas no package.json). Expõe Core e utilitários para os testes.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const FIX = path.join(ROOT, 'tests', 'fixtures');

const GeoTIFFLib = require('geotiff');
globalThis.proj4 = require('proj4');
globalThis.shp = require('shpjs');
globalThis.fflate = require('fflate');

// COGs "em memória": hrefs mem://... são servidos a partir deste mapa, sem rede.
const memCogs = new Map();
const requested = [];
globalThis.GeoTIFF = {
  fromUrl: async href => {
    requested.push(href);
    const key = href.split('?')[0];
    if (!memCogs.has(key)) throw new Error('COG de teste não registrado: ' + key);
    return GeoTIFFLib.fromArrayBuffer(memCogs.get(key));
  },
};

vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'js', 'core.js'), 'utf8'), { filename: 'js/core.js' });
const Core = globalThis.Core;

// Simula um File do navegador a partir de um arquivo de fixtures
function fixtureFile(name) {
  return new File([fs.readFileSync(path.join(FIX, name))], name);
}

// Registra um raster sintético de 1 banda como COG em memória.
// dtype segue o tipo de `data` (Uint16Array, Int16Array ou Float32Array); epsg pode ser Core.MODIS_SINU.
function registerCog(href, { W, H, X0, Y0, res, resY, epsg, data, nodata = 0 }) {
  const dtype = data instanceof Float32Array ? 'float32' : data instanceof Int16Array ? 'int16' : 'uint16';
  const buf = Core.buildGeoTIFF({ W, H, X0, Y0, res, resY, epsg, dtype, nodata, bands: [{ name: 'b', code: 'b', scale: 1, offset: 0, data }] }, {});
  memCogs.set(href, buf);
}

// Substitui fetch durante um teste; devolve as requisições feitas
function mockFetch(handler) {
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, opt = {}) => {
    calls.push({ url, opt, body: opt.body ? JSON.parse(opt.body) : null });
    const r = await handler(url, opt, calls.length - 1);
    return { ok: (r.status || 200) < 400, status: r.status || 200, json: async () => r.json, text: async () => JSON.stringify(r.json) };
  };
  return { calls, restore: () => { globalThis.fetch = orig; } };
}

module.exports = { Core, GeoTIFFLib, ROOT, FIX, fixtureFile, registerCog, memCogs, requested, mockFetch };
