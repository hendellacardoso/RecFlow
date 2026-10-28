'use strict';
/* global api */
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const QS = new URLSearchParams(location.search);
let FILE = QS.get('file');
let projectPath = QS.get('project');   // arquivo .gtproj aberto (ou salvo)
const video = $('#video');
const viewport = $('#viewport');
const zoomBox = $('#zoomBox');
const notesCanvas = $('#notesCanvas');
const nctx = notesCanvas.getContext('2d');
const ui = $('#ui');
const tlScroll = $('#tlScroll');
const tlInner = $('#tlInner');
const tlCanvas = $('#tlCanvas');
const tctx = tlCanvas.getContext('2d');

const info = { W: 1920, H: 1080, duration: 0, fps: 30, hasAudio: true, name: '', ffmpeg: true };
const newAudio = () => ({ main: 100, mic: 100, sys: 100, music: null });
let P = { inT: 0, outT: 0, cuts: [], zooms: [], notes: [], subs: [], voices: [], audio: newAudio(), intro: null, outro: null, subStyle: { burn: true, size: 5 } };   // projeto de edição
let side = { tracks: {}, clicks: null };     // trilhas separadas e cliques gravados
let sugg = { zooms: [], cuts: [] };          // sugestões ainda não aceitas
let inspTab = 'project';
let aiAvail = { text: false, transcribe: false, tts: false };
let brandCfg = {}, brandLogo = null;
let lastState = null;
const undoStack = [], redoStack = [];
let selId = null;
let tool = 'select';
const drawCfg = { shape: 'pen', color: '#ff3b30', width: 6 };
const COLORS = ['#ff3b30', '#ffd60a', '#30d158', '#0a84ff', '#ffffff', '#111111'];
let thumbs = null, thumbCount = 0, wave = null;
let pps = 50;             // pixels por segundo na linha do tempo
const PAD = 12;
let k = 1;                // pixels de tela por pixel de vídeo
let dpr = window.devicePixelRatio || 1;
let drag = null;          // arraste em andamento
let dirty = false;
let ready = false;

/* ------------------------------------------------------------------ */
/* Utilidades                                                           */
/* ------------------------------------------------------------------ */
const uid = () => Math.random().toString(36).slice(2, 10);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function fmt(t, cs = true) {
  t = Math.max(0, t || 0);
  const h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = t % 60;
  const ss = cs ? s.toFixed(2).padStart(5, '0') : String(Math.floor(s)).padStart(2, '0');
  return `${h ? `${h}:` : ''}${String(m).padStart(2, '0')}:${ss}`;
}
function parseTime(str) {
  const parts = String(str).trim().replace(',', '.').split(':').map(Number);
  if (parts.some(Number.isNaN)) return NaN;
  return parts.reduce((acc, v) => acc * 60 + v, 0);
}
let toastTimer = null;
function toast(msg, err = false) {
  const el = $('#toast'); el.textContent = msg; el.classList.toggle('error', err); el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), err ? 6000 : 3000);
}
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
const now = () => video.currentTime || 0;
const frame = () => 1 / Math.min(60, info.fps || 30);
const allItems = () => [...P.cuts.map((i) => ['cut', i]), ...P.zooms.map((i) => ['zoom', i]), ...P.notes.map((i) => [i.type, i]),
  ...P.subs.map((i) => ['sub', i]), ...P.voices.map((i) => ['voice', i])];
function findItem(id) { const f = allItems().find(([, i]) => i.id === id); return f ? { kind: f[0], item: f[1] } : null; }
const selected = () => (selId ? findItem(selId) : null);

/* ------------------------------------------------------------------ */
/* Desfazer / refazer                                                   */
/* ------------------------------------------------------------------ */
function commit() {
  const snap = JSON.stringify(P);
  if (snap === lastState) { renderAll(); return; }
  undoStack.push(lastState);
  if (undoStack.length > 200) undoStack.shift();
  redoStack.length = 0;
  lastState = snap;
  setDirty(true);
  renderAll();
}
function undo() {
  if (!undoStack.length) return;
  redoStack.push(lastState);
  lastState = undoStack.pop(); P = JSON.parse(lastState);
  if (selId && !findItem(selId)) selId = null;
  setDirty(true); renderAll();
}
function redo() {
  if (!redoStack.length) return;
  undoStack.push(lastState);
  lastState = redoStack.pop(); P = JSON.parse(lastState);
  if (selId && !findItem(selId)) selId = null;
  setDirty(true); renderAll();
}
function setDirty(v) { dirty = v; $('#dirty').hidden = !v; }
// avisa antes de fechar com alterações não salvas (o processo principal mostra a pergunta)
window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = false; } });

/* ------------------------------------------------------------------ */
/* Cálculos de edição                                                   */
/* ------------------------------------------------------------------ */
function keepSegments() {
  let segs = [[P.inT, P.outT]];
  [...P.cuts].sort((a, b) => a.start - b.start).forEach((c) => {
    const next = [];
    segs.forEach(([s, e]) => {
      if (c.end <= s || c.start >= e) { next.push([s, e]); return; }
      if (c.start > s) next.push([s, c.start]);
      if (c.end < e) next.push([c.end, e]);
    });
    segs = next;
  });
  return segs.filter(([s, e]) => e - s > 0.05);
}
function ramp(z, t) {
  const r = Math.min(0.4, (z.end - z.start) / 2);
  return clamp((t - z.start) / r, 0, 1) * clamp((z.end - t) / r, 0, 1);
}
// Mesma fórmula usada na exportação (main.js)
function zoomAt(t) {
  const { W, H } = info;
  let Z = 1, CX = W / 2, CY = H / 2;
  P.zooms.forEach((z) => {
    const r = ramp(z, t); if (!r) return;
    Z += (z.scale - 1) * r; CX += (z.cx * W - W / 2) * r; CY += (z.cy * H - H / 2) * r;
  });
  const x = clamp(CX * Z - W / 2, 0, W * Z - W), y = clamp(CY * Z - H / 2, 0, H * Z - H);
  return { Z, x, y };
}
function zoomRectOf(z) {
  const { W, H } = info;
  const rw = W / z.scale, rh = H / z.scale;
  return { x: clamp(z.cx * W - rw / 2, 0, W - rw), y: clamp(z.cy * H - rh / 2, 0, H - rh), w: rw, h: rh };
}

/* ------------------------------------------------------------------ */
/* Desenho das anotações (em pixels do vídeo)                           */
/* ------------------------------------------------------------------ */
const BG = { dark: 'rgba(0,0,0,0.68)', light: 'rgba(255,255,255,0.9)', accent: null };
function textLayout(ctx, n) {
  ctx.font = `${n.bold ? 700 : 500} ${n.size}px "Segoe UI", system-ui, sans-serif`;
  const lines = (n.text || '').split('\n');
  const lh = n.size * 1.25;
  const pad = n.bg !== 'none' ? n.size * 0.4 : 0;
  const w = Math.max(n.size, ...lines.map((l) => ctx.measureText(l).width)) + pad * 2;
  return { lines, lh, pad, w, h: lines.length * lh + pad * 2 };
}
function drawText(ctx, n) {
  const m = textLayout(ctx, n);
  ctx.save();
  if (n.bg !== 'none') {
    ctx.fillStyle = n.bg === 'accent' ? getComputedStyle(document.documentElement).getPropertyValue('--accent') : BG[n.bg];
    ctx.beginPath(); ctx.roundRect(n.x, n.y, m.w, m.h, n.size * 0.25); ctx.fill();
  } else {
    ctx.shadowColor = 'rgba(0,0,0,0.65)'; ctx.shadowBlur = n.size * 0.18; ctx.shadowOffsetY = n.size * 0.05;
  }
  ctx.fillStyle = n.color; ctx.textBaseline = 'middle';
  m.lines.forEach((l, i) => ctx.fillText(l, n.x + m.pad, n.y + m.pad + i * m.lh + m.lh / 2));
  ctx.restore();
}
function strokePts(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  if (pts.length === 1) ctx.lineTo(pts[0][0] + 0.01, pts[0][1]);
  for (let i = 1; i < pts.length - 1; i++) {
    ctx.quadraticCurveTo(pts[i][0], pts[i][1], (pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2);
  }
  if (pts.length > 1) ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
  ctx.stroke();
}
function drawStroke(ctx, s) {
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = s.color; ctx.fillStyle = s.color; ctx.lineWidth = s.width;
  const [x1, y1] = s.a || [0, 0], [x2, y2] = s.b || [0, 0];
  switch (s.shape) {
    case 'pen': strokePts(ctx, s.points); break;
    case 'highlighter': ctx.globalAlpha = 0.35; ctx.lineWidth = s.width * 4; ctx.lineCap = 'butt'; strokePts(ctx, s.points); break;
    case 'line': ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); break;
    case 'arrow': {
      const ang = Math.atan2(y2 - y1, x2 - x1), head = Math.max(s.width * 4, 16);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2 - Math.cos(ang) * head * 0.8, y2 - Math.sin(ang) * head * 0.8); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - Math.cos(ang - 0.45) * head, y2 - Math.sin(ang - 0.45) * head);
      ctx.lineTo(x2 - Math.cos(ang + 0.45) * head, y2 - Math.sin(ang + 0.45) * head);
      ctx.closePath(); ctx.fill(); break;
    }
    case 'rect': ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1)); break;
    case 'ellipse':
      ctx.beginPath();
      ctx.ellipse((x1 + x2) / 2, (y1 + y2) / 2, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2, 0, 0, Math.PI * 2);
      ctx.stroke(); break;
    default: break;
  }
  ctx.restore();
}
// Legendas: texto branco sobre faixa escura, centralizado embaixo
function drawSub(ctx, x) {
  const size = Math.round(info.H * (P.subStyle.size || 5) / 100);
  ctx.save();
  ctx.font = `600 ${size}px "Segoe UI", system-ui, sans-serif`;
  const maxW = info.W * 0.84;
  const lines = [];
  String(x.text || '').split('\n').forEach((para) => {
    let cur = '';
    para.split(/\s+/).filter(Boolean).forEach((w) => { const tt = cur ? `${cur} ${w}` : w; if (ctx.measureText(tt).width > maxW && cur) { lines.push(cur); cur = w; } else cur = tt; });
    if (cur) lines.push(cur);
  });
  const lh = size * 1.3, pad = size * 0.35;
  const bottom = info.H * 0.94;
  lines.slice(-3).reverse().forEach((l, i) => {
    const w = ctx.measureText(l).width;
    const y = bottom - (i + 1) * lh;
    ctx.fillStyle = 'rgba(0,0,0,0.72)';
    ctx.beginPath(); ctx.roundRect(info.W / 2 - w / 2 - pad, y - pad * 0.2, w + pad * 2, lh, size * 0.18); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    ctx.fillText(l, info.W / 2, y + lh / 2 - pad * 0.2);
  });
  ctx.restore();
}
function subPng(x) {
  const c = document.createElement('canvas');
  c.width = Math.floor(info.W / 2) * 2; c.height = Math.floor(info.H / 2) * 2;
  drawSub(c.getContext('2d'), x);
  return c.toDataURL('image/png');
}
function drawNote(ctx, n) {
  if (n.type === 'text') drawText(ctx, n);
  else n.strokes.forEach((s) => drawStroke(ctx, s));
}
function notePng(n) {
  const c = document.createElement('canvas');
  c.width = Math.floor(info.W / 2) * 2; c.height = Math.floor(info.H / 2) * 2;
  drawNote(c.getContext('2d'), n);
  return c.toDataURL('image/png');
}

