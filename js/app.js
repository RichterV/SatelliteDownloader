// ======================= Interface =======================
const $ = id => document.getElementById(id);
const state = { geo: null, fileBase: 'talhoes', cands: [], idx: -1, img: null, run: 0, params: null };

$('date').value = Core.isoDay(new Date());

// ---------- área ----------
const DROP_HINT = $('fileInfo').textContent;
['dragenter', 'dragover'].forEach(ev => $('file').addEventListener(ev, () => $('drop').classList.add('over')));
['dragleave', 'drop'].forEach(ev => $('file').addEventListener(ev, () => $('drop').classList.remove('over')));

$('file').addEventListener('change', async e => {
  const files = e.target.files;
  state.geo = null; $('btnSearch').disabled = true;
  $('drop').classList.remove('loaded', 'error');
  $('dropMain').textContent = 'Arraste ou clique para escolher'; $('fileInfo').textContent = DROP_HINT;
  if (!files.length) return;
  try {
    const { obj, base, noPrj } = await Core.readVectorFiles(files);
    state.geo = Core.parseGeoJSON(obj);
    state.fileBase = base;
    const g = state.geo;
    $('dropMain').textContent = base;
    $('fileInfo').textContent = [`${g.nFeatures} talhões`, g.srcEpsg !== 4326 && `EPSG:${g.srcEpsg}`,
      g.ignored && `${g.ignored} geometrias ignoradas`, noPrj && 'sem .prj (WGS84)'].filter(Boolean).join(' · ');
    $('drop').classList.add('loaded');
    $('btnSearch').disabled = false;
  } catch (err) {
    $('drop').classList.add('error');
    $('dropMain').textContent = files[0].name;
    $('fileInfo').textContent = err.message;
  }
});

// ---------- status ----------
function setStatus(text, kind) {
  $('status').textContent = text || '';
  $('status').className = 'status' + (kind ? ' ' + kind : '');
}
const fmtPct = v => v == null ? '–' : (v < 0.01 && v > 0 ? '<0,01' : v.toFixed(1).replace('.', ',')) + '%';
const fmtDelta = d => `${d > 0 ? '+' : ''}${d} d`;
const fmtDate = day => day.split('-').reverse().join('/');

const STATUS = {
  checking: ['', 'avaliando…'], ok: ['ok', 'sem nuvem'], cloud: ['no', 'nuvem'], nodata: ['no', 'fora da cena'],
  skip: ['', 'cena nublada'], rejected: ['', 'descartada'], error: ['no', 'erro'],
};
function renderTable() {
  const evaluated = state.cands.filter(c => c.status).length;
  $('candSummary').textContent = `Cenas avaliadas (${evaluated} de ${state.cands.length})`;
  $('candBody').innerHTML = state.cands.map((c, i) => {
    const [cls, txt] = STATUS[c.status] || ['', '–'];
    return `<tr class="${i === state.idx && c.status === 'ok' ? 'sel' : ''}" title="${c.item.id}${c.error ? '\n' + c.error : ''}">` +
      `<td>${fmtDate(c.day)}</td><td>${fmtDelta(c.delta)}</td><td>${c.satellite}</td><td>${fmtPct(c.sceneCloud)}</td>` +
      `<td>${c.check ? fmtPct(c.check.cloudPct) : '–'}</td><td>${c.status ? `<span class="pill ${cls}">${txt}</span>` : '–'}</td></tr>`;
  }).join('') || '<tr><td colspan="6">Nenhuma cena encontrada.</td></tr>';
}

function showResult(show) {
  $('resultPanel').classList.toggle('hidden', !show);
  $('emptyState').classList.toggle('hidden', show);
}

// ---------- busca ----------
async function runSearch() {
  const run = ++state.run;
  const sensor = document.querySelector('input[name=sensor]:checked').value;
  const day = $('date').value, win = parseInt($('window').value, 10) || 60;
  const buffer = Math.max(0, parseFloat($('buffer').value) || 0), tol = Math.max(0, parseFloat($('tol').value) || 0);
  if (!day) return setStatus('Informe a data.', 'err');
  state.params = { sensor, day, win, buffer, tol };
  showResult(false); $('candPanel').classList.add('hidden');
  state.cands = []; state.idx = -1;
  try {
    setStatus('Buscando cenas…', 'busy');
    const items = await Core.stacSearch(sensor, state.geo.bboxLL, Core.addDays(day, -win), Core.addDays(day, win));
    if (run !== state.run) return;
    state.cands = Core.orderCandidates(items, sensor, day, state.geo);
    renderTable(); $('candPanel').classList.remove('hidden');
    if (!state.cands.length) return setStatus(`Nenhuma cena em ± ${win} dias. Aumente a janela.`, 'err');
    await nextCandidate(run);
  } catch (err) { console.error(err); setStatus(err.message, 'err'); }
}

async function nextCandidate(run) {
  const { sensor, tol } = state.params;
  for (let i = state.idx + 1; i < state.cands.length; i++) {
    if (run !== state.run) return;
    const c = state.cands[i];
    if ((c.sceneCloud ?? 0) >= 99 && tol < 99) { c.status = 'skip'; renderTable(); continue; }
    c.status = 'checking'; renderTable();
    setStatus(`Verificando nuvens em ${fmtDate(c.day)}…`, 'busy');
    try {
      c.check = await Core.checkCandidate(c, sensor, state.geo);
      c.status = c.check.nodataPct > 0 ? 'nodata' : c.check.cloudPct > tol ? 'cloud' : 'ok';
    } catch (err) { console.error(err); c.status = 'error'; c.error = err.message; }
    renderTable();
    if (c.status === 'ok') { state.idx = i; renderTable(); return showCandidate(c, run); }
  }
  state.idx = state.cands.length;
  setStatus('Nenhuma cena limpa na janela. Aumente a janela ou a nuvem aceita.', 'err');
}

