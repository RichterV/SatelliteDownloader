// Zoom (Ctrl + scroll do mouse) e arraste na prévia
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { Core, ROOT } = require('./helpers/core');

// imagem 400x300 encaixada num canvas 800x600 (k0 = 2)
const g = { W: 400, H: 300, cw: 800, ch: 600, k0: 2 };
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} != ${b}`);
// pixel da imagem sob um ponto do canvas
const under = (v, x, y) => { const { s, tx, ty } = Core.viewTransform(v, g); return [(x - tx) / s, (y - ty) / s]; };

test('fitView: zoom 1 mostra a imagem inteira, sem deslocamento', () => {
  const v = Core.fitView(g);
  assert.deepEqual(v, { z: 1, cx: 200, cy: 150 });
  assert.deepEqual(Core.viewTransform(v, g), { s: 2, tx: 0, ty: 0 });
});

test('zoomAt: o pixel sob o cursor continua sob o cursor', () => {
  const v0 = Core.fitView(g);
  const before = under(v0, 300, 200);
  const v1 = Core.zoomAt(v0, 300, 200, 2.5, g);
  assert.equal(v1.z, 2.5);
  const after = under(v1, 300, 200);
  near(after[0], before[0], 'x'); near(after[1], before[1], 'y');
  // e de novo, num zoom já ampliado
  const v2 = Core.zoomAt(v1, 500, 350, 1.7, g);
  const b2 = under(v1, 500, 350), a2 = under(v2, 500, 350);
  near(a2[0], b2[0], 'x'); near(a2[1], b2[1], 'y');
});

test('zoomAt: não reduz abaixo da imagem inteira nem passa do máximo', () => {
  const v = Core.zoomAt(Core.fitView(g), 100, 100, 0.2, g);
  assert.deepEqual(v, Core.fitView(g), 'reduzir além de 100% volta ao encaixe');
  assert.equal(Core.zoomAt(Core.fitView(g), 100, 100, 1e6, g).z, Core.maxZoom(g));
  assert.equal(Core.maxZoom(g), 32, 'até 64 px por pixel da imagem');
  assert.equal(Core.maxZoom({ ...g, k0: 45 }), 8, 'imagem já muito ampliada (MODIS) ainda permite 8x');
});

test('panBy: a imagem acompanha o arraste e não sai da área', () => {
  const v = Core.zoomAt(Core.fitView(g), 400, 300, 4, g); // centro, 4x
  const before = under(v, 400, 300);
  const moved = Core.panBy(v, 40, -20, g); // arrasta 40 px para a direita e 20 para cima
  const after = under(moved, 440, 280);
  near(after[0], before[0], 'x'); near(after[1], before[1], 'y');
  // arrastar demais para a direita: a borda esquerda da imagem para no meio da tela, não some
  const edge = Core.panBy(v, 1e6, 0, g);
  assert.equal(Core.viewTransform(edge, g).tx, g.cw / 2);
  const edge2 = Core.panBy(v, -1e6, -1e6, g);
  const t = Core.viewTransform(edge2, g);
  near(t.tx + g.W * t.s, g.cw / 2, 'borda direita no meio'); near(t.ty + g.H * t.s, g.ch / 2, 'borda de baixo no meio');
});

test('imagem mais estreita que a prévia: zoom não escorrega e a imagem não sai da tela', () => {
  const gw = { W: 400, H: 300, cw: 1200, ch: 600, k0: 2 }; // imagem ocupa 800 px de 1200
  const u = (v, x, y) => { const { s, tx, ty } = Core.viewTransform(v, gw); return [(x - tx) / s, (y - ty) / s]; };
  const v0 = Core.fitView(gw);
  assert.equal(Core.viewTransform(v0, gw).tx, 200, 'sem zoom fica centrada');
  const v1 = Core.zoomAt(v0, 500, 300, 1.2, gw); // 960 px: ainda menor que 1200
  const a = u(v0, 500, 300), b = u(v1, 500, 300);
  near(b[0], a[0], 'x'); near(b[1], a[1], 'y');
  // zoom perto da borda, passando de mais estreita para mais larga que a prévia: o ponto continua fixo
  const v2 = Core.zoomAt(v0, 320, 400, 1.6, gw);
  const c = u(v0, 320, 400), d = u(v2, 320, 400);
  near(d[0], c[0], 'x na transição'); near(d[1], c[1], 'y na transição');
  const t = Core.viewTransform(Core.panBy(v1, 1e6, 0, gw), gw);
  near(t.tx, gw.cw / 2, 'arrastar não tira a imagem da tela');
  assert.deepEqual(Core.zoomAt(v1, 900, 100, 0.5, gw), v0, 'voltar a 100% recentraliza');
});

test('panBy: sem zoom, arrastar não move a imagem', () => {
  assert.deepEqual(Core.panBy(Core.fitView(g), 50, 30, g), Core.fitView(g));
});

test('clique com zoom: canvasToPixel no referencial da vista acha o pixel certo', () => {
  const v = Core.zoomAt(Core.fitView(g), 0, 0, 10, g); // 10x no canto superior esquerdo
  const { s, tx, ty } = Core.viewTransform(v, g);
  assert.equal(s, 20);
  // clique no canvas em (205, 45) => pixel (10, 2) da imagem
  assert.deepEqual(Core.canvasToPixel(205 - tx, 45 - ty, s, s, g.W, g.H), { c: 10, r: 2 });
});

test('interface: Ctrl + scroll com passive:false, arraste por pointer e botão Ajustar', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
  assert.match(app, /addEventListener\('wheel'[\s\S]*?e\.ctrlKey[\s\S]*?preventDefault\(\)[\s\S]*?passive: false/);
  assert.match(app, /addEventListener\('pointermove'/);
  assert.match(app, /Math\.hypot\(e\.clientX - drag\.x0, e\.clientY - drag\.y0\) < 4/, 'clique x arraste');
  assert.match(html, /id="viewWrap"[\s\S]*id="btnFit"[\s\S]*id="zoomLevel"/);
  // dica discreta FORA da imagem (abaixo dela), com os três comandos
  const hint = html.match(/<span class="view-hint" id="viewHint">([\s\S]*?)<\/span>/);
  assert.ok(hint, 'dica existe');
  assert.ok(html.indexOf('id="viewHint"') > html.indexOf('</div>', html.indexOf('id="viewWrap"')), 'dica fica fora da área da imagem');
  for (const t of ['Ctrl', 'zoom', 'arrastar', 'clique']) assert.ok(hint[1].includes(t), t);
  assert.doesNotMatch(html, /<canvas id="view"[^>]*title=/, 'sem tooltip sobre a imagem');
  assert.match(app, /\$\('btnFit'\)\.addEventListener\('click', \(\) => \{ state\.view = Core\.fitView/);
});