/* ------------------------------------------------------------------ */
/* Palco (vídeo + anotações)                                            */
/* ------------------------------------------------------------------ */
function fitStage() {
  const st = $('#stage').getBoundingClientRect();
  const maxW = st.width - 24, maxH = st.height - 24;
  let vw = maxW, vh = maxW * info.H / info.W;
  if (vh > maxH) { vh = maxH; vw = maxH * info.W / info.H; }
  vw = Math.max(50, Math.floor(vw)); vh = Math.max(30, Math.floor(vh));
  viewport.style.width = `${vw}px`; viewport.style.height = `${vh}px`;
  zoomBox.style.width = `${vw}px`; zoomBox.style.height = `${vh}px`;
  dpr = window.devicePixelRatio || 1;
  notesCanvas.width = Math.round(vw * dpr); notesCanvas.height = Math.round(vh * dpr);
  k = vw / info.W;
}
function toVideo(e) {
  const r = viewport.getBoundingClientRect();
  return [clamp((e.clientX - r.left) / k, 0, info.W), clamp((e.clientY - r.top) / k, 0, info.H)];
}
const activeAt = (n, t) => t >= n.start && t < n.end;

function renderStage(t) {
  const sel = selected();
  // zoom (desligado enquanto um zoom está selecionado, para mostrar o quadro inteiro)
  if (sel && sel.kind === 'zoom') zoomBox.style.transform = 'none';
  else { const z = zoomAt(t); zoomBox.style.transform = `translate(${-z.x * k}px, ${-z.y * k}px) scale(${z.Z})`; }

  nctx.setTransform(1, 0, 0, 1, 0, 0);
  nctx.clearRect(0, 0, notesCanvas.width, notesCanvas.height);
  nctx.setTransform(k * dpr, 0, 0, k * dpr, 0, 0);
  P.notes.forEach((n) => { if (activeAt(n, t) || (drag && drag.note === n)) drawNote(nctx, n); });
  P.subs.forEach((x) => { if (activeAt(x, t)) drawSub(nctx, x); });

  // retângulo de zoom
  const zr = $('#zoomRect');
  if (sel && sel.kind === 'zoom') {
    const r = zoomRectOf(sel.item);
    Object.assign(zr.style, { left: `${r.x * k}px`, top: `${r.y * k}px`, width: `${r.w * k}px`, height: `${r.h * k}px` });
    $('#zoomLabel').textContent = `${sel.item.scale.toFixed(1)}×`;
    zr.hidden = false;
  } else zr.hidden = true;

  // caixa do texto selecionado
  const tb = $('#textBox');
  if (sel && sel.kind === 'text' && activeAt(sel.item, t)) {
    const n = sel.item; const m = textLayout(nctx, n);
    Object.assign(tb.style, { left: `${n.x * k}px`, top: `${n.y * k}px`, width: `${m.w * k}px`, height: `${m.h * k}px` });
    tb.hidden = false;
  } else tb.hidden = true;
}

/* ------------------------------------------------------------------ */
/* Reprodução                                                           */
/* ------------------------------------------------------------------ */
function enforcePlayback(t) {
  if (t < P.inT - 0.05) { video.currentTime = P.inT; return; }
  if (t >= P.outT - 0.02) { video.pause(); video.currentTime = P.outT; return; }
  const c = P.cuts.find((x) => t >= x.start && t < x.end - 0.02);
  if (c) video.currentTime = c.end;
}
function togglePlay() {
  if (video.paused) {
    if (now() >= P.outT - 0.05 || now() < P.inT) video.currentTime = P.inT;
    video.play();
  } else video.pause();
}
function seek(t) { video.currentTime = clamp(t, 0, info.duration); }
function loop() {
  const t = now();
  if (ready) {
    if (!video.paused) enforcePlayback(t);
    renderStage(t);
    syncAudio(t);
    $('#tcNow').textContent = fmt(t);
    const x = PAD + t * pps;
    $('#playhead').style.left = `${x}px`;
    if (!video.paused && !drag) {
      const sl = tlScroll.scrollLeft, w = tlScroll.clientWidth;
      if (x > sl + w - 40 || x < sl) tlScroll.scrollLeft = x - 60;
    }
  }
  requestAnimationFrame(loop);
}
video.addEventListener('play', () => { $('#btnPlay').innerHTML = '<svg viewBox="0 0 24 24"><path d="M8 5h3v14H8zM13 5h3v14h-3z"/></svg>'; });
video.addEventListener('pause', () => { $('#btnPlay').innerHTML = '<svg viewBox="0 0 24 24"><path d="M8 5l11 7-11 7z"/></svg>'; });

/* ------------------------------------------------------------------ */
/* Linha do tempo                                                       */
/* ------------------------------------------------------------------ */
const tx = (t) => PAD + t * pps;
function layoutTimeline() {
  const sw = tlScroll.clientWidth;
  pps = ((sw - PAD * 2) / Math.max(0.5, info.duration)) * Number($('#tlZoom').value);
  tlInner.style.width = `${info.duration * pps + PAD * 2}px`;
  dpr = window.devicePixelRatio || 1;
  tlCanvas.width = Math.round(sw * dpr); tlCanvas.style.width = `${sw}px`; tlCanvas.height = Math.round(118 * dpr);
  renderTracks();
  drawTimeline();
}
function drawTimeline() {
  const sw = tlScroll.clientWidth, sl = tlScroll.scrollLeft;
  const css = getComputedStyle(document.documentElement);
  const cMuted = css.getPropertyValue('--muted').trim(), cLine = css.getPropertyValue('--line').trim();
  const cAccent = css.getPropertyValue('--accent').trim(), cSunken = css.getPropertyValue('--sunken').trim();
  const c = tctx;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, sw, 118);
  const x0 = tx(0) - sl, x1 = tx(info.duration) - sl;

  // régua
  const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800];
  const step = steps.find((s) => s * pps >= 80) || 3600;
  c.fillStyle = cMuted; c.strokeStyle = cLine; c.font = '11px "Segoe UI", sans-serif'; c.textBaseline = 'top';
  const tStart = Math.max(0, Math.floor((sl - PAD) / pps / step) * step);
  for (let t = tStart; t <= info.duration + 0.0001; t += step) {
    const x = Math.round(tx(t) - sl) + 0.5; if (x > sw) break;
    c.beginPath(); c.moveTo(x, 12); c.lineTo(x, 22); c.stroke();
    c.fillText(fmt(t, step < 1), x + 4, 2);
    for (let j = 1; j < 5; j++) {
      const xs = Math.round(tx(t + (step * j) / 5) - sl) + 0.5;
      c.beginPath(); c.moveTo(xs, 18); c.lineTo(xs, 22); c.stroke();
    }
  }

  // miniaturas
  c.fillStyle = cSunken; c.fillRect(Math.max(0, x0), 22, Math.min(sw, x1) - Math.max(0, x0), 96);
  c.save(); c.beginPath(); c.rect(x0, 22, x1 - x0, 58); c.clip();
  if (thumbs) {
    const tw = thumbs.width / thumbCount, th = thumbs.height;
    const tileW = 56 * (tw / th);
    let cx = PAD + Math.floor(Math.max(0, sl - PAD) / tileW) * tileW;
    for (; cx < sl + sw; cx += tileW) {
      const t = (cx - PAD + tileW / 2) / pps;
      if (t > info.duration) break;
      const idx = clamp(Math.floor((t / info.duration) * thumbCount), 0, thumbCount - 1);
      c.drawImage(thumbs, idx * tw, 0, tw, th, cx - sl, 23, tileW, 56);
    }
  }
  c.restore();

  // forma de onda
  if (wave && wave.length) {
    c.fillStyle = cAccent;
    const mid = 99, hmax = 17;
    for (let x = Math.max(0, Math.floor(x0)); x < Math.min(sw, x1); x++) {
      const ta = (x + sl - PAD) / pps, tb = (x + 1 + sl - PAD) / pps;
      const ia = Math.floor((ta / info.duration) * wave.length), ib = Math.max(ia + 1, Math.floor((tb / info.duration) * wave.length));
      let m = 0; for (let i = ia; i < ib && i < wave.length; i++) if (wave[i] > m) m = wave[i];
      const h = Math.max(0.5, Math.sqrt(m) * hmax);
      c.fillRect(x, mid - h, 1, h * 2);
    }
  } else if (!info.hasAudio) {
    c.fillStyle = cMuted; c.fillText('Sem áudio', Math.max(8, x0 + 8), 93);
  }

  // trechos removidos escurecidos
  c.fillStyle = 'rgba(0,0,0,0.5)';
  const shade = (a, b) => { const xa = tx(a) - sl, xb = tx(b) - sl; if (xb > 0 && xa < sw) c.fillRect(xa, 22, xb - xa, 96); };
  shade(0, P.inT); shade(P.outT, info.duration);
  P.cuts.forEach((cut) => shade(cut.start, cut.end));
}
tlScroll.addEventListener('scroll', drawTimeline);

