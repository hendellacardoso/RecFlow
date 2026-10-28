'use strict';
/* global api */
// Editor de manual: textos, ordem, prints, marcações, vídeo e exportação
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const { geom, drawMark } = window.RFMarks;
const DIR = new URLSearchParams(location.search).get('dir');

let doc = null;            // manual.json
let images = [];           // Image do print original de cada tela (mesma ordem de doc.screens)
let replaced = [];         // dataURL quando o print foi trocado (senão null)
let video = null;          // { rel, url, name }
let sel = 0;               // tela selecionada
let selMark = -1;          // marcação selecionada
let addMode = false;
let dirty = false;
let lastState = null;
const undoStack = [], redoStack = [];
const cv = $('#cv'), ctx = cv.getContext('2d');
let k = 1;                 // px na tela por px da imagem
let drag = null;

/* ---------------- utilidades ---------------- */
const el = (t, c, txt) => { const e = document.createElement(t); if (c) e.className = c; if (txt !== undefined) e.textContent = txt; return e; };
let toastT = null;
function toast(m, err = false) {
  const t = $('#toast'); t.textContent = m; t.classList.toggle('error', err); t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), err ? 6000 : 3000);
}
const fmtT = (t) => { if (!Number.isFinite(t)) return ''; t = Math.max(0, Math.floor(t)); const h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = t % 60; return `${h ? `${h}:` : ''}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`; };
const parseT = (v) => { const p = String(v).trim().split(':').map(Number); if (!v || p.some(Number.isNaN)) return null; return p.reduce((a, x) => a * 60 + x, 0); };
const scr = () => doc.screens[sel];
const scaleOf = (i) => doc.screens[i].scale || Math.max(1, (images[i] ? images[i].naturalWidth : 1920) / 1920);
function loadImg(src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; }); }

/* ---------------- desfazer ---------------- */
function snapshot() { return JSON.stringify({ doc, sel, video: video && video.rel }); }
function commit() {
  const s = snapshot();
  if (s === lastState) return;
  undoStack.push(lastState); if (undoStack.length > 150) undoStack.shift();
  redoStack.length = 0; lastState = s; setDirty(true); updUndo();
}
function restore(s) {
  const o = JSON.parse(s); doc = o.doc; sel = Math.min(o.sel, doc.screens.length - 1); selMark = -1;
  lastState = s; setDirty(true); renderAll(); updUndo();
}
function undo() { if (!undoStack.length) return; redoStack.push(lastState); restore(undoStack.pop()); }
function redo() { if (!redoStack.length) return; undoStack.push(lastState); restore(redoStack.pop()); }
function updUndo() { $('#btnUndo').disabled = !undoStack.length; $('#btnRedo').disabled = !redoStack.length; }
function setDirty(v) { dirty = v; $('#dirty').hidden = !v; }
window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = false; } });

/* ---------------- numeração ---------------- */
function renumber() {
  let n = 0;
  doc.screens.forEach((s, i) => {
    s.n = i + 1;
    if (doc.numbering !== 'continuous') n = 0;
    s.marks.forEach((m) => { m.num = ++n; });
  });
}

