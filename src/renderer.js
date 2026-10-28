'use strict';
/* global api */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

let S = {};                       // configurações atuais
let hookAvailable = false;
let sources = { screens: [], windows: [] };
let session = null;               // recursos da gravação em andamento
let starting = false;
const state = { recording: false, paused: false, startedAt: 0, pausedAccum: 0, pauseStart: 0, bytes: 0, partBytes: 0, partStart: 0, autoStopAt: null, file: null };

const MODE_LABEL = { screen: 'Tela inteira', area: 'Área selecionada', window: 'Janela', webcam: 'Somente webcam' };
const HOTKEY_LABEL = {
  record: 'Iniciar / parar gravação',
  pause: 'Pausar / retomar',
  screenshot: 'Capturar imagem',
  draw: 'Ativar / desativar desenho',
  clear: 'Limpar desenhos',
  webcam: 'Mostrar / ocultar webcam',
  manualMark: 'Manual: marcar campo',
  manualNewScreen: 'Manual: nova tela'
};
const DEFAULT_HOTKEYS = { record: 'F12', pause: 'Shift+F12', screenshot: 'F11', draw: 'Ctrl+Shift+D', clear: 'Ctrl+Shift+X', webcam: 'Ctrl+Shift+W', manualMark: 'Insert', manualNewScreen: 'Shift+Insert' };
const MANUAL_COLORS = ['#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#0a84ff', '#af52de', '#111111'];