async function showCandidate(c, run) {
  const { sensor } = state.params;
  setStatus(`Baixando bandas de ${fmtDate(c.day)}…`, 'busy');
  try {
    const img = await Core.loadImage(c, sensor, state.geo, state.params.buffer,
      (k, n) => setStatus(`Baixando bandas de ${fmtDate(c.day)}… ${k}/${n}`, 'busy'));
    if (run !== state.run) return;
    state.img = img;
    const s = Core.SENSORS[sensor];
    $('meta').innerHTML = [
      ['Data', fmtDate(c.day)], ['Diferença', fmtDelta(c.delta)], ['Satélite', c.satellite],
      ['Nuvem nos talhões', fmtPct(c.check.cloudPct)], ['Resolução', `${img.res} m`], ['EPSG', img.epsg],
    ].map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
    $('composite').innerHTML = availableComposites().map((cp, i) => `<option value="${i}" title="${cp.b.join(', ')}">${cp.label}</option>`).join('');
    $('bandSummary').textContent = `Bandas (${img.bands.length})`;
    $('bandlist').innerHTML = img.bands.map((b, i) => `<span><b>${i + 1}</b>${b.name}</span>`).join('');
    state.fileName = `${state.fileBase}_${s.short}_${c.day}.tif`;
    $('dlInfo').textContent = `${state.fileName.replace(/\.tif$/, '.zip')} · ${img.W} × ${img.H} px`;
    showResult(true);
    draw();
    setStatus('');
  } catch (err) { console.error(err); setStatus('Erro ao baixar as bandas: ' + err.message, 'err'); }
}

// ---------- visualização ----------
function availableComposites() {
  const img = state.img;
  return Core.SENSORS[state.params.sensor].composites.filter(c => c.b.every(n => img.bands.some(b => b.name === n)));
}

function draw() {
  const img = state.img; if (!img || $('resultPanel').classList.contains('hidden')) return;
  const cp = availableComposites()[$('composite').value || 0];
  const chans = cp.b.map(n => img.bands.find(b => b.name === n).data);
  const st = chans.map(d => Core.percentiles(d, 0.02, 0.98));
  const off = document.createElement('canvas'); off.width = img.W; off.height = img.H;
  const octx = off.getContext('2d'), id = octx.createImageData(img.W, img.H), px = id.data;
  for (let i = 0; i < img.W * img.H; i++) {
    let valid = false;
    for (let k = 0; k < 3; k++) {
      const v = chans[k][i]; if (v) valid = true;
      px[i * 4 + k] = Math.max(0, Math.min(255, 255 * (v - st[k][0]) / (st[k][1] - st[k][0])));
    }
    px[i * 4 + 3] = valid ? 255 : 0;
  }
  octx.putImageData(id, 0, 0);
  // ajusta à largura disponível e a ~70% da altura da janela
  const maxW = $('viewWrap').clientWidth || 900, maxH = Math.max(320, window.innerHeight * 0.7);
  const k = Math.min(8, maxW / img.W, maxH / img.H);
  const cv = $('view'); cv.width = Math.round(img.W * k); cv.height = Math.round(img.H * k);
  const ctx = cv.getContext('2d'); ctx.imageSmoothingEnabled = k < 1;
  ctx.drawImage(off, 0, 0, cv.width, cv.height);
  if ($('showPoly').checked) {
    ctx.strokeStyle = '#ffd400'; ctx.lineWidth = 1.5;
    for (const p of img.polysPx) {
      ctx.beginPath();
      for (const r of p) r.forEach(([x, y], j) => j ? ctx.lineTo(x * k, y * k) : ctx.moveTo(x * k, y * k));
      ctx.stroke();
    }
  }
}

// ---------- eventos ----------
$('btnSearch').addEventListener('click', runSearch);
$('composite').addEventListener('change', draw);
$('showPoly').addEventListener('change', draw);
window.addEventListener('resize', () => { clearTimeout(state.rt); state.rt = setTimeout(draw, 200); });
$('btnNext').addEventListener('click', () => {
  if (state.idx >= 0 && state.cands[state.idx]) state.cands[state.idx].status = 'rejected';
  showResult(false);
  nextCandidate(state.run);
});
$('btnDownload').addEventListener('click', async () => {
  const c = state.cands[state.idx], p = state.params;
  $('btnDownload').disabled = true;
  setStatus('Gerando .zip…', 'busy');
  try {
    const buf = Core.buildGeoTIFF(state.img, {
      SENSOR: Core.SENSORS[p.sensor].label, SATELLITE: c.satellite, ITEM_ID: c.item.id, DATETIME: c.item.properties.datetime,
      TARGET_DATE: p.day, DELTA_DAYS: c.delta, BUFFER_M: p.buffer,
      CLOUD_PCT_TALHOES: c.check.cloudPct.toFixed(3), SCENE_CLOUD_PCT: c.sceneCloud ?? '',
    });
    const zip = await Core.zipFile(state.fileName, buf);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([zip], { type: 'application/zip' }));
    a.download = state.fileName.replace(/\.tif$/, '.zip'); a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    setStatus(`${a.download} baixado (${(zip.length / 1048576).toFixed(1)} MB).`);
  } catch (err) { console.error(err); setStatus('Erro ao gerar o .zip: ' + err.message, 'err'); }
  finally { $('btnDownload').disabled = false; }
});
