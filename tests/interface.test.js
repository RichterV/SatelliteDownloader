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

test('tela vazia: animação em loop (só CSS) que some quando a imagem aparece', () => {
  const empty = html.match(/<div class="card empty" id="emptyState">([\s\S]*?)<\/div>\s*\n\s*<div class="card hidden" id="resultPanel">/);
  assert.ok(empty, 'cartão da tela vazia antes do resultado');
  assert.match(empty[1], /<svg class="sd-anim"[^>]*role="img"[^>]*aria-label=/, 'SVG acessível');
  assert.match(empty[1], /Carregue a área e busque uma imagem\./, 'frase mantida');
  for (const cls of ['sd-sat-bob', 'sd-packet', 'sd-pc', 'sd-world', 'sd-map', 'sd-river', 'sd-road', 'sd-lake', 'sd-up'])
    assert.ok(empty[1].includes(`class="${cls}`), cls);
  assert.ok((empty[1].match(/class="sd-stand"/g) || []).length >= 4, 'talhões no mapa');
  assert.match(empty[1], /<g class="sd-packet">[\s\S]*?<text[^>]*>011101<\/text>/, 'pacote mostra 011101');
  // zoom enquadra o monitor inteiro (140 x 92) dentro da vista 400 x 260
  const z = +css.match(/46%, 74% \{ transform: translate\([^)]*\) scale\(([\d.]+)\)/)[1];
  assert.ok(140 * z <= 400 && 92 * z <= 260, `monitor cabe no zoom (scale ${z})`);
  assert.match(css, /--sd-t: 10s/, 'loop de ~10 s');
  for (const k of ['sd-drop', 'sd-zoom', 'sd-map', 'sd-up']) {
    assert.match(css, new RegExp(`@keyframes ${k} \\{`), k);
    assert.match(css, new RegExp(`animation: ${k} var\\(--sd-t\\)[^;]*infinite`), `${k} em loop`);
  }
  assert.match(css, /prefers-reduced-motion: reduce[\s\S]*?\.sd-anim \* \{ animation: none !important; \}/, 'respeita redução de movimento');
  assert.match(css, /\.sd-anim \{[^}]*overflow: hidden/, 'zoom recortado na área do desenho');
  assert.match(app, /\$\('emptyState'\)\.classList\.toggle\('hidden', show\)/, 'some quando a prévia aparece');
});
