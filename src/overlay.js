'use strict';
/* global api */
const view = document.getElementById('view');
const fx = document.getElementById('fx');
const vctx = view.getContext('2d');
const fctx = fx.getContext('2d');
const base = document.createElement('canvas');   // traços já confirmados
const bctx = base.getContext('2d');

let dpr = window.devicePixelRatio || 1;
let opts = { tool: 'pen', color: '#ff3b30', width: 4 };
let drawMode = false;
let items = [];
let current = null;
const ripples = [];
let fxRunning = false;

function resize() {
  dpr = window.devicePixelRatio || 1;
  [view, fx, base].forEach((cv) => { cv.width = Math.round(innerWidth * dpr); cv.height = Math.round(innerHeight * dpr); });
  [vctx, fctx, bctx].forEach((cx) => cx.setTransform(dpr, 0, 0, dpr, 0, 0));
  rebuild();
}

/* ---------------- Desenho ---------------- */
function strokePath(ctx, pts) {
  ctx.beginPath();
  if (pts.length === 1) { ctx.moveTo(pts[0][0], pts[0][1]); ctx.lineTo(pts[0][0] + 0.01, pts[0][1]); }
  else {
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
      ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
    }
    const last = pts[pts.length - 1];
    ctx.lineTo(last[0], last[1]);
  }
  ctx.stroke();
}
function drawItem(ctx, it) {
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = it.color; ctx.fillStyle = it.color; ctx.lineWidth = it.width;
  const [x1, y1] = it.a || [0, 0], [x2, y2] = it.b || [0, 0];
  switch (it.tool) {
    case 'pen': strokePath(ctx, it.points); break;
    case 'highlighter':
      ctx.globalAlpha = 0.35; ctx.lineWidth = it.width * 4; ctx.lineCap = 'butt';
      strokePath(ctx, it.points); break;
    case 'eraser':
      ctx.globalCompositeOperation = 'destination-out'; ctx.lineWidth = it.width * 6;
      strokePath(ctx, it.points); break;
    case 'line':
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); break;
    case 'arrow': {
      const ang = Math.atan2(y2 - y1, x2 - x1);
      const head = Math.max(14, it.width * 4);
      const bx = x2 - Math.cos(ang) * head * 0.8, by = y2 - Math.sin(ang) * head * 0.8;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(bx, by); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - Math.cos(ang - 0.45) * head, y2 - Math.sin(ang - 0.45) * head);
      ctx.lineTo(x2 - Math.cos(ang + 0.45) * head, y2 - Math.sin(ang + 0.45) * head);
      ctx.closePath(); ctx.fill();
      break;
    }
    case 'rect':
      ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1)); break;
    case 'ellipse':
      ctx.beginPath();
      ctx.ellipse((x1 + x2) / 2, (y1 + y2) / 2, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2, 0, 0, Math.PI * 2);
      ctx.stroke(); break;
    default: break;
  }
  ctx.restore();
}
function rebuild() {
  bctx.clearRect(0, 0, innerWidth, innerHeight);
  items.forEach((it) => drawItem(bctx, it));
  render();
}
function render() {
  vctx.clearRect(0, 0, innerWidth, innerHeight);
  vctx.drawImage(base, 0, 0, innerWidth, innerHeight);
  if (current) drawItem(vctx, current);
}
const FREEHAND = ['pen', 'highlighter', 'eraser'];

view.addEventListener('pointerdown', (e) => {
  if (!drawMode || e.button !== 0) return;
  view.setPointerCapture(e.pointerId);
  const p = [e.clientX, e.clientY];
  current = { tool: opts.tool, color: opts.color, width: opts.width };
  if (FREEHAND.includes(opts.tool)) current.points = [p];
  else { current.a = p; current.b = p; }
  render();
});
view.addEventListener('pointermove', (e) => {
  if (!current) return;
  const p = [e.clientX, e.clientY];
  if (current.points) current.points.push(p);
  else {
    // Shift: linha reta em 45° / quadrado / círculo
    if (e.shiftKey) {
      const [ax, ay] = current.a; let dx = p[0] - ax, dy = p[1] - ay;
      if (current.tool === 'rect' || current.tool === 'ellipse') {
        const s = Math.max(Math.abs(dx), Math.abs(dy)); dx = Math.sign(dx || 1) * s; dy = Math.sign(dy || 1) * s;
      } else {
        const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4); const len = Math.hypot(dx, dy);
        dx = Math.cos(ang) * len; dy = Math.sin(ang) * len;
      }
      current.b = [ax + dx, ay + dy];
    } else current.b = p;
  }
  render();
});
function commit() {
  if (!current) return;
  items.push(current); drawItem(bctx, current); current = null; render();
}
view.addEventListener('pointerup', commit);
view.addEventListener('pointercancel', commit);