function lanesFor(notes) {
  const ends = []; const lanes = new Map();
  [...notes].sort((a, b) => a.start - b.start).forEach((n) => {
    let l = ends.findIndex((e) => e <= n.start + 0.001);
    if (l < 0) { l = ends.length; ends.push(0); }
    ends[l] = n.end; lanes.set(n.id, l);
  });
  return { lanes, count: Math.max(1, ends.length) };
}
function blockLabel(kind, it) {
  if (kind === 'cut') return `Removido ${(it.end - it.start).toFixed(1)} s`;
  if (kind === 'zoom') return `Zoom ${it.scale.toFixed(1)}×`;
  if (kind === 'text') return `T  ${(it.text || '').split('\n')[0] || 'Texto'}`;
  if (kind === 'sub') return (it.text || '').replace(/\n/g, ' ') || 'Legenda';
  if (kind === 'voice') return `🔊 ${it.text || 'Narração'}`;
  return `✎ Desenho (${it.strokes.length})`;
}
function renderTracks() {
  $$('.block').forEach((b) => b.remove());
  const mk = (track, kind, it, lane = 0) => {
    const b = el('div', `block ${kind}${it.id === selId ? ' sel' : ''}`, blockLabel(kind, it));
    b.dataset.id = it.id;
    b.style.left = `${tx(it.start)}px`;
    b.style.width = `${Math.max(4, (it.end - it.start) * pps)}px`;
    b.style.top = `${3 + lane * 26}px`;
    b.title = `${fmt(it.start)} → ${fmt(it.end)}`;
    track.appendChild(b);
  };
  P.cuts.forEach((c) => mk($('#trkCut'), 'cut', c));
  P.zooms.forEach((z) => mk($('#trkZoom'), 'zoom', z));
  const { lanes, count } = lanesFor(P.notes);
  P.notes.forEach((n) => mk($('#trkNotes'), n.type, n, lanes.get(n.id)));
  P.subs.forEach((x) => mk($('#trkSubs'), 'sub', x));
  P.voices.forEach((x) => mk($('#trkVoice'), 'voice', x));
  // sugestões (tracejadas): clique para aceitar
  const sg = (track, kind, it, i) => {
    const b = el('div', `block sugg ${kind}`, kind === 'zoom' ? `+ zoom ${it.scale.toFixed(1)}×` : `+ cortar ${(it.end - it.start).toFixed(1)} s`);
    b.dataset.sugg = `${kind}:${i}`;
    b.style.left = `${tx(it.start)}px`; b.style.width = `${Math.max(4, (it.end - it.start) * pps)}px`;
    b.title = 'Sugestão: clique para aceitar';
    track.appendChild(b);
  };
  sugg.zooms.forEach((z, i) => sg($('#trkZoom'), 'zoom', z, i));
  sugg.cuts.forEach((c, i) => sg($('#trkCut'), 'cut', c, i));
  const h = count * 26 + 4;
  $('#trkNotes').style.height = `${h}px`; $("#notesLabel").style.height = `${h}px`;

  // início/fim
  $('#hIn').style.left = `${tx(P.inT)}px`; $('#hOut').style.left = `${tx(P.outT)}px`;
  Object.assign($('#dimIn').style, { left: `${tx(0)}px`, width: `${P.inT * pps}px` });
  Object.assign($('#dimOut').style, { left: `${tx(P.outT)}px`, width: `${(info.duration - P.outT) * pps}px` });
}

function listFor(kind) { return kind === 'cut' ? P.cuts : kind === 'zoom' ? P.zooms : kind === 'sub' ? P.subs : kind === 'voice' ? P.voices : P.notes; }

function createRange(track, s, e) {
  const t0 = clamp(Math.min(s, e), 0, info.duration), t1 = clamp(Math.max(s, e), 0, info.duration);
  if (t1 - t0 < 0.15) return null;
  let it;
  if (track === 'cut') { it = { id: uid(), start: t0, end: t1 }; P.cuts.push(it); }
  else if (track === 'zoom') { it = { id: uid(), start: t0, end: t1, scale: 2, cx: 0.5, cy: 0.5 }; P.zooms.push(it); }
  else if (track === 'subs') { it = { id: uid(), start: t0, end: t1, text: 'Legenda' }; P.subs.push(it); }
  else if (track === 'voice') return null;
  else { it = newText(t0, t1, info.W * 0.1, info.H * 0.1); }
  return it;
}

// Interações na linha do tempo
tlInner.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || !ready) return;
  const rect = tlInner.getBoundingClientRect();
  const tAt = (ev) => clamp((ev.clientX - rect.left - PAD) / pps, 0, info.duration);
  const t = tAt(e);
  tlInner.setPointerCapture(e.pointerId);

  // régua / miniaturas / onda: arrastar o cursor de reprodução
  if (e.target === tlCanvas) {
    seek(t);
    drag = { kind: 'scrub', move: (ev) => seek(tAt(ev)) };
    return;
  }
  // alças de início/fim
  if (e.target.dataset.io) {
    const io = e.target.dataset.io;
    drag = {
      kind: 'io',
      move: (ev) => {
        const v = tAt(ev);
        if (io === 'in') P.inT = clamp(v, 0, P.outT - 0.2); else P.outT = clamp(v, P.inT + 0.2, info.duration);
        seek(io === 'in' ? P.inT : P.outT); renderTracks(); drawTimeline();
      },
      up: () => commit()
    };
    return;
  }
  // sugestões
  const sgb = e.target.closest('.block.sugg');
  if (sgb) { const [k, i] = sgb.dataset.sugg.split(':'); acceptSugg(k, Number(i)); return; }
  // blocos
  const block = e.target.closest('.block');
  if (block) {
    const found = findItem(block.dataset.id); if (!found) return;
    const it = found.item;
    const off = e.clientX - block.getBoundingClientRect().left;
    const mode = found.kind === 'voice' ? 'm' : off < 7 ? 'l' : off > block.offsetWidth - 7 ? 'r' : 'm';
    const s0 = it.start, e0 = it.end, x0 = e.clientX;
    let moved = false;
    selId = it.id; renderTracks(); renderInspector();
    drag = {
      kind: 'block',
      move: (ev) => {
        const dt = (ev.clientX - x0) / pps;
        if (Math.abs(ev.clientX - x0) > 2) moved = true;
        if (mode === 'm') { const len = e0 - s0; it.start = clamp(s0 + dt, 0, info.duration - len); it.end = it.start + len; }
        else if (mode === 'l') it.start = clamp(s0 + dt, 0, e0 - 0.2);
        else it.end = clamp(e0 + dt, s0 + 0.2, info.duration);
        renderTracks(); drawTimeline();
      },
      up: () => {
        if (moved) commit();
        else if (!activeAt(it, now())) seek(it.start + 0.01);
        renderInspector();
      }
    };
    return;
  }
  // faixa vazia: clique posiciona, arraste cria um item
  const track = e.target.closest('.track');
  if (track) {
    const kind = track.dataset.track;
    const ghost = el('div', `block ${kind === 'notes' ? 'text' : kind}`);
    ghost.style.opacity = '0.6';
    let created = false;
    drag = {
      kind: 'create',
      move: (ev) => {
        const t2 = tAt(ev);
        if (Math.abs(t2 - t) * pps < 4) return;
        if (!created) { track.appendChild(ghost); created = true; }
        ghost.style.left = `${tx(Math.min(t, t2))}px`; ghost.style.width = `${Math.abs(t2 - t) * pps}px`;
      },
      up: (ev) => {
        ghost.remove();
        if (!created) { seek(t); return; }
        const it = createRange(kind, t, tAt(ev));
        if (it) { selId = it.id; seek(it.start + 0.01); commit(); }
      }
    };
  }
});
window.addEventListener('pointermove', (e) => { if (drag && drag.move) drag.move(e); });
window.addEventListener('pointerup', (e) => { if (drag) { const d = drag; drag = null; if (d.up) d.up(e); } });

/* ------------------------------------------------------------------ */
/* Ferramentas no vídeo                                                 */
/* ------------------------------------------------------------------ */
function newText(start, end, x, y) {
  const n = {
    id: uid(), type: 'text', start, end, x, y, text: 'Seu texto aqui',
    size: Math.round(info.H * 0.055), color: '#ffffff', bg: 'dark', bold: true
  };
  P.notes.push(n);
  return n;
}
function setTool(t) {
  tool = t;
  $$('#tools button').forEach((b) => b.classList.toggle('active', b.dataset.tool === t));
  ui.className = `ui-layer t-${t}`;
  $('#drawOpts').hidden = t !== 'draw';
}

