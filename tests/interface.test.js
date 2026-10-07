// Checagens estáticas da página: ids usados no app.js existem, arquivos referenciados existem,
// versões das libs da CDN são as mesmas testadas aqui, e caminhos são relativos (GitHub Pages).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ROOT } = require('./helpers/core');

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'css', 'style.css'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

test('todo id usado em app.js existe no index.html', () => {
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
  const used = new Set([...app.matchAll(/\$\('([^']+)'\)/g)].map(m => m[1]));
  const missing = [...used].filter(id => !ids.has(id));
  assert.deepEqual(missing, []);
});

test('ids não se repetem no index.html', () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(ids.filter((id, i) => ids.indexOf(id) !== i), []);
});

test('arquivos locais referenciados existem e usam caminho relativo', () => {
  const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(m => m[1]).filter(u => !/^(https?:|mailto:|#)/.test(u));
  assert.ok(refs.length >= 4);
  for (const r of refs) {
    assert.ok(!r.startsWith('/'), `${r} deve ser relativo (GitHub Pages serve em /<repo>/)`);
    assert.ok(fs.existsSync(path.join(ROOT, r)), `${r} não existe`);
  }
});

test('core.js é carregado antes de app.js, e as libs antes dos dois', () => {
  const order = [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);
  const i = n => order.findIndex(s => s.includes(n));
  for (const lib of ['geotiff', 'proj4', 'shpjs', 'fflate']) assert.ok(i(lib) >= 0 && i(lib) < i('js/core.js'), lib);
  assert.ok(i('js/core.js') < i('js/app.js'));
});

test('versões das libs da CDN = versões testadas (package.json)', () => {
  const cdn = {
    geotiff: html.match(/geotiff@([\d.]+)/)?.[1],
    proj4: html.match(/proj4js\/([\d.]+)\//)?.[1],
    shpjs: html.match(/shpjs@([\d.]+)/)?.[1],
    fflate: html.match(/fflate@([\d.]+)/)?.[1],
  };
  for (const [lib, v] of Object.entries(cdn)) assert.equal(v, pkg.devDependencies[lib], lib);
});

test('card de preview (Open Graph) aponta para imagem existente', () => {
  const og = html.match(/property="og:image" content="([^"]+)"/)?.[1];
  assert.ok(og && og.startsWith('https://'), 'og:image precisa de URL absoluta');
  assert.ok(fs.existsSync(path.join(ROOT, path.basename(og))));
});

test('layout cabe na tela: formulário limitado à altura da janela e lista de satélites rolável', () => {
  const rule = sel => (css.match(new RegExp('^' + sel.replace(/[.]/g, '\\.') + String.raw` \{([^}]*)\}`, 'm')) || [])[1] || '';
  assert.match(rule('.form'), /max-height:\s*calc\(100vh/);
  assert.match(rule('.sensor-list'), /overflow-y:\s*auto/);
  assert.match(css, /\.form > \.sensor-field \{[^}]*flex-shrink:\s*1/);
  assert.match(html, /class="field sensor-field"[\s\S]*id="sensorOther"/);
  assert.match(app, /maxH = previewMaxHeight\(\)/, 'prévia dimensionada para não rolar a página');
});
