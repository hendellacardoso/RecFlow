'use strict';
/* global api */
const COLORS = ['#ff3b30', '#ffd60a', '#30d158', '#0a84ff', '#ffffff', '#111111'];
let opts = { tool: 'pen', color: '#ff3b30', width: 4 };

const colorsBox = document.getElementById('colors');
COLORS.forEach((c) => {
  const b = document.createElement('button');
  b.className = 'swb'; b.dataset.color = c; b.title = c;
  const s = document.createElement('span'); s.className = 'sw'; s.style.background = c;
  b.appendChild(s); colorsBox.appendChild(b);
});

function render() {
  document.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === opts.tool));
  document.querySelectorAll('[data-width]').forEach((b) => b.classList.toggle('on', Number(b.dataset.width) === opts.width));
  document.querySelectorAll('[data-color]').forEach((b) => b.firstChild.classList.toggle('on', b.dataset.color === opts.color));
}
function set(patch) { opts = { ...opts, ...patch }; api.drawTool(patch); render(); }

document.querySelectorAll('[data-tool]').forEach((b) => { b.onclick = () => set({ tool: b.dataset.tool }); });
document.querySelectorAll('[data-width]').forEach((b) => { b.onclick = () => set({ width: Number(b.dataset.width) }); });
document.querySelectorAll('[data-color]').forEach((b) => {
  b.onclick = () => set({ color: b.dataset.color, tool: opts.tool === 'eraser' ? 'pen' : opts.tool });
});
document.getElementById('undo').onclick = () => api.drawUndo();
document.getElementById('clear').onclick = () => api.drawClear();
document.getElementById('close').onclick = () => api.drawToggle(false);

api.on('draw:tool', (o) => { opts = { ...opts, ...o }; render(); });
api.toolbarInit().then((o) => { opts = { ...opts, ...o }; render(); });
