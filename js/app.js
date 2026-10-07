// ======================= Interface =======================
const $ = id => document.getElementById(id);
const state = { geo: null, fileBase: 'talhoes', cands: [], idx: -1, img: null, run: 0, params: null, sel: null };

$('date').value = Core.isoDay(new Date());

// ---------- satélite ----------
// Sentinel-2 e Landsat 8/9 ficam no seletor; os secundários em "Outros", como cartões com resolução e finalidade
const sensorMeta = s => `${s.res} m` + (s.since ? ` · desde ${s.since}` : '');
$('sensorOther').innerHTML = Object.entries(Core.SENSORS).filter(([, s]) => s.group === 'secondary')
  .map(([k, s], i) => `<label class="sensor-card"><input type="radio" name="sensorOther" value="${k}"${i ? '' : ' checked'}>` +
    `<span class="sc-head"><b>${s.label}</b><span class="sc-meta">${sensorMeta(s)}</span></span><span class="sc-about">${s.about}</span></label>`).join('');
document.querySelectorAll('input[name=sensor]').forEach(r => {
  const s = Core.SENSORS[r.value];
  if (s) r.parentElement.title = `${sensorMeta(s)}. ${s.about}`;
});
function currentSensor() {
  const v = document.querySelector('input[name=sensor]:checked').value;
  return v === 'other' ? document.querySelector('input[name=sensorOther]:checked').value : v;
}
function onSensorChange() {
  const other = document.querySelector('input[name=sensor]:checked').value === 'other';
  $('sensorOther').classList.toggle('hidden', !other);
  // mantém o cartão escolhido visível dentro da lista rolável
  if (other) document.querySelector('input[name=sensorOther]:checked').closest('.sensor-card').scrollIntoView({ block: 'nearest' });
  const s = Core.SENSORS[currentSensor()];
  $('sensorInfo').classList.toggle('hidden', other);
  $('sensorInfo').innerHTML = `<span class="sc-meta">${sensorMeta(s)}</span> ${s.about}`;
  // produto sem data (DEM): data e janela não se aplicam
  for (const id of ['date', 'window']) $(id).disabled = !!s.static;
  $('tol').disabled = !!s.cloudFree;
}
document.querySelectorAll('input[name=sensor], input[name=sensorOther]').forEach(r => r.addEventListener('change', onSensorChange));
onSensorChange();

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
  checking: ['', 'avaliando…'], ok: ['ok', 'sem nuvem'], cloud: ['no', 'nuvem'], nodata: ['no', 'sem dado'],
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
  const sensor = currentSensor();
  const day = $('date').value, win = parseInt($('window').value, 10) || 60;
  const buffer = Math.max(0, parseFloat($('buffer').value) || 0), tol = Math.max(0, parseFloat($('tol').value) || 0);
  if (!day) return setStatus('Informe a data.', 'err');
  state.params = { sensor, day, win, buffer, tol };
  showResult(false); $('candPanel').classList.add('hidden'); state.sel = null; $('pixelPop').classList.add('hidden');
  state.cands = []; state.idx = -1;
  try {
    setStatus('Buscando cenas…', 'busy');
    const [start, end] = Core.searchRange(sensor, day, win);
    const items = await Core.stacSearch(sensor, state.geo.bboxLL, start, end);
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
    state.img = img; state.sel = null; $('pixelPop').classList.add('hidden');
    const s = Core.SENSORS[sensor];
    $('meta').innerHTML = [
      ...(s.static ? [] : [['Data', fmtDate(c.day)], ['Diferença', fmtDelta(c.delta)]]), ['Satélite', c.satellite],
      ...(s.cloudFree ? [] : [['Nuvem nos talhões', fmtPct(c.check.cloudPct)]]),
      ['Resolução', Core.isGeographic(img.epsg) ? `≈ ${Math.round(img.res * 111320)} m` : `${+img.res.toFixed(2)} m`],
      ['Projeção', Core.crsLabel(img.epsg)],
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

// Altura disponível para a prévia sem rolar a página: tela menos tudo o que não é o canvas
// (cabeçalho, dados da imagem, rodapé do cartão, resumo de "Cenas avaliadas" fechado e rodapé da página).
function previewMaxHeight() {
  const cv = $('view'), panel = $('resultPanel').getBoundingClientRect();
  const below = $('candPanel').classList.contains('hidden') ? 0 : 20 + 50; // gap + resumo fechado
  const used = panel.bottom + window.scrollY - cv.height + below + 20 + document.querySelector('footer').offsetHeight;
  return Math.max(240, window.innerHeight - used);
}

function draw() {
  const img = state.img; if (!img || $('resultPanel').classList.contains('hidden')) return;
  const cp = availableComposites()[$('composite').value || 0];
  const chans = cp.b.map(n => img.bands.find(b => b.name === n).data);
  const st = chans.map(d => Core.percentiles(d, 0.02, 0.98, img.nodata));
  const off = document.createElement('canvas'); off.width = img.W; off.height = img.H;
  const octx = off.getContext('2d'), id = octx.createImageData(img.W, img.H), px = id.data;
  for (let i = 0; i < img.W * img.H; i++) {
    let valid = false;
    for (let k = 0; k < 3; k++) {
      const v = chans[k][i]; if (v !== img.nodata && !Number.isNaN(v)) valid = true;
      px[i * 4 + k] = Math.max(0, Math.min(255, 255 * (v - st[k][0]) / (st[k][1] - st[k][0])));
    }
    px[i * 4 + 3] = valid ? 255 : 0;
  }
  octx.putImageData(id, 0, 0);
  // ajusta à largura disponível e a ~70% da altura da janela
  const maxW = $('viewWrap').clientWidth || 900, maxH = previewMaxHeight();
  const k = Core.previewScale(img.W, img.H, maxW, maxH);
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
  drawSelection();
}

// ---------- inspeção de pixel ----------
// Clique na prévia: borda vermelha no pixel e balão com o valor de cada banda
const fmtNum = v => Number.isInteger(v) ? String(v) : (Math.abs(v) >= 1000 ? v.toFixed(1) : v.toPrecision(4)).replace('.', ',');

function drawSelection() {
  const img = state.img, sel = state.sel, cv = $('view');
  if (!img || !sel) return;
  const sx = cv.width / img.W, sy = cv.height / img.H;
  // pixels menores que a tela (imagem reduzida) ganham uma marca mínima de 8 px
  const w = Math.max(sx, 8), h = Math.max(sy, 8);
  const x = (sel.c + 0.5) * sx - w / 2, y = (sel.r + 0.5) * sy - h / 2;
  const ctx = cv.getContext('2d');
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(0, 0, 0, .6)'; ctx.strokeRect(x - 1, y - 1, w + 2, h + 2);
  ctx.strokeStyle = '#ff2d2d'; ctx.strokeRect(x, y, w, h);
  placePopup();
}

function showPixel(c, r) {
  const img = state.img;
  state.sel = { c, r };
  const [lon, lat] = Core.pixelLonLat(img, c, r);
  // valores brutos, como estão no .tif
  const rows = Core.pixelValues(img, c, r).map(v =>
    `<tr><td>${v.name}</td><td>${v.nodata ? '<span class="pp-nd">sem dado</span>' : fmtNum(v.raw)}</td></tr>`).join('');
  $('pixelPop').innerHTML =
    `<div class="pp-head"><span>Linha ${r}, coluna ${c}<small>${lat.toFixed(6)}, ${lon.toFixed(6)}</small></span>` +
    `<button class="pp-close" aria-label="Fechar">×</button></div>` +
    `<table><thead><tr><th>Banda</th><th>Valor</th></tr></thead><tbody>${rows}</tbody></table>`;
  $('pixelPop').classList.remove('hidden');
  draw();
}

function closePixel() {
  if (!state.sel) return;
  state.sel = null; $('pixelPop').classList.add('hidden'); draw();
}

// Posiciona o balão ao lado do pixel, sem sair da área da prévia
function placePopup() {
  const pop = $('pixelPop'), cv = $('view'), wrap = $('viewWrap'), img = state.img, sel = state.sel;
  if (!sel || pop.classList.contains('hidden')) return;
  const sx = cv.width / img.W, sy = cv.height / img.H;
  const px = cv.offsetLeft + (sel.c + 0.5) * sx, py = cv.offsetTop + (sel.r + 0.5) * sy;
  const gap = Math.max(sx, sy) / 2 + 10, W = wrap.clientWidth, H = wrap.clientHeight;
  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  let left = px + gap; if (left + pw > W - 8) left = px - gap - pw;
  let top = py - ph / 2;
  pop.style.left = Math.max(8, Math.min(left, W - pw - 8)) + 'px';
  pop.style.top = Math.max(8, Math.min(top, H - ph - 8)) + 'px';
}

$('view').addEventListener('click', e => {
  const img = state.img, cv = $('view'); if (!img) return;
  const rect = cv.getBoundingClientRect();
  const x = (e.clientX - rect.left) * cv.width / rect.width, y = (e.clientY - rect.top) * cv.height / rect.height;
  const p = Core.canvasToPixel(x, y, cv.width / img.W, cv.height / img.H, img.W, img.H);
  if (p) showPixel(p.c, p.r);
});
$('pixelPop').addEventListener('click', e => { if (e.target.closest('.pp-close')) closePixel(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closePixel(); });

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
      SENSOR: Core.SENSORS[p.sensor].label, SATELLITE: c.satellite, ITEM_ID: (c.items || [c.item]).map(i => i.id).join(','), DATETIME: c.item.properties.datetime || c.item.properties.start_datetime,
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