/* ------------------------------------------------------------------ */
/* Utilidades                                                           */
/* ------------------------------------------------------------------ */
const pad = (n) => String(n).padStart(2, '0');
function fmtTime(ms) {
  const t = Math.max(0, Math.floor(ms / 1000));
  return `${pad(Math.floor(t / 3600))}:${pad(Math.floor(t / 60) % 60)}:${pad(t % 60)}`;
}
function fmtBytes(b) {
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 ** 3).toFixed(2)} GB`;
}
const even = (n) => Math.max(2, Math.floor(n / 2) * 2);
let toastTimer = null;
function toast(msg, isError = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.toggle('error', !!isError);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), isError ? 6000 : 3500);
}
/* Cor de destaque do Windows (usada em botões, seleção e barra de rolagem) */
function setAccent(c) {
  if (c) document.documentElement.style.setProperty('--accent', c);
}
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/* Salvamento com debounce */
let pendingPatch = {}, saveTimer = null;
function save(patch, immediate = false) {
  Object.assign(pendingPatch, patch);
  clearTimeout(saveTimer);
  const run = async () => {
    const p = pendingPatch; pendingPatch = {};
    const r = await api.setSettings(p);
    S = { ...r.settings, ...pendingPatch };
    if (r.failed && r.failed.length) toast(`Atalho indisponível (já usado por outro programa): ${r.failed.join(', ')}`, true);
    return r;
  };
  if (immediate) return run();
  saveTimer = setTimeout(run, 250);
  return null;
}

/* ------------------------------------------------------------------ */
/* Inicialização                                                        */
/* ------------------------------------------------------------------ */
async function init() {
  const r = await api.getSettings();
  S = r.settings; hookAvailable = r.hookAvailable;
  $('#appVersion').textContent = `Versão ${r.version || '1.0.0'}`;
  setAccent(r.accent);
  if (r.failedHotkeys && r.failedHotkeys.length) toast(`Atalho indisponível: ${r.failedHotkeys.join(', ')}`, true);
  $('#hookWarn').hidden = hookAvailable;

  bindSettings();
  bindUi();
  setupNew();
  renderAll();
  refreshRecovery();
  refreshSources();
  loadDevices();
  setInterval(tick, 250);

  api.on('hotkey', (k) => { if (k === 'record') toggleRecord(); else if (k === 'pause') togglePause(); });
  // modo manual: pausa/retoma sem inverter o estado por engano
  api.on('set-paused', (p) => { if (state.recording && !!p !== state.paused) togglePause(); });
  api.on('manual:status', (st) => { renderManualStatus(st); if ($('#panel-manual').classList.contains('active')) refreshManuals(); });
  api.on('rec:force-stop', () => stopRecording());
  api.on('rec:bytes', (b) => { if (state.recording) { state.partBytes = b; state.bytes = b + (state.prevPartsBytes || 0); } });
  api.on('schedule:start', async ({ stopAt }) => {
    if (state.recording) return;
    await startRecording({ noCountdown: true });
    if (state.recording) { state.autoStopAt = stopAt; toast('Gravação agendada iniciada.'); }
  });
  api.on('frame:request', (id) => api.frameResponse(id, grabFrame()));
  api.on('settings:changed', (s) => { S = s; renderAll(); });
  api.on('files:changed', () => refreshFiles());
  api.on('show-panel', (id) => showPanel(id));
  api.on('cam:size', (w) => { S.webcamWidth = w; setEl($('[data-key="webcamWidth"]'), w); updateLabels(); });
  api.on('accent', setAccent);
  api.on('toast', (m, err) => toast(m, err));
  api.on('draw:state', (on) => { $('#btnDraw').classList.toggle('active', on); $('#btnDrawPanel').textContent = on ? 'Fechar ferramentas de desenho' : 'Abrir ferramentas de desenho'; });
}

function renderAll() {
  $$('[data-key]').forEach((e) => setEl(e, S[e.dataset.key]));
  updateLabels();
  renderMode();
  renderSources();
  renderHotkeys();
  renderSchedules();
  refreshFiles();
  $('#outputDir').textContent = S.outputDir;
  $('#outputShort').textContent = S.outputDir;
  refreshWatermark();
  renderManual();
  renderEngine();
  renderLimits();
  renderBrand();
  updateUI();
}

function setEl(e, v) {
  if (e.type === 'checkbox') e.checked = !!v;
  else if (v !== undefined && v !== null) e.value = String(v);
}
function getEl(e) {
  if (e.type === 'checkbox') return e.checked;
  if (e.type === 'range' || e.type === 'number' || e.hasAttribute('data-num')) return Number(e.value);
  return e.value;
}
function updateLabels() {
  $$('output[data-for]').forEach((o) => { o.textContent = `${S[o.dataset.for]}${o.dataset.unit ?? '%'}`; });
}

function bindSettings() {
  $$('[data-key]').forEach((e) => {
    const k = e.dataset.key;
    e.addEventListener(e.type === 'range' ? 'input' : 'change', () => {
      const v = getEl(e);
      S[k] = v;
      save({ [k]: v });
      updateLabels();
      applyLive(k);
      renderSummary();
    });
  });
}

/* Ajustes aplicados na hora, inclusive durante a gravação */
function applyLive(k) {
  if (monitor) {
    if (k === 'systemVolume' && monitor.sys) monitor.sys.gain.gain.value = S.systemVolume / 100;
    if (k === 'micVolume' && monitor.mic) monitor.mic.gain.gain.value = S.micVolume / 100;
  }
  if (['systemAudio', 'mic', 'micDeviceId', 'micNoise'].includes(k)) restartMonitor();
  if (k === 'micNoise' && state.recording) toast('A nova redução de ruído vale a partir da próxima gravação.');
  if (k === 'wmEnabled' && S.wmEnabled && !S.wmPath) chooseWatermark();
  if (session) {
    if (k === 'systemVolume' && session.sysGain) session.sysGain.gain.value = S.systemVolume / 100;
    if (k === 'micVolume' && session.micGain) session.micGain.gain.value = S.micVolume / 100;
  }
  if (k === 'webcam') updateUI();
  if (k === 'engine') { renderEngine(); if (S.engine === 'ffmpeg' && !S.hwEncoders) detectEncoders(); }
  if (k === 'limitMode') renderLimits();
  if (k === 'wmOpacity') { const i = $('#wmPreview img'); if (i) i.style.opacity = String(S.wmOpacity / 100); }
  if (k === 'webcam' && state.recording && S.mode === 'window') toast('No modo Janela a webcam será aplicada na próxima gravação.');
}

function bindUi() {
  $$('.nav').forEach((b) => { b.onclick = () => showPanel(b.dataset.panel); });
  $$('#modes button').forEach((b) => { b.onclick = () => setMode(b.dataset.mode); });
  $('#btnRec').onclick = toggleRecord;
  $('#btnPause').onclick = togglePause;
  $('#btnShot').onclick = () => api.screenshot();
  $('#btnDraw').onclick = () => api.drawToggle();
  $('#btnCam').onclick = () => {
    S.webcam = !S.webcam; save({ webcam: S.webcam }, true);
    setEl($('[data-key="webcam"]'), S.webcam); updateUI(); renderSummary();
    if (S.webcam && (S.mode === 'window' || S.mode === 'webcam')) toast('A janela flutuante da webcam aparece nos modos Tela inteira e Área.');
  };
  $$('#camPad button').forEach((b) => { b.onclick = () => api.camPlace(b.dataset.corner); });
  $('#btnDrawPanel').onclick = () => api.drawToggle();
  $('#btnRefresh').onclick = refreshSources;
  $('#btnSelectArea').onclick = selectArea;
  $('#btnDevices').onclick = () => loadDevices(true);
  $('#btnTestRec').onclick = testRecord;
  $$('[data-link]').forEach((a) => { a.onclick = (e) => { e.preventDefault(); api.openExternal(a.dataset.link); }; });
  $('#btnWm').onclick = chooseWatermark;
  $$('#manShapes button').forEach((b) => { b.onclick = () => { S.manualShape = b.dataset.shape; save({ manualShape: S.manualShape }); renderManual(); }; });
  $('#btnManDir').onclick = async () => { const d = await api.manualChooseDir(); if (d) { S.manualDir = d; renderManual(); } };
  $('#btnManFolder').onclick = () => api.manualOpenFolder('root');
  $('#btnManSessFolder').onclick = () => api.manualOpenFolder('session');
  $('#btnManHtml').onclick = () => api.manualOpenHtml();
  $('#btnManEnd').onclick = async () => { renderManualStatus(await api.manualEnd()); refreshManuals(); };
  $('#manTitle').addEventListener('change', async (e) => { S.manualTitle = await api.manualSetTitle(e.target.value); });
  $('#btnManRefresh').onclick = refreshManuals;
  $('#btnManOther').onclick = () => api.mdocOpenOther();
  $('#manLogo').onchange = (e) => { manualLogo = e.target.checked; };
  $('#btnOpenProject').onclick = () => api.projectOpen();
  $('#btnTestPlay').onclick = testPlay;
  $('#testWave').onclick = (e) => {
    if (!testUrl || !testAudio.duration) return;
    const r = e.currentTarget.getBoundingClientRect();
    testAudio.currentTime = ((e.clientX - r.left) / r.width) * testAudio.duration;
    if (testAudio.paused) testPlay();
  };
  window.addEventListener('resize', () => drawTestWave());
  $('#btnChooseFolder').onclick = async () => {
    const d = await api.chooseFolder();
    if (d) { S.outputDir = d; $('#outputDir').textContent = d; $('#outputShort').textContent = d; refreshFiles(); }
  };
  $('#btnOpenFolder').onclick = () => api.openFolder();
  $('#btnFilesFolder').onclick = () => api.openFolder();
  $('#btnFilesRefresh').onclick = refreshFiles;
  $('#btnResetHotkeys').onclick = async () => { S.hotkeys = { ...DEFAULT_HOTKEYS }; await save({ hotkeys: S.hotkeys }, true); renderHotkeys(); };
  $('#btnAddSched').onclick = addSchedule;

  const dt = new Date(Date.now() + 10 * 60000); dt.setSeconds(0, 0);
  $('#schStart').value = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

function showPanel(id) {
  $$('.nav').forEach((b) => b.classList.toggle('active', b.dataset.panel === id));
  $$('.panel').forEach((p) => p.classList.toggle('active', p.id === `panel-${id}`));
  if (id === 'home') refreshSources();
  if (id === 'files') refreshFiles();
  if (id === 'manual') renderManual();
  if (id === 'ai') refreshAi();
  if (id === 'brand') renderBrand();
  if (id === 'audio' || id === 'webcam') loadDevices();
  if (id === 'audio') startMonitor(); else if (!testing) stopMonitor();
}

/* ------------------------------------------------------------------ */
/* Modos e alvos                                                        */
/* ------------------------------------------------------------------ */
async function setMode(mode) {
  if (state.recording) return;
  S.mode = mode;
  await save({ mode }, true);
  renderMode();
  showPanel('home');
  if (mode === 'area' && !S.region) selectArea();
}

async function selectArea() {
  if (state.recording) return;
  const r = await api.selectRegion();
  if (r) { S.region = r; S.mode = 'area'; renderMode(); }
}

function renderMode() {
  $$('#modes button').forEach((b) => { b.classList.toggle('active', b.dataset.mode === S.mode); b.disabled = state.recording; });
  $$('.target').forEach((t) => t.classList.toggle('active', t.dataset.target === S.mode));
  $('#targetTitle').textContent = MODE_LABEL[S.mode];
  $('#btnRefresh').hidden = !(S.mode === 'screen' || S.mode === 'window');
  const r = S.region;
  $('#regionInfo').textContent = r ? `${r.w} × ${r.h} px na posição (${r.x}, ${r.y})` : 'Nenhuma área selecionada.';
  renderSummary();
}

async function refreshSources() {
  try { sources = await api.listSources(); } catch { return; }
  if (sources.screens.length && !sources.screens.some((s) => s.displayId === S.displayId)) {
    S.displayId = sources.screens[0].displayId; save({ displayId: S.displayId });
  }
  renderSources();
}

function renderSources() {
  fillGrid('#screenGrid', sources.screens, (s) => s.displayId === S.displayId, (s) => `${s.width} × ${s.height}`,
    (s) => { S.displayId = s.displayId; save({ displayId: s.displayId }); renderSources(); });
  fillGrid('#windowGrid', sources.windows, (w) => w.id === S.windowId, () => '',
    (w) => { S.windowId = w.id; S.windowName = w.name; save({ windowId: w.id, windowName: w.name }); renderSources(); });
  renderSummary();
}

function fillGrid(sel, items, isSel, sub, onPick) {
  const g = $(sel); g.innerHTML = '';
  if (!items.length) { g.appendChild(el('div', 'empty', 'Nada encontrado. Clique em Atualizar.')); return; }
  items.forEach((it) => {
    const b = el('button', `tile${isSel(it) ? ' selected' : ''}`);
    const img = el('img'); img.src = it.thumb; img.alt = '';
    b.append(img, el('div', 'name', it.name));
    const st = sub(it); if (st) b.appendChild(el('div', 'sub', st));
    b.title = it.name;
    b.onclick = () => { if (!state.recording) onPick(it); };
    g.appendChild(b);
  });
}

function renderSummary() {
  const parts = [MODE_LABEL[S.mode]];
  if (S.mode === 'screen') { const s = sources.screens.find((x) => x.displayId === S.displayId); if (s) parts.push(`${s.name} · ${s.width}×${s.height}`); }
  if (S.mode === 'area' && S.region) parts.push(`${S.region.w}×${S.region.h}`);
  if (S.mode === 'window' && S.windowName) parts.push(S.windowName);
  parts.push(`${S.fps} fps`, String(S.format).toUpperCase(), `${S.bitrate} Mbps`);
  const audio = [];
  if (S.systemAudio && S.mode !== 'webcam') audio.push('som do sistema');
  if (S.mic) audio.push('microfone');
  parts.push(audio.length ? `Áudio: ${audio.join(' + ')}` : 'Sem áudio');
  if (S.webcam && S.mode !== 'webcam') parts.push('Webcam junto');
  $('#summary').textContent = parts.join('  •  ');
}

/* ------------------------------------------------------------------ */
/* Dispositivos                                                         */
/* ------------------------------------------------------------------ */
async function loadDevices(askPermission = false) {
  if (askPermission) {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      s.getTracks().forEach((t) => t.stop());
    } catch { /* sem câmera ou sem microfone */ }
  }
  let devs = [];
  try { devs = await navigator.mediaDevices.enumerateDevices(); } catch { return; }
  fillDevices('#micDevice', devs.filter((d) => d.kind === 'audioinput'), S.micDeviceId, 'Microfone');
  fillDevices('#camDevice', devs.filter((d) => d.kind === 'videoinput'), S.webcamDeviceId, 'Câmera');
}
function fillDevices(sel, list, current, label) {
  const e = $(sel); e.innerHTML = '';
  e.add(new Option('Padrão do sistema', ''));
  list.forEach((d, i) => {
    if (d.deviceId === 'default' || d.deviceId === 'communications') return;
    e.add(new Option(d.label || `${label} ${i + 1}`, d.deviceId));
  });
  e.value = current || '';
  if (e.value !== (current || '')) e.value = '';
}
function camConstraints() {
  return {
    deviceId: S.webcamDeviceId ? { exact: S.webcamDeviceId } : undefined,
    width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 }
  };
}
/* ------------------------------------------------------------------ */
/* Gravação                                                             */
/* ------------------------------------------------------------------ */
function pickMime(fmt) {
  const mp4 = ['video/mp4;codecs=avc1.640033,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4;codecs=avc1,opus', 'video/mp4;codecs=avc1', 'video/mp4'];
  const webm = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  const list = fmt === 'webm' ? [...webm, ...mp4] : [...mp4, ...webm];
  const mime = list.find((m) => MediaRecorder.isTypeSupported(m)) || '';
  return { mime, ext: mime.startsWith('video/mp4') ? 'mp4' : 'webm' };
}

async function playStream(stream) {
  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.srcObject = stream;
  await v.play();
  if (!v.videoWidth) await new Promise((r) => { v.onloadedmetadata = r; setTimeout(r, 1500); });
  return v;
}

function drawCam(ctx, W, H, v) {
  const vw = v.videoWidth || v.width, vh = v.videoHeight || v.height;
  if (!vw || !vh) return;
  const circle = S.webcamShape === 'circle';
  const w = Math.round(W * S.webcamSize / 100);
  const h = circle ? w : Math.round(w * vh / vw);
  const m = Math.round(Math.min(W, H) * 0.025);
  const pos = S.webcamPos || 'br';
  const x = pos.includes('l') ? m : W - w - m;
  const y = pos.includes('t') ? m : H - h - m;
  let sx = 0, sy = 0, sw = vw, sh = vh;
  if (circle) { const s = Math.min(vw, vh); sx = (vw - s) / 2; sy = (vh - s) / 2; sw = sh = s; }

  ctx.save();
  ctx.beginPath();
  if (circle) ctx.arc(x + w / 2, y + h / 2, w / 2, 0, Math.PI * 2);
  else ctx.roundRect(x, y, w, h, Math.round(w * 0.04));
  ctx.closePath();
  ctx.save();
  ctx.clip();
  if (S.webcamMirror) { ctx.translate(x + w, y); ctx.scale(-1, 1); ctx.drawImage(v, sx, sy, sw, sh, 0, 0, w, h); }
  else ctx.drawImage(v, sx, sy, sw, sh, x, y, w, h);
  ctx.restore();
  ctx.lineWidth = Math.max(2, Math.round(w * 0.015));
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.stroke();
  ctx.restore();
}

/* Microfone: restrições conforme a redução de ruído escolhida */
function micConstraints() {
  const on = S.micNoise !== 'off';
  return {
    deviceId: S.micDeviceId ? { exact: S.micDeviceId } : undefined,
    echoCancellation: on, noiseSuppression: on, autoGainControl: on
  };
}
// Redução de ruído forte: RNNoise (IA) rodando localmente num AudioWorklet
const NS_BASE = 'gt://app/node_modules/@sapphi-red/web-noise-suppressor/dist';
let rnnoiseBin = null;
async function strongNoiseNode(ctx) {
  if (!rnnoiseBin) {
    const r = await fetch(`${NS_BASE}/rnnoise_simd.wasm`);
    if (!r.ok) throw new Error('RNNoise não encontrado (rode npm install)');
    rnnoiseBin = await r.arrayBuffer();
  }
  await ctx.audioWorklet.addModule(`${NS_BASE}/rnnoise/workletProcessor.js`);
  return new AudioWorkletNode(ctx, '@sapphi-red/web-noise-suppressor/rnnoise', {
    processorOptions: { maxChannels: 2, wasmBinary: rnnoiseBin }
  });
}
// Liga a fonte do microfone ao ganho, com o filtro de ruído no meio quando ativado
async function connectMic(ctx, source, gain) {
  if (S.micNoise === 'strong') {
    try { const ns = await strongNoiseNode(ctx); source.connect(ns); ns.connect(gain); return true; }
    catch (e) { toast(`Redução de ruído forte indisponível: ${e.message}`, true); }
  }
  source.connect(gain);
  return false;
}
function loadImage(url) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
}
function drawWatermark(ctx, W, H, img) {
  const w = Math.round(W * (S.wmSize || 14) / 100);
  const h = Math.round(w * img.naturalHeight / img.naturalWidth);
  const m = Math.round(Math.min(W, H) * 0.025);
  const pos = S.wmPos || 'br';
  const x = pos.includes('l') ? m : W - w - m;
  const y = pos.includes('t') ? m : H - h - m;
  ctx.save(); ctx.globalAlpha = (S.wmOpacity || 80) / 100; ctx.drawImage(img, x, y, w, h); ctx.restore();
}

let counting = false;
const MB = 1024 * 1024;
const AUDIO_MIME = () => ['audio/webm;codecs=opus', 'audio/webm'].find((x) => MediaRecorder.isTypeSupported(x)) || '';

// Um MediaRecorder que manda os pedaços para o disco (pelo processo principal), em ordem
function makeRecorder(stream, opts, write, counts) {
  const r = new MediaRecorder(stream, opts);
  const rr = { r, chain: Promise.resolve() };
  rr.stopped = new Promise((res) => { r.onstop = res; });
  r.ondataavailable = (e) => {
    if (!e.data || !e.data.size) return;
    if (counts) { state.bytes += e.data.size; state.partBytes += e.data.size; }
    const blob = e.data;
    rr.chain = rr.chain.then(async () => write(await blob.arrayBuffer())).catch(() => {});
  };
  r.onerror = (e) => { toast(`Erro na gravação: ${e.error ? e.error.message : 'desconhecido'}`, true); stopRecording(); };
  return rr;
}
// gravadores da sessão: vídeo (ou só áudio, no modo FFmpeg) + trilhas separadas
function createRecorders(sess) {
  const recs = {};
  if (sess.engine === 'ffmpeg') {
    if (sess.mixStream) recs.main = makeRecorder(sess.mixStream, { mimeType: AUDIO_MIME() || undefined, audioBitsPerSecond: 192000 }, (b) => api.recChunk(b), false);
  } else {
    recs.main = makeRecorder(sess.outStream, {
      mimeType: sess.mime || undefined,
      videoBitsPerSecond: Math.round(S.bitrate * 1e6),
      audioBitsPerSecond: 192000,
      videoKeyFrameIntervalDuration: 2000 // fragmentos a cada ~2s: o arquivo vai sendo gravado no disco
    }, (b) => api.recChunk(b), true);
  }
  Object.entries(sess.trackStreams || {}).forEach(([name, st]) => {
    recs[name] = makeRecorder(st, { mimeType: AUDIO_MIME() || undefined, audioBitsPerSecond: 160000 }, (b) => api.recTrackChunk(name, b), false);
  });
  return recs;
}
async function stopRecorders(sess) {
  const list = Object.values(sess.recs || {});
  list.forEach((rr) => { if (rr.r.state !== 'inactive') rr.r.stop(); });
  await Promise.all(list.map((rr) => rr.stopped));
  await Promise.all(list.map((rr) => rr.chain));
}

async function startRecording(opts = {}) {
  if (state.recording || starting || counting) return;
  // espaço em disco
  const free = await api.recDiskFree();
  if (free != null && free < 500 * MB) { toast(`Espaço insuficiente no disco (${fmtBytes(free)} livres).`, true); return; }
  if (free != null && free < 2048 * MB && !opts.continuation) toast(`Atenção: só ${fmtBytes(free)} livres no disco.`, true);
  // contagem regressiva antes de começar
  if (S.countdown > 0 && !opts.noCountdown) {
    counting = true; updateUI();
    const ok = await api.countdown(S.countdown);
    counting = false; updateUI();
    if (!ok) { toast('Gravação cancelada.'); return; }
  }
  starting = true;
  const sess = { begun: false, recs: {} };
  session = sess;
  try {
    const t = await api.captureTarget();
    if (t.error) throw new Error(t.error);
    const fps = Number(S.fps) || 30;
    sess.engine = S.engine === 'ffmpeg' && (t.kind === 'screen' || t.kind === 'area') ? 'ffmpeg' : 'browser';
    if (S.engine === 'ffmpeg' && sess.engine !== 'ffmpeg' && !opts.continuation) toast('A gravação pela placa de vídeo funciona em Tela inteira e Área; esta usa o modo padrão.');

    // 1) Tela / janela (+ som do sistema). No modo FFmpeg só o som do sistema vem daqui
    if (t.kind !== 'webcam') {
      const mandatory = { chromeMediaSource: 'desktop', chromeMediaSourceId: t.sourceId, maxFrameRate: sess.engine === 'ffmpeg' ? 1 : fps };
      if (sess.engine === 'ffmpeg') Object.assign(mandatory, { maxWidth: 320, maxHeight: 180 });
      else if (t.width) Object.assign(mandatory, { minWidth: t.width, maxWidth: t.width, minHeight: t.height, maxHeight: t.height });
      else Object.assign(mandatory, { maxWidth: 3840, maxHeight: 2160 });
      const video = { mandatory };
      if (S.systemAudio) {
        try {
          sess.screenStream = await navigator.mediaDevices.getUserMedia({ audio: { mandatory: { chromeMediaSource: 'desktop' } }, video });
        } catch {
          if (sess.engine !== 'ffmpeg') sess.screenStream = await navigator.mediaDevices.getUserMedia({ audio: false, video });
          toast('Som do sistema indisponível; gravando sem ele.', true);
        }
      } else if (sess.engine !== 'ffmpeg') {
        sess.screenStream = await navigator.mediaDevices.getUserMedia({ audio: false, video });
      }
      if (sess.engine !== 'ffmpeg') sess.screenVideo = await playStream(sess.screenStream);
    }

    // 2) Webcam
    // Nos modos Tela/Área a webcam é uma janela flutuante já capturada com a tela
    if (t.kind === 'webcam' || (S.webcam && t.kind === 'window')) {
      try {
        sess.camStream = await navigator.mediaDevices.getUserMedia({ video: camConstraints(), audio: false });
        sess.camVideo = await playStream(sess.camStream);
      } catch (e) {
        if (t.kind === 'webcam') throw new Error(`webcam indisponível (${e.message})`);
        toast('Webcam indisponível; gravando sem ela.', true);
      }
    }

    // 3) Microfone
    if (S.mic) {
      try {
        sess.micStream = await navigator.mediaDevices.getUserMedia({ audio: micConstraints(), video: false });
      } catch { toast('Microfone indisponível; gravando sem ele.', true); }
    }

    // Fundo desfocado da webcam (nos modos Janela e Webcam ela é desenhada aqui)
    if (sess.camVideo && S.webcamBlur) {
      try { sess.blur = await new window.BackgroundBlur().init(); }
      catch (e) { toast(`Desfoque indisponível: ${e.message}`, true); }
    }
    // Logo / marca d'água (no modo FFmpeg ele é aplicado pelo próprio FFmpeg)
    if (S.wmEnabled && sess.engine !== 'ffmpeg') {
      try { const url = await api.wmRead(); if (url) sess.wm = await loadImage(url); }
      catch { toast('Não foi possível carregar a imagem do logo.', true); }
    }

    // 4) Composição de vídeo
    let videoTrack = null;
    if (sess.engine !== 'ffmpeg') {
      const needCanvas = t.kind === 'webcam' || !!t.crop || !!sess.camVideo || !!sess.wm;
      if (!needCanvas) {
        videoTrack = sess.screenStream.getVideoTracks()[0];
      } else {
        let W, H, src = null;
        if (t.kind === 'webcam') { W = sess.camVideo.videoWidth; H = sess.camVideo.videoHeight; }
        else {
          const vw = sess.screenVideo.videoWidth, vh = sess.screenVideo.videoHeight;
          src = t.crop
            ? { x: Math.round(t.crop.x * vw), y: Math.round(t.crop.y * vh), w: Math.round(t.crop.w * vw), h: Math.round(t.crop.h * vh) }
            : { x: 0, y: 0, w: vw, h: vh };
          W = src.w; H = src.h;
        }
        W = even(W); H = even(H);
        const canvas = document.createElement('canvas');
        canvas.width = W; canvas.height = H;
        const ctx = canvas.getContext('2d', { alpha: false });
        const camSource = () => (sess.blur && S.webcamBlur ? sess.blur.process(sess.camVideo, S.webcamBlurStrength) : sess.camVideo);
        const draw = () => {
          if (t.kind === 'webcam') {
            const cam = camSource();
            if (S.webcamMirror) { ctx.save(); ctx.translate(W, 0); ctx.scale(-1, 1); ctx.drawImage(cam, 0, 0, W, H); ctx.restore(); }
            else ctx.drawImage(cam, 0, 0, W, H);
          } else {
            ctx.drawImage(sess.screenVideo, src.x, src.y, src.w, src.h, 0, 0, W, H);
            if (sess.camVideo) drawCam(ctx, W, H, camSource());
          }
          if (sess.wm && S.wmEnabled) drawWatermark(ctx, W, H, sess.wm);
        };
        draw();
        sess.timer = setInterval(draw, 1000 / fps);
        sess.canvas = canvas;
        videoTrack = canvas.captureStream(fps).getVideoTracks()[0];
      }
    }
    sess.videoTrack = videoTrack;

    // 5) Mixagem de áudio (e trilhas separadas, se pedido)
    const audioTracks = [];
    const sysTrack = sess.screenStream && sess.screenStream.getAudioTracks()[0];
    sess.trackStreams = {};
    if (sysTrack || sess.micStream) {
      const ac = new AudioContext({ sampleRate: 48000 });
      sess.audioCtx = ac;
      const dest = ac.createMediaStreamDestination();
      const separate = S.separateTracks && sysTrack && sess.micStream;
      if (sysTrack) {
        sess.sysGain = ac.createGain(); sess.sysGain.gain.value = S.systemVolume / 100;
        ac.createMediaStreamSource(new MediaStream([sysTrack])).connect(sess.sysGain).connect(dest);
        if (separate) { const d2 = ac.createMediaStreamDestination(); sess.sysGain.connect(d2); sess.trackStreams.sys = d2.stream; }
      }
      if (sess.micStream) {
        sess.micGain = ac.createGain(); sess.micGain.gain.value = S.micVolume / 100;
        await connectMic(ac, ac.createMediaStreamSource(sess.micStream), sess.micGain);
        sess.micGain.connect(dest);
        if (separate) { const d2 = ac.createMediaStreamDestination(); sess.micGain.connect(d2); sess.trackStreams.mic = d2.stream; }
      }
      audioTracks.push(dest.stream.getAudioTracks()[0]);
      const an = ac.createAnalyser(); an.fftSize = 1024;
      ac.createMediaStreamSource(dest.stream).connect(an);
      sess.vu = { an, buf: new Float32Array(an.fftSize) };
    }

    // 6) Gravadores
    if (sess.engine === 'ffmpeg') {
      sess.mixStream = audioTracks.length ? new MediaStream(audioTracks) : null;
    } else {
      sess.outStream = new MediaStream([videoTrack, ...audioTracks]);
      const { mime, ext } = pickMime(S.format);
      if (S.format === 'mp4' && ext !== 'mp4' && !opts.continuation) toast('MP4 não suportado nesta versão; gravando em WebM.', true);
      sess.mime = mime; sess.ext = ext;
    }
    // no modo FFmpeg o processo principal só responde quando o 1º quadro foi gravado
    const rb = await api.recBegin({
      ext: sess.ext || 'mp4', displayId: t.displayId, engine: sess.engine, audio: !!sess.mixStream,
      tracks: Object.keys(sess.trackStreams), continuation: !!opts.continuation
    });
    if (!rb || rb.error) throw new Error((rb && rb.error) || 'falha ao abrir o arquivo');
    sess.begun = true;
    state.file = rb.file;
    sess.recs = createRecorders(sess);

    // Se a janela/tela capturada sumir, encerra
    const srcTrack = sess.engine === 'ffmpeg' ? null : sess.screenStream ? sess.screenStream.getVideoTracks()[0] : sess.camStream.getVideoTracks()[0];
    if (srcTrack) srcTrack.addEventListener('ended', () => { toast('A fonte de captura foi encerrada.', true); stopRecording(); });

    Object.values(sess.recs).forEach((rr) => rr.r.start(1000));
    Object.assign(state, { recording: true, paused: false, startedAt: performance.now(), pausedAccum: 0, bytes: 0, partBytes: 0, partStart: 0, autoStopAt: null });

    const pv = $('#preview');
    if (videoTrack) {
      pv.srcObject = new MediaStream([videoTrack]);
      pv.play().catch(() => {});
      $('#previewEmpty').hidden = true;
    } else {
      $('#previewEmpty').textContent = `Gravando pelo FFmpeg (${rb.encoder || 'placa de vídeo'}). A pré-visualização fica desligada para não pesar.`;
    }
    requestAnimationFrame(vuLoop);
    updateUI();
  } catch (e) {
    if (sess.begun) await api.recEnd();
    cleanup(sess);
    toast(`Não foi possível iniciar: ${e.message}`, true);
  } finally {
    starting = false;
  }
}

async function stopRecording(opts = {}) {
  const sess = session;
  if (!state.recording || !sess || sess.stopping) return;
  sess.stopping = true;
  await stopRecorders(sess);
  await finishRecording(sess, opts);
}

async function finishRecording(sess, opts = {}) {
  const file = await api.recEnd({ split: !!opts.split });
  cleanup(sess);
  Object.assign(state, { recording: false, paused: false, autoStopAt: null });
  updateUI();
  refreshFiles();
  if (file && !opts.split) toast(`Vídeo salvo: ${file.split(/[\\/]/).pop()}`);
}

// Limite de tempo/tamanho: continua gravando num arquivo novo
async function splitRecording() {
  const sess = session;
  if (!sess || sess.splitting || sess.stopping || !state.recording) return;
  sess.splitting = true;
  try {
    if (sess.engine === 'ffmpeg') {
      const autoStop = state.autoStopAt;
      sess.stopping = true;
      await stopRecorders(sess);
      await finishRecording(sess, { split: true });
      await startRecording({ noCountdown: true, continuation: true });
      if (state.recording) state.autoStopAt = autoStop;
      toast('Limite atingido: a gravação continua num arquivo novo.');
      return;
    }
    await stopRecorders(sess);
    const file = await api.recSplit();
    if (!file) { stopRecording(); return; }
    state.file = file;
    sess.recs = createRecorders(sess);
    Object.values(sess.recs).forEach((rr) => rr.r.start(1000));
    if (state.paused) Object.values(sess.recs).forEach((rr) => rr.r.pause());
    state.partStart = elapsed(); state.partBytes = 0;
    toast(`Limite atingido: continuando em ${file.split(/[\\/]/).pop()}`);
  } finally { sess.splitting = false; }
}

function cleanup(sess) {
  if (!sess) return;
  clearInterval(sess.timer);
  [sess.screenStream, sess.camStream, sess.micStream].forEach((st) => st && st.getTracks().forEach((t) => t.stop()));
  if (sess.videoTrack) sess.videoTrack.stop();
  if (sess.audioCtx) sess.audioCtx.close().catch(() => {});
  [sess.screenVideo, sess.camVideo].forEach((v) => { if (v) v.srcObject = null; });
  $('#preview').srcObject = null;
  $('#previewEmpty').hidden = false;
  $('#previewEmpty').textContent = 'A pré-visualização aparece durante a gravação.';
  if (session === sess) session = null;
}

function toggleRecord() {
  if (counting) { api.countdownCancel(); return; }
  if (state.recording) stopRecording(); else startRecording();
}

async function togglePause() {
  const sess = session;
  if (!state.recording || !sess || sess.pausing || sess.stopping || sess.splitting) return;
  sess.pausing = true;
  const recs = Object.values(sess.recs || {});
  try {
    if (!state.paused) {
      recs.forEach((rr) => { if (rr.r.state === 'recording') rr.r.pause(); });
      state.paused = true; state.pauseStart = performance.now();
      api.recPaused(true); updateUI();
      if (sess.engine === 'ffmpeg') await api.recEnginePause(true);
    } else {
      if (sess.engine === 'ffmpeg' && !(await api.recEnginePause(false))) { sess.pausing = false; stopRecording(); return; }
      recs.forEach((rr) => { if (rr.r.state === 'paused') rr.r.resume(); });
      state.paused = false; state.pausedAccum += performance.now() - state.pauseStart;
      api.recPaused(false);
    }
  } finally { sess.pausing = false; updateUI(); }
}

function elapsed() {
  if (!state.recording) return 0;
  const now = performance.now();
  return now - state.startedAt - state.pausedAccum - (state.paused ? now - state.pauseStart : 0);
}

function grabFrame() {
  const s = session;
  if (!s) return null;
  try {
    if (s.canvas) return s.canvas.toDataURL('image/png');
    if (s.screenVideo) {
      const c = document.createElement('canvas');
      c.width = s.screenVideo.videoWidth; c.height = s.screenVideo.videoHeight;
      c.getContext('2d').drawImage(s.screenVideo, 0, 0);
      return c.toDataURL('image/png');
    }
  } catch { /* ignora */ }
  return null;
}

function tick() {
  if (!state.recording) return;
  $('#timer').textContent = fmtTime(elapsed());
  $('#size').textContent = fmtBytes(state.bytes);
  if (state.autoStopAt && Date.now() >= state.autoStopAt) { state.autoStopAt = null; stopRecording(); return; }
  // limite por parte (tempo ou tamanho)
  const s = session;
  if (S.limitMode && S.limitMode !== 'off' && s && !state.paused && !s.splitting && !s.stopping) {
    const over = S.limitMode === 'time'
      ? elapsed() - (state.partStart || 0) >= Math.max(1, Number(S.limitMinutes) || 30) * 60000
      : state.partBytes >= Math.max(50, Number(S.limitMB) || 2000) * MB;
    if (over) {
      if (S.limitAction === 'stop') { toast('Limite de gravação atingido: gravação encerrada.'); stopRecording(); }
      else splitRecording();
    }
  }
}

function updateUI() {
  const b = $('#btnRec');
  b.classList.toggle('recording', state.recording);
  $('#btnRecLabel').textContent = counting ? 'CANCELAR' : state.recording ? 'PARAR' : 'REC';
  $('#btnPause').disabled = !state.recording;
  $('#btnPause').innerHTML = state.paused
    ? '<svg viewBox="0 0 24 24"><path d="M8 5l11 7-11 7z"/></svg>'
    : '<svg viewBox="0 0 24 24"><path d="M9 5v14M15 5v14"/></svg>';
  const dot = $('#recDot');
  dot.classList.toggle('on', state.recording && !state.paused);
  dot.classList.toggle('paused', state.recording && state.paused);
  if (!state.recording) { $('#timer').textContent = '00:00:00'; $('#size').textContent = '0 MB'; }
  $$('#modes button').forEach((m) => { m.disabled = state.recording; });
  $('#btnSelectArea').disabled = state.recording;

  const hk = S.hotkeys || {};
  b.title = `Iniciar / parar (${hk.record || 'sem atalho'})`;
  $('#btnPause').title = `Pausar / retomar (${hk.pause || 'sem atalho'})`;
  $('#btnShot').title = `Capturar imagem (${hk.screenshot || 'sem atalho'})`;
  $('#btnCam').classList.toggle('active', !!S.webcam);
  $('#btnCam').title = `Mostrar / ocultar webcam (${hk.webcam || 'sem atalho'})`;
  $('#btnDraw').title = `Desenhar na tela (${hk.draw || 'sem atalho'})`;
  document.title = state.recording ? `● ${state.paused ? 'Pausado' : 'Gravando'} — RecFlow` : 'RecFlow';
}

/* ------------------------------------------------------------------ */
/* Atalhos                                                              */
/* ------------------------------------------------------------------ */
const KEY_MAP = {
  Space: 'Space', Enter: 'Enter', Tab: 'Tab', Insert: 'Insert', Home: 'Home', End: 'End',
  PageUp: 'PageUp', PageDown: 'PageDown', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  PrintScreen: 'PrintScreen', Pause: 'Pause', ScrollLock: 'Scrolllock', Minus: '-', Equal: '=',
  BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\', Backquote: '`'
};
function accelFromEvent(e) {
  const code = e.code;
  let key = null;
  let m;
  if ((m = /^Key([A-Z])$/.exec(code))) key = m[1];
  else if ((m = /^Digit(\d)$/.exec(code))) key = m[1];
  else if ((m = /^Numpad(\d)$/.exec(code))) key = `num${m[1]}`;
  else if (/^F\d{1,2}$/.test(code)) key = code;
  else if (KEY_MAP[code]) key = KEY_MAP[code];
  if (!key) return null;
  const mods = [];
  if (e.ctrlKey) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (e.metaKey) mods.push('Super');
  const standalone = /^F\d{1,2}$/.test(key) || ['PrintScreen', 'Pause', 'Scrolllock', 'Insert'].includes(key);
  if (!mods.length && !standalone) return { error: 'Use Ctrl, Alt ou Shift junto com essa tecla.' };
  return { acc: [...mods, key].join('+') };
}