function undo() { items.pop(); rebuild(); }
function clearAll() { items = []; current = null; rebuild(); }

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') api.drawToggle(false);
  else if (e.ctrlKey && e.key.toLowerCase() === 'z') undo();
});

function setMode(on) {
  drawMode = !!on;
  document.body.classList.toggle('drawing', drawMode);
  if (!drawMode) commit();
}

/* ---------------- Efeitos de clique ---------------- */
const CLICK_COLORS = { 1: '255,214,10', 2: '255,59,48', 3: '48,209,88' };
function addRipple(x, y, button) {
  ripples.push({ x, y, t0: performance.now(), rgb: CLICK_COLORS[button] || CLICK_COLORS[1] });
  if (!fxRunning) { fxRunning = true; requestAnimationFrame(fxLoop); }
}
function fxLoop(now) {
  fctx.clearRect(0, 0, innerWidth, innerHeight);
  for (let i = ripples.length - 1; i >= 0; i--) {
    const r = ripples[i]; const p = (now - r.t0) / 550;
    if (p >= 1) { ripples.splice(i, 1); continue; }
    const rad = 8 + 30 * p;
    fctx.beginPath(); fctx.arc(r.x, r.y, rad, 0, Math.PI * 2);
    fctx.fillStyle = `rgba(${r.rgb},${0.28 * (1 - p)})`; fctx.fill();
    fctx.lineWidth = 3; fctx.strokeStyle = `rgba(${r.rgb},${1 - p})`; fctx.stroke();
  }
  if (ripples.length) requestAnimationFrame(fxLoop);
  else { fxRunning = false; fctx.clearRect(0, 0, innerWidth, innerHeight); }
}


