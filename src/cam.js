'use strict';
/* global api */
const v = document.getElementById('v');
const msg = document.getElementById('msg');
const wrap = document.getElementById('wrap');
let cfg = {};
let stream = null;
let currentDevice = null;

async function startCamera() {
  if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  currentDevice = cfg.deviceId || '';
  msg.textContent = 'Abrindo webcam…'; msg.hidden = false;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        deviceId: cfg.deviceId ? { exact: cfg.deviceId } : undefined,
        width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 }
      }
    });
    v.srcObject = stream;
    v.onplaying = () => { msg.hidden = true; };
    await v.play();
    msg.hidden = true;
  } catch (e) {
    msg.textContent = `Webcam indisponível\n${e.message}`;
  }
}

/* Fundo desfocado */
const cv = document.getElementById('cv');
let blur = null, blurOn = false;
async function setBlur(on) {
  blurOn = on;
  if (!on) { cv.hidden = true; return; }
  try {
    if (!blur) { msg.textContent = 'Carregando desfoque…'; msg.hidden = false; blur = await new window.BackgroundBlur().init(); }
    if (v.readyState >= 2) msg.hidden = true;
    cv.hidden = false;
    requestAnimationFrame(blurLoop);
  } catch (e) {
    msg.textContent = `Desfoque indisponível\n${e.message}`; msg.hidden = false; cv.hidden = true;
  }
}
function blurLoop() {
  if (!blurOn || !blur) return;
  if (v.readyState >= 2) {
    if (!msg.hidden && stream) msg.hidden = true;
    const out = blur.process(v, cfg.blurStrength || 14);
    if (cv.width !== out.width || cv.height !== out.height) { cv.width = out.width; cv.height = out.height; }
    cv.getContext('2d').drawImage(out, 0, 0);
  }
  requestAnimationFrame(blurLoop);
}

function apply(c) {
  cfg = { ...cfg, ...c };
  if (!!cfg.blur !== blurOn) setBlur(!!cfg.blur);
  document.body.classList.toggle('circle', cfg.shape !== 'rect');
  document.body.classList.toggle('rect', cfg.shape === 'rect');
  document.body.classList.toggle('mirror', !!cfg.mirror);
  if ((cfg.deviceId || '') !== currentDevice || !stream) startCamera();
}

/* Arrastar (mover) e redimensionar: o processo principal calcula pela posição do cursor */
let dragging = false, raf = 0;
function begin(e, type) {
  if (e.button !== 0) return;
  e.preventDefault();
  dragging = true;
  e.target.setPointerCapture(e.pointerId);
  wrap.classList.add('dragging');
  api.camDragStart(type);
}
function move() {
  if (!dragging || raf) return;
  raf = requestAnimationFrame(() => { raf = 0; api.camDrag(); });
}
function end() {
  if (!dragging) return;
  dragging = false;
  wrap.classList.remove('dragging');
  api.camDragEnd();
}
wrap.addEventListener('pointerdown', (e) => begin(e, 'move'));
document.getElementById('resize').addEventListener('pointerdown', (e) => begin(e, 'resize'));
window.addEventListener('pointermove', move);
window.addEventListener('pointerup', end);
window.addEventListener('pointercancel', end);
window.addEventListener('wheel', (e) => { e.preventDefault(); api.camWheel(Math.sign(e.deltaY)); }, { passive: false });
document.getElementById('close').addEventListener('click', () => api.camHide());

api.on('cam:config', apply);
api.camInit().then(apply);