function renderHotkeys() {
  const list = $('#hotkeyList'); list.innerHTML = '';
  const hk = S.hotkeys || {};
  Object.entries(HOTKEY_LABEL).forEach(([k, label]) => {
    const row = el('div', 'hk-row');
    const input = el('input');
    input.type = 'text'; input.readOnly = true; input.value = hk[k] || ''; input.placeholder = 'nenhum';
    input.addEventListener('focus', () => input.classList.add('listening'));
    input.addEventListener('blur', () => input.classList.remove('listening'));
    input.addEventListener('keydown', async (e) => {
      e.preventDefault();
      if (e.key === 'Escape') { input.blur(); return; }
      let acc;
      if (e.key === 'Backspace' || e.key === 'Delete') acc = '';
      else {
        const r = accelFromEvent(e);
        if (!r) return;
        if (r.error) { toast(r.error, true); return; }
        acc = r.acc;
      }
      const dup = Object.entries(S.hotkeys).find(([o, v]) => o !== k && v && v === acc);
      if (dup) { toast(`Esse atalho já está em "${HOTKEY_LABEL[dup[0]]}".`, true); return; }
      S.hotkeys = { ...S.hotkeys, [k]: acc };
      input.value = acc;
      await save({ hotkeys: { [k]: acc } }, true);
      input.blur();
      updateUI(); renderDrawKeys();
    });
    row.append(el('span', '', label), input);
    list.appendChild(row);
  });
  renderDrawKeys();
}
function renderDrawKeys() {
  const ul = $('#drawKeys'); ul.innerHTML = '';
  const hk = S.hotkeys || {};
  [[hk.draw, 'ativa/desativa o modo desenho'], [hk.clear, 'limpa todos os desenhos'], ['Ctrl+Z', 'desfaz o último traço (no modo desenho)'], ['Esc', 'sai do modo desenho']]
    .forEach(([k, txt]) => {
      const li = el('li'); li.append(el('b', '', k || '—'), document.createTextNode(` ${txt}`)); ul.appendChild(li);
    });
}