/* ---------------- Teclas pressionadas ---------------- */
const keysBox = document.getElementById('keys');
let keysCfg = null;
const KEY_LABEL = {
  Enter: 'Enter ⏎', NumpadEnter: 'Enter ⏎', Backspace: '⌫ Backspace', Tab: 'Tab ⇥', Escape: 'Esc', Space: 'Espaço',
  ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Delete: 'Del', Insert: 'Ins', PageUp: 'PgUp',
  PageDown: 'PgDn', CapsLock: 'Caps Lock', PrintScreen: 'PrtSc', NumLock: 'Num Lock', ScrollLock: 'Scroll Lock',
  Semicolon: ';', Equal: '=', Comma: ',', Minus: '-', Period: '.', Slash: '/', Backquote: '`', BracketLeft: '[',
  Backslash: '\\', BracketRight: ']', Quote: "'", NumpadMultiply: '*', NumpadAdd: '+', NumpadSubtract: '-',
  NumpadDecimal: ',', NumpadDivide: '/', NumpadEnd: 'End', NumpadHome: 'Home', NumpadArrowLeft: '←',
  NumpadArrowRight: '→', NumpadArrowUp: '↑', NumpadArrowDown: '↓', NumpadPageUp: 'PgUp', NumpadPageDown: 'PgDn',
  NumpadInsert: 'Ins', NumpadDelete: 'Del'
};
const MODS = new Set(['Ctrl', 'CtrlRight', 'Alt', 'AltRight', 'Shift', 'ShiftRight', 'Meta', 'MetaRight']);
const keyLabel = (n) => KEY_LABEL[n] || (/^Numpad(\d)$/.exec(n) || [])[1] || n;
function charOf(k) {
  if (k.name === 'Space') return ' ';
  if (/^[A-Z]$/.test(k.name)) return k.shift ? k.name : k.name.toLowerCase();
  if (/^\d$/.test(k.name)) return k.name;
  if (/^Numpad\d$/.test(k.name)) return k.name.slice(-1);
  const l = KEY_LABEL[k.name];
  return l && l.length === 1 ? l : null;
}
function applyKeysConfig(c) {
  keysCfg = c;
  if (!c) { keysBox.innerHTML = ''; return; }
  keysBox.className = c.size || 'm';
  const r = c.rect || { x: 0, y: 0, w: innerWidth, h: innerHeight };
  const m = Math.round(Math.min(r.w, r.h) * 0.05);
  const pos = c.pos || 'bc';
  Object.assign(keysBox.style, { left: 'auto', right: 'auto', top: 'auto', bottom: 'auto', transform: 'none' });
  if (pos.includes('l')) keysBox.style.left = `${r.x + m}px`;
  else if (pos.includes('r')) keysBox.style.right = `${innerWidth - (r.x + r.w) + m}px`;
  else { keysBox.style.left = `${r.x + r.w / 2}px`; keysBox.style.transform = 'translateX(-50%)'; }
  if (pos[0] === 't') { keysBox.style.top = `${r.y + m}px`; keysBox.style.flexDirection = 'column'; }
  else { keysBox.style.bottom = `${innerHeight - (r.y + r.h) + m}px`; keysBox.style.flexDirection = 'column-reverse'; }
  keysBox.style.alignItems = pos.includes('l') ? 'flex-start' : pos.includes('r') ? 'flex-end' : 'center';
}
function chipTimer(chip) {
  clearTimeout(chip._t);
  chip.classList.remove('out');
  chip._t = setTimeout(() => { chip.classList.add('out'); setTimeout(() => chip.remove(), 400); }, (keysCfg?.duration || 1.5) * 1000);
}
function showKey(k) {
  if (!keysCfg || MODS.has(k.name)) return;
  const now = performance.now();
  const last = keysBox.firstChild && keysBox.firstChild.classList.contains('out') ? null : keysBox.firstChild;
  const ch = !k.ctrl && !k.alt && !k.meta ? charOf(k) : null;
  if (ch !== null) {
    // digitação: junta as letras num balão só
    if (last && last._typing && now - last._at < 1500 && last._text.length < 28) {
      last._text += ch; last.querySelector('.typed').textContent = last._text;
    } else {
      const c = document.createElement('div'); c.className = 'kc';
      const t = document.createElement('span'); t.className = 'typed'; t.textContent = ch;
      c.appendChild(t); c._typing = true; c._text = ch;
      keysBox.prepend(c);
    }
    keysBox.firstChild._at = now; chipTimer(keysBox.firstChild);
  } else {
    const parts = [k.ctrl && 'Ctrl', k.alt && 'Alt', k.shift && 'Shift', k.meta && 'Win', keyLabel(k.name)].filter(Boolean);
    const id = parts.join('+');
    if (last && !last._typing && last._id === id && now - last._at < 1500) {
      last._count = (last._count || 1) + 1;
      let cnt = last.querySelector('.count');
      if (!cnt) { cnt = document.createElement('span'); cnt.className = 'count'; last.appendChild(cnt); }
      cnt.textContent = `×${last._count}`;
    } else {
      const c = document.createElement('div'); c.className = 'kc'; c._id = id;
      parts.forEach((p, i) => {
        if (i) { const pl = document.createElement('span'); pl.className = 'plus'; pl.textContent = '+'; c.appendChild(pl); }
        const kb = document.createElement('kbd'); kb.textContent = p; c.appendChild(kb);
      });
      keysBox.prepend(c);
    }
    keysBox.firstChild._at = now; chipTimer(keysBox.firstChild);
  }
  while (keysBox.children.length > 4) keysBox.lastChild.remove();
}
api.on('keys:config', applyKeysConfig);
api.on('key', showKey);

/* ---------------- Integração ---------------- */
api.on('draw:mode', setMode);
api.on('draw:tool', (o) => { opts = { ...opts, ...o }; });
api.on('draw:undo', undo);
api.on('draw:clear', clearAll);
api.on('click', ({ x, y, button }) => addRipple(x, y, button));
window.addEventListener('resize', resize);

resize();
api.overlayInit().then((st) => { opts = { ...opts, ...st.drawOpts }; setMode(st.drawing); if (st.keys) applyKeysConfig(st.keys); });
