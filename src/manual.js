'use strict';
/* global api */
// Janela de marcação do modo manual: tela congelada + marcação + caixa de descrição
const $ = (s) => document.querySelector(s);
const stage = $('#stage');
const ctx = stage.getContext('2d');
let init = null;
let img = null;
let cur = null;          // marcação em andamento: { rect, shape, color, num }
let f = 1;               // pixels de tela (CSS) por pixel da imagem
let dpr = window.devicePixelRatio || 1;
let drag = null;
let saving = false;

const { geom, drawMark } = window.RFMarks;

/* ---------------- Tela ---------------- */
function resize() {
  dpr = window.devicePixelRatio || 1;
  stage.width = Math.round(innerWidth * dpr); stage.height = Math.round(innerHeight * dpr);
  if (init) f = innerWidth / init.imgW;
  render();
}
function render() {
  if (!img || !cur) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, stage.width, stage.height);
  ctx.setTransform(dpr * f, 0, 0, dpr * f, 0, 0);
  ctx.drawImage(img, 0, 0, init.imgW, init.imgH);
  init.marks.forEach((m) => drawMark(ctx, m, init.scale));
  if (drag && drag.kind === 'draw' && drag.rect) {
    const r = drag.rect;
    ctx.save(); ctx.setLineDash([6 * init.scale, 4 * init.scale]); ctx.lineWidth = 2 * init.scale; ctx.strokeStyle = cur.color;
    ctx.strokeRect(r.x, r.y, r.w, r.h); ctx.restore();
  }
  if (cur.rect) {
    const g = drawMark(ctx, cur, init.scale);
    // alça de redimensionar (só na tela, não sai no print)
    const h = handlePos(g);
    ctx.beginPath(); ctx.arc(h.x, h.y, 6 * init.scale, 0, Math.PI * 2);
    ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = 2 * init.scale; ctx.strokeStyle = cur.color; ctx.stroke();
    placeDialog(g);
  }
}
function handlePos(g) {
  // na elipse, a alça fica sobre o contorno (canto inferior direito)
  if (g.shape === 'ellipse') return { x: g.cx + g.rx * Math.SQRT1_2, y: g.cy + g.ry * Math.SQRT1_2 };
  return { x: g.box.x + g.box.w, y: g.box.y + g.box.h };
}

function placeDialog(g) {
  const dlg = $('#dialog');
  const wasHidden = dlg.hidden;
  dlg.hidden = false;
  const w = dlg.offsetWidth, h = dlg.offsetHeight;
  const bx = g.box.x * f, by = g.box.y * f, bw = g.box.w * f, bh = g.box.h * f;
  let left = Math.max(12, Math.min(innerWidth - w - 12, bx));
  let top = by + bh + 14;
  if (top + h > innerHeight - 12) top = by - h - 14;
  if (top < 56) top = Math.min(innerHeight - h - 12, Math.max(56, by + bh + 14));
  dlg.style.left = `${left}px`; dlg.style.top = `${top}px`;
  if (wasHidden) setTimeout(() => $('#text').focus(), 0);
}