/* ------------------------------------------------------------------ */
/* Agendamento                                                          */
/* ------------------------------------------------------------------ */
async function addSchedule() {
  const start = $('#schStart').value;
  const duration = Number($('#schDur').value);
  if (!start) return toast('Informe a data e hora de início.', true);
  if (!(duration >= 1)) return toast('Duração inválida.', true);
  if (new Date(start).getTime() + duration * 60000 <= Date.now()) return toast('Esse horário já passou.', true);
  const item = { id: Date.now().toString(36), start, duration, enabled: true, done: false };
  S.schedules = [...(S.schedules || []), item].sort((a, b) => a.start.localeCompare(b.start));
  await save({ schedules: S.schedules }, true);
  renderSchedules();
  toast('Gravação agendada.');
}
function renderSchedules() {
  const list = $('#schedList'); list.innerHTML = '';
  const items = S.schedules || [];
  if (!items.length) { list.appendChild(el('div', 'empty', 'Nenhuma gravação agendada.')); return; }
  items.forEach((s) => {
    const row = el('div', 'row');
    const info = el('div', 'grow');
    const dt = new Date(s.start);
    info.append(
      el('div', 'title', dt.toLocaleString('pt-BR', { dateStyle: 'full', timeStyle: 'short' })),
      el('div', 'meta', `Duração: ${s.duration} min`)
    );
    const status = s.missed ? ['miss', 'Perdido'] : s.done ? ['ok', 'Executado'] : s.enabled ? ['wait', 'Aguardando'] : ['', 'Desativado'];
    const badge = el('span', `badge ${status[0]}`, status[1]);
    row.append(info, badge);
    if (!s.done) {
      const tg = el('button', 'btn small', s.enabled ? 'Desativar' : 'Ativar');
      tg.onclick = async () => { s.enabled = !s.enabled; await save({ schedules: S.schedules }, true); renderSchedules(); };
      row.appendChild(tg);
    }
    const del = el('button', 'btn small danger', 'Excluir');
    del.onclick = async () => { S.schedules = S.schedules.filter((x) => x.id !== s.id); await save({ schedules: S.schedules }, true); renderSchedules(); };
    row.appendChild(del);
    list.appendChild(row);
  });
}