ui.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || !ready) return;
  const p = toVideo(e); const t = now();
  const sel = selected();
  ui.setPointerCapture(e.pointerId);

  // retângulo de zoom: mover / redimensionar
  if (sel && sel.kind === 'zoom' && e.target.closest('#zoomRect')) {
    const z = sel.item; const r0 = zoomRectOf(z); const h = e.target.dataset.h;
    const { W, H } = info;
    drag = {
      kind: 'zoomrect',
      move: (ev) => {
        const q = toVideo(ev);
        if (!h) {
          const nx = clamp(r0.x + q[0] - p[0], 0, W - r0.w), ny = clamp(r0.y + q[1] - p[1], 0, H - r0.h);
          z.cx = (nx + r0.w / 2) / W; z.cy = (ny + r0.h / 2) / H;
        } else {
          const fx = h.includes('w') ? r0.x + r0.w : r0.x, fy = h.includes('n') ? r0.y + r0.h : r0.y;
          const rw = clamp(Math.max(Math.abs(q[0] - fx), Math.abs(q[1] - fy) * W / H), W / 6, W / 1.1);
          const rh = rw * H / W;
          const nx = h.includes('w') ? fx - rw : fx, ny = h.includes('n') ? fy - rh : fy;
          z.scale = W / rw;
          z.cx = clamp(nx + rw / 2, rw / 2, W - rw / 2) / W; z.cy = clamp(ny + rh / 2, rh / 2, H - rh / 2) / H;
        }
        renderTracks();
      },
      up: () => { commit(); }
    };
    return;
  }
  // mover texto selecionado
  if (sel && sel.kind === 'text' && e.target === $('#textBox')) { startMoveText(sel.item, p); return; }

  if (tool === 'select') {
    const hit = [...P.notes].reverse().find((n) => n.type === 'text' && activeAt(n, t) && (() => {
      const m = textLayout(nctx, n); return p[0] >= n.x && p[0] <= n.x + m.w && p[1] >= n.y && p[1] <= n.y + m.h;
    })());
    if (hit) { selId = hit.id; renderAll(); startMoveText(hit, p); return; }
    selId = null; renderAll();
    return;
  }
  if (tool === 'text') {
    const n = newText(t, Math.min(info.duration, t + 3), p[0], p[1] - info.H * 0.03);
    selId = n.id; commit(); setTool('select');
    setTimeout(() => { const ta = $('#inspector textarea'); if (ta) { ta.focus(); ta.select(); } }, 30);
    return;
  }
  if (tool === 'draw') {
    let n = sel && sel.kind === 'draw' && activeAt(sel.item, t) ? sel.item : null;
    if (!n) { n = { id: uid(), type: 'draw', start: t, end: Math.min(info.duration, t + 3), strokes: [] }; P.notes.push(n); selId = n.id; }
    const freehand = drawCfg.shape === 'pen' || drawCfg.shape === 'highlighter';
    const s = { shape: drawCfg.shape, color: drawCfg.color, width: drawCfg.width * (info.H / 1080) };
    if (freehand) s.points = [p]; else { s.a = p; s.b = p; }
    n.strokes.push(s);
    drag = {
      kind: 'draw', note: n,
      move: (ev) => { const q = toVideo(ev); if (freehand) s.points.push(q); else s.b = q; },
      up: () => commit()
    };
    renderInspector();
    return;
  }
  if (tool === 'zoom') {
    const dr = $('#dragRect');
    let rect = null;
    drag = {
      kind: 'zoomdraw',
      move: (ev) => {
        const q = toVideo(ev);
        let w = Math.abs(q[0] - p[0]), h = Math.abs(q[1] - p[1]);
        if (w / h > info.W / info.H) h = w * info.H / info.W; else w = h * info.W / info.H;
        const x = q[0] < p[0] ? p[0] - w : p[0], y = q[1] < p[1] ? p[1] - h : p[1];
        rect = { x, y, w, h };
        Object.assign(dr.style, { left: `${x * k}px`, top: `${y * k}px`, width: `${w * k}px`, height: `${h * k}px` });
        dr.hidden = false;
      },
      up: () => {
        dr.hidden = true;
        if (!rect || rect.w < info.W / 20) { toast('Arraste um retângulo sobre a área que deve ser ampliada.'); return; }
        const scale = clamp(info.W / rect.w, 1.1, 6);
        const z = {
          id: uid(), start: t, end: Math.min(info.duration, t + 3), scale,
          cx: clamp(rect.x + rect.w / 2, 0, info.W) / info.W, cy: clamp(rect.y + rect.h / 2, 0, info.H) / info.H
        };
        P.zooms.push(z); selId = z.id; commit(); setTool('select');
      }
    };
  }
});
function startMoveText(n, p) {
  const x0 = n.x, y0 = n.y;
  drag = {
    kind: 'text',
    move: (ev) => { const q = toVideo(ev); n.x = x0 + q[0] - p[0]; n.y = y0 + q[1] - p[1]; },
    up: () => commit()
  };
}
ui.addEventListener('dblclick', () => { const ta = $('#inspector textarea'); if (ta) { ta.focus(); ta.select(); } });

/* ------------------------------------------------------------------ */
/* Painel de propriedades                                               */
/* ------------------------------------------------------------------ */
function field(label, input) { const f = el('label', 'field', label); f.appendChild(input); return f; }
function timeField(label, it, key) {
  const box = el('div', 'time-in');
  const inp = el('input'); inp.type = 'text'; inp.value = fmt(it[key]);
  inp.onchange = () => {
    const v = parseTime(inp.value);
    if (Number.isNaN(v)) { inp.value = fmt(it[key]); return; }
    if (key === 'start') it.start = clamp(v, 0, it.end - 0.1); else it.end = clamp(v, it.start + 0.1, info.duration);
    commit();
  };
  const b = el('button', 'btn small', 'Agora'); b.title = 'Usar a posição atual';
  b.onclick = () => {
    const v = now();
    if (key === 'start') { const len = it.end - it.start; it.start = clamp(v, 0, info.duration - 0.1); if (it.end <= it.start) it.end = Math.min(info.duration, it.start + len); }
    else it.end = clamp(v, it.start + 0.1, info.duration);
    commit();
  };
  box.append(inp, b);
  return field(label, box);
}
function swatchRow(current, onPick, colors = COLORS) {
  const row = el('div', 'swatches');
  colors.forEach((c) => {
    const b = el('button'); b.style.background = c; b.classList.toggle('on', c === current); b.title = c;
    b.onclick = () => onPick(c); row.appendChild(b);
  });
  const custom = el('input'); custom.type = 'color'; custom.value = current; custom.title = 'Outra cor';
  custom.style.cssText = 'width:26px;height:24px;padding:0;border:0;background:none;cursor:pointer';
  custom.onchange = () => onPick(custom.value);
  row.appendChild(custom);
  return row;
}

function renderInspector() {
  const box = $('#inspector'); box.innerHTML = '';
  const sel = selected();
  if (!sel) { renderProjectPanel(box); return; }
  const { kind, item: it } = sel;
  const titles = { cut: 'Trecho removido', zoom: 'Zoom', text: 'Texto', draw: 'Desenho', sub: 'Legenda', voice: 'Narração' };
  box.appendChild(el('span', `chip-type ${kind}`, titles[kind]));
  const times = el('div', 'row2');
  times.append(timeField('Início', it, 'start'), timeField('Fim', it, 'end'));
  box.appendChild(times);

  if (kind === 'zoom') {
    const r = el('input'); r.type = 'range'; r.min = '1.1'; r.max = '6'; r.step = '0.1'; r.value = String(it.scale);
    r.oninput = () => { it.scale = Number(r.value); renderTracks(); };
    r.onchange = () => commit();
    box.appendChild(field(`Ampliação (${it.scale.toFixed(1)}×)`, r));
    const c = el('button', 'btn small', 'Centralizar'); c.onclick = () => { it.cx = 0.5; it.cy = 0.5; commit(); };
    box.appendChild(c);
    box.appendChild(el('p', 'hint', 'Arraste o retângulo no vídeo para escolher a área; use os cantos para ajustar. A entrada e a saída do zoom são suaves.'));
  }
  if (kind === 'text') {
    const ta = el('textarea'); ta.value = it.text;
    ta.oninput = () => { it.text = ta.value; renderTracks(); };
    ta.onchange = () => commit();
    box.appendChild(field('Texto', ta));
    const size = el('input'); size.type = 'range'; size.min = String(Math.round(info.H * 0.02)); size.max = String(Math.round(info.H * 0.2)); size.value = String(it.size);
    size.oninput = () => { it.size = Number(size.value); };
    size.onchange = () => commit();
    box.appendChild(field('Tamanho', size));
    box.appendChild(field('Cor do texto', swatchRow(it.color, (c) => { it.color = c; commit(); })));
    const bg = el('select');
    [['dark', 'Fundo escuro'], ['light', 'Fundo claro'], ['accent', 'Fundo na cor de destaque'], ['none', 'Sem fundo (com sombra)']]
      .forEach(([v, l]) => bg.add(new Option(l, v)));
    bg.value = it.bg; bg.onchange = () => { it.bg = bg.value; commit(); };
    box.appendChild(field('Fundo', bg));
    const bold = el('label', 'check'); const cb = el('input'); cb.type = 'checkbox'; cb.checked = !!it.bold;
    cb.onchange = () => { it.bold = cb.checked; commit(); };
    bold.append(cb, document.createTextNode(' Negrito'));
    box.appendChild(bold);
    box.appendChild(el('p', 'hint', 'Arraste o texto no vídeo para posicionar.'));
  }
  if (kind === 'draw') {
    box.appendChild(el('p', 'hint', `${it.strokes.length} traço(s). Com a ferramenta Desenho ativa, os novos traços entram neste desenho enquanto ele estiver no tempo atual.`));
    const b = el('button', 'btn small', 'Desfazer último traço');
    b.onclick = () => { it.strokes.pop(); commit(); };
    const go = el('button', 'btn small', 'Continuar desenhando');
    go.onclick = () => { setTool('draw'); if (!activeAt(it, now())) seek(it.start + 0.01); };
    const row = el('div'); row.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap'; row.append(go, b);
    box.appendChild(row);
  }
  if (kind === 'cut') box.appendChild(el('p', 'hint', 'Este trecho não entra no vídeo final. Na reprodução ele é pulado.'));
  if (kind === 'sub') {
    const ta = el('textarea'); ta.value = it.text;
    ta.oninput = () => { it.text = ta.value; renderTracks(); };
    ta.onchange = () => commit();
    box.appendChild(field('Texto da legenda', ta));
    box.appendChild(el('p', 'hint', 'Tamanho e opções das legendas: aba Legendas (clique fora para ver o painel do projeto).'));
  }
  if (kind === 'voice') {
    box.appendChild(el('p', 'hint', it.text || ''));
    const r = el('input'); r.type = 'range'; r.min = '0'; r.max = '200'; r.step = '5'; r.value = String(it.volume ?? 100);
    r.oninput = () => { it.volume = Number(r.value); };
    r.onchange = () => commit();
    box.appendChild(field('Volume', r));
    const play = el('button', 'btn small', '▶ Ouvir daqui'); play.onclick = () => { seek(it.start); video.play(); };
    box.appendChild(play);
    box.appendChild(el('p', 'hint', 'Arraste o bloco na faixa Narração para mudar o momento.'));
  }

  const del = el('button', 'btn danger', 'Excluir'); del.style.marginTop = '18px';
  del.onclick = deleteSelected;
  box.appendChild(del);
}
function deleteSelected() {
  const sel = selected(); if (!sel) return;
  const list = listFor(sel.kind);
  list.splice(list.indexOf(sel.item), 1);
  selId = null; commit();
}

function renderAll() {
  renderTracks(); drawTimeline(); renderInspector();
  $('#tcFinal').textContent = fmt(finalDuration(), false);
  $('#btnUndo').disabled = !undoStack.length; $('#btnRedo').disabled = !redoStack.length;
}