/* ---------------- Interação ---------------- */
const toImg = (e) => ({ x: e.clientX / f, y: e.clientY / f });
function hit(p) {
  if (!cur || !cur.rect) return null;
  const g = geom(cur.rect, cur.shape, init.scale);
  const h = handlePos(g);
  const tol = 12 / f;
  if (Math.abs(p.x - h.x) < tol && Math.abs(p.y - h.y) < tol) return 'resize';
  const b = g.box;
  if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) return 'move';
  return null;
}
stage.addEventListener('pointermove', (e) => {
  if (!init || !cur) return;
  const p = toImg(e);
  if (drag) {
    if (drag.kind === 'move') { cur.rect.x = drag.r0.x + p.x - drag.p0.x; cur.rect.y = drag.r0.y + p.y - drag.p0.y; }
    else if (drag.kind === 'resize') {
      cur.rect.w = Math.max(8, drag.r0.w + p.x - drag.p0.x); cur.rect.h = Math.max(8, drag.r0.h + p.y - drag.p0.y);
    } else if (drag.kind === 'draw') {
      drag.rect = { x: Math.min(drag.p0.x, p.x), y: Math.min(drag.p0.y, p.y), w: Math.abs(p.x - drag.p0.x), h: Math.abs(p.y - drag.p0.y) };
    }
    render();
    return;
  }
  const hz = hit(p);
  stage.className = hz === 'resize' ? 'over-handle' : hz === 'move' ? 'over-mark' : '';
});
stage.addEventListener('pointerdown', (e) => {
  if (!init || !cur || e.button !== 0) return;
  stage.setPointerCapture(e.pointerId);
  const p = toImg(e);
  const hz = hit(p);
  drag = { kind: hz || 'draw', p0: p, r0: cur.rect ? { ...cur.rect } : null, rect: null };
});
stage.addEventListener('pointerup', () => {
  if (!drag) return;
  const d = drag; drag = null;
  if (d.kind === 'draw' && d.rect && d.rect.w * f > 8 && d.rect.h * f > 8) {
    cur.rect = d.rect;
    $('#drawHint').hidden = true;
    $('#dField').textContent = 'Marcado manualmente';
  }
  render();
  $('#text').focus();
});

function setShape(s) {
  cur.shape = s;
  document.querySelectorAll('#shapes button').forEach((b) => b.classList.toggle('on', b.dataset.shape === s));
  render();
}
document.querySelectorAll('#shapes button').forEach((b) => { b.onclick = () => { setShape(b.dataset.shape); $('#text').focus(); }; });

async function confirm() {
  if (saving || !cur.rect) return;
  saving = true;
  $('#ok').textContent = 'Salvando…';
  // imagem final: print + todas as marcações (sem a caixa de texto)
  const c = document.createElement('canvas');
  c.width = init.imgW; c.height = init.imgH;
  const x = c.getContext('2d');
  x.drawImage(img, 0, 0);
  init.marks.forEach((m) => drawMark(x, m, init.scale));
  drawMark(x, cur, init.scale);
  const r = await api.manualSave({
    text: $('#text').value, shape: cur.shape, color: cur.color,
    screenName: init.firstOfScreen ? $('#screenName').value : '',
    rect: { x: Math.round(cur.rect.x), y: Math.round(cur.rect.y), w: Math.round(cur.rect.w), h: Math.round(cur.rect.h) },
    png: c.toDataURL('image/png')
  });
  if (r && r.ok) api.manualClose();
  else { saving = false; $('#ok').textContent = 'OK'; const h = document.querySelector('.hint'); h.style.color = '#dc2626'; h.textContent = `Não foi possível salvar: ${(r && r.error) || 'erro'}`; }
}
function cancel() { api.manualClose(); }
$('#ok').onclick = confirm;
$('#cancel').onclick = cancel;
$('#screenName').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#text').focus(); } });
$('#text').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); confirm(); }
});
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); cancel(); } });
window.addEventListener('resize', resize);
window.addEventListener('focus', () => { if (!$('#dialog').hidden && document.activeElement !== $('#screenName')) $('#text').focus(); });

/* ---------------- Início ---------------- */
(async () => {
  init = await api.manualInit();
  if (!init) { api.manualClose(); return; }
  document.documentElement.style.setProperty('--c', init.color);
  img = new Image();
  img.src = init.image;
  await img.decode();
  cur = { rect: init.rect ? { ...init.rect } : null, shape: init.shape, color: init.color, num: init.num };
  $('#dNum').textContent = String(init.num);
  $('#dTitle').textContent = `Item ${init.num} · Tela ${init.screenN}`;
  $('#dField').textContent = init.fieldName || (init.rect ? '' : '');
  $('#bannerText').textContent = `Tela ${init.screenN} · item ${init.num}`;
  if (init.firstOfScreen) { $('#nameRow').hidden = false; $('#screenName').value = init.screenName || `Tela ${init.screenN}`; }
  setShape(init.shape);
  $('#drawHint').hidden = !!cur.rect;
  resize();
})();
