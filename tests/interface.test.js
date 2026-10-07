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
  // zoom enquadra o monitor inteiro (140 x 100, com o queixo do logo) dentro da vista 400 x 260
  const z = +css.match(/@keyframes sd-zoom \{[\s\S]*?translate\([^)]*\) scale\(([\d.]+)\)/)[1];
  assert.ok(140 * z <= 400 && 100 * z <= 260, `monitor cabe no zoom (scale ${z})`);
  assert.match(empty[1], /<image class="sd-logo" href="logo\.png"/, 'logo da Treevia no computador');
  assert.match(css, /--sd-t: 13s/, 'loop de 13 s (2 s de entrada orbitando + 10 s da história + 1 s de saída)');
  for (const k of ['sd-drop', 'sd-zoom', 'sd-map', 'sd-up']) {
    assert.match(css, new RegExp(`@keyframes ${k} \\{`), k);
    assert.match(css, new RegExp(`animation: ${k} var\\(--sd-t\\)[^;]*infinite`), `${k} em loop`);
  }
  assert.match(css, /prefers-reduced-motion: reduce[\s\S]*?\.sd-anim \* \{ animation: none !important; \}/, 'respeita redução de movimento');
  assert.match(css, /\.sd-anim \{[^}]*overflow: hidden/, 'zoom recortado na área do desenho');
  assert.match(app, /\$\('emptyState'\)\.classList\.toggle\('hidden', show\)/, 'some quando a prévia aparece');
});

test('tela vazia: pacote e mini-mapa se movem sem trancos (trajetória contínua, sem easing por trecho)', () => {
  for (const [k, cls] of [['sd-drop', 'sd-packet'], ['sd-up', 'sd-up']]) {
    // easing por trecho (ease-in-out) faz o objeto parar em cada ponto: precisa ser linear
    assert.match(css, new RegExp(`\\.${cls} \\{[^}]*animation: ${k} var\\(--sd-t\\) linear infinite`), `${k} linear`);
    const body = css.match(new RegExp(`@keyframes ${k} \\{([\\s\\S]*?)\\n\\}`))[1];
    const pts = [...body.matchAll(/translate\(([\d.]+)px, ([\d.]+)px\)[^;]*scale\(([\d.]+)[,)][^}]*opacity: 1/g)].map(m => [+m[1], +m[2]]);
    assert.ok(pts.length >= 10, `${k}: trajetória com pontos suficientes (${pts.length})`);
    const steps = pts.slice(1).map((q, i) => Math.hypot(q[0] - pts[i][0], q[1] - pts[i][1]));
    // no miolo do trajeto, um passo não pode ser muito menor que os vizinhos (seria um "pulo")
    for (let i = 2; i < steps.length - 2; i++)
      assert.ok(steps[i] > 0.4 * Math.min(steps[i - 1], steps[i + 1]), `${k}: tranco no passo ${i}`);
  }
});

test('tela vazia: satélite com um olho que olha para a Terra e globo com continentes', () => {
  const svg = html.match(/<svg class="sd-anim"[\s\S]*?<\/svg>/)[0];
  assert.match(svg, /class="sd-eye"/, 'olho');
  assert.match(svg, /<g class="sd-pupil">/, 'pupila que se move');
  assert.doesNotMatch(svg, /M89 64q6 5 12 0/, 'sem o sorriso antigo');
  assert.match(css, /\.sd-pupil \{[^}]*animation: sd-look [^;]*infinite/, 'olho varre de um lado para o outro');
  assert.match(css, /@keyframes sd-look \{/);
  assert.match(svg, /<clipPath id="sd-globe-clip">/, 'continentes recortados no globo');
  assert.ok((svg.match(/class="sd-continent"/g) || []).length >= 5, 'continentes desenhados');
  assert.match(svg, /América do Sul/);
  assert.match(css, /\.sd-ocean \{ fill: var\(--sd-ocean\)/, 'oceano com cor por tema');
  assert.match(css, /:root\[data-theme="dark"\] \.sd-anim \{[^}]*--sd-ocean/, 'versão escura do globo');
});

test('tela vazia: satélite entra orbitando por trás da Terra antes de enviar o pacote', () => {
  const svg = html.match(/<svg class="sd-anim"[\s\S]*?<\/svg>/)[0];
  // cópia de trás desenhada ANTES do globo (fica escondida por ele); cópia da frente depois
  const iBack = svg.indexOf('class="sd-orbit-back"'), iGlobe = svg.indexOf('class="sd-globe"'), iFront = svg.indexOf('class="sd-orbit-front"');
  assert.ok(iBack > 0 && iBack < iGlobe && iGlobe < iFront, 'ordem: satélite atrás, globo, satélite na frente');
  const pct = k => [...css.match(new RegExp(`@keyframes ${k} \\{([\\s\\S]*?)\\n\\}`))[1].matchAll(/([\d.]+)%[^{]*\{([^}]*)\}/g)].map(m => [+m[1], m[2]]);
  const back = pct('sd-orbit-back'), front = pct('sd-orbit-front');
  const swapBack = back.find(([, b]) => /opacity: 0/.test(b))[0];
  const showFront = front.find(([, b]) => /opacity: 1/.test(b))[0];
  assert.ok(Math.abs(showFront - swapBack) < 0.05, 'troca de cópias no mesmo instante');
  assert.ok(back.filter(([p]) => p < swapBack).every(([, b]) => /opacity: 1/.test(b)), 'cópia de trás opaca até a troca');
  // o pacote só sai depois que o satélite chegou à posição de envio
  const arrive = front.find(([, b]) => /translate\(0px, 0px\) scale\(1\)/.test(b))[0];
  const firstDrop = pct('sd-drop').find(([, b]) => /opacity: 1/.test(b))[0];
  assert.ok(firstDrop > arrive, `pacote (${firstDrop}%) depois da chegada (${arrive}%)`);
});

test('tela vazia: sem linha de órbita e o satélite sai pela esquerda (continua a órbita)', () => {
  assert.doesNotMatch(html, /class="sd-orbit"/, 'linha tracejada removida');
  const body = css.match(/@keyframes sd-orbit-front \{([\s\S]*?)\n\}/)[1];
  const last = [...body.matchAll(/translate\((-?[\d.]+)px, (-?[\d.]+)px\)[^;]*scale\(([\d.]+)\); opacity: 1/g)].at(-1);
  const x = 95 + +last[1], half = 70 * +last[3]; // centro do satélite e meia largura (painéis)
  assert.ok(x + half < 0, `sai inteiro pela esquerda antes de sumir (borda direita em ${x + half})`);
  assert.ok(Math.abs(+last[2]) < 60, 'sai pela lateral, não pelo alto');
});