/* ------------------------------------------------------------------ */
/* Ações                                                                */
/* ------------------------------------------------------------------ */
function markIn() { P.inT = clamp(now(), 0, P.outT - 0.2); commit(); }
function markOut() { P.outT = clamp(now(), P.inT + 0.2, info.duration); commit(); }
function addCut() {
  const t = now(); const it = createRange('cut', t, Math.min(info.duration, t + 2));
  if (it) { selId = it.id; commit(); }
}
function addZoom() {
  const t = now(); const it = createRange('zoom', t, Math.min(info.duration, t + 3));
  if (it) { selId = it.id; commit(); }
}
function addSub() {
  const t = now(); const it = createRange('subs', t, Math.min(info.duration, t + 3));
  if (it) { selId = it.id; commit(); setTimeout(() => { const ta = $('#inspector textarea'); if (ta) { ta.focus(); ta.select(); } }, 30); }
}
function addText() {
  const t = now(); const n = newText(t, Math.min(info.duration, t + 3), info.W * 0.08, info.H * 0.08);
  selId = n.id; commit();
  setTimeout(() => { const ta = $('#inspector textarea'); if (ta) { ta.focus(); ta.select(); } }, 30);
}

/* Projeto: salva o estado da edição para continuar depois */
async function saveProject(saveAs = false) {
  const r = await api.projectSave(saveAs ? null : projectPath, {
    video: FILE, edit: P, export: { format: $('#exportFmt').value }
  });
  if (r.ok) {
    projectPath = r.path; setDirty(false);
    $('#fileName').textContent = r.name; document.title = `${r.name} — RecFlow Editor`;
    toast(`Projeto salvo: ${r.name}`);
  } else if (!r.canceled) toast(`Não foi possível salvar o projeto: ${r.error}`, true);
  return r.ok;
}

async function save() {
  if (!info.ffmpeg) { toast('FFmpeg não encontrado. Rode "npm install" na pasta do projeto.', true); return; }
  const keep = keepSegments();
  if (!keep.length) { toast('Nada para salvar: todo o vídeo foi removido.', true); return; }
  video.pause();
  const fmtSel = $('#exportFmt').value;
  const isGif = fmtSel === 'gif';
  const finalDur = finalDuration();
  if (isGif && finalDur > 30) toast(`GIF de ${Math.round(finalDur)} s pode ficar grande. Para GIF, prefira trechos curtos.`);
  const base = FILE.replace(/\.[^.\\/]+$/, '');
  const def = isGif ? `${base}.gif` : fmtSel === 'whatsapp' ? `${base}_whatsapp.mp4` : `${base}_editado.mp4`;
  const out = await api.editorSaveDialog(def, isGif ? 'gif' : 'mp4');
  if (!out) return;

  showModal('Exportando vídeo…', out, [['Cancelar', () => api.editorCancel()]]);
  setProgress(0);
  const overlays = P.notes
    .filter((n) => n.end > n.start && (n.type === 'text' ? n.text.trim() : n.strokes.length))
    .map((n) => ({ start: n.start, end: n.end, png: notePng(n) }));
  const r = await api.editorExport({
    input: FILE, output: out, width: info.W, height: info.H, fps: info.fps, duration: info.duration,
    hasAudio: info.hasAudio, keep, overlays,
    format: fmtSel.startsWith('mp4') ? 'mp4' : fmtSel, crf: fmtSel.startsWith('mp4') ? Number(fmtSel.split('-')[1]) : 22,
    zooms: P.zooms.map((z) => ({ start: z.start, end: z.end, scale: z.scale, cx: z.cx, cy: z.cy })),
    ...exportExtras(fmtSel)
  });
  if (r.ok) {
    setProgress(1);
    $('#modal .modal-card').classList.remove('wide');
    showModal(isGif ? 'GIF salvo!' : 'Vídeo salvo!', r.file, [
      ['Mostrar na pasta', () => api.editorShowFile(r.file)],
      ['Abrir vídeo', () => api.editorOpenFile(r.file)],
      ['Fechar', hideModal, true]
    ]);
  } else if (r.error === 'cancelado') { hideModal(); toast('Exportação cancelada.'); }
  else showModal('Não foi possível salvar', r.error, [['Fechar', hideModal, true]]);
}
function showModal(title, text, actions, opts = {}) {
  $('#modal .modal-card').classList.remove('wide');
  $('#mTitle').textContent = title; $('#mText').textContent = text;
  $('#modal .bar').hidden = opts.bar === false;
  const a = $('#mActions'); a.innerHTML = '';
  actions.forEach(([label, fn, primary]) => { const b = el('button', `btn${primary ? ' primary' : ''}`, label); b.onclick = fn; a.appendChild(b); });
  $('#modal').hidden = false;
}
function hideModal() { $('#modal').hidden = true; }
function setProgress(p) { $('#mBar').style.width = `${Math.round(p * 100)}%`; }
api.on('editor:progress', (p) => { setProgress(p); $('#mTitle').textContent = `Exportando vídeo… ${Math.round(p * 100)}%`; });

/* ------------------------------------------------------------------ */
/* Painel do projeto (abas)                                             */
/* ------------------------------------------------------------------ */
const hasTracks = () => !!(side.tracks.mic || side.tracks.sys);
const clipDur = (c) => (c ? Math.max(0.5, Math.min(60, Number(c.dur) || 0)) : 0);
function finalDuration() {
  return keepSegments().reduce((a, [s2, e]) => a + e - s2, 0) + clipDur(P.intro) + clipDur(P.outro);
}
// tempo no vídeo final (depois dos cortes e da abertura) para um tempo do vídeo original
function outTime(t) {
  let acc = clipDur(P.intro);
  for (const [s2, e] of keepSegments()) {
    if (t <= s2) return acc;
    if (t < e) return acc + (t - s2);
    acc += e - s2;
  }
  return acc;
}
function rangeIn(label, min, max, step, value, onInput, onChange, unit = '%') {
  const f = el('label', 'field', `${label} (${value}${unit})`);
  const r = el('input'); r.type = 'range'; r.min = String(min); r.max = String(max); r.step = String(step); r.value = String(value);
  r.oninput = () => { f.firstChild.textContent = `${label} (${r.value}${unit})`; onInput(Number(r.value)); };
  r.onchange = () => onChange(Number(r.value));
  f.appendChild(r);
  return f;
}
function checkIn(label, value, onChange) {
  const l = el('label', 'check'); const c = el('input'); c.type = 'checkbox'; c.checked = !!value;
  c.onchange = () => onChange(c.checked);
  l.append(c, document.createTextNode(` ${label}`));
  return l;
}
function btn(label, fn, cls = '') { const b = el('button', `btn small ${cls}`, label); b.onclick = fn; return b; }
const TABS = [['project', 'Projeto'], ['audio', 'Áudio'], ['clips', 'Abertura'], ['subs', 'Legendas'], ['sugg', 'Sugestões']];

function renderProjectPanel(box) {
  const tabs = el('div', 'tabs');
  TABS.forEach(([k, l]) => {
    const b = el('button', inspTab === k ? 'on' : '', l + (k === 'sugg' && (sugg.zooms.length + sugg.cuts.length) ? ` (${sugg.zooms.length + sugg.cuts.length})` : ''));
    b.onclick = () => { inspTab = k; renderInspector(); };
    tabs.appendChild(b);
  });
  box.appendChild(tabs);
  ({ project: tabProject, audio: tabAudio, clips: tabClips, subs: tabSubs, sugg: tabSugg }[inspTab] || tabProject)(box);
}

function tabProject(box) {
  const keep = keepSegments();
  const kv = el('div', 'kv');
  [['Arquivo', info.name], ['Resolução', `${info.W} × ${info.H}`], ['Duração original', fmt(info.duration)],
    ['Duração final', fmt(finalDuration())], ['Trechos removidos', String(P.cuts.length)],
    ['Zooms', String(P.zooms.length)], ['Anotações', String(P.notes.length)], ['Legendas', String(P.subs.length)],
    ['Trilhas separadas', hasTracks() ? 'sim' : 'não']]
    .forEach(([kk, v]) => kv.append(el('span', '', kk), el('span', '', v)));
  box.appendChild(kv);
  void keep;
  box.appendChild(el('h3', '', 'Como editar'));
  const ul = el('ul', 'shortcuts');
  [['Espaço', 'reproduzir / pausar'], ['← →', 'quadro a quadro (Shift: 1 s)'], ['I / O', 'marcar início / fim'],
    ['X', 'remover trecho a partir do ponto atual'], ['Z', 'zoom: arraste um retângulo no vídeo'],
    ['T', 'texto: clique no vídeo'], ['D', 'desenho: risque no vídeo'], ['L', 'legenda no ponto atual'], ['Del', 'excluir item selecionado'],
    ['Ctrl+Z / Ctrl+Y', 'desfazer / refazer'], ['Ctrl+S', 'salvar projeto'], ['Ctrl+E', 'exportar vídeo']]
    .forEach(([kk, v]) => { const li = el('li'); li.append(el('b', '', kk), document.createTextNode(` ${v}`)); ul.appendChild(li); });
  box.appendChild(ul);
}

