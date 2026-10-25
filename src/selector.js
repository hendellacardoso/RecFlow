'use strict';
/* global api */
const c = document.getElementById('c');
const ctx = c.getContext('2d');
const bar = document.getElementById('bar');
const help = document.getElementById('help');
let dpr = window.devicePixelRatio || 1;
let start = null, rect = null, dragging = false, cursor = null;

function resize() {
  dpr = window.devicePixelRatio || 1;
  c.width = Math.round(innerWidth * dpr); c.height = Math.round(innerHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw();
}
function norm(a, b) {
  const x = Math.max(0, Math.min(a.x, b.x)), y = Math.max(0, Math.min(a.y, b.y));
  const x2 = Math.min(innerWidth, Math.max(a.x, b.x)), y2 = Math.min(innerHeight, Math.max(a.y, b.y));
  return { x: Math.round(x), y: Math.round(y), w: Math.round(x2 - x), h: Math.round(y2 - y) };
}
function draw() {
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(0, 0, innerWidth, innerHeight);
  if (rect && rect.w > 0 && rect.h > 0) {
    ctx.clearRect(rect.x, rect.y, rect.w, rect.h);
    // alfa mínimo para a janela continuar recebendo cliques na área "furada"
    ctx.fillStyle = 'rgba(255,255,255,0.01)';
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    ctx.strokeStyle = '#ff3b30'; ctx.lineWidth = 2;
    ctx.strokeRect(rect.x + 1, rect.y + 1, rect.w - 2, rect.h - 2);
    const label = `${Math.round(rect.w * dpr)} × ${Math.round(rect.h * dpr)}`;
    ctx.font = '600 13px "Segoe UI", sans-serif';
    const tw = ctx.measureText(label).width + 14;
    const ly = rect.y > 28 ? rect.y - 26 : rect.y + 6;
    ctx.fillStyle = '#ff3b30'; ctx.fillRect(rect.x, ly, tw, 22);
    ctx.fillStyle = '#fff'; ctx.fillText(label, rect.x + 7, ly + 15);
  } else if (cursor) {
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cursor.x + 0.5, 0); ctx.lineTo(cursor.x + 0.5, innerHeight);
    ctx.moveTo(0, cursor.y + 0.5); ctx.lineTo(innerWidth, cursor.y + 0.5);
    ctx.stroke();
  }
}
function placeBar() {
  if (!rect) { bar.classList.remove('show'); return; }
  bar.classList.add('show');
  const bw = bar.offsetWidth, bh = bar.offsetHeight;
  let x = rect.x + rect.w - bw; let y = rect.y + rect.h + 8;
  if (y + bh > innerHeight - 4) y = rect.y + rect.h - bh - 8;
  if (y < 4) y = 4;
  x = Math.max(4, Math.min(innerWidth - bw - 4, x));
  bar.style.left = `${x}px`; bar.style.top = `${y}px`;
}
function confirm() { if (rect && rect.w >= 16 && rect.h >= 16) api.regionResult(rect); }
function cancel() { api.regionResult(null); }

c.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  start = { x: e.clientX, y: e.clientY }; dragging = true; rect = null;
  bar.classList.remove('show'); help.style.display = 'none';
  api.regionStart(); // avisa os outros monitores para limpar a seleção
});
// Seleção iniciada em outro monitor: limpa esta
api.on('region:reset', () => {
  rect = null; dragging = false; cursor = null;
  bar.classList.remove('show'); help.style.display = '';
  draw();
});
document.addEventListener('mouseleave', () => { cursor = null; if (!dragging) draw(); });
window.addEventListener('mousemove', (e) => {
  cursor = { x: e.clientX, y: e.clientY };
  if (dragging) rect = norm(start, cursor);
  draw();
});
window.addEventListener('mouseup', () => {
  if (!dragging) return;
  dragging = false;
  if (!rect || rect.w < 16 || rect.h < 16) rect = null;
  draw(); placeBar();
});
c.addEventListener('dblclick', confirm);
c.addEventListener('contextmenu', (e) => { e.preventDefault(); cancel(); });
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') cancel();
  if (e.key === 'Enter') confirm();
});
document.getElementById('ok').onclick = confirm;
document.getElementById('cancel').onclick = cancel;
document.getElementById('redo').onclick = () => { rect = null; draw(); placeBar(); help.style.display = ''; };
document.getElementById('preset').onchange = (e) => {
  const v = e.target.value; e.target.value = '';
  if (!v) return;
  if (v === 'full') rect = { x: 0, y: 0, w: innerWidth, h: innerHeight };
  else {
    const [pw, ph] = v.split('x').map(Number);
    const w = Math.min(innerWidth, Math.round(pw / dpr)), h = Math.min(innerHeight, Math.round(ph / dpr));
    const cx = rect ? rect.x + rect.w / 2 : innerWidth / 2, cy = rect ? rect.y + rect.h / 2 : innerHeight / 2;
    rect = {
      x: Math.round(Math.max(0, Math.min(innerWidth - w, cx - w / 2))),
      y: Math.round(Math.max(0, Math.min(innerHeight - h, cy - h / 2))), w, h
    };
  }
  draw(); placeBar();
};
window.addEventListener('resize', resize);
resize();