/* ---------------- render ---------------- */
function renderAll() {
  $('#docTitle').value = doc.title || '';
  $('#docSubtitle').value = doc.subtitle || '';
  $('#docAuthor').value = doc.author || '';
  $('#docNumbering').value = doc.numbering || 'screen';
  renderVideo();
  renderScreens();
  renderScreen();
}
function renderScreens() {
  const box = $('#screenList'); box.innerHTML = '';
  $('#screenCount').textContent = `(${doc.screens.length})`;
  doc.screens.forEach((s, i) => {
    const c = el('div', `scr${i === sel ? ' on' : ''}`);
    const im = el('img'); im.src = replaced[i] || (images[i] && images[i].src) || ''; im.alt = '';
    const info = el('div');
    if (s.group) info.appendChild(el('div', 'grp', s.group));
    info.append(el('div', 'nm', `${i + 1}. ${s.name || `Tela ${i + 1}`}`), el('div', 'mt', `${s.marks.length} item(ns)${Number.isFinite(s.videoTime) && video ? ` · ▶ ${fmtT(s.videoTime)}` : ''}`));
    const acts = el('div', 'acts');
    const mk = (txt, title, fn, dis, cls = '') => { const b = el('button', `mini ${cls}`, txt); b.title = title; b.disabled = dis; b.onclick = (e) => { e.stopPropagation(); fn(); }; return b; };
    acts.append(
      mk('↑', 'Mover para cima', () => moveScreen(i, -1), i === 0),
      mk('↓', 'Mover para baixo', () => moveScreen(i, 1), i === doc.screens.length - 1),
      mk('✕', 'Excluir esta tela', () => deleteScreen(i), doc.screens.length < 2, 'del'));
    info.appendChild(acts);
    c.append(im, info);
    c.onclick = () => { sel = i; selMark = -1; addMode = false; renderScreens(); renderScreen(); };
    box.appendChild(c);
  });
}
function renderScreen() {
  const s = scr();
  $('#tnBadge').textContent = String(sel + 1);
  if (document.activeElement !== $('#screenName')) $('#screenName').value = s.name || '';
  if (document.activeElement !== $('#screenGroup')) $('#screenGroup').value = s.group || '';
  const groups = [...new Set(doc.screens.map((x) => x.group).filter(Boolean))];
  $('#groupList').innerHTML = groups.map((g) => `<option value="${g.replace(/"/g, '&quot;')}">`).join('');
  $('#btnAddMark').classList.toggle('on', addMode);
  $('#addHint').hidden = !addMode;
  cv.classList.toggle('adding', addMode);
  $('#vtInput').value = fmtT(s.videoTime);
  fitCanvas(); draw(); renderItems();
}
function fitCanvas() {
  const img = images[sel]; if (!img) return;
  const wrap = $('#canvasWrap').getBoundingClientRect();
  k = Math.min((wrap.width - 24) / img.naturalWidth, (wrap.height - 24) / img.naturalHeight);
  const dpr = window.devicePixelRatio || 1;
  cv.style.width = `${Math.round(img.naturalWidth * k)}px`; cv.style.height = `${Math.round(img.naturalHeight * k)}px`;
  cv.width = Math.round(img.naturalWidth * k * dpr); cv.height = Math.round(img.naturalHeight * k * dpr);
}
function draw() {
  const img = images[sel]; if (!img) return;
  const dpr = window.devicePixelRatio || 1; const s = scaleOf(sel);
  ctx.setTransform(dpr * k, 0, 0, dpr * k, 0, 0);
  ctx.clearRect(0, 0, img.naturalWidth, img.naturalHeight);
  ctx.drawImage(img, 0, 0);
  scr().marks.forEach((m, i) => {
    const g = drawMark(ctx, m, s);
    if (i === selMark) {
      ctx.save(); ctx.setLineDash([6 * s, 4 * s]); ctx.lineWidth = 1.5 * s; ctx.strokeStyle = '#3b82f6';
      ctx.strokeRect(g.box.x - 4 * s, g.box.y - 4 * s, g.box.w + 8 * s, g.box.h + 8 * s); ctx.restore();
      const h = handlePos(g);
      ctx.beginPath(); ctx.arc(h.x, h.y, 6 * s, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
      ctx.lineWidth = 2 * s; ctx.strokeStyle = m.color; ctx.stroke();
    }
  });
  if (drag && drag.kind === 'new' && drag.rect) {
    const r = drag.rect; ctx.save(); ctx.setLineDash([6 * s, 4 * s]); ctx.lineWidth = 2 * s; ctx.strokeStyle = '#3b82f6';
    ctx.strokeRect(r.x, r.y, r.w, r.h); ctx.restore();
  }
}
function handlePos(g) {
  if (g.shape === 'ellipse') return { x: g.cx + g.rx * Math.SQRT1_2, y: g.cy + g.ry * Math.SQRT1_2 };
  return { x: g.box.x + g.box.w, y: g.box.y + g.box.h };
}
const SHAPES = [['ellipse', '<ellipse cx="12" cy="8" rx="10" ry="6"/>'], ['roundrect', '<rect x="2" y="2" width="20" height="12" rx="4"/>'], ['rect', '<rect x="2" y="2" width="20" height="12"/>']];
function renderItems() {
  const box = $('#itemList'); box.innerHTML = '';
  const s = scr();
  if (!s.marks.length) { box.appendChild(el('div', 'empty-items', 'Nenhum item nesta tela. Use "+ Marcação" e arraste sobre o componente.')); return; }
  s.marks.forEach((m, i) => {
    const c = el('div', `item${i === selMark ? ' on' : ''}`);
    const top = el('div', 'item-top');
    const n = el('span', 'num', String(m.num)); n.style.background = m.color;
    top.append(n, el('span', 'fn', m.fieldName || ''));
    const ta = el('textarea'); ta.value = m.text || ''; ta.placeholder = 'Explique o que deve ser preenchido ou feito…';
    ta.oninput = () => { m.text = ta.value; setDirty(true); };
    ta.onchange = () => commit();
    ta.onfocus = () => { if (selMark !== i) { selMark = i; $$('.item').forEach((x, j) => x.classList.toggle('on', j === i)); draw(); } };
    const opts = el('div', 'item-opts');
    const shp = el('div', 'shp');
    SHAPES.forEach(([k2, svgIn]) => {
      const b = el('button'); b.title = k2 === 'ellipse' ? 'Elipse' : k2 === 'roundrect' ? 'Arredondado' : 'Retângulo';
      b.innerHTML = `<svg viewBox="0 0 24 16" fill="none" stroke="currentColor" stroke-width="2">${svgIn}</svg>`;
      b.classList.toggle('on', m.shape === k2);
      b.onclick = () => { m.shape = k2; commit(); renderItems(); draw(); };
      shp.appendChild(b);
    });
    const col = el('input'); col.type = 'color'; col.value = m.color; col.title = 'Cor';
    col.oninput = () => { m.color = col.value; n.style.background = m.color; draw(); };
    col.onchange = () => { commit(); renderItems(); };
    const mk = (txt, title, fn, dis, cls = '') => { const b = el('button', `mini ${cls}`, txt); b.title = title; b.disabled = dis; b.onclick = fn; return b; };
    opts.append(shp, col, el('span', 'grow'),
      mk('↑', 'Subir (renumera)', () => moveMark(i, -1), i === 0),
      mk('↓', 'Descer (renumera)', () => moveMark(i, 1), i === s.marks.length - 1),
      mk('✕', 'Excluir item', () => deleteMark(i), false, 'del'));
    c.append(top, ta, opts);
    c.onclick = (e) => { if (e.target === c || e.target === top) { selMark = i; renderItems(); draw(); } };
    box.appendChild(c);
  });
}

/* ---------------- ações ---------------- */
function moveScreen(i, d) {
  const j = i + d; if (j < 0 || j >= doc.screens.length) return;
  [doc.screens[i], doc.screens[j]] = [doc.screens[j], doc.screens[i]];
  [images[i], images[j]] = [images[j], images[i]];
  [replaced[i], replaced[j]] = [replaced[j], replaced[i]];
  if (sel === i) sel = j; else if (sel === j) sel = i;
  renumber(); commit(); renderScreens(); renderScreen();
}
function deleteScreen(i) {
  if (doc.screens.length < 2) return;
  if (!confirm(`Excluir a tela "${doc.screens[i].name}" e seus ${doc.screens[i].marks.length} item(ns)?`)) return;
  doc.screens.splice(i, 1); images.splice(i, 1); replaced.splice(i, 1);
  sel = Math.min(sel, doc.screens.length - 1); selMark = -1;
  renumber(); commit(); renderScreens(); renderScreen();
}
function moveMark(i, d) {
  const a = scr().marks, j = i + d; if (j < 0 || j >= a.length) return;
  [a[i], a[j]] = [a[j], a[i]]; selMark = j;
  renumber(); commit(); renderScreens(); renderItems(); draw();
}
function deleteMark(i) {
  scr().marks.splice(i, 1); selMark = -1;
  renumber(); commit(); renderScreens(); renderItems(); draw();
}
async function replacePrint() {
  const url = await api.mdocPickImage(); if (!url) return;
  const img = await loadImg(url);
  const old = images[sel];
  if (old && old.naturalWidth !== img.naturalWidth) {
    // mantém as marcações na mesma posição relativa
    const fx = img.naturalWidth / old.naturalWidth, fy = img.naturalHeight / old.naturalHeight;
    scr().marks.forEach((m) => { m.rect = { x: m.rect.x * fx, y: m.rect.y * fy, w: m.rect.w * fx, h: m.rect.h * fy }; });
    if (scr().scale) scr().scale *= fx;
  }
  images[sel] = img; replaced[sel] = url;
  commit(); renderScreens(); renderScreen();
  toast('Print trocado. As marcações foram mantidas; ajuste se precisar.');
}

/* ---------------- interação no print ---------------- */
const toImg = (e) => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) / k, y: (e.clientY - r.top) / k }; };
function hitTest(p) {
  const s = scaleOf(sel); const marks = scr().marks;
  if (selMark >= 0 && marks[selMark]) {
    const h = handlePos(geom(marks[selMark].rect, marks[selMark].shape, s));
    if (Math.abs(p.x - h.x) < 12 / k && Math.abs(p.y - h.y) < 12 / k) return { i: selMark, kind: 'resize' };
  }
  for (let i = marks.length - 1; i >= 0; i--) {
    const b = geom(marks[i].rect, marks[i].shape, s).box;
    if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) return { i, kind: 'move' };
  }
  return null;
}
cv.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  cv.setPointerCapture(e.pointerId);
  const p = toImg(e);
  if (addMode) { drag = { kind: 'new', p0: p, rect: null }; return; }
  const h = hitTest(p);
  if (!h) { selMark = -1; renderItems(); draw(); return; }
  selMark = h.i; renderItems();
  const m = scr().marks[h.i];
  drag = { kind: h.kind, p0: p, r0: { ...m.rect }, m, moved: false };
  draw();
});
cv.addEventListener('pointermove', (e) => {
  const p = toImg(e);
  if (!drag) {
    if (addMode) return;
    const h = hitTest(p); cv.className = h ? (h.kind === 'resize' ? 'over-handle' : 'over-mark') : '';
    return;
  }
  if (drag.kind === 'new') {
    drag.rect = { x: Math.min(drag.p0.x, p.x), y: Math.min(drag.p0.y, p.y), w: Math.abs(p.x - drag.p0.x), h: Math.abs(p.y - drag.p0.y) };
  } else if (drag.kind === 'move') {
    drag.m.rect.x = drag.r0.x + p.x - drag.p0.x; drag.m.rect.y = drag.r0.y + p.y - drag.p0.y; drag.moved = true;
  } else {
    drag.m.rect.w = Math.max(8, drag.r0.w + p.x - drag.p0.x); drag.m.rect.h = Math.max(8, drag.r0.h + p.y - drag.p0.y); drag.moved = true;
  }
  draw();
});
cv.addEventListener('pointerup', () => {
  const d = drag; drag = null; if (!d) return;
  if (d.kind === 'new') {
    if (d.rect && d.rect.w * k > 8 && d.rect.h * k > 8) {
      const prev = scr().marks[scr().marks.length - 1];
      scr().marks.push({ num: 0, text: '', shape: prev ? prev.shape : 'ellipse', color: prev ? prev.color : '#ff3b30', rect: d.rect, fieldName: '', videoTime: null });
      selMark = scr().marks.length - 1; addMode = false;
      renumber(); commit(); renderScreens(); renderScreen();
      setTimeout(() => { const ta = $$('.item textarea')[selMark]; if (ta) ta.focus(); }, 30);
    } else draw();
    return;
  }
  if (d.moved) commit();
});
cv.addEventListener('dblclick', () => { const ta = $$('.item textarea')[selMark]; if (ta) ta.focus(); });