/* ---- Áudio: trilhas, música e narração ---- */
function tabAudio(box) {
  const A = P.audio;
  box.appendChild(el('h3', '', 'Volumes'));
  if (hasTracks()) {
    if (side.tracks.mic) box.appendChild(rangeIn('Microfone', 0, 200, 5, A.mic, (v) => { A.mic = v; }, () => commit()));
    if (side.tracks.sys) box.appendChild(rangeIn('Som do sistema', 0, 200, 5, A.sys, (v) => { A.sys = v; }, () => commit()));
    box.appendChild(el('p', 'hint', 'Esta gravação tem trilhas separadas: cada volume é ajustado sozinho. Acima de 100% vale na exportação.'));
  } else if (info.hasAudio) {
    box.appendChild(rangeIn('Áudio do vídeo', 0, 200, 5, A.main, (v) => { A.main = v; }, () => commit()));
    box.appendChild(el('p', 'hint', 'Para ajustar microfone e som do sistema separadamente, ative "trilhas separadas" na aba Áudio do RecFlow antes de gravar.'));
  } else box.appendChild(el('p', 'hint', 'Este vídeo não tem áudio.'));

  box.appendChild(el('h3', '', 'Música de fundo'));
  const mb = el('div', 'media-box');
  const mu = A.music;
  mb.appendChild(el('div', `media-name${mu ? '' : ' none'}`, mu ? mu.name : 'Nenhuma música'));
  const row = el('div', 'btn-row');
  row.append(btn(mu ? 'Trocar…' : 'Escolher…', async () => {
    const m = await api.editorPickMedia('music'); if (!m) return;
    A.music = { file: m.file, name: m.name, url: m.url, duration: m.duration, volume: mu ? mu.volume : 20, loop: true, duck: true, fadeIn: 1, fadeOut: 2 };
    commit();
  }));
  if (mu) row.append(btn('Remover', () => { A.music = null; commit(); }, 'ghost'));
  mb.appendChild(row);
  if (mu) {
    mb.appendChild(rangeIn('Volume', 0, 100, 1, mu.volume, (v) => { mu.volume = v; }, () => commit()));
    mb.appendChild(checkIn('Repetir até o fim do vídeo', mu.loop, (v) => { mu.loop = v; commit(); }));
    mb.appendChild(checkIn('Abaixar a música quando houver voz', mu.duck, (v) => { mu.duck = v; commit(); }));
    mb.appendChild(rangeIn('Entrada suave', 0, 5, 0.5, mu.fadeIn, (v) => { mu.fadeIn = v; }, () => commit(), ' s'));
    mb.appendChild(rangeIn('Saída suave', 0, 8, 0.5, mu.fadeOut, (v) => { mu.fadeOut = v; }, () => commit(), ' s'));
  }
  box.appendChild(mb);

  box.appendChild(el('h3', '', 'Narração (IA)'));
  const ta = el('textarea'); ta.placeholder = 'Texto que será falado a partir do ponto atual do vídeo…';
  box.appendChild(ta);
  const nr = el('div', 'btn-row'); nr.style.marginTop = '8px';
  const gen = btn('🔊 Gerar narração aqui', async () => {
    const text = ta.value.trim(); if (!text) { ta.focus(); return; }
    if (!aiAvail.tts) { toast('Cadastre uma credencial de narração (voz) na aba IA do RecFlow.', true); return; }
    gen.disabled = true; gen.textContent = 'Gerando…';
    const r = await api.editorNarrate(FILE, text);
    gen.disabled = false; gen.textContent = '🔊 Gerar narração aqui';
    if (!r.ok) { toast(r.error, true); return; }
    const t = now();
    const v = { id: uid(), start: t, end: Math.min(info.duration, t + r.duration), dur: r.duration, file: r.file, url: r.url, text, volume: 100 };
    P.voices.push(v); selId = v.id; commit();
    toast('Narração adicionada na faixa Narração.');
  }, 'ai');
  const imp = btn('✨ Melhorar texto', async () => {
    const text = ta.value.trim(); if (!text) return;
    if (!aiAvail.text) { toast('Cadastre uma credencial de IA para textos.', true); return; }
    imp.disabled = true;
    const r = await api.aiTask('improveNarration', { text });
    imp.disabled = false;
    if (r.ok) ta.value = r.data; else toast(r.error, true);
  }, 'ghost');
  nr.append(gen, imp);
  box.appendChild(nr);
  if (!aiAvail.tts) box.appendChild(el('p', 'hint', 'Usa a voz cadastrada na aba IA (OpenAI, compatível ou sua própria API, como a APIVoz).'));
}