/* ------------------------------------------------------------------ */
/* Arquivos                                                             */
/* ------------------------------------------------------------------ */
async function refreshFiles() {
  const files = await api.listFiles();
  const list = $('#fileList'); list.innerHTML = '';
  if (!files.length) { list.appendChild(el('div', 'empty', 'Nenhum arquivo ainda.')); return; }
  files.forEach((f) => {
    const ext = f.name.split('.').pop().toLowerCase();
    const row = el('div', 'row');
    const icon = el('div', `ftype ${ext}`, ext.toUpperCase());
    const info = el('div', 'grow');
    info.append(el('div', 'title', f.name), el('div', 'meta', `${fmtBytes(f.size)} · ${new Date(f.mtime).toLocaleString('pt-BR')}`));
    const isProj = ext === 'gtproj';
    const open = el('button', 'btn small', 'Abrir'); open.onclick = () => (isProj ? api.projectOpen(f.path) : api.openFile(f.path));
    const show = el('button', 'btn small ghost', 'Mostrar na pasta'); show.onclick = () => api.showFile(f.path);
    const del = el('button', 'btn small danger', 'Lixeira');
    del.onclick = async () => { if (await api.deleteFile(f.path)) refreshFiles(); };
    if (ext === 'mp4' || ext === 'webm') {
      const edit = el('button', 'btn small primary', 'Editar'); edit.onclick = () => api.openEditor(f.path);
      row.append(icon, info, edit, open, show, del);
    } else row.append(icon, info, open, show, del);
    if (isProj) { icon.textContent = 'PROJ'; open.classList.add('primary'); }
    row.ondblclick = () => (isProj ? api.projectOpen(f.path) : api.openFile(f.path));
    list.appendChild(row);
  });
}

/* Modo manual */
function renderManual() {
  const color = S.manualColor || '#ff3b30';
  $('#panel-manual').style.setProperty('--mc', color);
  $$('#manShapes button').forEach((b) => b.classList.toggle('on', b.dataset.shape === (S.manualShape || 'ellipse')));
  const box = $('#manColors'); box.innerHTML = '';
  MANUAL_COLORS.forEach((c) => {
    const b = el('button'); b.style.background = c; b.title = c; b.classList.toggle('on', c.toLowerCase() === color.toLowerCase());
    b.onclick = () => { S.manualColor = c; save({ manualColor: c }); renderManual(); };
    box.appendChild(b);
  });
  const custom = el('input'); custom.type = 'color'; custom.value = color; custom.title = 'Outra cor';
  custom.onchange = () => { S.manualColor = custom.value; save({ manualColor: custom.value }); renderManual(); };
  box.appendChild(custom);
  const hk = S.hotkeys || {};
  $('#mkMark').textContent = hk.manualMark || '—';
  $('#mkNew').textContent = hk.manualNewScreen || '—';
  $('#manualDir').textContent = S.manualDir || `${S.outputDir}\\Manuais`;
  if (document.activeElement !== $('#manTitle')) $('#manTitle').value = S.manualTitle || 'Manual';
  api.manualStatus().then(renderManualStatus);
  api.mdocHasLogo().then((has) => {
    $('#manLogo').disabled = !has; if (!has) $('#manLogo').checked = false; else $('#manLogo').checked = manualLogo;
    $('#manLogo').parentElement.title = has ? '' : 'Escolha um logo na aba Vídeo para usar esta opção';
  });
  refreshManuals();
}

let manualLogo = true;
async function refreshManuals() {
  const list = $('#manList'); if (!list) return;
  const items = await api.mdocList();
  list.innerHTML = '';
  if (!items.length) { list.appendChild(el('div', 'empty', 'Nenhum manual salvo ainda.')); return; }
  items.slice(0, 30).forEach((m) => {
    const row = el('div', 'row');
    const info = el('div', 'grow');
    info.append(el('div', 'title', m.title), el('div', 'meta', `${m.screens} tela(s) · ${m.items} item(ns) · ${new Date(m.updatedAt).toLocaleString('pt-BR')} · ${m.folder}`));
    const b = (label, cls, fn) => { const x = el('button', `btn small ${cls}`, label); x.onclick = fn; return x; };
    const exp = async (kind) => {
      const r = await api.mdocExport(m.dir, kind, { logo: manualLogo && !$('#manLogo').disabled });
      if (r.ok) { toast(`${kind === 'pdf' ? 'PDF' : 'Word'} salvo: ${r.file.split(/[\\/]/).pop()}`); api.mdocOpenFile(r.file); }
      else if (!r.canceled) toast(`Não foi possível exportar: ${r.error}`, true);
    };
    row.append(el('div', 'ftype man', 'DOC'), info,
      b('Editar', 'primary', () => api.mdocEdit(m.dir)),
      b('HTML', '', () => api.mdocOpenHtml(m.dir)),
      b('PDF', '', () => exp('pdf')),
      b('Word', '', () => exp('docx')),
      b('Traduzir', 'ghost', () => translateDialog(m)),
      b('Pasta', 'ghost', () => api.mdocOpenFolder(m.dir)));
    list.appendChild(row);
  });
}
function renderManualStatus(st) {
  if (!st) return;
  const has = st.active && st.items > 0;
  $('#manSessionText').textContent = has
    ? `${st.items} item(ns) em ${st.screens} tela(s) · ${st.dir.split(/[\\/]/).pop()}`
    : st.active ? 'Sessão aberta, sem marcações ainda.' : 'Nenhuma marcação ainda. Aperte Insert sobre um campo para começar.';
  ['#btnManHtml', '#btnManSessFolder', '#btnManEnd'].forEach((s) => { $(s).disabled = !has; });
}

/* Logo / marca d'água */
async function chooseWatermark() {
  const r = await api.wmChoose();
  if (!r) { if (!S.wmPath) { S.wmEnabled = false; setEl($('[data-key="wmEnabled"]'), false); save({ wmEnabled: false }); } return; }
  if (r.error) { toast(r.error, true); return; }
  S.wmPath = r.path; S.wmEnabled = true; setEl($('[data-key="wmEnabled"]'), true);
  showWatermark(r.dataUrl); renderSummary();
}
async function refreshWatermark() { showWatermark(S.wmPath ? await api.wmRead() : null); }
function showWatermark(url) {
  const box = $('#wmPreview'); box.innerHTML = '';
  if (url) { const i = el('img'); i.src = url; i.style.opacity = String((S.wmOpacity || 80) / 100); box.appendChild(i); }
  else box.appendChild(el('span', '', 'Sem imagem'));
}

