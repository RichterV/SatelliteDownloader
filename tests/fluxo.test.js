// Fluxo da busca (Core.pickCandidate): escolha da próxima cena limpa, erros e cancelamento por nova busca.
// Também os utilitários de texto/data usados pela interface.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Core } = require('./helpers/core');

const cand = (id, extra = {}) => ({ id, day: '2025-08-01', ...extra });
const CLEAR = { n: 10, cloudPct: 0, nodataPct: 0 };
// check que devolve o resultado configurado por id (ou lança se for Error)
const checkBy = map => async c => { const r = map[c.id]; if (r instanceof Error) throw r; return r; };
const opts = (o = {}) => ({ tol: 0, alive: () => true, check: async () => CLEAR, show: async () => {}, ...o });

test('pickCandidate: pula nublada e sem dado e exibe a primeira limpa', async () => {
  const cands = [cand('a'), cand('b'), cand('c'), cand('d')];
  const shown = [];
  const i = await Core.pickCandidate(cands, 0, opts({
    check: checkBy({ a: { n: 10, cloudPct: 30, nodataPct: 0 }, b: { n: 10, cloudPct: 0, nodataPct: 5 }, c: CLEAR, d: CLEAR }),
    show: async c => shown.push(c.id),
  }));
  assert.equal(i, 2);
  assert.deepEqual(cands.map(c => c.status), ['cloud', 'nodata', 'ok', undefined]);
  assert.deepEqual(shown, ['c']);
});

test('pickCandidate: nuvem dentro da tolerância é aceita; cena com >= 99% de nuvem é pulada sem verificar', async () => {
  const cands = [cand('a', { sceneCloud: 99.5 }), cand('b')];
  const checked = [];
  const i = await Core.pickCandidate(cands, 0, opts({
    tol: 5, check: async c => { checked.push(c.id); return { n: 10, cloudPct: 4, nodataPct: 0 }; },
  }));
  assert.equal(i, 1);
  assert.equal(cands[0].status, 'skip');
  assert.deepEqual(checked, ['b']);
});

test('pickCandidate: começa no índice pedido (botão "Não gostei")', async () => {
  const cands = [cand('a', { status: 'rejected' }), cand('b')];
  assert.equal(await Core.pickCandidate(cands, 1, opts()), 1);
  assert.equal(cands[0].status, 'rejected');
});

test('pickCandidate: erro na verificação marca a cena e segue', async () => {
  const cands = [cand('a'), cand('b')];
  const i = await Core.pickCandidate(cands, 0, opts({ check: checkBy({ a: new Error('A cena a não tem o asset "scl".'), b: CLEAR }) }));
  assert.equal(i, 1);
  assert.equal(cands[0].status, 'error');
  assert.match(cands[0].error, /asset "scl"/);
});

test('pickCandidate: erro ao baixar as bandas marca a cena e tenta a próxima', async () => {
  const cands = [cand('a'), cand('b')];
  const shown = [];
  const i = await Core.pickCandidate(cands, 0, opts({
    show: async c => { if (c.id === 'a') throw new Error('Erro ao baixar as bandas: HTTP 403'); shown.push(c.id); },
  }));
  assert.equal(i, 1);
  assert.equal(cands[0].status, 'error');
  assert.match(cands[0].error, /403/);
  assert.deepEqual(shown, ['b']);
});

test('pickCandidate: nenhuma limpa => -1; lista vazia => -1', async () => {
  const cands = [cand('a'), cand('b')];
  assert.equal(await Core.pickCandidate(cands, 0, opts({ check: async () => ({ n: 1, cloudPct: 50, nodataPct: 0 }) })), -1);
  assert.equal(await Core.pickCandidate([], 0, opts()), -1);
});

test('pickCandidate: busca substituída durante a verificação não grava resultado nem exibe a cena', async () => {
  let run = 1;
  const cands = [cand('a'), cand('b')];
  let shown = 0;
  const updates = [];
  const i = await Core.pickCandidate(cands, 0, opts({
    alive: () => run === 1,
    check: async () => { run = 2; return CLEAR; }, // usuário disparou outra busca enquanto verificava
    show: async () => { shown++; },
    onUpdate: c => updates.push(c.status),
  }));
  assert.equal(i, null);
  assert.equal(shown, 0);
  assert.equal(cands[0].check, undefined);
  assert.deepEqual(updates, ['checking']); // nada depois da troca
  assert.equal(cands[1].status, undefined);
});

test('pickCandidate: erro numa busca já substituída é ignorado', async () => {
  let run = 1;
  const cands = [cand('a')];
  const updates = [];
  const i = await Core.pickCandidate(cands, 0, opts({
    alive: () => run === 1,
    check: async () => { run = 2; throw new Error('cancelada'); },
    onUpdate: c => updates.push(c.status),
  }));
  assert.equal(i, null);
  assert.equal(cands[0].error, undefined);
  assert.deepEqual(updates, ['checking']);
});

test('pickCandidate: busca substituída durante o download devolve null', async () => {
  let run = 1;
  const i = await Core.pickCandidate([cand('a')], 0, opts({ alive: () => run === 1, show: async () => { run = 2; } }));
  assert.equal(i, null);
});

test('escHtml: escapa aspas e tags (texto seguro em atributos title="...")', () => {
  assert.equal(Core.escHtml('asset "scl" <b>&\'x\''), 'asset &quot;scl&quot; &lt;b&gt;&amp;&#39;x&#39;');
  assert.equal(Core.escHtml(undefined), '');
  assert.equal(Core.escHtml(42), '42');
});

test('localDay: data no fuso local, não em UTC (23h30 continua sendo o mesmo dia)', () => {
  assert.equal(Core.localDay(new Date(2026, 9, 8, 23, 30)), '2026-10-08');
  assert.equal(Core.localDay(new Date(2026, 0, 1, 0, 5)), '2026-01-01');
});