/* ---------------- vídeo ---------------- */
function renderVideo() {
  const nm = $('#vidName');
  nm.classList.toggle('missing', !video && !!doc.video);
  nm.textContent = video ? video.name : doc.video ? `Vídeo não encontrado: ${doc.video}` : 'Nenhum vídeo';
  $('#btnVidRemove').disabled = !doc.video;
  $('#playerBox').hidden = !video;
  const pl = $('#player');
  if (video && pl.dataset.src !== video.url) { pl.src = video.url; pl.dataset.src = video.url; }
  if (!video) { pl.removeAttribute('src'); pl.dataset.src = ''; }
}
$('#btnVidPick').onclick = async () => {
  const v = await api.mdocPickVideo(DIR); if (!v) return;
  video = v; doc.video = v.rel; commit(); renderVideo(); renderScreens();
  toast('Vídeo escolhido. Se ele foi editado (cortes), reajuste o momento de cada tela.');
};
$('#btnVidRemove').onclick = () => { video = null; doc.video = null; commit(); renderVideo(); renderScreens(); };
$('#btnVtUse').onclick = () => { scr().videoTime = Math.round($('#player').currentTime * 10) / 10; $('#vtInput').value = fmtT(scr().videoTime); commit(); renderScreens(); };
$('#btnVtGo').onclick = () => { const t = scr().videoTime; if (Number.isFinite(t)) { const pl = $('#player'); pl.currentTime = t; pl.play(); } };
$('#vtInput').onchange = (e) => { const t = parseT(e.target.value); scr().videoTime = t; e.target.value = fmtT(t); commit(); renderScreens(); };

