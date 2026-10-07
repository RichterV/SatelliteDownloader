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

test('tela vazia: sem linha de órbita; satélite segue a órbita para a direita e some atrás da Terra', () => {
  assert.doesNotMatch(html, /class="sd-orbit"/, 'linha tracejada removida');
  const rows = k => [...css.match(new RegExp(`@keyframes ${k} \\{([\\s\\S]*?)\\n\\}`))[1]
    .matchAll(/([\d.]+)%[^{]*\{ transform: translate\((-?[\d.]+)px, (-?[\d.]+)px\) scale\(([\d.]+)\); opacity: ([\d.]+)/g)]
    .map(m => ({ p: +m[1], x: 95 + +m[2], y: 60 + +m[3], s: +m[4], o: +m[5] }));
  const front = rows('sd-orbit-front'), back = rows('sd-orbit-back');
  const lastFront = front.filter(r => r.o === 1).at(-1);
  const backAgain = back.filter(r => r.o === 1 && r.p > 50);
  assert.ok(backAgain.length >= 3, 'no fim do ciclo volta a cópia de trás');
  // troca no mesmo lugar, com o satélite inteiro fora do disco, à direita
  assert.ok(Math.abs(backAgain[0].x - lastFront.x) < 1 && Math.abs(backAgain[0].y - lastFront.y) < 1, 'troca sem salto');
  const edge = y => 200 + Math.sqrt(128 ** 2 - (y - 130) ** 2);
  for (const dy of [-25, 0, 25]) assert.ok(lastFront.x - 70 * lastFront.s > edge(lastFront.y + dy), 'troca fora do disco');
  assert.ok(lastFront.x > 300, 'sai pela direita');
  // termina escondido atrás do globo
  const end = backAgain.at(-1);
  assert.ok(Math.hypot(end.x - 200, end.y - 130) + 70 * end.s < 128 + 15, 'termina atrás da Terra');
});

test('tela vazia: computador mostra a plataforma Treevia até o pacote chegar; depois o mapa', () => {
  const svg = html.match(/<svg class="sd-anim"[\s\S]*?<\/svg>/)[0];
  const ui = svg.match(/<g class="sd-ui"[^>]*>([\s\S]*?)\n {10}<\/g>/)[1];
  for (const cls of ['sd-ui-top', 'sd-ui-btn', 'sd-ui-search', 'sd-ui-farm', 'sd-ui-ocean', 'sd-ui-pin', 'sd-ui-cluster'])
    assert.ok(ui.includes(`class="${cls}"`), cls);
  assert.equal((ui.match(/class="sd-ui-num"/g) || []).length, 6 + 3, '6 indicadores + 3 fazendas');
  assert.match(ui, /href="logo\.png"/, 'logo no menu');
  assert.match(svg, /<g class="sd-ui" clip-path="url\(#sd-screen-clip\)">/, 'recortada nos cantos arredondados da tela');
  const uiHide = +css.match(/@keyframes sd-ui \{[^}]*\}\s*([\d.]+)%/)[1];
  const hit = +css.match(/@keyframes sd-flash \{[^}]*\}\s*([\d.]+)%/)[1];
  assert.ok(Math.abs(uiHide - hit) < 1.5, `tela da plataforma some quando o pacote bate (${uiHide}% x ${hit}%)`);
});