/* ------------------------------------------------------------------ */
/* Medidores de áudio e teste de 5 segundos                             */
/* ------------------------------------------------------------------ */
let monitor = null;
let testing = false, testUrl = null, testPeaks = null;
const testAudio = new Audio();
const meterHist = { sys: [], mic: [] };

function measure(node) {
  node.an.getFloatTimeDomainData(node.buf);
  let sum = 0, peak = 0;
  for (let i = 0; i < node.buf.length; i++) { const v = node.buf[i]; sum += v * v; const a = Math.abs(v); if (a > peak) peak = a; }
  const rms = Math.sqrt(sum / node.buf.length);
  const db = 20 * Math.log10(Math.max(rms, 1e-6));
  return { db, peak, lvl: Math.max(0, Math.min(1, (db + 60) / 60)) };
}

async function startMonitor() {
  if (monitor) return monitor;
  const m = { ctx: new AudioContext({ sampleRate: 48000 }), streams: [], frame: 0 };
  monitor = m;
  m.ctx.resume().catch(() => {});
  m.dest = m.ctx.createMediaStreamDestination();
  const add = async (stream, key, vol) => {
    const src = m.ctx.createMediaStreamSource(stream);
    const gain = m.ctx.createGain(); gain.gain.value = vol / 100;
    const an = m.ctx.createAnalyser(); an.fftSize = 2048;
    if (key === 'mic') await connectMic(m.ctx, src, gain); else src.connect(gain);
    gain.connect(an); gain.connect(m.dest);
    m[key] = { gain, an, buf: new Float32Array(an.fftSize) };
  };
  if (S.systemAudio) {
    try {
      const st = await navigator.mediaDevices.getUserMedia({
        audio: { mandatory: { chromeMediaSource: 'desktop' } },
        video: { mandatory: { chromeMediaSource: 'desktop', maxWidth: 320, maxHeight: 180, maxFrameRate: 1 } }
      });
      m.streams.push(st);
      if (st.getAudioTracks().length) await add(new MediaStream(st.getAudioTracks()), 'sys', S.systemVolume);
      else m.sysErr = 'Sem áudio do sistema';
    } catch (e) { m.sysErr = `Indisponível: ${e.message}`; }
  }
  if (S.mic) {
    try {
      const st = await navigator.mediaDevices.getUserMedia({ audio: micConstraints(), video: false });
      m.streams.push(st);
      await add(st, 'mic', S.micVolume);
    } catch (e) { m.micErr = `Indisponível: ${e.message}`; }
  }
  if (monitor !== m) { closeMonitor(m); return null; }   // fechado enquanto abria
  meterHist.sys = []; meterHist.mic = [];
  m.raf = requestAnimationFrame(meterLoop);
  return m;
}
function closeMonitor(m) {
  cancelAnimationFrame(m.raf);
  m.streams.forEach((st) => st.getTracks().forEach((t) => t.stop()));
  m.ctx.close().catch(() => {});
}
function stopMonitor() {
  if (!monitor) return;
  const m = monitor; monitor = null; closeMonitor(m);
  drawMeters();
}
function restartMonitor() {
  if (!$('#panel-audio').classList.contains('active') || testing) return;
  stopMonitor(); startMonitor();
}

function meterLoop() {
  const m = monitor; if (!m) return;
  m.frame++;
  if (m.frame % 2 === 0) {
    [['sys', '#dbSys'], ['mic', '#dbMic']].forEach(([key, lbl]) => {
      const node = m[key];
      if (!node) return;
      const r = measure(node);
      meterHist[key].push(r);
      if (meterHist[key].length > 600) meterHist[key].shift();
      const label = $(lbl);
      label.textContent = r.peak >= 0.99 ? 'saturando!' : r.lvl < 0.02 ? 'silêncio' : `${Math.round(r.db)} dB`;
      label.style.color = r.peak >= 0.99 ? 'var(--red)' : '';
    });
    drawMeters();
  }
  m.raf = requestAnimationFrame(meterLoop);
}

function prepCanvas(c) {
  const dpr = window.devicePixelRatio || 1;
  const w = c.clientWidth, h = c.clientHeight;
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
  const ctx = c.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}