/* ---------------- campos do documento ---------------- */
[['#docTitle', 'title'], ['#docSubtitle', 'subtitle'], ['#docAuthor', 'author']].forEach(([id, key]) => {
  $(id).oninput = (e) => { doc[key] = e.target.value; setDirty(true); };
  $(id).onchange = () => commit();
});
$('#docNumbering').onchange = (e) => { doc.numbering = e.target.value; renumber(); commit(); renderScreens(); renderItems(); draw(); };
$('#screenName').oninput = (e) => { scr().name = e.target.value; setDirty(true); const nm = $$('.scr .nm')[sel]; if (nm) nm.textContent = `${sel + 1}. ${e.target.value}`; };
$('#screenName').onchange = () => commit();
$('#screenGroup').oninput = (e) => { scr().group = e.target.value; setDirty(true); };
$('#screenGroup').onchange = () => { scr().group = $('#screenGroup').value.trim(); commit(); renderScreens(); renderScreen(); };
$('#btnAddMark').onclick = () => { addMode = !addMode; selMark = -1; renderScreen(); };
$('#btnReplace').onclick = replacePrint;
$('#btnUndo').onclick = undo;
$('#btnRedo').onclick = redo;

/* ---------------- salvar e exportar ---------------- */
async function save() {
  renumber();
  $('#btnSave').disabled = true; $('#btnSave').textContent = 'Salvando…';
  try {
    // print final de cada tela = original + marcações
    const pngs = doc.screens.map((s, i) => {
      const img = images[i]; const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      const x = c.getContext('2d'); x.drawImage(img, 0, 0);
      s.marks.forEach((m) => drawMark(x, m, scaleOf(i)));
      return c.toDataURL('image/png');
    });
    const payload = JSON.parse(JSON.stringify(doc));
    payload.copyVideo = $('#optCopyVideo').checked;
    const r = await api.mdocSave(DIR, payload, pngs, replaced);
    if (!r.ok) { toast(`Não foi possível salvar: ${r.error}`, true); return false; }
    doc = r.doc; replaced = doc.screens.map(() => null);
    if (payload.copyVideo && doc.video && video && !doc.video.includes('..')) { video = { ...video, rel: doc.video, name: doc.video }; $('#optCopyVideo').checked = false; }
    lastState = snapshot(); setDirty(false); renderAll();
    toast('Manual salvo (imagens, HTML e TXT atualizados).');
    return true;
  } finally { $('#btnSave').disabled = false; $('#btnSave').textContent = 'Salvar'; }
}
async function exportAs(kind) {
  if (dirty && !(await save())) return;
  const r = await api.mdocExport(DIR, kind, { logo: $('#optLogo').checked && !$('#optLogo').disabled });
  if (r.ok) { toast(`${kind === 'pdf' ? 'PDF' : 'Word'} salvo: ${r.file.split(/[\\/]/).pop()}`); api.mdocOpenFile(r.file); }
  else if (!r.canceled) toast(`Não foi possível exportar: ${r.error}`, true);
}
$('#btnSave').onclick = save;
$('#btnPdf').onclick = () => exportAs('pdf');
$('#btnDocx').onclick = () => exportAs('docx');
$('#btnHtml').onclick = async () => { if (dirty && !(await save())) return; api.mdocOpenHtml(DIR); };
$('#btnFolder').onclick = () => api.mdocOpenFolder(DIR);