test('tela vazia: logo da Treevia só na tela verde-escura (ao receber o pacote e enquanto o dado volta), nunca sobre o mapa', () => {
  const svg = html.match(/<svg class="sd-anim"[\s\S]*?<\/svg>/)[0];
  const map = svg.match(/<g class="sd-map"[\s\S]*?<rect class="sd-scan"/)[0];
  assert.doesNotMatch(map, /logo\.png|sd-splash/, 'sem logo no mapa');
  assert.match(svg, /<g class="sd-idle-logo">[\s\S]*?href="logo\.png"/, 'logo na tela verde-escura');
  // janelas em que o logo está visível (opacity > 0) a partir das keyframes
  const kf = name => {
    // corpo do bloco contando chaves (há @keyframes de uma linha e de várias)
    let i = css.indexOf('@keyframes ' + name + ' {') + ('@keyframes ' + name + ' {').length, d = 1, j = i;
    while (d) { if (css[j] === '{') d++; else if (css[j] === '}') d--; j++; }
    const body = css.slice(i, j - 1);
    return [...body.matchAll(/([\d.%,\s]+)\{[^}]*?opacity: ([\d.]+)/g)]
      .flatMap(m => m[1].split(',').map(t => [parseFloat(t), +m[2]])).filter(([p]) => !isNaN(p)).sort((a, b) => a[0] - b[0]);
  };
  const at = (frames, t) => { // interpolação linear da opacidade
    for (let k = 1; k < frames.length; k++) if (t <= frames[k][0]) {
      const [p0, o0] = frames[k - 1], [p1, o1] = frames[k];
      return p1 === p0 ? o1 : o0 + (o1 - o0) * (t - p0) / (p1 - p0);
    }
    return frames.at(-1)[1];
  };
  const logo = kf('sd-idle-logo'), mapOp = kf('sd-map'), ui = kf('sd-ui');
  let seen = 0;
  for (let t = 0; t <= 100; t += 0.1) {
    const l = at(logo, t);
    if (l > 0.02) {
      seen++;
      assert.ok(at(mapOp, t) < 0.02, `logo junto do mapa em ${t.toFixed(1)}%`);
      assert.ok(at(ui, t) < 0.02, `logo junto da tela da plataforma em ${t.toFixed(1)}%`);
    }
  }
  assert.ok(seen > 100, 'logo aparece nas duas telas verdes');
  // aparece ao receber o pacote (antes do mapa) e na volta (depois do mapa)
  assert.ok(at(logo, 43) > 0.9 && at(logo, 85) > 0.9, 'logo nas duas telas verdes');
  // pin assenta antes de o mapa começar a sumir
  const pinRest = +css.match(/@keyframes sd-pin \{[\s\S]*?\n {2}([\d.]+)%, 92\.31%, 100%/)[1];
  assert.ok(pinRest < 73.85, `pin assenta (${pinRest}%) antes de o mapa sumir`);
});

test('tela vazia: mapa florestal com texturas por idade e elementos animados do setor', () => {
  const svg = html.match(/<svg class="sd-anim"[\s\S]*?<\/svg>/)[0];
  const map = svg.match(/<g class="sd-map"[\s\S]*?<rect class="sd-scan"/)[0];
  for (const cls of ['sd-mature', 'sd-young', 'sd-sprouts', 'sd-harvested', 'sd-nursery', 'sd-native', 'sd-aceiro'])
    assert.ok(map.includes(`class="${cls}"`), `textura/área ${cls}`);
  for (const id of ['sd-canopy', 'sd-sprouts', 'sd-forest-tex', 'sd-beds']) assert.match(svg, new RegExp(`<pattern id="${id}"`), id);
  // elementos animados ligados ao setor florestal
  const anim = { 'sd-truck': 'sd-truck', 'sd-harvester': 'sd-harvest', 'sd-drone': 'sd-drone', 'sd-ping': 'sd-ping',
    'sd-seedling': 'sd-grow', 'sd-sway': 'sd-sway', 'sd-birds': 'sd-birds', 'sd-tower-light': 'sd-blink' };
  for (const [cls, k] of Object.entries(anim)) {
    assert.ok(map.includes(`class="${cls}`) || map.includes(`sd-pop ${cls}`), `elemento ${cls}`);
    assert.match(css, new RegExp(`\\.${cls} \\{[^}]*animation: ${k} [^;]*infinite`), `${cls} animado em loop`);
  }
  assert.ok((map.match(/class="sd-sensor"/g) || []).length >= 3, 'sensores Treevia nas árvores');
  // caminhão: ângulo contínuo (sem dar meia-volta entre quadros)
  const ang = [...css.match(/@keyframes sd-truck \{([\s\S]*?)\n\}/)[1].matchAll(/rotate\((-?[\d.]+)deg\)/g)].map(m => +m[1]);
  for (let i = 1; i < ang.length; i++) assert.ok(Math.abs(ang[i] - ang[i - 1]) < 45, `caminhão gira ${ang[i - 1]} -> ${ang[i]}`);
});