const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
function alpha(c, a) {
  const m = /^#([0-9a-f]{6})/i.exec(c); if (!m) return c;
  const n = parseInt(m[1], 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}

function drawMeter(canvas, hist, color, msg) {
  if (!canvas.clientWidth) return;
  const { ctx, w, h } = prepCanvas(canvas);
  // linhas de referência
  ctx.strokeStyle = cssVar('--line'); ctx.fillStyle = cssVar('--muted'); ctx.font = '10px "Segoe UI", sans-serif'; ctx.lineWidth = 1;
  [-6, -18, -36].forEach((db) => {
    const y = Math.round(h - ((db + 60) / 60) * (h - 6)) + 0.5;
    ctx.beginPath(); ctx.moveTo(30, y); ctx.lineTo(w, y); ctx.stroke();
    ctx.fillText(`${db}`, 4, y + 3);
  });
  if (msg) {
    ctx.fillStyle = cssVar('--muted'); ctx.font = '12.5px "Segoe UI", sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(msg, w / 2, h / 2 + 4); ctx.textAlign = 'left';
    return;
  }
  const step = 2, n = Math.min(hist.length, Math.floor((w - 30) / step));
  if (!n) return;
  const pts = hist.slice(-n);
  const yOf = (l) => h - l * (h - 6);
  ctx.beginPath(); ctx.moveTo(w - (n - 1) * step, h);
  pts.forEach((p, i) => ctx.lineTo(w - (n - 1 - i) * step, yOf(p.lvl)));
  ctx.lineTo(w, h); ctx.closePath();
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, alpha(color, 0.7)); g.addColorStop(1, alpha(color, 0.08));
  ctx.fillStyle = g; ctx.fill();
  ctx.beginPath();
  pts.forEach((p, i) => { const x = w - (n - 1 - i) * step, y = yOf(p.lvl); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
  ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.stroke();
  // nível atual + pico
  const last = pts[pts.length - 1];
  ctx.fillStyle = last.peak >= 0.99 ? cssVar('--red') : color;
  ctx.fillRect(w - 4, yOf(last.lvl), 4, h - yOf(last.lvl));
}
function drawMeters() {
  const m = monitor;
  const sysMsg = !S.systemAudio ? 'Desativado' : !m ? 'Abra esta aba para medir' : m.sysErr || (!m.sys ? 'Abrindo…' : null);
  const micMsg = !S.mic ? 'Desativado' : !m ? 'Abra esta aba para medir' : m.micErr || (!m.mic ? 'Abrindo…' : null);
  drawMeter($('#meterSys'), meterHist.sys, cssVar('--accent'), sysMsg);
  drawMeter($('#meterMic'), meterHist.mic, cssVar('--green'), micMsg);
  if (!m) { $('#dbSys').textContent = '—'; $('#dbMic').textContent = '—'; }
}

async function testRecord() {
  if (testing) return;
  const m = await startMonitor();
  if (!m || (!m.sys && !m.mic)) { toast('Ative o som do sistema ou o microfone para testar.', true); return; }
  testing = true; testAudio.pause();
  $('#btnTestRec').disabled = true; $('#btnTestPlay').disabled = true;
  const mime = ['audio/webm;codecs=opus', 'audio/webm'].find((x) => MediaRecorder.isTypeSupported(x)) || '';
  const rec = new MediaRecorder(m.dest.stream, mime ? { mimeType: mime } : undefined);
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const t0 = performance.now();
  const anim = () => {
    if (!testing) return;
    const p = Math.min(1, (performance.now() - t0) / 5000);
    $('#testHint').textContent = `Gravando… ${Math.ceil(5 - p * 5)} s`;
    drawTestWave(p, true);
    requestAnimationFrame(anim);
  };
  rec.onstop = async () => {
    testing = false;
    $('#btnTestRec').disabled = false;
    const blob = new Blob(chunks, { type: mime || 'audio/webm' });
    if (testUrl) URL.revokeObjectURL(testUrl);
    testUrl = URL.createObjectURL(blob);
    try {
      const ctx = new AudioContext();
      const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
      ctx.close();
      const data = buf.getChannelData(0); const N = 400; const step = Math.max(1, Math.floor(data.length / N));
      testPeaks = [];
      for (let i = 0; i < data.length; i += step) { let mx = 0; for (let j = i; j < i + step && j < data.length; j++) mx = Math.max(mx, Math.abs(data[j])); testPeaks.push(mx); }
      const max = Math.max(...testPeaks);
      $('#testHint').textContent = max < 0.01
        ? 'Pronto, mas quase não houve som. Confira se a fonte certa está ativada e o volume.'
        : 'Pronto! Ouvindo o teste… (clique no gráfico para pular)';
    } catch { testPeaks = null; $('#testHint').textContent = 'Pronto! Ouvindo o teste…'; }
    $('#btnTestPlay').disabled = false;
    drawTestWave(0);
    testPlay();
    if (!$('#panel-audio').classList.contains('active')) stopMonitor();
  };
  rec.start();
  requestAnimationFrame(anim);
  setTimeout(() => { if (rec.state !== 'inactive') rec.stop(); }, 5000);
}

function testPlay() {
  if (!testUrl) return;
  if (!testAudio.paused) { testAudio.pause(); return; }
  if (testAudio.src !== testUrl) testAudio.src = testUrl;
  testAudio.play();
  const anim = () => {
    const d = testAudio.duration;
    drawTestWave(Number.isFinite(d) && d ? testAudio.currentTime / d : 0);
    if (!testAudio.paused) requestAnimationFrame(anim);
  };
  requestAnimationFrame(anim);
}
testAudio.addEventListener('play', () => { $('#btnTestPlay').textContent = '❚❚ Pausar'; });
testAudio.addEventListener('pause', () => { $('#btnTestPlay').textContent = '▶ Ouvir'; drawTestWave(0); });
testAudio.addEventListener('ended', () => { $('#btnTestPlay').textContent = '▶ Ouvir'; drawTestWave(0); });

function drawTestWave(p = 0, recording = false) {
  const c = $('#testWave'); if (!c.clientWidth) return;
  const { ctx, w, h } = prepCanvas(c);
  const accent = cssVar('--accent'), muted = cssVar('--line-hover');
  if (recording) {
    ctx.fillStyle = alpha(cssVar('--red'), 0.25);
    ctx.fillRect(0, 0, w * p, h);
    const m = monitor; const nodes = m ? [m.sys, m.mic].filter(Boolean) : [];
    const lvl = nodes.length ? Math.max(...nodes.map((nd) => measure(nd).lvl)) : 0;
    ctx.fillStyle = cssVar('--red');
    ctx.fillRect(w * p - 3, h / 2 - (lvl * h) / 2, 3, lvl * h);
    return;
  }
  if (!testPeaks) {
    ctx.fillStyle = cssVar('--muted'); ctx.font = '12.5px "Segoe UI", sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('Nenhum teste gravado ainda', w / 2, h / 2 + 4); ctx.textAlign = 'left';
    return;
  }
  const n = testPeaks.length; const bw = w / n;
  testPeaks.forEach((v, i) => {
    const bh = Math.max(1, Math.sqrt(v) * (h - 8));
    ctx.fillStyle = i / n <= p && p > 0 ? accent : muted;
    ctx.fillRect(i * bw, (h - bh) / 2, Math.max(1, bw - 0.5), bh);
  });
  if (p > 0) { ctx.fillStyle = cssVar('--text'); ctx.fillRect(w * p - 1, 0, 2, h); }
}

/* Medidor da barra superior durante a gravação */
function vuLoop() {
  const bar = $('#vuBar');
  if (!session || !session.vu || !state.recording) { bar.style.width = '0'; return; }
  const r = measure(session.vu);
  bar.style.width = `${Math.round(r.lvl * 100)}%`;
  bar.style.background = r.peak >= 0.99 ? 'var(--red)' : state.paused ? 'var(--muted)' : 'var(--green)';
  requestAnimationFrame(vuLoop);
}

/* ------------------------------------------------------------------ */
/* Diálogo simples                                                      */
/* ------------------------------------------------------------------ */
function showDlg(title, body, actions) {
  $('#dlgTitle').textContent = title;
  const b = $('#dlgBody'); b.innerHTML = '';
  if (typeof body === 'string') b.appendChild(el('p', 'hint', body)); else if (body) b.appendChild(body);
  const a = $('#dlgActions'); a.innerHTML = '';
  actions.forEach(([label, fn, cls]) => { const x = el('button', `btn ${cls || ''}`, label); x.onclick = fn; a.appendChild(x); });
  $('#dlg').hidden = false;
}
function hideDlg() { $('#dlg').hidden = true; }

/* ------------------------------------------------------------------ */
/* Motor de gravação e limites                                          */
/* ------------------------------------------------------------------ */
function renderEngine() {
  const ff = S.engine === 'ffmpeg';
  $('#encLabel').hidden = !ff; $('#grabLabel').hidden = !ff; $('#engineRow').hidden = !ff; $('#engineHint').hidden = !ff;
  const sel = $('#hwEncoder'); const cur = S.hwEncoder || 'auto';
  sel.innerHTML = '';
  sel.add(new Option('Automático (placa de vídeo, se houver)', 'auto'));
  (S.hwEncoders || []).forEach((e) => sel.add(new Option(e.label, e.id)));
  sel.value = cur; if (sel.value !== cur) sel.value = 'auto';
  const hw = (S.hwEncoders || []).filter((e) => e.id !== 'libx264');
  $('#encInfo').textContent = !S.hwEncoders ? 'Ainda não verificado.' : hw.length ? `Encontrado: ${hw.map((e) => e.label).join(', ')}` : 'Nenhum codificador de placa de vídeo encontrado; será usado o processador (x264).';
}
async function detectEncoders() {
  $('#btnDetectEnc').disabled = true; $('#encInfo').textContent = 'Verificando…';
  try { S.hwEncoders = await api.recEncoders(true); } finally { $('#btnDetectEnc').disabled = false; }
  renderEngine();
}
function renderLimits() {
  const m = S.limitMode || 'off';
  $('#limTime').hidden = m !== 'time'; $('#limSize').hidden = m !== 'size'; $('#limAction').hidden = m === 'off';
}

/* ------------------------------------------------------------------ */
/* Recuperação de gravações interrompidas                               */
/* ------------------------------------------------------------------ */
async function refreshRecovery() {
  const items = await api.recoveryList();
  const box = $('#recoverBox'); const list = $('#recoverList');
  box.hidden = !items.length; list.innerHTML = '';
  items.forEach((it) => {
    const row = el('div', 'row');
    const info = el('div', 'grow');
    info.append(el('div', 'title', it.name), el('div', 'meta', `${fmtBytes(it.size)} · iniciada em ${new Date(it.startedAt).toLocaleString('pt-BR')}${it.engine === 'ffmpeg' ? ' · FFmpeg' : ''}`));
    const ok = el('button', 'btn small primary', 'Recuperar');
    const no = el('button', 'btn small ghost', 'Descartar');
    ok.onclick = async () => {
      ok.disabled = no.disabled = true; ok.textContent = 'Recuperando…';
      const r = await api.recoveryRepair(it.id);
      if (r.ok) {
        toast(`Recuperado: ${r.name} (${fmtTime(r.duration * 1000)})`);
        showDlg('Gravação recuperada', `O vídeo "${r.name}" foi salvo na pasta de gravações. Os pedaços danificados foram para a Lixeira.`, [
          ['Abrir no editor', () => { hideDlg(); api.openEditor(r.file); }, 'primary'], ['Fechar', hideDlg]]);
      } else { toast(`Não foi possível recuperar: ${r.error}`, true); ok.disabled = no.disabled = false; ok.textContent = 'Tentar de novo'; return; }
      refreshRecovery(); refreshFiles();
    };
    no.onclick = () => showDlg('Descartar gravação?', `Os arquivos de "${it.name}" vão para a Lixeira.`, [
      ['Cancelar', hideDlg], ['Descartar', async () => { hideDlg(); await api.recoveryDiscard(it.id); refreshRecovery(); }, 'danger']]);
    row.append(el('div', 'ftype mp4', 'REC'), info, ok, no);
    list.appendChild(row);
  });
}

/* ------------------------------------------------------------------ */
/* Identidade visual                                                    */
/* ------------------------------------------------------------------ */
let brandLogoImg = null;
const BRAND_FIELDS = [['#brName', 'name'], ['#brSite', 'site'], ['#brFooter', 'footer'], ['#brColor', 'color'], ['#brColor2', 'color2']];
function brand() { return { name: '', color: '#e5484d', color2: '#111827', logoPath: '', footer: '', site: '', ...(S.brand || {}) }; }
async function renderBrand(reloadLogo = true) {
  const b = brand();
  BRAND_FIELDS.forEach(([id, k]) => { if (document.activeElement !== $(id)) $(id).value = b[k] || ''; });
  $('#brColorTxt').textContent = b.color; $('#brColor2Txt').textContent = b.color2;
  if (reloadLogo) {
    const url = b.logoPath ? await api.brandLogo() : null;
    brandLogoImg = url ? await loadImage(url).catch(() => null) : null;
    const box = $('#brLogo'); box.innerHTML = '';
    if (url) { const i = el('img'); i.src = url; box.appendChild(i); } else box.appendChild(el('span', '', 'Sem logo'));
    $('#btnBrLogoDel').disabled = !url; $('#btnBrToWm').disabled = !url;
  }
  const pv = $('#brPreview');
  pv.style.setProperty('--bc', b.color); pv.style.setProperty('--bc2', b.color2);
  $('#bpName').textContent = b.name || 'Passo a passo';
  $('#bpFoot').textContent = b.footer || 'Gerado pelo RecFlow';
  const bl = $('#bpLogo'); bl.hidden = !brandLogoImg; if (brandLogoImg) bl.src = brandLogoImg.src;
  const c = $('#bpCard');
  window.RFBrand.drawCard(c.getContext('2d'), c.width, c.height, { brand: b, logo: brandLogoImg, title: 'Como emitir a nota fiscal', kind: 'intro' });
}
function bindBrand() {
  BRAND_FIELDS.forEach(([id, k]) => {
    $(id).addEventListener('input', (e) => { S.brand = { ...brand(), [k]: e.target.value }; save({ brand: S.brand }); renderBrand(false); });
  });
  $('#btnBrLogo').onclick = async () => {
    const r = await api.brandChooseLogo(); if (!r) return;
    if (r.error) { toast(r.error, true); return; }
    S.brand = { ...brand(), logoPath: r.path }; renderBrand();
  };
  $('#btnBrLogoDel').onclick = async () => { S.brand = { ...brand(), logoPath: '' }; await save({ brand: S.brand }, true); renderBrand(); };
  $('#btnBrToWm').onclick = async () => {
    const b = brand(); if (!b.logoPath) return;
    S.wmPath = b.logoPath; S.wmEnabled = true;
    await save({ wmPath: b.logoPath, wmEnabled: true }, true);
    setEl($('[data-key="wmEnabled"]'), true); refreshWatermark(); renderSummary();
    toast('Logo aplicado como marca d\'água das gravações (aba Vídeo).');
  };
}

/* ------------------------------------------------------------------ */
/* IA: credenciais                                                      */
/* ------------------------------------------------------------------ */
let aiState = null, aiEditing = null;
const AI_KEY_LINKS = {
  anthropic: 'https://console.anthropic.com/settings/keys', openai: 'https://platform.openai.com/api-keys',
  gemini: 'https://aistudio.google.com/apikey', compatible: 'https://console.groq.com/keys'
};
async function refreshAi() {
  aiState = await api.aiList();
  $('#aiEncWarn').hidden = aiState.encryption;
  const list = $('#aiList'); list.innerHTML = '';
  if (!aiState.profiles.length) list.appendChild(el('div', 'empty', 'Nenhuma credencial cadastrada. Clique em "Adicionar credencial".'));
  aiState.profiles.forEach((p) => {
    const row = el('div', 'row');
    const info = el('div', 'grow');
    const prov = aiState.providers[p.provider] ? aiState.providers[p.provider].label : p.provider;
    const uses = Object.entries(aiState.use).filter(([, id]) => id === p.id).map(([u]) => ({ text: 'textos', transcribe: 'transcrição', tts: 'narração' }[u]));
    info.append(el('div', 'title', p.name), el('div', 'meta', [prov, p.model || p.ttsModel || (p.provider === 'http' ? p.httpUrl : ''), p.hasKey ? `chave ${p.keyMask}` : 'sem chave', p.sessionOnly ? 'só nesta sessão' : '', uses.length ? `usado em: ${uses.join(', ')}` : ''].filter(Boolean).join(' · ')));
    const b = (label, cls, fn) => { const x = el('button', `btn small ${cls}`, label); x.onclick = fn; return x; };
    const test = b('Testar', '', async () => {
      test.disabled = true; test.textContent = 'Testando…';
      const r = await api.aiTest(p.id);
      test.disabled = false; test.textContent = 'Testar';
      toast(r.ok ? r.data : r.error, !r.ok);
    });
    row.append(el('div', 'ftype ai', 'IA'), info, test, b('Editar', 'ghost', () => editAi(p)),
      b('Excluir', 'danger', () => showDlg('Excluir credencial?', `"${p.name}" e a chave guardada serão apagadas deste computador.`, [
        ['Cancelar', hideDlg], ['Excluir', async () => { hideDlg(); await api.aiRemove(p.id); refreshAi(); }, 'danger']])));
    list.appendChild(row);
  });
  const fill = (sel, use) => {
    const e = $(sel); e.innerHTML = ''; e.add(new Option('— nenhum —', ''));
    aiState.profiles.filter((p) => aiState.providers[p.provider] && aiState.providers[p.provider].uses.includes(use)).forEach((p) => e.add(new Option(p.name, p.id)));
    e.value = aiState.use[use] || '';
  };
  fill('#aiUseText', 'text'); fill('#aiUseStt', 'transcribe'); fill('#aiUseTts', 'tts');
  $('#aiLang').value = aiState.lang || 'pt-BR';
  if (!$('#aiProvider').options.length) Object.entries(aiState.providers).forEach(([k, v]) => $('#aiProvider').add(new Option(v.label, k)));
}
function aiFormLayout() {
  const pv = $('#aiProvider').value;
  const P = aiState.providers[pv] || { uses: [] };
  $('#aiRowBase').hidden = pv === 'http';
  $('#aiBase').placeholder = P.base || 'https://api.exemplo.com/v1';
  $('#aiRowModel').hidden = pv === 'http';
  $('#aiRowStt').hidden = !P.uses.includes('transcribe');
  $('#aiRowTts').hidden = !P.uses.includes('tts') || pv === 'http';
  $('#aiRowHttp').hidden = pv !== 'http';
  const link = AI_KEY_LINKS[pv];
  const kl = $('#aiKeyLink'); kl.innerHTML = '';
  if (link) {
    const a = el('a', '', pv === 'compatible' ? 'Exemplo: obter chave do Groq' : 'Onde obter a chave'); a.href = '#';
    a.onclick = (e) => { e.preventDefault(); api.aiOpenLink(link); };
    kl.appendChild(a);
  }
  if (pv === 'compatible') kl.appendChild(el('span', 'hint', ' · Ollama/LM Studio locais não precisam de chave (ex.: http://localhost:11434/v1).'));
}
function editAi(p) {
  aiEditing = p ? p.id : null;
  const f = p || { provider: 'anthropic' };
  $('#aiName').value = f.name || '';
  $('#aiProvider').value = f.provider;
  $('#aiBase').value = f.baseUrl || '';
  $('#aiKey').value = ''; $('#aiKey').placeholder = p && p.hasKey ? `Chave guardada (${p.keyMask}). Deixe em branco para manter.` : 'Cole a chave aqui';
  $('#aiModel').value = f.model || ''; $('#aiStt').value = f.sttModel || ''; $('#aiTtsModel').value = f.ttsModel || ''; $('#aiVoice').value = f.voice || '';
  $('#aiHttpUrl').value = f.httpUrl || ''; $('#aiHttpHeaders').value = f.httpHeaders || ''; $('#aiHttpBody').value = f.httpBody || '';
  $('#aiHttpResp').value = f.httpResponse || 'audio'; $('#aiHttpPath').value = f.httpJsonPath || '';
  $('#aiModels').innerHTML = '';
  aiFormLayout();
  $('#aiForm').hidden = false;
  $('#aiName').focus();
}
function aiFormData() {
  return {
    id: aiEditing || undefined, name: $('#aiName').value, provider: $('#aiProvider').value, baseUrl: $('#aiBase').value,
    apiKey: $('#aiKey').value, model: $('#aiModel').value, sttModel: $('#aiStt').value, ttsModel: $('#aiTtsModel').value, voice: $('#aiVoice').value,
    httpUrl: $('#aiHttpUrl').value, httpHeaders: $('#aiHttpHeaders').value, httpBody: $('#aiHttpBody').value,
    httpResponse: $('#aiHttpResp').value, httpJsonPath: $('#aiHttpPath').value
  };
}
async function saveAi() {
  const r = await api.aiSave(aiFormData());
  if (!r.ok) { toast(r.error, true); return null; }
  const saved = r.data.profiles.find((p) => p.id === aiEditing) || r.data.profiles[r.data.profiles.length - 1];
  aiEditing = saved ? saved.id : null;
  $('#aiKey').value = '';
  return saved;
}
function bindAi() {
  $('#btnAiAdd').onclick = () => editAi(null);
  $('#aiProvider').onchange = aiFormLayout;
  $('#btnAiCancel').onclick = () => { $('#aiForm').hidden = true; aiEditing = null; };
  $('#btnAiSave').onclick = async () => { const p = await saveAi(); if (p) { $('#aiForm').hidden = true; toast('Credencial salva.'); refreshAi(); } };
  $('#btnAiModels').onclick = async () => {
    const p = await saveAi(); if (!p) return;
    $('#btnAiModels').disabled = true;
    const r = await api.aiModels(p.id);
    $('#btnAiModels').disabled = false;
    if (!r.ok) { toast(r.error, true); return; }
    $('#aiModels').innerHTML = r.data.map((m) => `<option value="${m.replace(/"/g, '&quot;')}">`).join('');
    toast(`${r.data.length} modelo(s) encontrado(s). Clique no campo Modelo para escolher.`);
    $('#aiModel').focus();
    refreshAi();
  };
  const setUse = async () => {
    const r = await api.aiSetUse({ text: $('#aiUseText').value, transcribe: $('#aiUseStt').value, tts: $('#aiUseTts').value }, $('#aiLang').value);
    if (r.ok) refreshAi();
  };
  ['#aiUseText', '#aiUseStt', '#aiUseTts', '#aiLang'].forEach((s) => { $(s).onchange = setUse; });
}

/* ------------------------------------------------------------------ */
/* Manuais: mesclar e traduzir                                          */
/* ------------------------------------------------------------------ */
async function mergeDialog() {
  const items = await api.mdocList();
  if (items.length < 2) { toast('São necessários pelo menos dois manuais salvos.', true); return; }
  const order = [];
  const body = el('div', 'merge');
  body.appendChild(el('p', 'hint', 'Marque os manuais na ordem em que devem entrar. Cada um vira um capítulo do manual novo; os originais não mudam.'));
  const list = el('div', 'merge-list');
  const renderList = () => {
    list.innerHTML = '';
    items.forEach((m) => {
      const pos = order.indexOf(m.dir);
      const r = el('label', `merge-item${pos >= 0 ? ' on' : ''}`);
      const cb = el('input'); cb.type = 'checkbox'; cb.checked = pos >= 0;
      cb.onchange = () => { if (cb.checked) order.push(m.dir); else order.splice(order.indexOf(m.dir), 1); renderList(); };
      r.append(cb, el('span', 'merge-n', pos >= 0 ? String(pos + 1) : ''), el('span', 'grow', m.title), el('small', '', `${m.screens} tela(s)`));
      list.appendChild(r);
    });
  };
  renderList();
  const title = el('input'); title.type = 'text'; title.value = 'Manual completo'; title.maxLength = 120;
  const chap = el('select');
  chap.add(new Option('Cada manual vira um capítulo', 'manual'));
  chap.add(new Option('Manter os capítulos de cada manual', 'keep'));
  const f = el('div', 'form');
  const l1 = el('label', '', 'Título do manual novo'); l1.appendChild(title);
  const l2 = el('label', '', 'Capítulos'); l2.appendChild(chap);
  f.append(l1, l2);
  body.append(list, f);
  showDlg('Mesclar manuais', body, [['Cancelar', hideDlg], ['Mesclar', async () => {
    if (order.length < 2) { toast('Marque pelo menos dois manuais.', true); return; }
    const r = await api.mdocMerge(order, { title: title.value.trim() || 'Manual completo', chapters: chap.value });
    if (!r.ok) { toast(r.error, true); return; }
    hideDlg(); refreshManuals();
    toast('Manual mesclado criado.');
    api.mdocEdit(r.data.dir);
  }, 'primary']]);
}
async function translateDialog(m) {
  const av = await api.aiAvailable();
  if (!av.text) { toast('Cadastre uma credencial de IA para textos na aba IA.', true); showPanel('ai'); return; }
  const sel = el('select');
  [['en', 'Inglês'], ['es', 'Espanhol'], ['pt-BR', 'Português (Brasil)'], ['fr', 'Francês'], ['it', 'Italiano'], ['de', 'Alemão']].forEach(([v, l]) => sel.add(new Option(l, v)));
  const body = el('div');
  body.appendChild(el('p', 'hint', `Cria uma cópia de "${m.title}" com os textos traduzidos pela IA. Os prints e o vídeo são reaproveitados.`));
  const lb = el('label', '', 'Idioma'); lb.appendChild(sel); body.appendChild(lb);
  showDlg('Traduzir manual', body, [['Cancelar', hideDlg], ['Traduzir', async (ev) => {
    const btn = ev.currentTarget; btn.disabled = true; btn.textContent = 'Traduzindo…';
    const r = await api.mdocTranslate(m.dir, sel.value);
    btn.disabled = false; btn.textContent = 'Traduzir';
    if (!r.ok) { toast(r.error, true); return; }
    hideDlg(); refreshManuals(); toast('Manual traduzido criado.');
    api.mdocEdit(r.data.dir);
  }, 'primary']]);
}

function setupNew() {
  $('#btnDetectEnc').onclick = detectEncoders;
  $('#btnSetExport').onclick = async () => { const f = await api.settingsExport(); if (f) toast(`Configurações exportadas: ${f.split(/[\\/]/).pop()}`); };
  $('#btnSetImport').onclick = async () => {
    const r = await api.settingsImport(); if (!r) return;
    if (r.error) { toast(r.error, true); return; }
    toast(r.failed && r.failed.length ? `Configurações importadas. Atalho indisponível: ${r.failed.join(', ')}` : 'Configurações importadas.');
  };
  $('#btnManMerge').onclick = mergeDialog;
  $('#dlg').addEventListener('click', (e) => { if (e.target.id === 'dlg') hideDlg(); });
  bindBrand(); bindAi();
}

init();