window.addEventListener('keydown', (e) => {
  const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName);
  const key = e.key.toLowerCase();
  if (e.ctrlKey && key === 's') { e.preventDefault(); save(); return; }
  if (typing) return;
  if (e.ctrlKey && key === 'z') { e.preventDefault(); undo(); return; }
  if (e.ctrlKey && key === 'y') { e.preventDefault(); redo(); return; }
  if (key === 'escape' && addMode) { addMode = false; renderScreen(); }
  if ((key === 'delete' || key === 'backspace') && selMark >= 0) deleteMark(selMark);
});
window.addEventListener('resize', () => { if (doc) { fitCanvas(); draw(); } });

/* ---------------- início ---------------- */
(async () => {
  try {
    const s = await api.getSettings();
    if (s.accent) document.documentElement.style.setProperty('--accent', s.accent);
  } catch { /* ignora */ }
  const r = await api.mdocLoad(DIR);
  if (!r.ok) { $('#loading').textContent = `Não foi possível abrir o manual: ${r.error}`; return; }
  doc = r.doc; video = r.video;
  images = await Promise.all(r.originals.map((u) => (u ? loadImg(u) : loadImg('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='))));
  replaced = doc.screens.map(() => null);
  $('#optLogo').disabled = !r.hasLogo; $('#optLogo').checked = r.hasLogo;
  $('#optLogo').parentElement.title = r.hasLogo ? '' : 'Escolha um logo na aba Vídeo do RecFlow';
  if (r.videoMissing) toast('O vídeo deste manual não foi encontrado. Escolha o vídeo novamente.', true);
  document.title = `${doc.title} — Editor de manual`;
  lastState = snapshot();
  renderAll();
  $('#loading').hidden = true;
})();
