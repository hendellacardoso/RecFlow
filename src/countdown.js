'use strict';
const total = Math.max(1, Number(new URLSearchParams(location.search).get('s')) || 3);
const n = document.getElementById('n');
const arc = document.getElementById('arc');
const C = 2 * Math.PI * 45;
arc.style.strokeDasharray = String(C);
const t0 = performance.now();
let last = null;
function frame(now) {
  const el = (now - t0) / 1000;
  const left = Math.max(1, Math.ceil(total - el));
  if (left !== last) { n.textContent = String(left); n.style.animation = 'none'; void n.offsetWidth; n.style.animation = ''; last = left; }
  arc.style.strokeDashoffset = String(C * Math.min(1, el / total));
  if (el < total) requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
