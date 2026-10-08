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

test('header mostra o logo da Treevia ao lado do nome do app', () => {
  const brand = html.match(/<div class="brand">([\s\S]*?)<\/div>/)[1];
  assert.match(brand, /<img class="brand-logo" src="logo\.png" alt="Treevia"/, 'logo com texto alternativo');
  assert.match(brand, /<span>Satellite Downloader<\/span>/);
  assert.doesNotMatch(brand, /<svg/, 'sem o ícone genérico antigo');
  assert.match(css, /\.brand-logo \{[^}]*height: 28px/);
});

test('menu começa com uma apresentação curta: para que serve e três passos de uso', () => {
  const form = html.match(/<aside class="card form">([\s\S]*?)<\/aside>/)[1];
  assert.match(form, /^\s*<div class="intro">/, 'primeiro item do menu');
  const intro = form.match(/<div class="intro">([\s\S]*?)<\/div>/)[1];
  assert.match(intro, /<p>[^<]*sem nuvem[^<]*talhões[^<]*<\/p>/, 'diz para que serve');
  assert.equal((intro.match(/<li>/g) || []).length, 3, 'três passos');
  assert.ok(intro.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().length < 320, 'curta');
  assert.match(css, /\.intro \{[^}]*font-size: \.82rem/);
  // só aparece quando sobra altura; em janelas baixas o menu também fica mais compacto
  assert.match(css, /@media \(max-height: \d+px\) \{ \.intro \{ display: none; \} \.form \{ gap: \d+px; \}/, 'some em janelas baixas');
  // o grupo do satélite só encolhe com a lista de Outros aberta (senão o texto dele invadia a data)
  assert.match(css, /\.form > \.sensor-field:has\(\.sensor-list:not\(\.hidden\)\) \{ flex-shrink: 1; min-height: 0; \}/);
  assert.doesNotMatch(css, /^\.form > \.sensor-field \{/m, 'sem a regra que encolhia o grupo sempre');
});

test('layout cabe na tela: formulário limitado à altura da janela e lista de satélites rolável', () => {
  const rule = sel => (css.match(new RegExp('^' + sel.replace(/[.]/g, '\\.') + String.raw` \{([^}]*)\}`, 'm')) || [])[1] || '';
  assert.match(rule('.form'), /max-height:\s*calc\(100vh/);
  // campos distribuídos na altura do menu; botão de busca (com o status) ancorado na base
  assert.match(rule('.form'), /justify-content: space-between/);
  assert.match(css, /\.area-field \{ flex: 1 0 auto; max-height: \d+px; \}/, 'área de soltar cresce, com limite');
  assert.match(html, /<div class="field area-field">\s*<span class="label">Área<\/span>/);
  assert.match(html, /<div class="form-actions">\s*<button id="btnSearch"[^>]*>Buscar imagem<\/button>\s*<div id="status" class="status"><\/div>\s*<\/div>\s*<\/aside>/);
  // menu lateral estica até a altura da área da direita (animação ou prévia)
  assert.match(css, /\.layout \{[^}]*align-items: stretch/);
  assert.doesNotMatch(css.match(/\.layout \{[^}]*\}/)[0], /align-items: start/);
  assert.match(rule('.sensor-list'), /overflow-y:\s*auto/);
  assert.match(css, /\.form > \.sensor-field:has\(\.sensor-list:not\(\.hidden\)\) \{[^}]*flex-shrink:\s*1/, 'lista de Outros encolhe e rola por dentro');
  assert.match(html, /class="field sensor-field"[\s\S]*id="sensorOther"/);
  assert.match(app, /maxH = previewMaxHeight\(\)/, 'prévia dimensionada para não rolar a página');
});

test('tela vazia: animação em loop (só CSS) que some quando a imagem aparece', () => {
  const empty = html.match(/<div class="card empty" id="emptyState">([\s\S]*?)<\/div>\s*\n\s*<div class="card hidden" id="resultPanel">/);
  assert.ok(empty, 'cartão da tela vazia antes do resultado');
  assert.match(empty[1], /<svg class="sd-anim"[^>]*role="img"[^>]*aria-label=/, 'SVG acessível');
  assert.match(empty[1], /Carregue a área e busque uma imagem\./, 'frase mantida');
  for (const cls of ['sd-sat-bob', 'sd-packet', 'sd-pc', 'sd-world', 'sd-calc', 'sd-up'])
    assert.ok(empty[1].includes(`class="${cls}`), cls);
  assert.match(empty[1], /<g class="sd-packet">[\s\S]*?<text[^>]*>011101<\/text>/, 'pacote mostra 011101');
  // zoom enquadra o monitor inteiro (140 x 100, com o queixo do logo) dentro da vista 400 x 260
  const z = +css.match(/@keyframes sd-zoom \{[\s\S]*?translate\([^)]*\) scale\(([\d.]+)\)/)[1];
  assert.ok(140 * z <= 400 && 100 * z <= 260, `monitor cabe no zoom (scale ${z})`);
  assert.match(empty[1], /<image class="sd-logo" href="logo\.png"/, 'logo da Treevia no computador');
  assert.match(css, /--sd-t: 13s/, 'loop de 13 s (2 s de entrada orbitando + 10 s da história + 1 s de saída)');
  for (const k of ['sd-drop', 'sd-zoom', 'sd-calc-show', 'sd-up']) {
    assert.match(css, new RegExp(`@keyframes ${k} \\{`), k);
    assert.match(css, new RegExp(`animation: ${k} var\\(--sd-t\\)[^;]*infinite`), `${k} em loop`);
  }
  assert.match(css, /prefers-reduced-motion: reduce[\s\S]*?\.sd-anim \* \{ animation: none !important; \}/, 'respeita redução de movimento');
  assert.match(css, /\.sd-anim \{[^}]*overflow: hidden/, 'zoom recortado na área do desenho');
  assert.match(app, /\$\('emptyState'\)\.classList\.toggle\('hidden', show\)/, 'some quando a prévia aparece');
});

test('tela vazia: pacote e mini-gráfico se movem sem trancos (trajetória contínua, sem easing por trecho)', () => {
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
  assert.match(css, /\.sd-pupil \{[^}]*animation: sd-gaze var\(--sd-t\)[^;]*infinite/, 'olhar segue a história do ciclo');
  assert.match(css, /@keyframes sd-gaze \{/);
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

test('tela vazia: computador mostra a plataforma Treevia até o pacote chegar; depois os cálculos', () => {
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

test('tela vazia: logo da Treevia só na tela verde-escura (ao receber o pacote e enquanto o dado volta), nunca sobre os cálculos', () => {
  const svg = html.match(/<svg class="sd-anim"[\s\S]*?<\/svg>/)[0];
  const calc = svg.match(/<g class="sd-calc" [\s\S]*?\n {10}<\/g>/)[0];
  assert.doesNotMatch(calc, /logo\.png|sd-splash/, 'sem logo nos cálculos');
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
  const logo = kf('sd-idle-logo'), calcOp = kf('sd-calc-show'), ui = kf('sd-ui');
  let seen = 0;
  for (let t = 0; t <= 100; t += 0.1) {
    const l = at(logo, t);
    if (l > 0.02) {
      seen++;
      assert.ok(at(calcOp, t) < 0.02, `logo junto dos cálculos em ${t.toFixed(1)}%`);
      assert.ok(at(ui, t) < 0.02, `logo junto da tela da plataforma em ${t.toFixed(1)}%`);
    }
  }
  assert.ok(seen > 100, 'logo aparece nas duas telas verdes');
  // aparece ao receber o pacote (antes dos cálculos) e na volta (depois deles)
  assert.ok(at(logo, 43) > 0.9 && at(logo, 85) > 0.9, 'logo nas duas telas verdes');
});

test('tela vazia: satélite com câmera, feixe de captura, identidade Treevia e olho expressivo', () => {
  const svg = html.match(/<svg class="sd-anim"[\s\S]*?<\/svg>/)[0];
  const front = svg.slice(svg.indexOf('class="sd-orbit-front"'));
  // câmera no lugar do prato, nas duas cópias
  assert.equal((svg.match(/class="sd-lens"/g) || []).length, 2, 'lente nas duas cópias');
  assert.doesNotMatch(svg, /sd-dish/, 'sem o prato antigo');
  // identidade: faixa verde e logo no corpo; luz da antena verde
  assert.equal((svg.match(/class="sd-band"/g) || []).length, 2);
  assert.match(css, /\.sd-blink \{ fill: #2fd27a/, 'luz verde na antena');
  // feixe só na cópia da frente; ordem: feixe -> flash -> pacote
  assert.match(front, /class="sd-beam"/);
  const first = (k, re) => { const m = css.match(re); assert.ok(m, k); return +m[1]; };
  const beamOff = first('feixe', /@keyframes sd-beam \{[^\n]*?([\d.]+)%, 100% \{ opacity: 0/);
  const flashPeak = first('flash', /@keyframes sd-cam-flash \{[^\n]*?([\d.]+)% \{ opacity: \.95/);
  const packetOn = first('pacote', /@keyframes sd-drop \{\s*0%, [\d.]+%, [\d.]+% \{[^}]*\}\s*([\d.]+)% \{[^}]*opacity: 1/);
  assert.ok(beamOff <= flashPeak + 0.5 && flashPeak < packetOn, `feixe (${beamOff}%) -> flash (${flashPeak}%) -> pacote (${packetOn}%)`);
  // olho: arregala quando o pacote sai e fecha feliz (^) ao receber o mini-gráfico
  assert.match(svg, /<g class="sd-eye-mood">[\s\S]*?<g class="sd-eye-g">/);
  assert.match(css, /@keyframes sd-mood \{[\s\S]*?scale\(1\.2\d?\)[\s\S]*?scale\(1, \.00\d\)/, 'arregala e fecha feliz (olho some, fica só o arco)');
  const happyOn = first('feliz', /@keyframes sd-happy \{[^\n]*?([\d.]+)%, [\d.]+% \{ opacity: 1/);
  const upArrive = first('chegada', /@keyframes sd-up \{[\s\S]*?\n {2}([\d.]+)% \{[^\n]*scale\(0\.35\)/);
  assert.ok(happyOn >= upArrive - 0.5, `olho feliz (${happyOn}%) quando o mini-gráfico chega (${upArrive}%)`);
});

test('tela vazia: zoom leve (cálculos só com o zoom completo) e feixe sobre a América do Sul', () => {
  const svg = html.match(/<svg class="sd-anim"[\s\S]*?<\/svg>/)[0];
  // desempenho: durante o zoom (entrada e saída) os cálculos ficam ocultos (visibility), só o monitor é ampliado
  const zoom = css.match(/@keyframes sd-zoom \{([\s\S]*?)\n\}/)[1];
  const zIn = +zoom.match(/\n {2}([\d.]+)%, [\d.]+% \{ transform: translate/)[1];
  const zOut = +zoom.match(/\n {2}[\d.]+%, ([\d.]+)% \{ transform: translate/)[1];
  const showKf = css.match(/@keyframes sd-calc-show \{([^\n]*)\}/)[1];
  const visibleFrom = +showKf.match(/([\d.]+)% \{ visibility: visible; \}/)[1];
  const hiddenFrom = +showKf.match(/([\d.]+)%, 92\.31%, 100% \{ opacity: 0; visibility: hidden; \}/)[1];
  assert.ok(visibleFrom >= zIn && hiddenFrom <= zOut, `cálculos visíveis só entre o fim do zoom (${zIn}%) e o início da saída (${zOut}%)`);
  assert.match(css, /@keyframes sd-ui \{[^\n]*visibility: hidden/, 'tela da plataforma oculta quando transparente');
  // satélite sem o logo (só a faixa verde)
  assert.doesNotMatch(svg.slice(svg.indexOf('class="sd-orbit-front"'), svg.indexOf('<!-- computador')), /logo\.png/, 'sem logo no satélite (frente)');
  assert.doesNotMatch(svg.slice(svg.indexOf('class="sd-orbit-back"'), svg.indexOf('class="sd-globe"')), /logo\.png/, 'sem logo no satélite (trás)');
  // feixe: a base fica sobre a América do Sul (caixa do continente projetado: x 125-222, y 123-245)
  const b = svg.match(/class="sd-beam" d="M[\d.]+ [\d.]+L([\d.]+) ([\d.]+)Q[\d.]+ [\d.]+ ([\d.]+) ([\d.]+)Z"/).slice(1).map(Number);
  for (const [x, y] of [[b[0], b[1]], [b[2], b[3]]]) assert.ok(x > 125 && x < 222 && y > 123 && y < 245, `feixe termina no continente (${x}, ${y})`);
});

test('app.js: valores dinâmicos em atributos title="..." passam por Core.escHtml', () => {
  const titles = [...app.matchAll(/title="\$\{([^}]*)/g)].map(m => m[1]);
  assert.ok(titles.length >= 2);
  for (const t of titles) assert.match(t, /^Core\.escHtml\(/, t);
});

test('app.js: data inicial no fuso local (Core.localDay) e busca de cenas via Core.pickCandidate', () => {
  assert.match(app, /\$\('date'\)\.value = Core\.localDay\(new Date\(\)\)/);
  assert.match(app, /Core\.pickCandidate\(/);
});

test('campo de arquivo aceita KML/KMZ e a dica cita o formato', () => {
  const accept = html.match(/id="file"[^>]*accept="([^"]+)"/)?.[1] || '';
  for (const e of ['.geojson', '.kml', '.kmz', '.zip', '.shp']) assert.ok(accept.split(',').includes(e), e);
  assert.match(html.match(/id="fileInfo">([^<]*)</)?.[1] || '', /KML\/KMZ/);
});

test('app.js: "Data" aparece também para produtos sem data (SRTM, DEM), pelo período; só a diferença some', () => {
  assert.match(app, /\['Data', Core\.sceneDate\(sensor, c\)\], \.\.\.\(s\.static \? \[\] : \[\['Diferença'/);
  assert.doesNotMatch(app, /s\.static \? \[\] : \[\['Data'/);
  assert.match(app, /<td>\$\{Core\.sceneDate\(state\.params\.sensor, c\)\}<\/td>/, 'tabela de cenas');
  assert.match(app, /ACQUISITION: Core\.sceneDate\(p\.sensor, c\)/, 'metadado no .tif');
});

// ======================= tela vazia: cena de cálculos no zoom do monitor =======================
const svgAnim = () => html.match(/<svg class="sd-anim"[\s\S]*?<\/svg>/)[0];
const calcMarkup = () => svgAnim().match(/<g class="sd-calc" [\s\S]*?\n {10}<\/g>/)[0];
// porcentagem em que uma keyframe chega ao estado final ("NN%, 100% {")
const settle = name => {
  const m = css.match(new RegExp(String.raw`@keyframes ${name} \{[^\n]*?([\d.]+)%, 100% \{`));
  assert.ok(m, `keyframe ${name} com estado final`);
  return +m[1];
};

test('tela vazia: só a cena de cálculos no zoom (o mapa florestal foi removido)', () => {
  const svg = svgAnim();
  assert.match(svg, /<g class="sd-calc" clip-path="url\(#sd-screen-clip\)">/, 'cálculos recortados na tela');
  assert.doesNotMatch(svg, /class="sd-map"|data-scene|<pattern id=/, 'sem mapa, sem troca de cena, sem texturas do mapa');
  assert.match(svg, /<g class="sd-up"><g class="sd-up-calc">/, 'cartão de volta é o mini-gráfico');
  const emptyCard = html.slice(html.indexOf('id="emptyState"'), html.indexOf('id="resultPanel"'));
  assert.equal((emptyCard.match(/<svg[\s>]/g) || []).length, 1, 'sem <svg> aninhado (o teste e a revisão de quadros extraem até o primeiro </svg>)');
  assert.match(css, /\.sd-calc \{[^}]*animation: sd-calc-show var\(--sd-t\) linear infinite/, 'oculta durante o zoom');
  assert.doesNotMatch(css, /@keyframes sd-map\b|\.sd-(map|stand|truck|harvester)\b/, 'CSS do mapa removido');
});

test('tela vazia: tudo da cena de cálculos termina de entrar antes de a tela começar a sumir', () => {
  const T = 13, fade = +css.match(/@keyframes sd-calc-show \{[^\n]*?52\.3%, ([\d.]+)% \{ opacity: 1/)[1];
  const calc = calcMarkup();
  const kfOf = { 'sd-calc-pop': 'sd-calc-pop', 'sd-calc-dot': 'sd-calc-dot', 'sd-calc-odo': 'sd-calc-odo', 'sd-calc-line sd-calc-diag': 'sd-calc-draw',
    'sd-calc-line sd-calc-trend': 'sd-calc-trend', 'sd-calc-band': 'sd-calc-fade', 'sd-calc-cover': 'sd-calc-type' };
  let n = 0;
  for (const m of calc.matchAll(/class="([^"]+)"(?: [^>]*?)?(?: style="([^"]*)")?/g)) {
    const kf = kfOf[m[1]];
    if (!kf) continue;
    n++;
    const delay = +((m[2] || '').match(/animation-delay:([\d.]+)s/) || [0, 0])[1];
    const end = settle(kf) + delay / T * 100;
    assert.ok(end < fade, `${m[1]} (atraso ${delay}s) termina em ${end.toFixed(1)}% >= ${fade}%`);
  }
  assert.ok(n >= 70, `elementos animados conferidos (${n})`);
});

test('tela vazia: sem animação (movimento reduzido) a tela de cálculos fica completa', () => {
  // estado base = estado final das keyframes
  const base = cls => css.match(new RegExp(String.raw`\.${cls} \{[^}]*?transform: ([^;]+);`))[1];
  const fin = kf => css.match(new RegExp(String.raw`@keyframes ${kf} \{[^\n]*?, 100% \{ transform: ([^;]+);`))[1];
  assert.equal(base('sd-calc-cover'), fin('sd-calc-type'), 'equação toda visível');
  assert.equal(base('sd-calc-odo'), fin('sd-calc-odo'), 'odômetro no valor final');
  for (const cls of ['sd-calc-pop', 'sd-calc-dot', 'sd-calc-band'])
    assert.doesNotMatch(css.match(new RegExp(String.raw`\.${cls} \{[^}]*\}`))[0], /transform: scale\(0\)|opacity: 0/, cls);
});

test('tela vazia: números rolam até os valores da plataforma (8.143, 2.891, 0.336)', () => {
  const step = +css.match(/@keyframes sd-calc-odo \{[^\n]*translateY\(-([\d.]+)px\)/)[1];
  const odos = [...calcMarkup().matchAll(/<g clip-path="url\(#(sd-odo-clip-\d)\)"><g class="sd-calc-odo"[^>]*>(.*?)<\/g><\/g>/g)];
  assert.equal(odos.length, 3);
  const finals = odos.map(([, clip, body]) => {
    const lines = [...body.matchAll(/<text x="[\d.]+" y="([\d.]+)">([^<]+)<\/text>/g)].map(t => [+t[1], t[2]]);
    const win = html.match(new RegExp(String.raw`<clipPath id="${clip}"><rect x="[\d.]+" y="([\d.]+)" width="[\d.]+" height="([\d.]+)"/>`));
    const [y0, h] = [+win[1], +win[2]];
    // a linha que fica dentro da janela depois de subir `step`
    const shown = lines.filter(([y]) => y - step > y0 && y - step < y0 + h);
    assert.equal(shown.length, 1, clip);
    return shown[0][1];
  });
  assert.deepEqual(finals, ['8.143', '2.891', '0.336']);
});

test('tela vazia: pontos dos gráficos dentro das áreas de plotagem e linhas crescendo a partir do início', () => {
  const calc = calcMarkup();
  const plots = [...calc.matchAll(/<rect class="sd-calc-plot" x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)].map(m => m.slice(1).map(Number));
  assert.equal(plots.length, 2);
  const dots = [...calc.matchAll(/<circle class="sd-calc-dot" cx="([\d.]+)" cy="([\d.]+)"/g)].map(m => [+m[1], +m[2]]);
  assert.ok(dots.length >= 40);
  for (const [x, y] of dots) assert.ok(plots.some(([px, py, w, h]) => x > px && x < px + w && y > py && y < py + h), `ponto ${x},${y}`);
  for (const m of calc.matchAll(/class="sd-calc-line [^"]+" style="transform-origin:([\d.]+)px ([\d.]+)px[^"]*" d="M([\d.]+) ([\d.]+)/g))
    assert.deepEqual([+m[1], +m[2]], [+m[3], +m[4]], 'origem da escala no primeiro ponto da linha');
});