/* ---- Abertura e encerramento ---- */
function tabClips(box) {
  [['intro', 'Abertura'], ['outro', 'Encerramento']].forEach(([key, label]) => {
    box.appendChild(el('h3', '', label));
    const c = P[key];
    const sel = el('select');
    [['', 'Nenhum'], ['card', 'Cartão com a identidade visual'], ['file', 'Vídeo ou imagem do computador']].forEach(([v, l]) => sel.add(new Option(l, v)));
    sel.value = !c ? '' : c.kind === 'card' ? 'card' : 'file';
    sel.onchange = async () => {
      if (sel.value === '') P[key] = null;
      else if (sel.value === 'card') P[key] = { kind: 'card', dur: 3, title: key === 'intro' ? (info.name || '').replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ') : 'Obrigado por assistir!', subtitle: '' };
      else {
        const m = await api.editorPickMedia('clip');
        if (!m) { sel.value = !c ? '' : c.kind === 'card' ? 'card' : 'file'; return; }
        P[key] = { kind: m.kind === 'image' ? 'image' : 'video', file: m.file, name: m.name, url: m.url, hasAudio: m.hasAudio, dur: m.kind === 'image' ? 3 : Math.min(60, m.duration || 5) };
      }
      commit();
    };
    box.appendChild(field('Tipo', sel));
    if (!c) return;
    if (c.kind === 'card') {
      const cv = el('canvas', 'card-prev'); cv.width = 480; cv.height = Math.round(480 * info.H / info.W);
      window.RFBrand.drawCard(cv.getContext('2d'), cv.width, cv.height, { brand: brandCfg, logo: brandLogo, title: c.title, subtitle: c.subtitle, kind: key });
      box.appendChild(cv);
      const t = el('input'); t.type = 'text'; t.value = c.title || ''; t.maxLength = 90;
      t.oninput = () => { c.title = t.value; window.RFBrand.drawCard(cv.getContext('2d'), cv.width, cv.height, { brand: brandCfg, logo: brandLogo, title: c.title, subtitle: c.subtitle, kind: key }); };
      t.onchange = () => commit();
      box.appendChild(field('Título', t));
      const st = el('input'); st.type = 'text'; st.value = c.subtitle || ''; st.maxLength = 120;
      st.placeholder = key === 'intro' ? (brandCfg.name || 'Subtítulo (opcional)') : (brandCfg.site || brandCfg.footer || 'Texto (opcional)');
      st.oninput = () => { c.subtitle = st.value; t.oninput(); };
      st.onchange = () => commit();
      box.appendChild(field('Subtítulo', st));
    } else {
      box.appendChild(el('div', 'media-name', c.name || ''));
    }
    if (c.kind !== 'video' || (c.dur || 0) > 0) {
      box.appendChild(rangeIn('Duração', 1, c.kind === 'video' ? Math.max(1, Math.ceil(c.dur)) : 15, 0.5, c.dur, (v) => { c.dur = v; }, () => commit(), ' s'));
    }
  });
  box.appendChild(el('p', 'hint', 'Cores e logo do cartão vêm da aba Identidade visual do RecFlow. A abertura e o encerramento entram só no vídeo exportado.'));
}

/* ---- Legendas (transcrição por IA) ---- */
function tabSubs(box) {
  box.appendChild(el('h3', '', 'Legendas automáticas'));
  const src = el('select');
  if (side.tracks.mic) src.add(new Option('Microfone (trilha separada)', 'mic'));
  src.add(new Option('Áudio do vídeo', 'main'));
  if (side.tracks.mic || info.hasAudio) box.appendChild(field('Ouvir de', src));
  const gen = btn(P.subs.length ? '✨ Gerar de novo' : '✨ Gerar legendas', () => transcribe(src.value), 'ai');
  gen.disabled = !info.hasAudio && !side.tracks.mic;
  box.appendChild(el('div', 'btn-row')).appendChild(gen);
  if (!aiAvail.transcribe) box.appendChild(el('p', 'hint', 'Usa a transcrição cadastrada na aba IA (OpenAI Whisper ou compatível, como o Groq).'));

  box.appendChild(el('h3', '', `Aparência (${P.subs.length} legenda(s))`));
  box.appendChild(checkIn('Gravar as legendas no vídeo exportado', P.subStyle.burn, (v) => { P.subStyle.burn = v; commit(); }));
  box.appendChild(rangeIn('Tamanho', 3, 9, 0.5, P.subStyle.size, (v) => { P.subStyle.size = v; }, () => commit(), '%'));
  const r2 = el('div', 'btn-row');
  r2.append(btn('Salvar .srt', saveSrt), btn('Apagar todas', () => { if (P.subs.length && confirm('Apagar todas as legendas?')) { P.subs = []; commit(); } }, 'ghost'));
  box.appendChild(r2);

  box.appendChild(el('h3', '', 'Traduzir legendas'));
  const lang = el('select');
  [['en', 'Inglês'], ['es', 'Espanhol'], ['pt-BR', 'Português (Brasil)'], ['fr', 'Francês'], ['it', 'Italiano'], ['de', 'Alemão']].forEach(([v, l]) => lang.add(new Option(l, v)));
  const tr = btn('✨ Traduzir', async () => {
    if (!P.subs.length) { toast('Gere ou crie legendas primeiro.'); return; }
    if (!aiAvail.text) { toast('Cadastre uma credencial de IA para textos na aba IA.', true); return; }
    showModal('Traduzindo legendas…', `${P.subs.length} legenda(s)`, []); setProgress(0.3);
    const r = await api.aiTask('texts', { mode: 'translate', lang: lang.value, items: P.subs.map((x) => ({ id: x.id, text: x.text })) });
    hideModal();
    if (!r.ok) { toast(r.error, true); return; }
    P.subs.forEach((x) => { if (r.data[x.id]) x.text = r.data[x.id]; });
    commit(); toast('Legendas traduzidas. Ctrl+Z desfaz.');
  }, 'ai');
  const row = el('div', 'btn-row'); row.append(lang, tr); lang.style.flex = '1';
  box.appendChild(row);

  box.appendChild(el('h3', '', 'YouTube'));
  box.appendChild(btn('✨ Título, descrição e capítulos', videoMeta, 'ai'));
  box.appendChild(el('p', 'hint', 'A IA usa as legendas (a transcrição) para sugerir título, descrição e capítulos com os tempos do vídeo final.'));
}
function splitLong(segs) {
  const out = [];
  segs.forEach((sg) => {
    const end = sg.end == null ? sg.start + Math.max(2, sg.text.split(/\s+/).length * 0.4) : sg.end;
    const dur = end - sg.start;
    const words = sg.text.split(/\s+/).filter(Boolean);
    const n = Math.max(1, Math.min(words.length, Math.ceil(dur / 5), Math.ceil(sg.text.length / 90)));
    for (let i = 0; i < n; i++) {
      const w = words.slice(Math.round((i * words.length) / n), Math.round(((i + 1) * words.length) / n));
      if (!w.length) continue;
      out.push({ id: uid(), start: sg.start + (i * dur) / n, end: sg.start + ((i + 1) * dur) / n, text: w.join(' ') });
    }
  });
  return out.filter((x) => x.end > x.start && x.start < info.duration).map((x) => ({ ...x, end: Math.min(x.end, info.duration) }));
}
async function transcribe(source) {
  if (!aiAvail.transcribe) { toast('Cadastre uma credencial de transcrição na aba IA do RecFlow.', true); return; }
  if (P.subs.length && !confirm('Substituir as legendas atuais?')) return;
  showModal('Gerando legendas…', 'Enviando o áudio para a transcrição', []); setProgress(0.15);
  const off = api.on('ai:progress', (m) => { $('#mText').textContent = m; setProgress(Math.min(0.9, parseFloat($('#mBar').style.width || '0') / 100 + 0.2)); });
  const r = await api.editorTranscribe(FILE, { track: source === 'mic' && side.tracks.mic ? side.tracks.mic.file : null });
  off(); hideModal();
  if (!r.ok) { toast(r.error, true); return; }
  P.subs = splitLong(r.segments);
  inspTab = 'subs'; commit();
  toast(`${P.subs.length} legenda(s) criada(s). Clique numa legenda na linha do tempo para corrigir o texto.`);
}
function srtTime(t) {
  const ms = Math.max(0, Math.round(t * 1000));
  const p = (n, l = 2) => String(n).padStart(l, '0');
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
}
function mappedSubs() {
  return [...P.subs].sort((a, b) => a.start - b.start)
    .map((x) => ({ ...x, a: outTime(x.start), b: outTime(x.end) }))
    .filter((x) => x.b - x.a > 0.15 && x.text.trim());
}
async function saveSrt() {
  const list = mappedSubs();
  if (!list.length) { toast('Não há legendas.'); return; }
  const txt = list.map((x, i) => `${i + 1}\r\n${srtTime(x.a)} --> ${srtTime(x.b)}\r\n${x.text.trim()}\r\n`).join('\r\n');
  const f = await api.editorSaveText(FILE.replace(/\.[^.\\/]+$/, '.srt'), txt, 'srt');
  if (f) toast(`Legenda salva: ${f.split(/[\\/]/).pop()}`);
}
async function videoMeta() {
  if (!aiAvail.text) { toast('Cadastre uma credencial de IA para textos na aba IA.', true); return; }
  const list = mappedSubs();
  if (!list.length) { toast('Gere as legendas primeiro: a IA usa a transcrição.', true); return; }
  showModal('Criando título e capítulos…', 'A IA está lendo a transcrição', []); setProgress(0.4);
  const mmss = (t) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  const r = await api.aiTask('videoMeta', { transcript: list.map((x) => `[${mmss(x.a)}] ${x.text}`).join('\n') });
  hideModal();
  if (!r.ok) { toast(r.error, true); return; }
  const d = r.data || {};
  const chapters = (d.chapters || []).map((c) => `${c.t} ${c.title}`).join('\n');
  const wrap = el('div', 'meta-out');
  const mk = (label, value, rows) => {
    const l = el('label', 'field', label); const t = el('textarea'); t.value = value; t.rows = rows;
    const c = el('button', 'btn small', 'Copiar'); c.onclick = () => { navigator.clipboard.writeText(t.value); toast('Copiado.'); };
    l.append(t, c); wrap.appendChild(l);
  };
  mk('Título', d.title || '', 2);
  mk('Descrição', `${d.description || ''}${chapters ? `\n\n${chapters}` : ''}`, 8);
  mk('Capítulos', chapters, 5);
  showModal('Para o YouTube', '', [['Fechar', hideModal, true]], { bar: false });
  $('#mText').replaceChildren(wrap);
  $('#modal .modal-card').classList.add('wide');
}

/* ---- Sugestões: zoom pelos cliques e cortes de silêncio ---- */
function tabSugg(box) {
  box.appendChild(el('h3', '', 'Zoom automático'));
  const nClicks = side.clicks && side.clicks.clicks ? side.clicks.clicks.length : 0;
  box.appendChild(el('p', 'hint', nClicks ? `${nClicks} clique(s) gravado(s). O RecFlow sugere zooms onde você clicou.` : 'Esta gravação não tem cliques guardados (ative na aba Desenho e teclas do RecFlow).'));
  const zb = btn('Sugerir zooms pelos cliques', suggestZooms); zb.disabled = !nClicks;
  box.appendChild(zb);

  box.appendChild(el('h3', '', 'Silêncios'));
  const db = el('select');
  [[-45, 'Muito sensível (−45 dB)'], [-38, 'Normal (−38 dB)'], [-30, 'Só silêncio forte (−30 dB)']].forEach(([v, l]) => db.add(new Option(l, v)));
  db.value = '-38';
  const mn = el('select');
  [[0.8, '0,8 s ou mais'], [1.5, '1,5 s ou mais'], [3, '3 s ou mais']].forEach(([v, l]) => mn.add(new Option(l, v)));
  mn.value = '1.5';
  box.append(field('Sensibilidade', db), field('Pausas de', mn));
  const sb = btn('Detectar silêncios para cortar', () => suggestCuts(Number(db.value), Number(mn.value)));
  sb.disabled = !info.hasAudio && !hasTracks();
  box.appendChild(sb);

  const total = sugg.zooms.length + sugg.cuts.length;
  box.appendChild(el('h3', '', `Sugestões (${total})`));
  if (!total) { box.appendChild(el('p', 'hint', 'As sugestões aparecem tracejadas na linha do tempo. Clique numa para aceitar.')); return; }
  const list = el('div', 'sugg-list');
  const item = (k, it, i) => {
    const r = el('div', 'sugg-item');
    const t = el('span', '', `${k === 'zoom' ? `Zoom ${it.scale.toFixed(1)}×` : 'Cortar silêncio'} · ${fmt(it.start, false)}–${fmt(it.end, false)}`);
    t.onclick = () => seek(it.start + 0.01);
    r.append(t, btn('Aceitar', () => acceptSugg(k, i)), btn('✕', () => { (k === 'zoom' ? sugg.zooms : sugg.cuts).splice(i, 1); renderAll(); }, 'ghost'));
    list.appendChild(r);
  };
  sugg.zooms.forEach((z, i) => item('zoom', z, i));
  sugg.cuts.forEach((c, i) => item('cut', c, i));
  box.appendChild(list);
  const row = el('div', 'btn-row');
  row.append(btn('Aceitar todas', () => {
    sugg.zooms.forEach((z) => P.zooms.push({ ...z, id: uid() }));
    sugg.cuts.forEach((c) => P.cuts.push({ ...c, id: uid() }));
    sugg = { zooms: [], cuts: [] }; commit();
  }, 'primary'), btn('Descartar todas', () => { sugg = { zooms: [], cuts: [] }; renderAll(); }, 'ghost'));
  box.appendChild(row);
}
function acceptSugg(k, i) {
  const list = k === 'zoom' ? sugg.zooms : sugg.cuts;
  const it = list[i]; if (!it) return;
  list.splice(i, 1);
  const n = { ...it, id: uid() };
  (k === 'zoom' ? P.zooms : P.cuts).push(n);
  selId = n.id; commit();
}
const overlaps = (a, list) => list.some((b) => a.start < b.end && a.end > b.start);
function suggestZooms() {
  const clicks = [...(side.clicks.clicks || [])].filter((c) => c.t >= 0 && c.t <= info.duration).sort((a, b) => a.t - b.t);
  const groups = [];
  clicks.forEach((c) => {
    const g = groups[groups.length - 1];
    if (g && c.t - g[g.length - 1].t < 2.5 && Math.hypot(c.x - g[0].x, c.y - g[0].y) < 0.28) g.push(c); else groups.push([c]);
  });
  const out = [];
  groups.forEach((g) => {
    const xs = g.map((c) => c.x), ys = g.map((c) => c.y);
    const spread = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    const z = {
      start: clamp(g[0].t - 0.9, 0, info.duration), end: clamp(g[g.length - 1].t + 1.8, 0, info.duration),
      scale: spread > 0.18 ? 1.5 : 2, cx: clamp(xs.reduce((a, b) => a + b, 0) / g.length, 0.15, 0.85), cy: clamp(ys.reduce((a, b) => a + b, 0) / g.length, 0.15, 0.85)
    };
    const prev = out[out.length - 1];
    if (prev && z.start < prev.end + 0.4) { prev.end = Math.max(prev.end, z.end); prev.cx = (prev.cx + z.cx) / 2; prev.cy = (prev.cy + z.cy) / 2; prev.scale = Math.min(prev.scale, z.scale); return; }
    out.push(z);
  });
  sugg.zooms = out.filter((z) => z.end - z.start >= 1.2 && !overlaps(z, P.zooms));
  inspTab = 'sugg'; renderAll();
  toast(sugg.zooms.length ? `${sugg.zooms.length} zoom(s) sugerido(s). Confira e aceite na linha do tempo.` : 'Nenhum zoom novo para sugerir.');
}
async function suggestCuts(db, min) {
  showModal('Procurando silêncios…', '', []); setProgress(0.5);
  const sil = await api.editorSilences(FILE, { db, min, track: side.tracks.mic ? side.tracks.mic.file : null });
  hideModal();
  const m = 0.25;   // margem para não cortar o fim/começo das falas
  sugg.cuts = sil.map(([a, b]) => ({ start: a + m, end: Math.min(info.duration, b) - m }))
    .filter((c) => c.end - c.start >= 0.4 && c.end > P.inT && c.start < P.outT && !overlaps(c, P.cuts));
  inspTab = 'sugg'; renderAll();
  const tot = sugg.cuts.reduce((a, c) => a + c.end - c.start, 0);
  toast(sugg.cuts.length ? `${sugg.cuts.length} silêncio(s) encontrado(s) (${tot.toFixed(1)} s). Aceite os que quiser cortar.` : 'Nenhum silêncio encontrado com essa sensibilidade.');
}

/* ------------------------------------------------------------------ */
/* Prévia do áudio (trilhas separadas, música e narrações)              */
/* ------------------------------------------------------------------ */
const aux = new Map();   // chave -> <audio>
function auxEl(key, url) {
  let a = aux.get(key);
  if (!a || a.dataset.url !== url) {
    if (a) { a.pause(); a.remove(); }
    a = new Audio(url); a.dataset.url = url; a.preload = 'auto';
    $('#auxMedia').appendChild(a); aux.set(key, a);
  }
  return a;
}
function syncAudio(t) {
  const playing = !video.paused;
  const master = Number($('#volume').value);
  const want = new Set();
  const drive = (key, url, target, vol, active) => {
    want.add(key);
    const a = auxEl(key, url);
    a.volume = clamp(vol, 0, 1) * master;
    if (!playing || !active) { if (!a.paused) a.pause(); return; }
    if (Math.abs(a.currentTime - target) > 0.25) { try { a.currentTime = Math.max(0, target); } catch { /* ainda carregando */ } }
    a.playbackRate = video.playbackRate;
    if (a.paused) a.play().catch(() => {});
  };
  video.muted = hasTracks();
  if (!hasTracks()) video.volume = clamp(P.audio.main / 100, 0, 1) * master;
  if (side.tracks.mic) drive('mic', side.tracks.mic.url, t, P.audio.mic / 100, true);
  if (side.tracks.sys) drive('sys', side.tracks.sys.url, t, P.audio.sys / 100, true);
  const mu = P.audio.music;
  if (mu && mu.url) {
    const ot = outTime(t) - clipDur(P.intro);
    const len = mu.duration || 0;
    const target = mu.loop && len ? ot % len : ot;
    drive('music', mu.url, target, (mu.volume / 100) * (mu.duck ? 0.6 : 1), !len || mu.loop || ot < len);
  }
  P.voices.forEach((v) => drive(`v:${v.id}`, v.url, t - v.start, (v.volume ?? 100) / 100, t >= v.start && t < v.start + (v.dur || v.end - v.start)));
  [...aux.keys()].forEach((k) => { if (!want.has(k)) { const a = aux.get(k); a.pause(); a.remove(); aux.delete(k); } });
}

/* ------------------------------------------------------------------ */
/* Exportação: dados extras (áudio, legendas, abertura)                 */
/* ------------------------------------------------------------------ */
function clipSpec(c, kind) {
  if (!c) return null;
  if (c.kind === 'card') return { kind: 'image', dur: clipDur(c), png: window.RFBrand.cardPng(Math.floor(info.W / 2) * 2, Math.floor(info.H / 2) * 2, { brand: brandCfg, logo: brandLogo, title: c.title, subtitle: c.subtitle, kind }) };
  return { kind: c.kind, file: c.file, dur: clipDur(c), hasAudio: !!c.hasAudio };
}
function exportExtras(fmtSel) {
  const gif = fmtSel === 'gif';
  return {
    audio: {
      main: P.audio.main,
      tracks: hasTracks() ? [side.tracks.mic && { file: side.tracks.mic.file, volume: P.audio.mic }, side.tracks.sys && { file: side.tracks.sys.file, volume: P.audio.sys }].filter(Boolean) : [],
      voices: P.voices.map((v) => ({ file: v.file, start: v.start, volume: v.volume ?? 100 })),
      music: P.audio.music ? { ...P.audio.music } : null
    },
    subs: P.subStyle.burn ? P.subs.filter((x) => x.text.trim()).map((x) => ({ start: x.start, end: x.end, png: subPng(x) })) : [],
    intro: gif ? null : clipSpec(P.intro, 'intro'),
    outro: gif ? null : clipSpec(P.outro, 'outro')
  };
}

/* ------------------------------------------------------------------ */
/* Controles                                                            */
/* ------------------------------------------------------------------ */
$$('#tools button').forEach((b) => { b.onclick = () => setTool(b.dataset.tool); });
$('#btnPlay').onclick = togglePlay;
$('#btnStart').onclick = () => seek(P.inT);
$('#btnEnd').onclick = () => seek(P.outT);
$('#btnBack').onclick = () => { video.pause(); seek(now() - frame()); };
$('#btnFwd').onclick = () => { video.pause(); seek(now() + frame()); };
$('#speed').onchange = (e) => { video.playbackRate = Number(e.target.value); };
$('#volume').oninput = (e) => { video.volume = Number(e.target.value); };
$('#btnUndo').onclick = undo;
$('#btnRedo').onclick = redo;
$('#btnSave').onclick = save;
$('#btnSaveProj').onclick = () => saveProject(false);
$('#btnSaveProj').oncontextmenu = (e) => { e.preventDefault(); saveProject(true); };
$('#btnOpenProj').onclick = () => api.projectOpen();
$('#btnIn').onclick = markIn;
$('#btnOut').onclick = markOut;
$('#btnCut').onclick = addCut;
$('#btnAddZoom').onclick = addZoom;
$('#btnAddText').onclick = addText;
$('#btnAddSub').onclick = addSub;
$('#tlZoom').oninput = () => {
  const center = (tlScroll.scrollLeft + tlScroll.clientWidth / 2 - PAD) / pps;
  layoutTimeline();
  tlScroll.scrollLeft = PAD + center * pps - tlScroll.clientWidth / 2;
};
$('#drawShape').onchange = (e) => { drawCfg.shape = e.target.value; };
$('#drawWidth').onchange = (e) => { drawCfg.width = Number(e.target.value); };
function renderDrawColors() {
  const box = $('#drawColors'); box.innerHTML = '';
  COLORS.forEach((c) => {
    const b = el('button'); b.style.background = c; b.classList.toggle('on', c === drawCfg.color);
    b.onclick = () => { drawCfg.color = c; renderDrawColors(); };
    box.appendChild(b);
  });
}

window.addEventListener('keydown', (e) => {
  const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) && e.target.type !== 'range';
  const key = e.key.toLowerCase();
  if (e.ctrlKey && key === 's') { e.preventDefault(); saveProject(e.shiftKey); return; }
  if (e.ctrlKey && key === 'e') { e.preventDefault(); save(); return; }
  if (e.ctrlKey && key === 'o') { e.preventDefault(); api.projectOpen(); return; }
  if (typing) return;
  if (e.ctrlKey && key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
  if (e.ctrlKey && (key === 'y' || (key === 'z' && e.shiftKey))) { e.preventDefault(); redo(); return; }
  if (e.ctrlKey || e.altKey) return;
  switch (key) {
    case ' ': e.preventDefault(); togglePlay(); break;
    case 'arrowleft': e.preventDefault(); video.pause(); seek(now() - (e.shiftKey ? 1 : frame())); break;
    case 'arrowright': e.preventDefault(); video.pause(); seek(now() + (e.shiftKey ? 1 : frame())); break;
    case 'home': seek(P.inT); break;
    case 'end': seek(P.outT); break;
    case 'i': markIn(); break;
    case 'o': markOut(); break;
    case 'x': addCut(); break;
    case 'v': setTool('select'); break;
    case 'z': setTool('zoom'); break;
    case 't': setTool('text'); break;
    case 'd': setTool('draw'); break;
    case 'l': addSub(); break;
    case 'delete': case 'backspace': deleteSelected(); break;
    case 'escape': selId = null; setTool('select'); renderAll(); break;
    default: break;
  }
});
window.addEventListener('resize', () => { if (ready) { fitStage(); layoutTimeline(); } });

/* ------------------------------------------------------------------ */
/* Carregamento                                                         */
/* ------------------------------------------------------------------ */
async function init() {
  renderDrawColors(); setTool('select');
  try {
    const s = await api.getSettings();
    if (s.accent) document.documentElement.style.setProperty('--accent', s.accent);
  } catch { /* ignora */ }
  api.on('accent', (c) => { if (c) document.documentElement.style.setProperty('--accent', c); });

  // abrindo um projeto salvo
  let proj = null;
  if (projectPath) {
    const pr = await api.projectLoad(projectPath);
    if (!pr.ok) { $('#loading').textContent = pr.error; return; }
    proj = pr.project; FILE = proj.video;
    if (proj.export && proj.export.format) $('#exportFmt').value = proj.export.format;
  }
  const r = await api.editorInfo(FILE);
  if (r.error) { $('#loading').textContent = r.error; return; }
  Object.assign(info, { name: r.name, ffmpeg: r.ffmpeg, hasAudio: r.hasAudio !== false, fps: r.fps || 30 });
  const shownName = projectPath ? projectPath.split(/[\\/]/).pop() : r.name;
  $('#fileName').textContent = shownName;
  document.title = `${shownName} — RecFlow Editor`;
  if (!r.ffmpeg) toast('FFmpeg não encontrado: dá para revisar, mas não salvar. Rode "npm install".', true);

  video.src = r.url;
  await new Promise((res, rej) => { video.onloadedmetadata = res; video.onerror = () => rej(new Error('formato não suportado')); })
    .catch((e) => { $('#loading').textContent = `Não foi possível abrir o vídeo (${e.message}).`; throw e; });
  info.W = video.videoWidth || r.width || 1920;
  info.H = video.videoHeight || r.height || 1080;
  info.duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : (r.duration || 0);
  if (!info.duration) { $('#loading').textContent = 'Não foi possível ler a duração do vídeo.'; return; }

  P.outT = info.duration;
  if (proj) {
    const e = proj.edit || {};
    const fix = (it) => { it.start = clamp(Number(it.start) || 0, 0, info.duration); it.end = clamp(Number(it.end) || 0, it.start, info.duration); return it; };
    P = {
      inT: clamp(Number(e.inT) || 0, 0, info.duration), outT: clamp(Number(e.outT) || info.duration, 0, info.duration),
      cuts: (e.cuts || []).map(fix), zooms: (e.zooms || []).map(fix), notes: (e.notes || []).map(fix),
      subs: (e.subs || []).map(fix), voices: (e.voices || []).map(fix),
      audio: { ...newAudio(), ...(e.audio || {}) }, intro: e.intro || null, outro: e.outro || null,
      subStyle: { burn: true, size: 5, ...(e.subStyle || {}) }
    };
    if (P.outT <= P.inT) P.outT = info.duration;
  }
  try { side = await api.editorSidecars(FILE); } catch { side = { tracks: {}, clicks: null }; }
  try { aiAvail = await api.aiAvailable(); } catch { /* sem IA */ }
  try {
    const st = await api.getSettings(); brandCfg = (st.settings && st.settings.brand) || {};
    const lg = await api.brandLogo(); if (lg) brandLogo = await new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = lg; });
  } catch { /* sem identidade visual */ }
  if (hasTracks()) info.hasAudio = true;
  lastState = JSON.stringify(P);
  $('#tcTotal').textContent = fmt(info.duration);
  fitStage();
  layoutTimeline();
  renderAll();
  $('#loading').hidden = true;
  ready = true;
  requestAnimationFrame(loop);

  // miniaturas e forma de onda (em segundo plano)
  thumbCount = clamp(Math.round(info.duration / 1.5), 8, 80);
  api.editorThumbs(FILE, info.duration, thumbCount).then((url) => {
    if (!url) return;
    const img = new Image(); img.onload = () => { thumbs = img; drawTimeline(); }; img.src = url;
  });
  if (info.hasAudio) api.editorWaveform(FILE, 4000).then((p) => { wave = p; drawTimeline(); });
}
init();
