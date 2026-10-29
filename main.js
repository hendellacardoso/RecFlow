'use strict';
const {
  app, BrowserWindow, ipcMain, desktopCapturer, screen, globalShortcut,
  shell, dialog, Tray, Menu, nativeImage, nativeTheme, systemPreferences, protocol, net
} = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');
const mdocs = require('./manual-docs');
const ai = require('./ai');
const hwrec = require('./hwrec');

// FFmpeg embutido (usado para finalizar gravações e exportar o vídeo editado)
let ffmpegPath = null;
try {
  ffmpegPath = require('ffmpeg-static');
  if (ffmpegPath) ffmpegPath = ffmpegPath.replace('app.asar', 'app.asar.unpacked');
  if (!ffmpegPath || !fs.existsSync(ffmpegPath)) ffmpegPath = null;
} catch { ffmpegPath = null; }

// Hook global de mouse (opcional) para os efeitos de clique
let uIOhook = null, UiohookKey = {};
try { ({ uIOhook, UiohookKey } = require('uiohook-napi')); } catch { uIOhook = null; }
const KEY_NAMES = {};
for (const [name, code] of Object.entries(UiohookKey || {})) if (!(code in KEY_NAMES)) KEY_NAMES[code] = name;

// Protocolo interno gt://app/... para carregar modelos de IA, WebAssembly e worklets
// (o fetch() do Chromium não lê arquivos file://)
protocol.registerSchemesAsPrivileged([
  { scheme: 'gt', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }
]);
const PROJECT_EXT = '.gtproj';

const ICON = path.join(__dirname, 'assets', 'icon.png');
const TRAY_ICON = path.join(__dirname, 'assets', process.platform === 'win32' ? 'icon.ico' : 'tray.png');
const PRELOAD = path.join(__dirname, 'preload.js');
const APP_TITLE = 'RecFlow';
// Links permitidos na tela Sobre
const ABOUT_LINKS = ['mailto:suporte@api2dev.com.br', 'https://wa.me/5562993148955', 'https://api2dev.com.br', 'https://github.com/hendellacardoso/RecFlow', 'https://github.com/hendellacardoso/RecFlow/releases'];

let camWin = null, camDrag = null, camSaveTimer = null;
let mainWin = null, overlayWin = null, toolbarWin = null, borderWin = null, tray = null;
let selectorWins = [];
let settings = null;
let failedHotkeys = [];
let drawing = false;
let drawOpts = { tool: 'pen', color: '#ff3b30', width: 4 };
let hookRunning = false;
let pendingQuit = false;
const rec = { active: false, paused: false, stream: null, file: null, displayId: null, tracks: {}, clicks: [], parts: [], engine: 'browser', cap: null };

/* ------------------------------------------------------------------ */
/* Configurações                                                        */
/* ------------------------------------------------------------------ */
function defaults() {
  return {
    outputDir: path.join(app.getPath('videos'), 'RecFlow'),
    format: 'mp4', fps: 30, bitrate: 8,
    mode: 'screen', displayId: null, windowId: null, windowName: '', region: null,
    systemAudio: true, systemVolume: 100, mic: false, micDeviceId: '', micVolume: 100,
    webcam: false, webcamDeviceId: '', webcamPos: 'br', webcamSize: 22, webcamShape: 'circle', webcamMirror: false,
    webcamWidth: 260, webcamBounds: null, theme: 'system', openEditor: true,
    webcamBlur: false, webcamBlurStrength: 14, micNoise: 'standard',
    countdown: 3,
    manualEnabled: true, manualTitle: 'Manual', manualShape: 'ellipse', manualColor: '#ff3b30', manualNumbering: 'screen', manualPause: true, manualDir: '',
    keysShow: false, keysPos: 'bc', keysSize: 'm', keysCombosOnly: false, keysDuration: 1.5,
    wmEnabled: false, wmPath: '', wmPos: 'br', wmSize: 14, wmOpacity: 80,
    clickEffects: true, hideApp: true, showBorder: true, minimizeOnRecord: false,
    engine: 'browser', hwEncoder: 'auto', hwGrabber: 'gdigrab', hwEncoders: null,
    limitMode: 'off', limitMinutes: 30, limitMB: 2000, limitAction: 'split',
    separateTracks: false, recordClicks: true, statusBar: true,
    brand: { name: '', color: '#e5484d', color2: '#111827', logoPath: '', footer: '', site: '' }, brandManuals: true,
    hotkeys: { record: 'F12', pause: 'Shift+F12', screenshot: 'F11', draw: 'Ctrl+Shift+D', clear: 'Ctrl+Shift+X', webcam: 'Ctrl+Shift+W', manualMark: 'Insert', manualNewScreen: 'Shift+Insert' },
    schedules: []
  };
}
const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');

function loadSettings() {
  const d = defaults();
  try {
    // migra as configurações da versão anterior (quando o app se chamava "Gravador de Tela")
    const old = path.join(app.getPath('appData'), 'gravador-tela', 'settings.json');
    if (!fs.existsSync(settingsPath()) && fs.existsSync(old)) {
      fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
      fs.copyFileSync(old, settingsPath());
    }
  } catch { /* ignora */ }
  try {
    const s = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
    return { ...d, ...s, hotkeys: { ...d.hotkeys, ...(s.hotkeys || {}) }, brand: { ...d.brand, ...(s.brand || {}) } };
  } catch { return d; }
}
function saveSettings() {
  try {
    fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
    fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2));
  } catch (e) { console.error('Falha ao salvar configurações', e); }
}
function ensureOutputDir() { fs.mkdirSync(settings.outputDir, { recursive: true }); }
// Arquivos auxiliares de cada gravação (trilhas separadas, cliques, segmentos) ficam em .recflow, ao lado do vídeo
function sidecar(file, kind) { return path.join(path.dirname(file), '.recflow', `${path.basename(file)}.${kind}`); }
function ensureSidecarDir(file) {
  const d = path.join(path.dirname(file), '.recflow');
  if (!fs.existsSync(d)) {
    fs.mkdirSync(d, { recursive: true });
    if (process.platform === 'win32') { try { spawn('attrib', ['+h', d], { windowsHide: true }); } catch { /* ignora */ } }
  }
  return d;
}
function freeBytes(dir) {
  try { fs.mkdirSync(dir, { recursive: true }); const st = fs.statfsSync(dir); return st.bavail * st.bsize; } catch { return null; }
}
// Identidade visual nos manuais
function applyBrand() {
  const b = settings.brand || {};
  mdocs.setBrand(settings.brandManuals ? { color: b.color, color2: b.color2, name: b.name, footer: b.footer, logoFile: b.logoPath } : null);
}
function insideOutput(p) {
  const base = path.resolve(settings.outputDir) + path.sep;
  return path.resolve(p).startsWith(base);
}
function stamp() {
  const d = new Date(); const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}
function getDisplay(id) {
  return screen.getAllDisplays().find((d) => String(d.id) === String(id)) || screen.getPrimaryDisplay();
}
function cursorDisplayId() {
  return String(screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id);
}
function accentColor() {
  try {
    const c = systemPreferences.getAccentColor && systemPreferences.getAccentColor();
    if (c && /^[0-9a-f]{6}/i.test(c)) return `#${c.slice(0, 6)}`;
  } catch { /* sem cor de destaque */ }
  return null;
}
function send(ch, ...a) { if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send(ch, ...a); }
function alive(w) { return w && !w.isDestroyed(); }
function webPrefs(extra = {}) {
  return { preload: PRELOAD, contextIsolation: true, nodeIntegration: false, ...extra };
}

/* ------------------------------------------------------------------ */
/* Janela principal e bandeja                                           */
/* ------------------------------------------------------------------ */
// A janela do RecFlow some do vídeo só enquanto grava; fora disso, prints funcionam normalmente
function applyHide() { if (alive(mainWin)) mainWin.setContentProtection(!!settings.hideApp && !!rec.active); }
function createMainWindow() {
  mainWin = new BrowserWindow({
    width: 1320, height: 760, minWidth: 1000, minHeight: 620,
    backgroundColor: '#14161b', icon: ICON, title: APP_TITLE, autoHideMenuBar: true, show: false,
    webPreferences: webPrefs({ backgroundThrottling: false })
  });
  mainWin.setMenu(null);
  mainWin.loadFile(path.join(__dirname, 'src', 'index.html'));
  mainWin.once('ready-to-show', () => mainWin.show());
  applyHide();
  mainWin.on('close', (e) => {
    // Fechar durante a gravação apenas esconde na bandeja
    if (rec.active && !app.isQuitting) { e.preventDefault(); mainWin.hide(); }
  });
  mainWin.on('closed', () => { mainWin = null; app.quit(); });
}

function createTray() {
  const trayImg = nativeImage.createFromPath(TRAY_ICON);
  tray = new Tray(process.platform === 'win32' ? trayImg : trayImg.resize({ width: 16, height: 16 }));
  tray.on('click', () => { if (mainWin) { mainWin.show(); mainWin.focus(); } });
  updateTray();
}
function updateTray() {
  if (!tray) return;
  tray.setToolTip(rec.active ? (rec.paused ? 'Gravação pausada' : 'Gravando…') : APP_TITLE);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: rec.active ? 'Parar gravação' : 'Iniciar gravação', click: () => send('hotkey', 'record') },
    { label: rec.paused ? 'Retomar' : 'Pausar', enabled: rec.active, click: () => send('hotkey', 'pause') },
    { label: 'Capturar imagem', click: () => takeScreenshot() },
    { label: drawing ? 'Fechar desenho' : 'Desenhar na tela', click: () => setDrawing(!drawing) },
    { type: 'separator' },
    { label: 'Sobre o RecFlow', click: () => { if (mainWin) { mainWin.show(); mainWin.focus(); send('show-panel', 'about'); } } },
    { label: 'Mostrar janela', click: () => { if (mainWin) { mainWin.show(); mainWin.focus(); } } },
    { label: 'Sair', click: () => { app.isQuitting = true; app.quit(); } }
  ]));
}

/* ------------------------------------------------------------------ */
/* Atalhos globais                                                      */
/* ------------------------------------------------------------------ */
function registerHotkeys() {
  globalShortcut.unregisterAll();
  const actions = {
    record: () => send('hotkey', 'record'),
    pause: () => send('hotkey', 'pause'),
    screenshot: () => takeScreenshot(),
    draw: () => setDrawing(!drawing),
    clear: () => { if (alive(overlayWin)) overlayWin.webContents.send('draw:clear'); },
    webcam: () => {
      settings.webcam = !settings.webcam; saveSettings(); syncCamWindow();
      send('settings:changed', settings);
    },
    manualMark: () => manualMark(false),
    manualNewScreen: () => manualMark(true)
  };
  const failed = [];
  for (const [key, fn] of Object.entries(actions)) {
    const acc = settings.hotkeys[key];
    if (!acc) continue;
    if ((key === 'manualMark' || key === 'manualNewScreen') && !settings.manualEnabled) continue;
    try { if (!globalShortcut.register(acc, fn)) failed.push(acc); } catch { failed.push(acc); }
  }
  failedHotkeys = failed;
  return failed;
}

/* ------------------------------------------------------------------ */
/* Seleção de área                                                      */
/* ------------------------------------------------------------------ */
function closeSelectors() {
  selectorWins.forEach((w) => { if (alive(w)) w.close(); });
  selectorWins = [];
}

// Abre um seletor em CADA monitor; a área fica no monitor onde o usuário arrastar
function selectRegion() {
  return new Promise((resolve) => {
    closeSelectors();
    const wasVisible = alive(mainWin) && mainWin.isVisible() && !mainWin.isMinimized();
    if (wasVisible) mainWin.minimize();

    const cursorId = cursorDisplayId();
    const byContents = new Map(); // webContents.id -> { win, display }
    let done = false;

    const finish = (r, d) => {
      if (done) return; done = true;
      ipcMain.removeListener('region:result', onResult);
      ipcMain.removeListener('region:start', onStart);
      closeSelectors();
      if (r && d && r.w >= 16 && r.h >= 16) {
        settings.region = { x: r.x, y: r.y, w: r.w, h: r.h, displayId: String(d.id) };
        settings.mode = 'area';
        saveSettings();
        syncCamWindow();
        if (alive(camWin) && !camInsideTarget()) placeCam('br');
      }
      if (wasVisible && alive(mainWin)) mainWin.restore();
      resolve(r && d ? settings.region : null);
    };
    const onResult = (ev, r) => {
      const e = byContents.get(ev.sender.id);
      if (e) finish(r, e.display);
    };
    // Ao começar a arrastar num monitor, limpa a seleção dos outros
    const onStart = (ev) => {
      for (const [id, e] of byContents) {
        if (id !== ev.sender.id && alive(e.win)) e.win.webContents.send('region:reset');
      }
    };
    ipcMain.on('region:result', onResult);
    ipcMain.on('region:start', onStart);

    for (const d of screen.getAllDisplays()) {
      const win = new BrowserWindow({
        ...d.bounds, frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true,
        resizable: false, movable: false, fullscreenable: false, hasShadow: false, show: false,
        title: 'GT Selecao', webPreferences: webPrefs()
      });
      byContents.set(win.webContents.id, { win, display: d });
      selectorWins.push(win);
      win.setAlwaysOnTop(true, 'screen-saver');
      win.setContentProtection(true);
      win.loadFile(path.join(__dirname, 'src', 'selector.html'));
      win.once('ready-to-show', () => {
        if (!alive(win)) return;
        win.setBounds(d.bounds); // reaplica: corrige posição em monitores com escalas diferentes
        win.show();
        if (String(d.id) === cursorId) win.focus();
      });
      win.on('closed', () => finish(null, null));
    }
  });
}

/* ------------------------------------------------------------------ */
/* Overlay (desenho + efeitos de clique), barra de ferramentas e borda  */
/* ------------------------------------------------------------------ */
function ensureOverlay(displayId) {
  if (alive(overlayWin)) return overlayWin;
  const d = getDisplay(displayId);
  overlayWin = new BrowserWindow({
    ...d.bounds, frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true,
    resizable: false, movable: false, focusable: true, hasShadow: false, show: false,
    fullscreenable: false, title: 'GT Overlay', webPreferences: webPrefs({ backgroundThrottling: false })
  });
  overlayWin.setAlwaysOnTop(true, 'screen-saver');
  overlayWin.setIgnoreMouseEvents(!drawing);
  overlayWin.loadFile(path.join(__dirname, 'src', 'overlay.html'));
  overlayWin.once('ready-to-show', () => {
    if (!alive(overlayWin)) return;
    overlayWin.setBounds(d.bounds);
    overlayWin.showInactive();
    applyOverlayState();
  });
  overlayWin.on('closed', () => { overlayWin = null; });
  return overlayWin;
}
function applyOverlayState() {
  if (!alive(overlayWin)) return;
  overlayWin.setIgnoreMouseEvents(!drawing);
  overlayWin.webContents.send('draw:mode', drawing);
  if (drawing) {
    overlayWin.focus();
    if (alive(toolbarWin)) toolbarWin.moveTop();
  }
}
function closeOverlay() { if (alive(overlayWin)) overlayWin.close(); overlayWin = null; }

function showToolbar(displayId) {
  if (alive(toolbarWin)) { toolbarWin.showInactive(); toolbarWin.moveTop(); return; }
  const d = getDisplay(displayId);
  const w = 740, h = 56;
  toolbarWin = new BrowserWindow({
    x: Math.round(d.bounds.x + (d.bounds.width - w) / 2), y: d.bounds.y + 14, width: w, height: h,
    frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true, resizable: false,
    hasShadow: false, show: false, fullscreenable: false, title: 'GT Ferramentas', webPreferences: webPrefs()
  });
  toolbarWin.setAlwaysOnTop(true, 'screen-saver', 1);
  toolbarWin.setContentProtection(true); // a barra não aparece no vídeo
  toolbarWin.loadFile(path.join(__dirname, 'src', 'toolbar.html'));
  toolbarWin.once('ready-to-show', () => { if (alive(toolbarWin)) { toolbarWin.showInactive(); toolbarWin.moveTop(); } });
  toolbarWin.on('closed', () => { toolbarWin = null; });
}
function closeToolbar() { if (alive(toolbarWin)) toolbarWin.close(); toolbarWin = null; }

function setDrawing(on) {
  drawing = !!on;
  if (drawing) {
    const disp = rec.active && rec.displayId ? rec.displayId : cursorDisplayId();
    const existed = alive(overlayWin);
    ensureOverlay(disp);
    showToolbar(disp);
    if (existed) applyOverlayState();
  } else {
    closeToolbar();
    if (rec.active && settings.mode !== 'window' && settings.mode !== 'webcam') applyOverlayState();
    else closeOverlay();
  }
  send('draw:state', drawing);
  updateTray();
}

function showBorder() {
  const r = settings.region; if (!r) return;
  const d = getDisplay(r.displayId); const p = 3;
  borderWin = new BrowserWindow({
    x: d.bounds.x + r.x - p, y: d.bounds.y + r.y - p, width: r.w + p * 2, height: r.h + p * 2,
    frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true, focusable: false,
    resizable: false, movable: false, hasShadow: false, show: false, title: 'GT Borda', webPreferences: webPrefs()
  });
  borderWin.setIgnoreMouseEvents(true);
  borderWin.setAlwaysOnTop(true, 'screen-saver');
  borderWin.setContentProtection(true);
  borderWin.loadFile(path.join(__dirname, 'src', 'border.html'));
  borderWin.once('ready-to-show', () => alive(borderWin) && borderWin.showInactive());
  borderWin.on('closed', () => { borderWin = null; });
}
function closeBorder() { if (alive(borderWin)) borderWin.close(); borderWin = null; }

/* ------------------------------------------------------------------ */
/* Webcam flutuante (arrastável; aparece no vídeo onde estiver)         */
/* ------------------------------------------------------------------ */
const camAllowed = () => !!settings.webcam && (settings.mode === 'screen' || settings.mode === 'area');
const camAspect = () => (settings.webcamShape === 'circle' ? 1 : 16 / 9);
const camConfig = () => ({ deviceId: settings.webcamDeviceId, shape: settings.webcamShape, mirror: !!settings.webcamMirror, blur: !!settings.webcamBlur, blurStrength: settings.webcamBlurStrength });

function targetRect() {
  // Retângulo (em coordenadas de tela) que está sendo gravado
  if (settings.mode === 'area' && settings.region) {
    const r = settings.region; const d = getDisplay(r.displayId);
    return { x: d.bounds.x + r.x, y: d.bounds.y + r.y, width: r.w, height: r.h };
  }
  return getDisplay(settings.displayId).workArea;
}
function camSizeFor(width) {
  const w = Math.round(Math.max(100, Math.min(1000, width)));
  return { width: w, height: Math.round(w / camAspect()) };
}
function placeCam(corner) {
  if (!alive(camWin)) return;
  const t = targetRect(); const b = camWin.getBounds();
  const m = Math.round(Math.min(t.width, t.height) * 0.03);
  let { width, height } = b;
  if (width > t.width - m * 2 || height > t.height - m * 2) ({ width, height } = camSizeFor(Math.min(t.width, t.height) * 0.35));
  const x = corner.includes('l') ? t.x + m : corner === 'c' ? t.x + (t.width - width) / 2 : t.x + t.width - width - m;
  const y = corner.includes('t') ? t.y + m : corner === 'c' ? t.y + (t.height - height) / 2 : t.y + t.height - height - m;
  camWin.setBounds({ x: Math.round(x), y: Math.round(y), width, height });
  saveCamBounds();
}
function camInsideTarget() {
  if (!alive(camWin)) return true;
  const b = camWin.getBounds(); const t = targetRect();
  return b.x >= t.x && b.y >= t.y && b.x + b.width <= t.x + t.width && b.y + b.height <= t.y + t.height;
}
function saveCamBounds() {
  if (!alive(camWin)) return;
  clearTimeout(camSaveTimer);
  camSaveTimer = setTimeout(() => {
    if (!alive(camWin)) return;
    settings.webcamBounds = camWin.getBounds();
    settings.webcamWidth = settings.webcamBounds.width;
    saveSettings();
    send('cam:size', settings.webcamWidth);
  }, 300);
}
function syncCamWindow() {
  if (!camAllowed()) { if (alive(camWin)) camWin.close(); camWin = null; return; }
  if (alive(camWin)) {
    camWin.webContents.send('cam:config', camConfig());
    const b = camWin.getBounds(); const sz = camSizeFor(settings.webcamWidth || b.width);
    if (sz.width !== b.width || sz.height !== b.height) camWin.setBounds({ x: b.x, y: b.y, ...sz });
    return;
  }
  let b = settings.webcamBounds;
  const visible = b && screen.getAllDisplays().some((d) => b.x < d.bounds.x + d.bounds.width && b.x + b.width > d.bounds.x && b.y < d.bounds.y + d.bounds.height && b.y + b.height > d.bounds.y);
  const sz = camSizeFor(settings.webcamWidth || 260);
  if (!visible) {
    const t = targetRect();
    b = { x: t.x + t.width - sz.width - 24, y: t.y + t.height - sz.height - 24 };
  }
  const bounds = { x: Math.round(b.x), y: Math.round(b.y), ...sz };
  camWin = new BrowserWindow({
    ...bounds, frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true, resizable: false,
    maximizable: false, minimizable: false, fullscreenable: false, hasShadow: false, show: false,
    title: 'GT Webcam', webPreferences: webPrefs({ backgroundThrottling: false })
  });
  camWin.setAlwaysOnTop(true, 'screen-saver', 2);
  camWin.loadFile(path.join(__dirname, 'src', 'cam.html'));
  camWin.once('ready-to-show', () => { if (alive(camWin)) { camWin.setBounds(bounds); camWin.showInactive(); } });
  camWin.on('closed', () => { camWin = null; });
}

/* Efeitos de clique (precisa do uiohook-napi) */
function keysConfig() {
  // área onde as teclas aparecem (área gravada, relativa ao overlay)
  let rect = null;
  if (settings.mode === 'area' && settings.region) rect = { x: settings.region.x, y: settings.region.y, w: settings.region.w, h: settings.region.h };
  return { pos: settings.keysPos, size: settings.keysSize, duration: settings.keysDuration, rect };
}
// Área gravada (coordenadas DIP) para guardar a posição dos cliques
function clickTarget() {
  if (settings.mode === 'area' && settings.region) {
    const r = settings.region; const d = getDisplay(r.displayId);
    return { x: d.bounds.x + r.x, y: d.bounds.y + r.y, width: r.w, height: r.h };
  }
  if (settings.mode === 'screen') return getDisplay(settings.displayId).bounds;
  return null;
}
const wantClicks = () => !!settings.recordClicks && (settings.mode === 'screen' || settings.mode === 'area');
function startHook() {
  if (!uIOhook || hookRunning || !(settings.clickEffects || settings.keysShow || (rec.active && wantClicks()))) return;
  uIOhook.removeAllListeners('mousedown');
  uIOhook.removeAllListeners('keydown');
  if (settings.keysShow) {
    if (alive(overlayWin)) overlayWin.webContents.send('keys:config', keysConfig());
    uIOhook.on('keydown', (e) => {
      if (!alive(overlayWin) || rec.paused) return;
      const name = KEY_NAMES[e.keycode];
      if (!name) return;
      if (settings.manualEnabled && [settings.hotkeys.manualMark, settings.hotkeys.manualNewScreen]
        .some((acc) => acc && acc.split('+').pop() === name)) return;
      const combo = e.ctrlKey || e.altKey || e.metaKey;
      if (settings.keysCombosOnly && !combo && !/^F\d+$/.test(name)) return;
      overlayWin.webContents.send('key', { name, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey });
    });
  }
  const target = rec.active && wantClicks() ? clickTarget() : null;
  uIOhook.on('mousedown', (e) => {
    let pt = { x: e.x, y: e.y };
    if (process.platform === 'win32' && typeof screen.screenToDipPoint === 'function') pt = screen.screenToDipPoint(pt);
    // linha do tempo dos cliques (sugestões de zoom no editor)
    if (target && rec.active && !rec.paused && pt.x >= target.x && pt.y >= target.y && pt.x <= target.x + target.width && pt.y <= target.y + target.height) {
      const t = recElapsed();
      if (t != null && rec.clicks.length < 20000) {
        rec.clicks.push({ t: Math.round((t - (rec.partOffset || 0)) * 100) / 100, x: Math.round(((pt.x - target.x) / target.width) * 1000) / 1000, y: Math.round(((pt.y - target.y) / target.height) * 1000) / 1000, b: e.button });
      }
    }
    if (!settings.clickEffects || !alive(overlayWin)) return;
    const b = overlayWin.getBounds();
    if (pt.x < b.x || pt.y < b.y || pt.x > b.x + b.width || pt.y > b.y + b.height) return;
    overlayWin.webContents.send('click', { x: pt.x - b.x, y: pt.y - b.y, button: e.button });
  });
  try { uIOhook.start(); hookRunning = true; } catch (err) { console.error('uiohook', err); }
}
function stopHook() {
  if (uIOhook && hookRunning) { try { uIOhook.stop(); } catch { /* ignora */ } hookRunning = false; }
}

/* ------------------------------------------------------------------ */
/* Modo manual: Insert marca o campo em foco, Shift+Insert = nova tela  */
/* ------------------------------------------------------------------ */
let manual = null;        // sessão atual (pasta, telas e marcações)
let manualBusy = false;
let manualWin = null;
let manualCtx = null;     // dados da marcação em andamento
let uia = null;           // processo PowerShell com UI Automation (Windows)

// Script que devolve o retângulo do elemento com foco e do elemento sob o mouse
const UIA_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName WindowsBase
[Console]::OutputEncoding = [Text.Encoding]::UTF8
function R($el) {
  if ($el -eq $null) { return $null }
  $r = $el.Current.BoundingRectangle
  if ($r.IsEmpty -or $r.Width -le 0) { return $null }
  return @{ x = [int]$r.X; y = [int]$r.Y; w = [int]$r.Width; h = [int]$r.Height; name = [string]$el.Current.Name; type = [string]$el.Current.LocalizedControlType; pid = [int]$el.Current.ProcessId }
}
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null) { break }
  $out = @{}
  try { $out.focus = R ([System.Windows.Automation.AutomationElement]::FocusedElement) } catch {}
  try {
    $p = $line.Split(',')
    if ($p.Length -ge 2) {
      $pt = New-Object System.Windows.Point ([double]$p[0]), ([double]$p[1])
      $out.point = R ([System.Windows.Automation.AutomationElement]::FromPoint($pt))
    }
  } catch {}
  [Console]::Out.WriteLine(($out | ConvertTo-Json -Compress -Depth 3))
  [Console]::Out.Flush()
}`;

function uiaStart() {
  if (process.platform !== 'win32' || (uia && !uia.dead)) return;
  try {
    const enc = Buffer.from(UIA_SCRIPT, 'utf16le').toString('base64');
    const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', enc], { windowsHide: true });
    uia = { proc: p, buf: '', waiting: [], dead: false };
    p.stdout.on('data', (d) => {
      uia.buf += d.toString('utf8');
      let i;
      while ((i = uia.buf.indexOf('\n')) >= 0) {
        const line = uia.buf.slice(0, i).trim(); uia.buf = uia.buf.slice(i + 1);
        const w = uia.waiting.shift();
        if (w) { try { w(JSON.parse(line)); } catch { w(null); } }
      }
    });
    p.on('exit', () => { if (uia) { uia.dead = true; uia.waiting.splice(0).forEach((w) => w(null)); } });
    p.on('error', () => { if (uia) uia.dead = true; });
    uiaQuery({ x: 0, y: 0 }); // "aquece" (ativa a acessibilidade do Chrome/Edge)
  } catch { uia = null; }
}
function uiaQuery(physPoint) {
  return new Promise((resolve) => {
    if (!uia || uia.dead) return resolve(null);
    const t = setTimeout(() => { const i = uia.waiting.indexOf(done); if (i >= 0) uia.waiting.splice(i, 1); resolve(null); }, 2500);
    const done = (r) => { clearTimeout(t); resolve(r); };
    uia.waiting.push(done);
    uia.proc.stdin.write(`${Math.round(physPoint.x)},${Math.round(physPoint.y)}\n`);
  });
}
function uiaStop() { if (uia && !uia.dead) { try { uia.proc.kill(); } catch { /* ignora */ } } uia = null; }

const manualRoot = () => settings.manualDir || path.join(settings.outputDir, 'Manuais');
const pad2 = (n) => String(n).padStart(2, '0');
// segundos já gravados (descontando as pausas)
function recElapsed() {
  if (!rec.active || !rec.t0) return null;
  const now = Date.now();
  return Math.max(0, (now - rec.t0 - (rec.pausedTotal || 0) - (rec.pauseAt ? now - rec.pauseAt : 0)) / 1000);
}
function manualNewSession() {
  const base = rec.active && rec.file ? `${path.basename(rec.file, path.extname(rec.file))}_manual` : `Manual_${stamp()}`;
  const dir = path.join(manualRoot(), base);
  fs.mkdirSync(path.join(dir, 'originais'), { recursive: true });
  manual = {
    dir, recFile: rec.active ? rec.file : null, startedAt: new Date().toISOString(), counter: 0, screens: [],
    title: settings.manualTitle || 'Manual', numbering: settings.manualNumbering || 'screen',
    video: rec.active && rec.file ? path.relative(dir, rec.file) : null
  };
  return manual;
}
function manualStatus() {
  if (!manual) return { active: false, root: manualRoot() };
  return {
    active: true, dir: manual.dir, root: manualRoot(),
    screens: manual.screens.length, items: manual.screens.reduce((t, s) => t + s.marks.length, 0)
  };
}
function manualEnd(notify = true) {
  if (!manual) return;
  const st = manualStatus();
  if (notify && st.items) send('toast', `Manual salvo: ${st.screens} tela(s), ${st.items} item(ns) em ${path.basename(manual.dir)}`);
  manual = null;
  send('manual:status', manualStatus());
}

// Escolhe o retângulo do componente: o campo com foco; se não servir, o elemento sob o mouse
function pickRect(res, cursorDip) {
  const toDip = (r) => {
    if (!r) return null;
    let d = { x: r.x, y: r.y, width: r.w, height: r.h };
    if (process.platform === 'win32' && typeof screen.screenToDipRect === 'function') d = screen.screenToDipRect(null, d);
    return { x: d.x, y: d.y, w: d.width, h: d.height, name: r.name || '', type: r.type || '', pid: r.pid };
  };
  const disp = screen.getDisplayNearestPoint(cursorDip);
  const area = disp.bounds.width * disp.bounds.height;
  const ok = (r) => r && r.w >= 6 && r.h >= 6 && r.pid !== process.pid && (r.w * r.h) < area * 0.3;
  const f = toDip(res && res.focus), p = toDip(res && res.point);
  if (ok(f)) return f;
  if (ok(p)) return p;
  return null;
}

async function captureDisplay(d) {
  const size = { width: Math.round(d.bounds.width * d.scaleFactor), height: Math.round(d.bounds.height * d.scaleFactor) };
  const srcs = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size });
  const idx = screen.getAllDisplays().findIndex((x) => x.id === d.id);
  const src = srcs.find((s) => s.display_id === String(d.id)) || srcs[idx] || srcs[0];
  return src.thumbnail;
}

async function manualMark(newScreen, testRect) {
  if (manualBusy || !settings.manualEnabled) return;
  manualBusy = true;
  let resume = false;
  const hidden = [];
  try {
    // 1) campo com foco (antes de qualquer janela nossa aparecer)
    const cursor = screen.getCursorScreenPoint();
    let rect = null;
    if (testRect !== undefined) rect = testRect;
    else if (process.platform === 'win32') {
      const phys = typeof screen.dipToScreenPoint === 'function' ? screen.dipToScreenPoint(cursor) : cursor;
      rect = pickRect(await uiaQuery(phys), cursor);
    }
    const videoTime = recElapsed();
    const anchor = rect ? { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 } : cursor;
    const d = screen.getDisplayNearestPoint(anchor);

    // 2) pausa a gravação
    if (settings.manualPause !== false && rec.active && !rec.paused) { send('set-paused', true); resume = true; }

    // 3) sessão e tela
    if (!manual) manualNewSession();
    let scr = manual.screens[manual.screens.length - 1];
    if (newScreen || !scr || scr.displayId !== String(d.id)) {
      // esconde o que não deve sair no print
      [overlayWin, camWin, toolbarWin, borderWin].forEach((w) => { if (alive(w) && w.isVisible()) { w.hide(); hidden.push(w); } });
      await new Promise((r) => setTimeout(r, hidden.length ? 220 : 60));
      const img = await captureDisplay(d);
      const n = manual.screens.length + 1;
      const original = path.join(manual.dir, 'originais', `tela_${pad2(n)}.png`);
      fs.writeFileSync(original, img.toPNG());
      scr = {
        videoTime: videoTime == null ? null : Math.round(videoTime * 10) / 10,
        n, name: `Tela ${n}`, displayId: String(d.id), file: `tela_${pad2(n)}.png`, original, base: img.toDataURL(),
        imgW: img.getSize().width, imgH: img.getSize().height, scale: img.getSize().width / d.bounds.width, marks: []
      };
      manual.screens.push(scr);
    }
    const num = settings.manualNumbering === 'continuous' ? manual.counter + 1 : scr.marks.length + 1;

    // 4) janela de marcação sobre a tela congelada
    const k = scr.scale;
    manualCtx = {
      screen: scr, num, resume, hidden, videoTime,
      init: {
        image: scr.base, imgW: scr.imgW, imgH: scr.imgH, scale: k,
        screenN: scr.n, num, marks: scr.marks,
        firstOfScreen: scr.marks.length === 0, screenName: scr.name,
        rect: rect ? { x: (rect.x - d.bounds.x) * k, y: (rect.y - d.bounds.y) * k, w: rect.w * k, h: rect.h * k } : null,
        fieldName: rect ? [rect.name, rect.type].filter(Boolean).join(' · ') : '',
        shape: settings.manualShape || 'ellipse', color: settings.manualColor || '#ff3b30',
        numbering: settings.manualNumbering || 'screen'
      }
    };
    manualWin = new BrowserWindow({
      ...d.bounds, frame: false, alwaysOnTop: true, skipTaskbar: true, resizable: false, movable: false,
      fullscreenable: false, hasShadow: false, show: false, backgroundColor: '#000000',
      title: 'GT Manual', webPreferences: webPrefs()
    });
    manualWin.setAlwaysOnTop(true, 'screen-saver', 4);
    manualWin.setContentProtection(true);
    manualWin.loadFile(path.join(__dirname, 'src', 'manual.html'));
    manualWin.once('ready-to-show', () => { if (alive(manualWin)) { manualWin.setBounds(d.bounds); manualWin.show(); manualWin.focus(); } });
    manualWin.on('closed', () => { manualWin = null; manualFinishMark(); });
  } catch (e) {
    send('toast', `Modo manual: ${e.message}`, true);
    hidden.forEach((w) => alive(w) && w.showInactive());
    if (resume && rec.active) send('set-paused', false);
    manualBusy = false;
  }
}

// chamado ao fechar a janela (confirmado ou cancelado)
function manualFinishMark() {
  const c = manualCtx; manualCtx = null;
  if (c) {
    c.hidden.forEach((w) => { if (alive(w)) w.showInactive(); });
    if (c.resume && rec.active && rec.paused) setTimeout(() => send('set-paused', false), 250);
  }
  manualBusy = false;
  send('manual:status', manualStatus());
}

function manualDoc() {
  const m = manual;
  return mdocs.normalize({
    title: m.title, numbering: m.numbering, startedAt: m.startedAt, updatedAt: new Date().toISOString(), recording: m.recFile, video: m.video,
    screens: m.screens.map((sc) => ({ n: sc.n, name: sc.name, file: sc.file, original: path.relative(m.dir, sc.original), scale: sc.scale, videoTime: sc.videoTime, marks: sc.marks }))
  }, m.dir);
}
function manualWriteDocs() {
  if (!manual) return;
  const prev = path.join(manual.dir, 'manual.json');
  // preserva campos editados no editor de manual (subtítulo, autor)
  let extra = {};
  try { const o = JSON.parse(fs.readFileSync(prev, 'utf8')); extra = { subtitle: o.subtitle, author: o.author }; } catch { /* novo */ }
  // grava o manual quando a gravação termina: o vídeo final já existe
  mdocs.writeDocs(manual.dir, { ...manualDoc(), ...extra });
}

/* ------------------------------------------------------------------ */
/* Editor de manual                                                     */
/* ------------------------------------------------------------------ */
const manualEditors = new Map(); // dir -> janela
function openManualEditor(dir) {
  if (manual && path.resolve(manual.dir) === path.resolve(dir)) manualEnd(false); // edição encerra a sessão de captura
  const open = manualEditors.get(dir);
  if (open && alive(open)) { open.show(); open.focus(); return; }
  const w = new BrowserWindow({
    width: 1360, height: 880, minWidth: 1080, minHeight: 680, icon: ICON, show: false, autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#14161b' : '#f3f4f7',
    title: `${path.basename(dir)} — Editor de manual`, webPreferences: webPrefs()
  });
  w.setMenu(null);
  w.loadFile(path.join(__dirname, 'src', 'manual-editor.html'), { query: { dir } });
  w.once('ready-to-show', () => { w.maximize(); w.show(); });
  w.webContents.on('will-prevent-unload', (ev) => {
    const r = dialog.showMessageBoxSync(w, {
      type: 'question', buttons: ['Sair sem salvar', 'Cancelar'], defaultId: 1, cancelId: 1,
      title: 'Manual não salvo', message: 'Há alterações que não foram salvas no manual.'
    });
    if (r === 0) ev.preventDefault();
  });
  manualEditors.set(dir, w);
  w.on('closed', () => manualEditors.delete(dir));
}
function readLogo() {
  // logo da identidade visual; se não houver, o logo da marca d'água
  for (const p of [settings.brandManuals && settings.brand && settings.brand.logoPath, settings.wmPath]) {
    try {
      if (!p || !fs.existsSync(p)) continue;
      const img = nativeImage.createFromPath(p);
      if (!img.isEmpty()) return img.toDataURL();
    } catch { /* tenta o próximo */ }
  }
  return null;
}
const safeName = (s) => String(s || 'Manual').replace(/[\\/:*?"<>|]+/g, '-').trim().slice(0, 80) || 'Manual';

/* ------------------------------------------------------------------ */
/* Captura de imagem                                                    */
/* ------------------------------------------------------------------ */
let frameReqId = 0;
function requestFrame() {
  return new Promise((resolve) => {
    if (!alive(mainWin)) return resolve(null);
    const id = ++frameReqId;
    const h = (_e, rid, data) => {
      if (rid !== id) return;
      clearTimeout(t); ipcMain.removeListener('frame:response', h); resolve(data);
    };
    const t = setTimeout(() => { ipcMain.removeListener('frame:response', h); resolve(null); }, 4000);
    ipcMain.on('frame:response', h);
    mainWin.webContents.send('frame:request', id);
  });
}

async function takeScreenshot() {
  try {
    ensureOutputDir();
    const file = path.join(settings.outputDir, `Captura_${stamp()}.png`);
    let buffer = null;

    if (rec.active) {
      const dataUrl = await requestFrame();
      if (dataUrl) buffer = Buffer.from(dataUrl.split(',')[1], 'base64');
    }
    if (!buffer) {
      let img = null;
      if (settings.mode === 'window' && settings.windowId) {
        const srcs = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 3840, height: 2160 } });
        const src = srcs.find((s) => s.id === settings.windowId);
        if (src) img = src.thumbnail;
      }
      if (!img) {
        const displayId = settings.mode === 'area' && settings.region ? settings.region.displayId : settings.displayId;
        const d = getDisplay(displayId);
        const size = { width: Math.round(d.bounds.width * d.scaleFactor), height: Math.round(d.bounds.height * d.scaleFactor) };
        const srcs = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size });
        const src = srcs.find((s) => s.display_id === String(d.id)) || srcs[0];
        img = src.thumbnail;
        if (settings.mode === 'area' && settings.region) {
          const r = settings.region; const k = img.getSize().width / d.bounds.width;
          img = img.crop({ x: Math.round(r.x * k), y: Math.round(r.y * k), width: Math.round(r.w * k), height: Math.round(r.h * k) });
        }
      }
      buffer = img.toPNG();
    }
    fs.writeFileSync(file, buffer);
    send('toast', `Imagem salva: ${path.basename(file)}`);
    send('files:changed');
    return file;
  } catch (e) {
    send('toast', `Falha ao capturar imagem: ${e.message}`, true);
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* FFmpeg                                                               */
/* ------------------------------------------------------------------ */
const exportProcs = new Map(); // webContents.id -> processo em andamento

function runFfmpeg(args, { duration, onProgress, owner } = {}) {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error('FFmpeg não encontrado. Rode "npm install" novamente.'));
    const p = spawn(ffmpegPath, ['-hide_banner', '-nostdin', '-y', ...args], { windowsHide: true });
    if (owner) exportProcs.set(owner, p);
    const out = []; let err = '';
    p.stdout.on('data', (d) => out.push(d));
    p.stderr.on('data', (d) => {
      const txt = d.toString();
      err = (err + txt).slice(-30000);
      if (onProgress && duration) {
        const m = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(txt);
        if (m) onProgress(Math.min(1, (Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) / duration));
      }
    });
    p.on('error', reject);
    p.on('close', (code) => {
      if (owner) exportProcs.delete(owner);
      if (code === 0) resolve(Buffer.concat(out));
      else reject(new Error(p.killed ? 'cancelado' : err.trim().split('\n').slice(-4).join('\n')));
    });
  });
}

function probe(file) {
  return new Promise((resolve) => {
    if (!ffmpegPath) return resolve(null);
    const p = spawn(ffmpegPath, ['-hide_banner', '-i', file], { windowsHide: true });
    let e = '';
    p.stderr.on('data', (d) => { e += d; });
    p.on('error', () => resolve(null));
    p.on('close', () => {
      const dm = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(e);
      const vm = /Video:.*?(\d{2,5})x(\d{2,5})/.exec(e);
      const fm = /(\d+(?:\.\d+)?) fps/.exec(e) || /(\d+(?:\.\d+)?) tbr/.exec(e);
      resolve({
        duration: dm ? Number(dm[1]) * 3600 + Number(dm[2]) * 60 + Number(dm[3]) : null,
        width: vm ? Number(vm[1]) : null, height: vm ? Number(vm[2]) : null,
        fps: fm ? Number(fm[1]) : null, hasAudio: /Stream #.*Audio:/.test(e)
      });
    });
  });
}

// O MediaRecorder gera arquivos sem índice/duração: uma cópia rápida (sem recodificar) corrige isso
async function finalizeRecording(file) {
  if (!ffmpegPath || !file || !fs.existsSync(file)) return;
  const ext = path.extname(file).toLowerCase();
  const tmp = `${file}.tmp${ext}`;
  try {
    const args = ['-i', file, '-map', '0', '-c', 'copy'];
    if (ext === '.mp4') args.push('-movflags', '+faststart');
    await runFfmpeg([...args, tmp]);
    fs.renameSync(tmp, file);
  } catch (e) {
    console.error('Falha ao finalizar gravação', e.message);
    try { fs.unlinkSync(tmp); } catch { /* ignora */ }
  }
}


/* ------------------------------------------------------------------ */
/* Trilhas separadas, cliques, disco e recuperação                      */
/* ------------------------------------------------------------------ */
const MB = 1024 * 1024;
const fmtSize = (b) => (b >= 1024 * MB ? `${(b / 1024 / MB).toFixed(1)} GB` : `${Math.round(b / MB)} MB`);

function openTracks(names) {
  rec.tracks = {};
  (names || []).filter((n) => n === 'mic' || n === 'sys').forEach((n) => {
    ensureSidecarDir(rec.file);
    const file = sidecar(rec.file, `${n}.webm`);
    rec.tracks[n] = { file, stream: fs.createWriteStream(file) };
  });
}
function closeTracks(tracks) {
  return Promise.all(Object.values(tracks || {}).map((t) => new Promise((r) => (t.stream ? t.stream.end(r) : r()))));
}
// o MediaRecorder grava WebM sem duração no cabeçalho: uma cópia rápida corrige
async function fixTrack(f) {
  if (!ffmpegPath || !f || !fs.existsSync(f) || !fs.statSync(f).size) return;
  const tmp = `${f}.tmp.webm`;
  try { await runFfmpeg(['-i', f, '-c', 'copy', tmp]); fs.renameSync(tmp, f); } catch { fs.rmSync(tmp, { force: true }); }
}
function saveClicks(file) {
  if (!file || !rec.clicks.length) return;
  try {
    const t = clickTarget();
    ensureSidecarDir(file);
    fs.writeFileSync(sidecar(file, 'clicks.json'), JSON.stringify({ version: 1, target: t ? { w: t.width, h: t.height } : null, clicks: rec.clicks }));
  } catch { /* ignora */ }
}

// diário das gravações em andamento: se o app cair, dá para recuperar na próxima abertura
const journalPath = () => path.join(app.getPath('userData'), 'recovery.json');
function readJournal() { try { const j = JSON.parse(fs.readFileSync(journalPath(), 'utf8')); return Array.isArray(j) ? j : []; } catch { return []; } }
function writeJournal(l) { try { fs.mkdirSync(path.dirname(journalPath()), { recursive: true }); fs.writeFileSync(journalPath(), JSON.stringify(l, null, 2)); } catch { /* ignora */ } }
function journalUpdate() {
  const entry = {
    id: rec.id, file: rec.file, engine: rec.engine, startedAt: new Date(rec.t0 || Date.now()).toISOString(),
    segments: rec.cap ? rec.cap.segments.slice() : undefined, audio: rec.engine === 'ffmpeg' ? rec.audioFile : undefined,
    tracks: Object.fromEntries(Object.entries(rec.tracks || {}).map(([k, t]) => [k, t.file]))
  };
  writeJournal([...readJournal().filter((e) => e.id !== rec.id), entry]);
}
function journalDrop(id) { writeJournal(readJournal().filter((e) => e.id !== id)); }
let recoverable = [];
function scanRecovery() {
  const all = readJournal().filter((e) => !(rec.active && e.id === rec.id));
  recoverable = all.map((e) => {
    const files = [e.file, ...(e.segments || []), e.audio].filter((f) => f && fs.existsSync(f));
    const size = files.reduce((t, f) => t + fs.statSync(f).size, 0);
    return size > 0 ? { ...e, size } : null;
  }).filter(Boolean);
  const keep = new Set(recoverable.map((e) => e.id));
  writeJournal(readJournal().filter((e) => keep.has(e.id) || (rec.active && e.id === rec.id)));
  return recoverable;
}
const SIDE_KINDS = ['mic.webm', 'sys.webm', 'clicks.json'];
async function repairRecording(id) {
  const e = recoverable.find((x) => x.id === id);
  if (!e) throw new Error('Gravação não encontrada.');
  if (!ffmpegPath) throw new Error('FFmpeg não encontrado. Rode "npm install" novamente.');
  let out;
  if (e.engine === 'ffmpeg') {
    out = fs.existsSync(e.file) ? e.file.replace(/\.mp4$/i, '_recuperado.mp4') : e.file;
    const listFile = sidecar(e.file, 'concat.txt');
    await runFfmpeg(hwrec.muxArgs({ segments: e.segments || [], audio: e.audio, out, listFile }));
    fs.rmSync(listFile, { force: true });
  } else {
    const ext = path.extname(e.file);
    out = `${e.file.slice(0, -ext.length)}_recuperado${ext}`;
    try {
      await runFfmpeg(['-err_detect', 'ignore_err', '-fflags', '+genpts+discardcorrupt', '-i', e.file, '-map', '0', '-c', 'copy', ...(ext.toLowerCase() === '.mp4' ? ['-movflags', '+faststart'] : []), out]);
    } catch {
      out = `${e.file.slice(0, -ext.length)}_recuperado.mp4`;
      await runFfmpeg(['-err_detect', 'ignore_err', '-i', e.file, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out]);
    }
  }
  const info = await probe(out);
  if (!info || !info.duration) { fs.rmSync(out, { force: true }); throw new Error('O arquivo estava danificado demais para recuperar.'); }
  for (const f of Object.values(e.tracks || {})) await fixTrack(f);
  // arquivos auxiliares passam a acompanhar o vídeo recuperado
  if (path.resolve(out) !== path.resolve(e.file)) {
    SIDE_KINDS.forEach((k) => { const a = sidecar(e.file, k); if (fs.existsSync(a)) { try { fs.renameSync(a, sidecar(out, k)); } catch { /* ignora */ } } });
  }
  fs.rmSync(sidecar(e.file, 'logo.png'), { force: true });
  const junk = e.engine === 'ffmpeg' ? [...(e.segments || []), e.audio] : [e.file];
  for (const f of junk) {
    if (f && fs.existsSync(f) && path.resolve(f) !== path.resolve(out)) { try { await shell.trashItem(f); } catch { fs.rmSync(f, { force: true }); } }
  }
  journalDrop(id); recoverable = recoverable.filter((x) => x.id !== id);
  send('files:changed');
  return { file: out, name: path.basename(out), duration: info.duration };
}
async function discardRecording(id) {
  const e = recoverable.find((x) => x.id === id) || readJournal().find((x) => x.id === id);
  if (e) {
    const files = [e.file, ...(e.segments || []), e.audio, ...Object.values(e.tracks || {}), ...SIDE_KINDS.map((k) => sidecar(e.file, k))];
    for (const f of files) { if (f && fs.existsSync(f)) { try { await shell.trashItem(f); } catch { fs.rmSync(f, { force: true }); } } }
  }
  journalDrop(id); recoverable = recoverable.filter((x) => x.id !== id);
  send('files:changed');
}

// espaço livre durante a gravação (aviso e parada segura) e tamanho na gravação pelo FFmpeg
let diskTimer = null, diskWarned = false;
function startDiskMonitor() {
  clearInterval(diskTimer); diskWarned = false;
  diskTimer = setInterval(() => {
    if (!rec.active) { stopDiskMonitor(); return; }
    const free = freeBytes(path.dirname(rec.file));
    if (free != null && free < 400 * MB) {
      send('toast', `O disco está quase cheio (${fmtSize(free)} livres). A gravação foi encerrada para não perder o vídeo.`, true);
      stopDiskMonitor(); send('rec:force-stop'); return;
    }
    if (free != null && free < 2048 * MB && !diskWarned) { diskWarned = true; send('toast', `Atenção: só ${fmtSize(free)} livres no disco da gravação.`, true); }
    if (rec.engine === 'ffmpeg' && rec.cap) {
      let a = 0; try { a = rec.audioFile && fs.existsSync(rec.audioFile) ? fs.statSync(rec.audioFile).size : 0; } catch { /* ignora */ }
      send('rec:bytes', rec.cap.bytes() + a);
    }
    if (rec.clicks.length) saveClicks(rec.file);
  }, 3000);
}
function stopDiskMonitor() { clearInterval(diskTimer); diskTimer = null; }

// Gravação pelo FFmpeg (GPU): monta a captura da tela/área
function physRect(r) {
  if (process.platform === 'win32' && typeof screen.dipToScreenRect === 'function') {
    const p = screen.dipToScreenRect(null, { x: r.x, y: r.y, width: r.width, height: r.height });
    return { x: p.x, y: p.y, w: p.width, h: p.height };
  }
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
}
async function beginFfmpeg() {
  if (!ffmpegPath) throw new Error('FFmpeg não encontrado. Rode "npm install" novamente.');
  if (settings.mode !== 'screen' && settings.mode !== 'area') throw new Error('A gravação pelo FFmpeg funciona nos modos Tela inteira e Área.');
  const t = clickTarget();
  const d = settings.mode === 'area' ? getDisplay(settings.region.displayId) : getDisplay(settings.displayId);
  const r = physRect(t); const dp = physRect(d.bounds);
  r.w = Math.max(2, Math.floor(r.w / 2) * 2); r.h = Math.max(2, Math.floor(r.h / 2) * 2);
  const fps = Number(settings.fps) || 30;
  if (!settings.hwEncoders) settings.hwEncoders = await hwrec.detect(ffmpegPath);
  const okIds = settings.hwEncoders.map((x) => x.id);
  let enc = settings.hwEncoder;
  if (enc === 'auto' || !okIds.includes(enc)) enc = (settings.hwEncoders.find((x) => x.id !== 'libx264') || hwrec.CPU).id;
  const input = hwrec.inputArgs({
    grabber: settings.hwGrabber, rect: r, local: { x: r.x - dp.x, y: r.y - dp.y }, fps,
    outputIdx: Math.max(0, screen.getAllDisplays().findIndex((x) => x.id === d.id))
  });
  let wm = null;
  if (settings.wmEnabled && settings.wmPath && fs.existsSync(settings.wmPath)) {
    const img = nativeImage.createFromPath(settings.wmPath);
    if (!img.isEmpty()) {
      const ww = Math.max(16, Math.round((r.w * (settings.wmSize || 14)) / 100 / 2) * 2);
      const sz = img.getSize(); const wh = Math.round((ww * sz.height) / sz.width);
      const m = Math.round(Math.min(r.w, r.h) * 0.025); const pos = settings.wmPos || 'br';
      const file = sidecar(rec.file, 'logo.png');
      fs.writeFileSync(file, img.toPNG());
      wm = { file, width: ww, opacity: settings.wmOpacity || 80, x: pos.includes('l') ? m : r.w - ww - m, y: pos.includes('t') ? m : r.h - wh - m };
    }
  }
  rec.cap = new hwrec.Capture({ ffmpeg: ffmpegPath, dir: path.dirname(sidecar(rec.file, 'x')), base: path.basename(rec.file), input, encoder: enc, fps, mbps: Number(settings.bitrate) || 8, wm });
  rec.cap.onExit = () => { if (rec.active && !rec.paused) { send('toast', 'O FFmpeg parou de gravar inesperadamente. A gravação foi encerrada.', true); send('rec:force-stop'); } };
  rec.encoder = enc;
  await rec.cap.startSegment();
}

const num = (n) => Number(n).toFixed(3);

// Monta o comando de exportação do editor
// Ordem: vídeo (zoom, anotações, legendas) -> áudio (trilhas, narrações) -> cortes -> música -> abertura/encerramento
function buildExport(spec, tmpDir) {
  const W = Math.floor(spec.width / 2) * 2, H = Math.floor(spec.height / 2) * 2;
  const fps = Math.max(10, Math.min(60, Math.round(spec.fps || 30)));
  const fmt = spec.format || 'mp4';
  const args = ['-i', spec.input];
  let inputs = 1;
  const addInput = (...a) => { args.push(...a); return inputs++; };
  const parts = [];
  let v = '[0:v]';
  let n = 0;
  const label = () => `[x${n++}]`;
  const vol = (p) => (Math.max(0, Math.min(400, Number(p ?? 100))) / 100).toFixed(2);
  const A = 'aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo';
  const writePng = (name, dataUrl) => { const f = path.join(tmpDir, name); fs.writeFileSync(f, Buffer.from(dataUrl.split(',')[1], 'base64')); return f; };

  // tamanho par (exigência do H.264)
  if (W !== spec.width || H !== spec.height) { const o = label(); parts.push(`${v}crop=${W}:${H}:0:0${o}`); v = o; }

  // zoom animado (entra e sai suave)
  const zooms = (spec.zooms || []).filter((z) => z.end > z.start && z.scale > 1.01);
  if (zooms.length) {
    const ramp = (z) => {
      const r = Math.min(0.4, (z.end - z.start) / 2);
      return `clip((t-${num(z.start)})/${num(r)},0,1)*clip((${num(z.end)}-t)/${num(r)},0,1)`;
    };
    const Z = `(1${zooms.map((z) => `+${num(z.scale - 1)}*${ramp(z)}`).join('')})`;
    const CX = `(${W / 2}${zooms.map((z) => `+${num(z.cx * W - W / 2)}*${ramp(z)}`).join('')})`;
    const CY = `(${H / 2}${zooms.map((z) => `+${num(z.cy * H - H / 2)}*${ramp(z)}`).join('')})`;
    const o = label();
    parts.push(`${v}scale=w='trunc(iw*${Z}/2)*2':h='trunc(ih*${Z}/2)*2':eval=frame:flags=bicubic,` +
      `crop=${W}:${H}:x='clip(${CX}*iw/${W}-${W / 2},0,iw-${W})':y='clip(${CY}*ih/${H}-${H / 2},0,ih-${H})'${o}`);
    v = o;
  }

  // textos e desenhos (imagens PNG transparentes do tamanho do vídeo)
  (spec.overlays || []).forEach((ov, i) => {
    const idx = addInput('-i', writePng(`ov${i}.png`, ov.png));
    const o = label();
    parts.push(`${v}[${idx}:v]overlay=0:0:eof_action=repeat:enable='between(t,${num(ov.start)},${num(ov.end)})'${o}`);
    v = o;
  });

  // legendas: uma sequência de imagens (concat) sobreposta ao vídeo
  const subs = (spec.subs || []).filter((s) => s.end > s.start && s.png).sort((a, b) => a.start - b.start);
  if (subs.length) {
    const blank = nativeImage.createFromBuffer(Buffer.alloc(W * H * 4), { width: W, height: H }).toPNG();
    fs.writeFileSync(path.join(tmpDir, 'blank.png'), blank);
    const lines = ['ffconcat version 1.0'];
    let t = 0;
    subs.forEach((s, i) => {
      const st = Math.max(t, s.start), en = Math.max(st + 0.04, s.end);
      if (st - t > 0.001) lines.push("file 'blank.png'", `duration ${num(st - t)}`);
      writePng(`sub${i}.png`, s.png);
      lines.push(`file 'sub${i}.png'`, `duration ${num(en - st)}`);
      t = en;
    });
    lines.push("file 'blank.png'", 'duration 1', "file 'blank.png'");
    const list = path.join(tmpDir, 'subs.ffconcat');
    fs.writeFileSync(list, `${lines.join('\n')}\n`);
    const idx = addInput('-f', 'concat', '-safe', '0', '-i', list);
    const o = label();
    parts.push(`${v}[${idx}:v]overlay=0:0:eof_action=pass:format=auto${o}`);
    v = o;
  }

  // áudio na linha do tempo original: trilhas separadas (ou o áudio do vídeo) + narrações
  let a = null;
  const au = spec.audio || {};
  if (fmt !== 'gif') {
    const srcs = [];
    const tracks = (au.tracks || []).filter((t) => t.file && fs.existsSync(t.file));
    if (tracks.length) {
      tracks.forEach((t) => { const i = addInput('-i', t.file); const o = label(); parts.push(`[${i}:a]${A},volume=${vol(t.volume)}${o}`); srcs.push(o); });
    } else if (spec.hasAudio) {
      const o = label(); parts.push(`[0:a]${A},volume=${vol(au.main)}${o}`); srcs.push(o);
    }
    const voices = (au.voices || []).filter((x) => x.file && fs.existsSync(x.file));
    if (voices.length && !srcs.length) { const o = label(); parts.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${num(spec.duration)}${o}`); srcs.push(o); }
    voices.forEach((x) => {
      const i = addInput('-i', x.file); const o = label(); const ms = Math.max(0, Math.round(x.start * 1000));
      parts.push(`[${i}:a]${A},volume=${vol(x.volume)},adelay=${ms}|${ms}${o}`); srcs.push(o);
    });
    if (srcs.length === 1) a = srcs[0];
    else if (srcs.length > 1) {
      const o = label(); parts.push(`${srcs.join('')}amix=inputs=${srcs.length}:duration=longest:normalize=0:dropout_transition=0,atrim=duration=${num(spec.duration)}${o}`); a = o;
    }
  }

  // cortes: mantém só os trechos escolhidos
  const keep = spec.keep && spec.keep.length ? spec.keep : [[0, spec.duration]];
  const full = keep.length === 1 && keep[0][0] <= 0.01 && keep[0][1] >= spec.duration - 0.01;
  if (!full) {
    const k = keep.length;
    const vs = keep.map((_, i) => `[vs${i}]`), as = keep.map((_, i) => `[as${i}]`);
    parts.push(k > 1 ? `${v}split=${k}${vs.join('')}` : `${v}null${vs[0]}`);
    if (a) parts.push(k > 1 ? `${a}asplit=${k}${as.join('')}` : `${a}anull${as[0]}`);
    const seq = [];
    keep.forEach(([s, e], i) => {
      parts.push(`${vs[i]}trim=start=${num(s)}:end=${num(e)},setpts=PTS-STARTPTS[vt${i}]`);
      seq.push(`[vt${i}]`);
      if (a) { parts.push(`${as[i]}atrim=start=${num(s)}:end=${num(e)},asetpts=PTS-STARTPTS[at${i}]`); seq.push(`[at${i}]`); }
    });
    parts.push(`${seq.join('')}concat=n=${k}:v=1:a=${a ? 1 : 0}[vcut]${a ? '[acut]' : ''}`);
    v = '[vcut]'; if (a) a = '[acut]';
  }
  const mainDur = keep.reduce((t, [s, e]) => t + (e - s), 0);

  // música de fundo (abaixa sozinha quando há voz)
  const mu = au.music;
  if (fmt !== 'gif' && mu && mu.file && fs.existsSync(mu.file)) {
    const i = mu.loop !== false ? addInput('-stream_loop', '-1', '-i', mu.file) : addInput('-i', mu.file);
    const fi = Math.min(Number(mu.fadeIn) || 0, mainDur / 2), fo = Math.min(Number(mu.fadeOut) || 0, mainDur / 2);
    let chain = `[${i}:a]${A},atrim=duration=${num(mainDur)},volume=${vol(mu.volume)}`;
    if (fi > 0) chain += `,afade=t=in:d=${num(fi)}`;
    if (fo > 0) chain += `,afade=t=out:st=${num(Math.max(0, mainDur - fo))}:d=${num(fo)}`;
    chain += `,apad=whole_dur=${num(mainDur)}[mus]`;
    parts.push(chain);
    if (a) {
      if (mu.duck !== false) {
        parts.push(`${a}asplit=2[am1][am2]`, '[mus][am2]sidechaincompress=threshold=0.03:ratio=12:attack=20:release=700[musd]', '[am1][musd]amix=inputs=2:duration=first:normalize=0:dropout_transition=0[amus]');
      } else parts.push(`${a}[mus]amix=inputs=2:duration=first:normalize=0:dropout_transition=0[amus]`);
      a = '[amus]';
    } else a = '[mus]';
  }

  // abertura e encerramento
  let outDuration = mainDur;
  const clips = [['intro', spec.intro], ['outro', spec.outro]].filter(([, c]) => c && c.dur > 0 && (c.file || c.png));
  if (clips.length) {
    const withAudio = !!a;
    const made = {};
    clips.forEach(([tag, c]) => {
      let i;
      const dur = Math.max(0.5, Math.min(60, Number(c.dur)));
      if (c.kind === 'video') i = addInput('-t', num(dur), '-i', c.file);
      else i = addInput('-loop', '1', '-framerate', String(fps), '-t', num(dur), '-i', c.png ? writePng(`${tag}.png`, c.png) : c.file);
      const fade = c.kind === 'video' ? '' : `,fade=t=in:d=0.4,fade=t=out:st=${num(Math.max(0, dur - 0.5))}:d=0.5`;
      parts.push(`[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${fps},format=yuv420p${fade},trim=duration=${num(dur)},setpts=PTS-STARTPTS[${tag}v]`);
      if (withAudio) {
        if (c.kind === 'video' && c.hasAudio) parts.push(`[${i}:a]${A},atrim=duration=${num(dur)},apad=whole_dur=${num(dur)},asetpts=PTS-STARTPTS[${tag}a]`);
        else parts.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${num(dur)}[${tag}a]`);
      }
      made[tag] = true;
      outDuration += dur;
    });
    parts.push(`${v}fps=${fps},format=yuv420p,setsar=1[mainv]`);
    if (withAudio) parts.push(`${a}${A}[maina]`);
    const order = ['intro', 'main', 'outro'].filter((t) => t === 'main' || made[t]);
    const seq = order.map((t) => (t === 'main' ? `[mainv]${withAudio ? '[maina]' : ''}` : `[${t}v]${withAudio ? `[${t}a]` : ''}`)).join('');
    parts.push(`${seq}concat=n=${order.length}:v=1:a=${withAudio ? 1 : 0}[vfin]${withAudio ? '[afin]' : ''}`);
    v = '[vfin]'; if (withAudio) a = '[afin]';
  }
  if (v === '[0:v]') { parts.push('[0:v]null[vout]'); v = '[vout]'; }

  if (fmt === 'gif') {
    // GIF: 12 qps, até 960 px de largura, paleta otimizada
    parts.push(`${v}fps=12,scale='min(960,iw)':-2:flags=lanczos,split[g1][g2]`,
      '[g1]palettegen=stats_mode=diff[pal]', '[g2][pal]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle[gout]');
    args.push('-filter_complex', parts.join(';'), '-map', '[gout]', '-loop', '0', spec.output);
    return { args, outDuration };
  }
  if (fmt === 'whatsapp') {
    // até 720p e ~15 MB no total
    parts.push(`${v}scale='if(gte(iw,ih),min(1280,iw),-2)':'if(gte(iw,ih),-2,min(1280,ih))':flags=lanczos[wout]`);
    v = '[wout]';
    const totalKbps = (15 * 8192) / Math.max(1, outDuration);
    const vk = Math.round(Math.max(250, Math.min(2500, totalKbps - 96)));
    args.push('-filter_complex', parts.join(';'), '-map', v);
    if (a) args.push('-map', a, '-c:a', 'aac', '-b:a', '96k', '-ac', '2');
    args.push('-c:v', 'libx264', '-preset', 'medium', '-b:v', `${vk}k`, '-maxrate', `${Math.round(vk * 1.5)}k`,
      '-bufsize', `${vk * 2}k`, '-pix_fmt', 'yuv420p', '-profile:v', 'main', '-r', String(Math.min(fps, 30)),
      '-movflags', '+faststart', spec.output);
    return { args, outDuration };
  }
  args.push('-filter_complex', parts.join(';'), '-map', v);
  if (a) args.push('-map', a, '-c:a', 'aac', '-b:a', '192k');
  args.push('-c:v', 'libx264', '-preset', spec.preset || 'veryfast', '-crf', String(spec.crf || 20),
    '-pix_fmt', 'yuv420p', '-r', String(fps), '-movflags', '+faststart', spec.output);
  return { args, outDuration };
}

/* ------------------------------------------------------------------ */
/* Editor                                                               */
/* ------------------------------------------------------------------ */
function openEditor(file, project = null) {
  const w = new BrowserWindow({
    width: 1320, height: 860, minWidth: 1040, minHeight: 660, icon: ICON,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#14161b' : '#f3f4f7',
    title: `${path.basename(project || file)} — RecFlow Editor`, autoHideMenuBar: true, show: false,
    webPreferences: webPrefs()
  });
  w.setMenu(null);
  w.loadFile(path.join(__dirname, 'src', 'editor.html'), { query: project ? { project } : { file } });
  w.once('ready-to-show', () => { w.maximize(); w.show(); });
  // Fechar com alterações não salvas: pergunta antes
  w.webContents.on('will-prevent-unload', (ev) => {
    const r = dialog.showMessageBoxSync(w, {
      type: 'question', buttons: ['Sair sem salvar', 'Cancelar'], defaultId: 1, cancelId: 1,
      title: 'Projeto não salvo', message: 'Há alterações que não foram salvas no projeto.',
      detail: 'Use "Salvar projeto" (Ctrl+S) para continuar a edição depois.'
    });
    if (r === 0) ev.preventDefault();
  });
  const wcId = w.webContents.id;   // após fechar, w.webContents não pode mais ser lido
  w.on('closed', () => { const p = exportProcs.get(wcId); if (p) p.kill(); });
  return w;
}

/* ------------------------------------------------------------------ */
/* Projetos (.gtproj)                                                   */
/* ------------------------------------------------------------------ */
function readProject(projPath) {
  const data = JSON.parse(fs.readFileSync(projPath, 'utf8'));
  if (!['recflow', 'gravador-tela'].includes(data.app) || !data.edit) throw new Error('Este arquivo não é um projeto do RecFlow.');
  let video = data.video;
  if (!video || !fs.existsSync(video)) {
    const rel = data.videoRelative && path.resolve(path.dirname(projPath), data.videoRelative);
    if (rel && fs.existsSync(rel)) video = rel;
    else throw new Error(`Vídeo do projeto não encontrado:\n${data.video}`);
  }
  return { ...data, video };
}
function openProject(projPath) {
  try {
    readProject(projPath);
    openEditor(null, projPath);
    return true;
  } catch (e) {
    dialog.showMessageBox(alive(mainWin) ? mainWin : undefined, { type: 'error', title: 'Abrir projeto', message: 'Não foi possível abrir o projeto.', detail: e.message });
    return false;
  }
}
async function chooseAndOpenProject(parent) {
  const r = await dialog.showOpenDialog(parent, {
    title: 'Abrir projeto', defaultPath: settings.outputDir,
    filters: [{ name: 'Projeto RecFlow', extensions: ['gtproj'] }], properties: ['openFile']
  });
  if (!r.canceled && r.filePaths[0]) openProject(r.filePaths[0]);
}
function projectFromArgv(argv) {
  return argv.find((a) => typeof a === 'string' && a.toLowerCase().endsWith(PROJECT_EXT) && fs.existsSync(a));
}

/* ------------------------------------------------------------------ */
/* Contagem regressiva                                                  */
/* ------------------------------------------------------------------ */
let countdownWin = null, countdownDone = null;
function runCountdown(seconds) {
  return new Promise((resolve) => {
    if (alive(countdownWin)) countdownWin.close();
    const t = settings.mode === 'window' || settings.mode === 'webcam' ? getDisplay(cursorDisplayId()).workArea : targetRect();
    const size = 260;
    countdownWin = new BrowserWindow({
      x: Math.round(t.x + (t.width - size) / 2), y: Math.round(t.y + (t.height - size) / 2), width: size, height: size,
      frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true, focusable: false, resizable: false,
      hasShadow: false, show: false, title: 'GT Contagem', webPreferences: webPrefs()
    });
    countdownWin.setIgnoreMouseEvents(true);
    countdownWin.setAlwaysOnTop(true, 'screen-saver', 3);
    countdownWin.setContentProtection(true);
    countdownWin.loadFile(path.join(__dirname, 'src', 'countdown.html'), { query: { s: String(seconds) } });
    countdownWin.once('ready-to-show', () => alive(countdownWin) && countdownWin.showInactive());
    let finished = false;
    countdownDone = (ok) => {
      if (finished) return; finished = true;
      clearTimeout(timer);
      if (alive(countdownWin)) countdownWin.close();
      countdownWin = null; countdownDone = null;
      resolve(ok);
    };
    const timer = setTimeout(() => countdownDone && countdownDone(true), seconds * 1000 + 350);
  });
}

/* ------------------------------------------------------------------ */
/* Agendamento                                                          */
/* ------------------------------------------------------------------ */
function checkSchedules() {
  if (!settings) return;
  const now = Date.now(); let changed = false;
  for (const s of settings.schedules) {
    if (!s.enabled || s.done) continue;
    const start = new Date(s.start).getTime();
    const end = start + Number(s.duration) * 60000;
    if (Number.isNaN(start)) continue;
    if (now >= end) { s.done = true; s.missed = true; changed = true; }
    else if (now >= start && !rec.active) {
      s.done = true; changed = true;
      send('schedule:start', { id: s.id, stopAt: end });
    }
  }
  if (changed) { saveSettings(); send('settings:changed', settings); }
}

/* ------------------------------------------------------------------ */
/* IA: tarefas de apoio (manual e vídeo)                                */
/* ------------------------------------------------------------------ */
const AI_LINKS = ['https://console.anthropic.com/settings/keys', 'https://platform.openai.com/api-keys', 'https://aistudio.google.com/apikey', 'https://console.groq.com/keys'];
const LANG_NAMES = { 'pt-BR': 'português do Brasil', 'pt-PT': 'português de Portugal', en: 'inglês', es: 'espanhol', fr: 'francês', it: 'italiano', de: 'alemão' };
const langName = (l) => LANG_NAMES[l] || LANG_NAMES[String(l).split('-')[0]] || l;
const cleanText = (t) => String(t || '').trim().replace(/^["“'`]+|["”'`]+$/g, '').trim();
const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };

async function aiTask(name, p) {
  const lang = langName(ai.lang());
  const sys = `Você ajuda a produzir manuais de uso e vídeos tutoriais de sistemas. Escreva sempre em ${lang}, de forma clara e objetiva.`;
  switch (name) {
    case 'describeField': {
      const prompt = [
        'A primeira imagem mostra um componente de uma tela de sistema, contornado e numerado. A segunda (se houver) é a tela inteira, para contexto.',
        `Manual: "${p.title || ''}". Tela: "${p.screenName || ''}". Componente identificado automaticamente: "${p.fieldName || 'não identificado'}".`,
        p.text ? `Rascunho do usuário: "${p.text}". Melhore-o mantendo o sentido.` : '',
        'Escreva UMA instrução curta (1 ou 2 frases, até 220 caracteres) dizendo ao usuário o que preencher, escolher ou fazer nesse componente.',
        'Use o imperativo. Não cite "imagem", "destaque", "contorno" nem o número. Responda apenas com o texto.'
      ].filter(Boolean).join('\n');
      return cleanText(await ai.chat({ system: sys, prompt, images: [p.crop, p.full].filter(Boolean), maxTokens: 400 }));
    }
    case 'texts': {
      // revisar ou traduzir uma lista [{ id, text }] -> { id: texto }
      const items = (p.items || []).filter((x) => x && String(x.text || '').trim());
      const out = {};
      for (const part of chunk(items, 50)) {
        const prompt = p.mode === 'translate'
          ? `Traduza para ${langName(p.lang)} os textos de um manual de sistema abaixo. Mantenha o tom instrutivo, nomes de botões e campos coerentes entre si e quebras de linha.\nResponda APENAS com um array JSON no formato [{"id":"...","text":"..."}], com os mesmos ids.\n\n${JSON.stringify(part)}`
          : `Revise os textos de um manual de sistema abaixo: corrija ortografia, gramática, pontuação e clareza; mantenha o sentido, o tom instrutivo e um tamanho parecido. Não invente informações.\nResponda APENAS com um array JSON no formato [{"id":"...","text":"..."}], com os mesmos ids.\n\n${JSON.stringify(part)}`;
        const res = ai.parseJson(await ai.chat({ system: p.mode === 'translate' ? `Você é tradutor técnico de software.` : sys, prompt, maxTokens: 8000 }));
        (Array.isArray(res) ? res : []).forEach((r) => { if (r && r.id != null && typeof r.text === 'string') out[String(r.id)] = r.text.trim(); });
      }
      return out;
    }
    case 'structure': {
      const list = (p.screens || []).map((s) => ({ n: s.n, name: s.name, group: s.group || '', items: (s.items || []).slice(0, 12) }));
      const prompt = `Estas são as telas de um manual de sistema, na ordem, com os textos de cada item. Sugira um nome curto e descritivo (até 50 caracteres) para cada tela e agrupe telas seguidas em capítulos (nome até 40 caracteres) quando fizer sentido; telas sem relação podem ficar sem capítulo ("").\nManual: "${p.title || ''}".\nResponda APENAS com JSON no formato [{"n":1,"name":"...","group":"..."}].\n\n${JSON.stringify(list)}`;
      const res = ai.parseJson(await ai.chat({ system: sys, prompt, maxTokens: 4000 }));
      return Array.isArray(res) ? res : [];
    }
    case 'fillScreen': {
      const prompt = `A imagem é uma tela de sistema com componentes marcados por números em círculos. Para cada item da lista, escreva uma instrução curta (1 ou 2 frases, até 220 caracteres, no imperativo) do que o usuário deve fazer ou preencher naquele componente. "fieldName" ajuda a identificar o componente e "text" é um rascunho (pode estar vazio).\nManual: "${p.title || ''}". Tela: "${p.screenName || ''}".\nResponda APENAS com JSON no formato [{"num":1,"text":"..."}].\n\n${JSON.stringify(p.marks || [])}`;
      const res = ai.parseJson(await ai.chat({ system: sys, prompt, images: [p.image].filter(Boolean), maxTokens: 3000 }));
      return Array.isArray(res) ? res : [];
    }
    case 'videoMeta': {
      const prompt = `Abaixo está a transcrição de um vídeo tutorial, com o tempo de cada trecho (mm:ss).\nCrie: um título atrativo (até 80 caracteres), uma descrição de 2 a 4 parágrafos curtos para YouTube e uma lista de capítulos (o primeiro em 00:00, no máximo 12, com títulos de até 50 caracteres).\nResponda APENAS com JSON no formato {"title":"...","description":"...","chapters":[{"t":"00:00","title":"..."}]}.\n\n${String(p.transcript || '').slice(0, 60000)}`;
      return ai.parseJson(await ai.chat({ system: sys, prompt, maxTokens: 3000 }));
    }
    case 'improveNarration': {
      const prompt = `Reescreva o texto abaixo para ser narrado em voz alta num vídeo tutorial: frases curtas, naturais e claras, sem mudar o sentido. Responda apenas com o texto.\n\n${p.text || ''}`;
      return cleanText(await ai.chat({ system: sys, prompt, maxTokens: 1500 }));
    }
    default: throw new Error('Tarefa de IA desconhecida.');
  }
}

/* ------------------------------------------------------------------ */
/* Exportar / importar configurações                                    */
/* ------------------------------------------------------------------ */
// itens que dependem deste computador ficam de fora
const NO_EXPORT = ['windowId', 'windowName', 'displayId', 'region', 'webcamBounds', 'micDeviceId', 'webcamDeviceId', 'schedules', 'hwEncoders'];
function importSettings(file) {
  let data;
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return { error: 'Arquivo inválido.' }; }
  if (!data || data.app !== 'recflow' || data.kind !== 'settings' || typeof data.settings !== 'object') return { error: 'Este arquivo não é de configurações do RecFlow.' };
  const inc = { ...data.settings };
  NO_EXPORT.forEach((k) => delete inc[k]);
  const d = defaults();
  Object.keys(inc).forEach((k) => { if (!(k in d)) delete inc[k]; });
  // caminhos que não existem neste computador são ignorados
  ['outputDir', 'manualDir'].forEach((k) => { if (inc[k] && !fs.existsSync(inc[k])) delete inc[k]; });
  if (inc.wmPath && !fs.existsSync(inc.wmPath)) { delete inc.wmPath; inc.wmEnabled = false; }
  if (inc.brand && inc.brand.logoPath && !fs.existsSync(inc.brand.logoPath)) inc.brand = { ...inc.brand, logoPath: '' };
  settings = { ...settings, ...inc, hotkeys: { ...settings.hotkeys, ...(inc.hotkeys || {}) }, brand: { ...settings.brand, ...(inc.brand || {}) } };
  saveSettings();
  nativeTheme.themeSource = settings.theme || 'system';
  applyHide();
  if (settings.manualEnabled) uiaStart(); else uiaStop();
  syncCamWindow(); applyBrand();
  const failed = registerHotkeys();
  send('settings:changed', settings);
  return { ok: true, failed };
}

/* ------------------------------------------------------------------ */
/* IPC                                                                  */
/* ------------------------------------------------------------------ */
function registerIpc() {
  ipcMain.handle('app:openExternal', (_e, url) => { if (ABOUT_LINKS.includes(url)) shell.openExternal(url); });
  ipcMain.handle('settings:get', () => ({ version: require('./package.json').version, settings, failedHotkeys, hookAvailable: !!uIOhook, accent: accentColor(), ffmpeg: !!ffmpegPath }));
  ipcMain.handle('settings:set', (_e, patch) => {
    const hotkeysChanged = !!patch.hotkeys;
    settings = { ...settings, ...patch, hotkeys: { ...settings.hotkeys, ...(patch.hotkeys || {}) }, brand: { ...settings.brand, ...(patch.brand || {}) } };
    saveSettings();
    if ('hideApp' in patch) applyHide();
    if ('theme' in patch) nativeTheme.themeSource = settings.theme || 'system';
    if (['webcam', 'webcamShape', 'webcamDeviceId', 'webcamMirror', 'webcamWidth', 'webcamBlur', 'webcamBlurStrength', 'mode', 'region', 'displayId'].some((k) => k in patch)) syncCamWindow();
    if ('manualEnabled' in patch) { if (settings.manualEnabled) uiaStart(); else uiaStop(); }
    if ('brand' in patch || 'brandManuals' in patch) { settings.brand = { ...defaults().brand, ...settings.brand }; applyBrand(); }
    const failed = hotkeysChanged || 'manualEnabled' in patch ? registerHotkeys() : [];
    return { settings, failed };
  });

  ipcMain.handle('sources:list', async () => {
    const displays = screen.getAllDisplays();
    const primary = screen.getPrimaryDisplay();
    const srcs = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 } });
    const screens = srcs.filter((s) => s.id.startsWith('screen:')).map((s, i) => {
      const d = displays.find((x) => String(x.id) === s.display_id) || displays[i] || primary;
      return {
        id: s.id, displayId: String(d.id),
        name: `Monitor ${i + 1}${d.id === primary.id ? ' (principal)' : ''}`,
        thumb: s.thumbnail.toDataURL(),
        width: Math.round(d.bounds.width * d.scaleFactor), height: Math.round(d.bounds.height * d.scaleFactor)
      };
    });
    const windows = srcs
      .filter((s) => s.id.startsWith('window:') && s.name && s.name !== APP_TITLE && !s.name.startsWith('GT '))
      .map((s) => ({ id: s.id, name: s.name, thumb: s.thumbnail.toDataURL() }));
    return { screens, windows };
  });

  ipcMain.handle('capture:target', async () => {
    const s = settings;
    if (s.mode === 'webcam') return { kind: 'webcam', displayId: null };
    if (s.mode === 'window') {
      if (!s.windowId) return { error: 'Selecione uma janela na aba Início.' };
      return { kind: 'window', sourceId: s.windowId, displayId: String(screen.getPrimaryDisplay().id) };
    }
    if (s.mode === 'area' && !s.region) return { error: 'Selecione uma área primeiro.' };
    const d = getDisplay(s.mode === 'area' ? s.region.displayId : s.displayId);
    const srcs = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
    const idx = screen.getAllDisplays().findIndex((x) => x.id === d.id);
    const src = srcs.find((x) => x.display_id === String(d.id)) || srcs[idx] || srcs[0];
    if (!src) return { error: 'Nenhuma tela disponível para captura.' };
    const out = {
      kind: s.mode, sourceId: src.id, displayId: String(d.id),
      width: Math.round(d.bounds.width * d.scaleFactor), height: Math.round(d.bounds.height * d.scaleFactor), crop: null
    };
    if (s.mode === 'area') {
      const r = s.region;
      out.crop = { x: r.x / d.bounds.width, y: r.y / d.bounds.height, w: r.w / d.bounds.width, h: r.h / d.bounds.height };
    }
    return out;
  });

  ipcMain.handle('region:select', () => selectRegion());

  ipcMain.handle('rec:begin', async (_e, opts = {}) => {
    const { ext, displayId, tracks = [], engine = 'browser', continuation = false } = opts;
    ensureOutputDir();
    const free = freeBytes(settings.outputDir);
    if (free != null && free < 500 * MB) return { error: `Espaço insuficiente no disco (${fmtSize(free)} livres).` };
    const useFfmpeg = engine === 'ffmpeg';
    rec.file = path.join(settings.outputDir, `Gravacao_${stamp()}.${useFfmpeg || ext !== 'webm' ? 'mp4' : 'webm'}`);
    rec.engine = useFfmpeg ? 'ffmpeg' : 'browser';
    rec.id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    rec.clicks = []; rec.partOffset = 0; rec.part = 1; rec.base = rec.file;
    if (!continuation) rec.sessionFiles = [];
    rec.sessionFiles.push(rec.file);
    rec.tracks = {};
    try {
      if (useFfmpeg) {
        ensureSidecarDir(rec.file);
        rec.audioFile = sidecar(rec.file, 'audio.webm');
        rec.stream = opts.audio ? fs.createWriteStream(rec.audioFile) : null;
        await beginFfmpeg();
      } else {
        rec.stream = fs.createWriteStream(rec.file);
      }
      openTracks(tracks);
    } catch (err) {
      try { if (rec.stream) rec.stream.destroy(); } catch { /* ignora */ }
      rec.stream = null; rec.cap = null;
      return { error: err.message };
    }
    journalUpdate();
    rec.active = true; rec.paused = false; rec.displayId = displayId || cursorDisplayId();
    rec.t0 = Date.now(); rec.pausedTotal = 0; rec.pauseAt = null;
    applyHide();
    if (manual && !continuation) manualEnd(true);   // cada gravação começa um manual novo
    if (settings.mode === 'area' && settings.showBorder) showBorder();
    if (alive(camWin)) { if (!camInsideTarget()) placeCam('br'); camWin.moveTop(); }
    if (settings.mode === 'screen' || settings.mode === 'area') {
      if ((settings.clickEffects || settings.keysShow) && uIOhook) ensureOverlay(rec.displayId);
      if (uIOhook && (settings.clickEffects || settings.keysShow || wantClicks())) { stopHook(); startHook(); }
    }
    if (settings.minimizeOnRecord && alive(mainWin) && !continuation) mainWin.minimize();
    startDiskMonitor();
    updateTray();
    const encLabel = rec.engine === 'ffmpeg' ? ((settings.hwEncoders || []).find((x) => x.id === rec.encoder) || { label: rec.encoder }).label : null;
    return { file: rec.file, engine: rec.engine, encoder: encLabel };
  });

  ipcMain.handle('rec:chunk', (_e, buf) => new Promise((resolve) => {
    if (!rec.stream) return resolve(false);
    rec.stream.write(Buffer.from(buf), () => resolve(true));
  }));
  // trilhas separadas (microfone e som do sistema)
  ipcMain.handle('rec:trackChunk', (_e, name, buf) => new Promise((resolve) => {
    const t = rec.tracks[name];
    if (!t || !t.stream) return resolve(false);
    t.stream.write(Buffer.from(buf), () => resolve(true));
  }));

  // divide a gravação em partes (limite de tempo/tamanho), sem parar a captura
  ipcMain.handle('rec:split', async () => {
    if (!rec.active || rec.engine !== 'browser') return null;
    const prev = rec.file, prevTracks = rec.tracks;
    await new Promise((r) => (rec.stream ? rec.stream.end(r) : r()));
    await closeTracks(prevTracks);
    saveClicks(prev);
    rec.part += 1;
    const ext = path.extname(rec.base);
    rec.file = `${rec.base.slice(0, -ext.length)}_parte${rec.part}${ext}`;
    rec.stream = fs.createWriteStream(rec.file);
    rec.sessionFiles.push(rec.file);
    rec.clicks = []; rec.partOffset = recElapsed() || 0;
    openTracks(Object.keys(prevTracks));
    journalUpdate();
    finalizeRecording(prev).then(() => Promise.all(Object.values(prevTracks).map((t) => fixTrack(t.file)))).then(() => send('files:changed'));
    return rec.file;
  });

  ipcMain.handle('rec:end', (_e, opts = {}) => new Promise((resolve) => {
    const file = rec.file;
    const finish = async () => {
      const tracks = rec.tracks; const cap = rec.cap; const engine = rec.engine; const id = rec.id;
      rec.active = false; rec.paused = false; rec.stream = null; rec.cap = null;
      applyHide();
      stopDiskMonitor();
      closeBorder(); stopHook();
      if (alive(overlayWin)) overlayWin.webContents.send('keys:config', null);
      if (!drawing) closeOverlay();
      updateTray();
      saveClicks(file);
      await closeTracks(tracks);
      if (!opts.split && manual && rec.sessionFiles && rec.sessionFiles.includes(manual.recFile)) { if (manual.screens.some((x) => x.marks.length)) manualWriteDocs(); manualEnd(true); }
      if (engine === 'ffmpeg') {
        if (cap) await cap.stopSegment();
        try {
          const listFile = sidecar(file, 'concat.txt');
          await runFfmpeg(hwrec.muxArgs({ segments: cap ? cap.segments : [], audio: rec.audioFile, out: file, listFile }));
          [listFile, rec.audioFile, sidecar(file, 'logo.png'), ...(cap ? cap.segments : [])].forEach((f) => { try { fs.rmSync(f, { force: true }); } catch { /* ignora */ } });
          journalDrop(id);
        } catch (err) {
          send('toast', `Não foi possível juntar a gravação: ${err.message}. Ela aparece para recuperar na próxima abertura.`, true);
          resolve(null); return;
        }
      } else journalDrop(id);
      if (pendingQuit) { resolve(file); setImmediate(() => app.quit()); return; }
      if (engine !== 'ffmpeg') await finalizeRecording(file);
      await Promise.all(Object.values(tracks).map((t) => fixTrack(t.file)));
      resolve(file);
      send('files:changed');
      if (!opts.split && settings.openEditor && file && fs.existsSync(file) && fs.statSync(file).size > 0) openEditor(file);
    };
    if (rec.stream) rec.stream.end(finish); else finish();
  }));

  ipcMain.on('rec:paused', (_e, p) => {
    if (p && !rec.pauseAt) rec.pauseAt = Date.now();
    if (!p && rec.pauseAt) { rec.pausedTotal += Date.now() - rec.pauseAt; rec.pauseAt = null; }
    rec.paused = !!p; updateTray();
  });
  // gravação pelo FFmpeg: a pausa fecha o segmento; a retomada abre outro (espera o 1º quadro)
  ipcMain.handle('rec:enginePause', async (_e, p) => {
    if (!rec.active || rec.engine !== 'ffmpeg' || !rec.cap) return true;
    try {
      if (p) await rec.cap.stopSegment(); else { await rec.cap.startSegment(); journalUpdate(); }
      return true;
    } catch (err) { send('toast', `FFmpeg: ${err.message}`, true); return false; }
  });
  ipcMain.handle('rec:diskFree', () => freeBytes(settings.outputDir));
  ipcMain.handle('rec:encoders', async (_e, refresh) => {
    if (!ffmpegPath) return [];
    if (!settings.hwEncoders || refresh) { settings.hwEncoders = await hwrec.detect(ffmpegPath); saveSettings(); }
    return settings.hwEncoders;
  });
  ipcMain.handle('recovery:list', () => scanRecovery().map((e) => ({ id: e.id, name: path.basename(e.file), startedAt: e.startedAt, size: e.size, engine: e.engine })));
  ipcMain.handle('recovery:repair', async (_e, id) => {
    try { return { ok: true, ...(await repairRecording(id)) }; } catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('recovery:discard', async (_e, id) => { await discardRecording(id); return true; });

  // modo manual
  ipcMain.handle('manual:init', () => (manualCtx ? { ...manualCtx.init, ai: ai.available().text, title: manual ? manual.title : '' } : null));
  ipcMain.handle('manual:save', (_e, data) => {
    const c = manualCtx;
    if (!c || !manual) return { ok: false };
    try {
      const mk = {
        num: c.num, text: String(data.text || '').trim(), shape: data.shape, color: data.color,
        rect: data.rect, fieldName: c.init.fieldName,
        videoTime: c.videoTime == null ? null : Math.round(c.videoTime * 10) / 10
      };
      if (c.screen.videoTime == null && c.videoTime != null) c.screen.videoTime = Math.round(c.videoTime * 10) / 10;
      if (data.screenName && data.screenName.trim()) c.screen.name = data.screenName.trim();
      c.screen.marks.push(mk);
      manual.counter = Math.max(manual.counter, c.num);
      fs.writeFileSync(path.join(manual.dir, c.screen.file), Buffer.from(data.png.split(',')[1], 'base64'));
      if (data.shape && data.shape !== settings.manualShape) { settings.manualShape = data.shape; saveSettings(); send('settings:changed', settings); }
      manualWriteDocs();
      return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
  });
  ipcMain.on('manual:close', () => { if (alive(manualWin)) manualWin.close(); });
  ipcMain.handle('manual:status', () => manualStatus());
  ipcMain.handle('manual:end', () => { manualEnd(true); return manualStatus(); });
  ipcMain.handle('manual:openFolder', (_e, which) => {
    const target = which === 'session' && manual ? manual.dir : manualRoot();
    fs.mkdirSync(target, { recursive: true });
    return shell.openPath(target);
  });
  ipcMain.handle('manual:openHtml', () => {
    const f = manual && path.join(manual.dir, 'manual.html');
    return f && fs.existsSync(f) ? shell.openPath(f) : 'sem manual';
  });
  ipcMain.handle('manual:setTitle', (_e, t) => {
    settings.manualTitle = String(t || '').trim() || 'Manual'; saveSettings();
    if (manual) { manual.title = settings.manualTitle; if (manual.screens.some((x) => x.marks.length)) manualWriteDocs(); }
    return settings.manualTitle;
  });
  ipcMain.handle('mdoc:list', () => mdocs.listManuals(manualRoot()));
  ipcMain.handle('mdoc:edit', (_e, dir) => { if (dir && fs.existsSync(path.join(dir, 'manual.json'))) openManualEditor(dir); });
  ipcMain.handle('mdoc:openOther', async (e) => {
    const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), {
      title: 'Abrir manual', defaultPath: manualRoot(), properties: ['openFile'],
      filters: [{ name: 'Manual do RecFlow', extensions: ['json'] }]
    });
    if (r.canceled || !r.filePaths[0]) return null;
    const dir = path.dirname(r.filePaths[0]);
    openManualEditor(dir);
    return dir;
  });
  ipcMain.handle('mdoc:load', (_e, dir) => {
    try {
      const doc = mdocs.loadManual(dir);
      const originals = doc.screens.map((sc) => {
        const f = path.join(dir, sc.original);
        const alt = path.join(dir, sc.file);
        const img = nativeImage.createFromPath(fs.existsSync(f) ? f : alt);
        return img.isEmpty() ? null : img.toDataURL();
      });
      const vAbs = doc.video ? path.resolve(dir, doc.video) : null;
      const video = vAbs && fs.existsSync(vAbs) ? { abs: vAbs, rel: doc.video, url: pathToFileURL(vAbs).href, name: path.basename(vAbs) } : null;
      const screenVideos = {};
      doc.screens.forEach((sc) => {
        if (!sc.video || screenVideos[sc.video]) return;
        const abs = path.resolve(dir, sc.video);
        if (fs.existsSync(abs)) screenVideos[sc.video] = { abs, rel: sc.video, url: pathToFileURL(abs).href, name: path.basename(abs) };
      });
      return { ok: true, doc, originals, video, screenVideos, videoMissing: !!(doc.video && !video), hasLogo: !!readLogo(), ai: ai.available().text };
    } catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('mdoc:save', (_e, dir, doc, pngs, originals) => {
    try {
      // lê os originais na ordem nova (do arquivo atual ou da imagem trocada)
      const bufs = doc.screens.map((sc, i) => (originals[i]
        ? Buffer.from(originals[i].split(',')[1], 'base64')
        : fs.readFileSync(path.join(dir, sc.original))));
      // apaga os prints antigos e grava na ordem nova
      fs.readdirSync(dir).filter((f) => /^tela_\d+\.png$/i.test(f)).forEach((f) => fs.unlinkSync(path.join(dir, f)));
      const od = path.join(dir, 'originais'); fs.mkdirSync(od, { recursive: true });
      fs.readdirSync(od).filter((f) => /^tela_\d+\.png$/i.test(f)).forEach((f) => fs.unlinkSync(path.join(od, f)));
      doc.screens.forEach((sc, i) => {
        const n = pad2(i + 1);
        sc.n = i + 1; sc.file = `tela_${n}.png`; sc.original = path.join('originais', `tela_${n}.png`);
        fs.writeFileSync(path.join(od, `tela_${n}.png`), bufs[i]);
        fs.writeFileSync(path.join(dir, sc.file), Buffer.from(pngs[i].split(',')[1], 'base64'));
      });
      if (doc.copyVideo && doc.video) {
        const abs = path.resolve(dir, doc.video);
        if (fs.existsSync(abs) && path.dirname(abs) !== path.resolve(dir)) {
          const target = path.join(dir, `video${path.extname(abs).toLowerCase()}`);
          fs.copyFileSync(abs, target);
          doc.video = path.basename(target);
        }
      }
      delete doc.copyVideo;
      doc.updatedAt = new Date().toISOString();
      const norm = mdocs.normalize(doc, dir);
      mdocs.writeDocs(dir, norm);
      return { ok: true, doc: norm };
    } catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('mdoc:pickVideo', async (e, dir) => {
    const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), {
      title: 'Vídeo do manual', defaultPath: settings.outputDir, properties: ['openFile'],
      filters: [{ name: 'Vídeos', extensions: ['mp4', 'webm'] }]
    });
    if (r.canceled || !r.filePaths[0]) return null;
    const abs = r.filePaths[0];
    return { abs, rel: path.relative(dir, abs), url: pathToFileURL(abs).href, name: path.basename(abs) };
  });
  ipcMain.handle('mdoc:pickImage', async (e) => {
    const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), {
      title: 'Trocar o print desta tela', properties: ['openFile'],
      filters: [{ name: 'Imagens', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }]
    });
    if (r.canceled || !r.filePaths[0]) return null;
    const img = nativeImage.createFromPath(r.filePaths[0]);
    return img.isEmpty() ? null : img.toDataURL();
  });
  ipcMain.handle('mdoc:export', async (e, dir, kind, opts = {}) => {
    try {
      const doc = mdocs.loadManual(dir);
      const ext = kind === 'docx' ? 'docx' : 'pdf';
      const r = await dialog.showSaveDialog(BrowserWindow.fromWebContents(e.sender), {
        defaultPath: path.join(dir, `${safeName(doc.title)}.${ext}`),
        filters: [ext === 'pdf' ? { name: 'PDF', extensions: ['pdf'] } : { name: 'Documento do Word', extensions: ['docx'] }]
      });
      if (r.canceled || !r.filePath) return { ok: false, canceled: true };
      const logo = opts.logo ? readLogo() : null;
      if (ext === 'pdf') await mdocs.exportPdf(dir, doc, r.filePath, { logo });
      else await mdocs.exportDocx(dir, doc, r.filePath, { logo });
      return { ok: true, file: r.filePath };
    } catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('mdoc:openHtml', (_e, dir) => { const f = path.join(dir, 'manual.html'); return fs.existsSync(f) ? shell.openPath(f) : 'sem manual'; });
  ipcMain.handle('mdoc:openFolder', (_e, dir) => shell.openPath(dir));
  ipcMain.handle('mdoc:openFile', (_e, f) => (f && fs.existsSync(f) ? shell.openPath(f) : null));
  ipcMain.handle('mdoc:hasLogo', () => !!readLogo());

  ipcMain.handle('manual:chooseDir', async (e) => {
    const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), { properties: ['openDirectory', 'createDirectory'], defaultPath: manualRoot() });
    if (r.canceled || !r.filePaths[0]) return null;
    settings.manualDir = r.filePaths[0]; saveSettings();
    return settings.manualDir;
  });

  ipcMain.handle('screenshot:take', () => takeScreenshot());

  ipcMain.handle('files:list', () => {
    try {
      ensureOutputDir();
      return fs.readdirSync(settings.outputDir)
        .filter((f) => /\.(mp4|webm|png|gif|gtproj)$/i.test(f))
        .map((f) => {
          const p = path.join(settings.outputDir, f); const st = fs.statSync(p);
          return { name: f, path: p, size: st.size, mtime: st.mtimeMs };
        })
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, 200);
    } catch { return []; }
  });
  ipcMain.handle('files:open', (_e, p) => (insideOutput(p) ? shell.openPath(p) : 'negado'));
  ipcMain.handle('files:show', (_e, p) => { if (insideOutput(p)) shell.showItemInFolder(p); });
  ipcMain.handle('files:delete', async (_e, p) => {
    if (!insideOutput(p) || p === rec.file) return false;
    await shell.trashItem(p);
    // arquivos auxiliares (trilhas, cliques, narrações) vão junto
    try {
      const d = path.join(path.dirname(p), '.recflow'); const base = `${path.basename(p)}.`;
      if (fs.existsSync(d)) for (const f of fs.readdirSync(d)) if (f.startsWith(base)) await shell.trashItem(path.join(d, f)).catch(() => {});
    } catch { /* ignora */ }
    return true;
  });
  ipcMain.handle('folder:open', () => { ensureOutputDir(); return shell.openPath(settings.outputDir); });
  ipcMain.handle('folder:choose', async () => {
    const r = await dialog.showOpenDialog(mainWin, { properties: ['openDirectory', 'createDirectory'], defaultPath: settings.outputDir });
    if (r.canceled || !r.filePaths[0]) return null;
    settings.outputDir = r.filePaths[0]; saveSettings();
    return settings.outputDir;
  });

  ipcMain.handle('cam:init', () => camConfig());
  ipcMain.on('cam:drag-start', (_e, type) => {
    if (!alive(camWin)) return;
    camDrag = { type, cursor: screen.getCursorScreenPoint(), bounds: camWin.getBounds() };
  });
  ipcMain.on('cam:drag', () => {
    if (!camDrag || !alive(camWin)) return;
    const c = screen.getCursorScreenPoint(); const b = camDrag.bounds;
    const dx = c.x - camDrag.cursor.x, dy = c.y - camDrag.cursor.y;
    if (camDrag.type === 'resize') {
      const sz = camSizeFor(b.width + Math.max(dx, dy * camAspect()));
      camWin.setBounds({ x: b.x, y: b.y, ...sz });
    } else {
      camWin.setBounds({ x: b.x + dx, y: b.y + dy, width: b.width, height: b.height });
    }
  });
  ipcMain.on('cam:drag-end', () => { camDrag = null; saveCamBounds(); });
  ipcMain.on('cam:wheel', (_e, dir) => {
    if (!alive(camWin)) return;
    const b = camWin.getBounds(); const sz = camSizeFor(b.width * (dir < 0 ? 1.08 : 1 / 1.08));
    camWin.setBounds({ x: Math.round(b.x + (b.width - sz.width) / 2), y: Math.round(b.y + (b.height - sz.height) / 2), ...sz });
    saveCamBounds();
  });
  ipcMain.on('cam:place', (_e, corner) => placeCam(corner));
  ipcMain.on('cam:hide', () => { settings.webcam = false; saveSettings(); syncCamWindow(); send('settings:changed', settings); });

  ipcMain.handle('editor:open', (_e, file) => { if (file && fs.existsSync(file)) openEditor(file); });
  ipcMain.handle('editor:info', async (_e, file) => {
    if (!file || !fs.existsSync(file)) return { error: 'Arquivo não encontrado.' };
    const info = (await probe(file)) || {};
    return { ...info, file, name: path.basename(file), url: pathToFileURL(file).href, ffmpeg: !!ffmpegPath };
  });
  ipcMain.handle('editor:thumbs', async (_e, file, duration, count) => {
    if (!ffmpegPath || !duration) return null;
    try {
      const png = await runFfmpeg(['-i', file, '-an', '-vf', `fps=${count}/${num(duration)},scale=-2:90,tile=${count}x1`,
        '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', '-']);
      return `data:image/png;base64,${png.toString('base64')}`;
    } catch { return null; }
  });
  ipcMain.handle('editor:waveform', async (_e, file, points) => {
    if (!ffmpegPath) return null;
    try {
      const raw = await runFfmpeg(['-i', file, '-vn', '-ac', '1', '-ar', '4000', '-f', 's16le', '-']);
      const samples = new Int16Array(raw.buffer, raw.byteOffset, Math.floor(raw.length / 2));
      const step = Math.max(1, Math.floor(samples.length / points));
      const peaks = [];
      for (let i = 0; i < samples.length; i += step) {
        let m = 0;
        for (let j = i; j < Math.min(i + step, samples.length); j++) { const v = Math.abs(samples[j]); if (v > m) m = v; }
        peaks.push(m / 32768);
      }
      return peaks;
    } catch { return null; }
  });
  ipcMain.handle('editor:saveDialog', async (e, defaultPath, kind = 'mp4') => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const filters = {
      mp4: [{ name: 'Vídeo MP4', extensions: ['mp4'] }],
      gif: [{ name: 'GIF animado', extensions: ['gif'] }],
      gtproj: [{ name: 'Projeto RecFlow', extensions: ['gtproj'] }]
    }[kind] || [];
    const r = await dialog.showSaveDialog(win, { defaultPath, filters });
    return r.canceled ? null : r.filePath;
  });
  ipcMain.handle('project:load', (_e, projPath) => {
    try { return { ok: true, project: readProject(projPath), path: projPath, name: path.basename(projPath) }; }
    catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('project:save', async (e, projPath, data) => {
    try {
      let target = projPath;
      if (!target) {
        const win = BrowserWindow.fromWebContents(e.sender);
        const def = `${data.video.replace(/\.[^.\\/]+$/, '')}${PROJECT_EXT}`;
        const r = await dialog.showSaveDialog(win, { defaultPath: def, filters: [{ name: 'Projeto RecFlow', extensions: ['gtproj'] }] });
        if (r.canceled || !r.filePath) return { ok: false, canceled: true };
        target = r.filePath.toLowerCase().endsWith(PROJECT_EXT) ? r.filePath : r.filePath + PROJECT_EXT;
      }
      const doc = {
        app: 'recflow', version: 1, savedAt: new Date().toISOString(),
        video: data.video, videoRelative: path.relative(path.dirname(target), data.video),
        edit: data.edit, export: data.export || {}
      };
      fs.writeFileSync(target, JSON.stringify(doc, null, 2));
      send('files:changed');
      const win = BrowserWindow.fromWebContents(e.sender);
      if (win) win.setTitle(`${path.basename(target)} — RecFlow Editor`);
      return { ok: true, path: target, name: path.basename(target) };
    } catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('project:open', (e, p) => {
    if (p) return openProject(p);
    return chooseAndOpenProject(BrowserWindow.fromWebContents(e.sender));
  });

  // contagem regressiva
  ipcMain.handle('countdown:run', (_e, seconds) => runCountdown(Math.max(1, Math.min(10, Number(seconds) || 3))));
  ipcMain.on('countdown:cancel', () => countdownDone && countdownDone(false));

  // marca d'água
  const readImage = (p) => {
    try {
      const img = nativeImage.createFromPath(p);
      return img.isEmpty() ? null : img.toDataURL();
    } catch { return null; }
  };
  ipcMain.handle('wm:choose', async (e) => {
    const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), {
      title: 'Escolher logo / marca d\'água', properties: ['openFile'],
      filters: [{ name: 'Imagens', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'] }]
    });
    if (r.canceled || !r.filePaths[0]) return null;
    const dataUrl = readImage(r.filePaths[0]);
    if (!dataUrl) return { error: 'Imagem inválida.' };
    settings.wmPath = r.filePaths[0]; settings.wmEnabled = true; saveSettings();
    return { path: r.filePaths[0], dataUrl };
  });
  ipcMain.handle('wm:read', () => (settings.wmPath ? readImage(settings.wmPath) : null));
  ipcMain.handle('editor:export', async (e, spec) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gravador-'));
    const owner = e.sender.id;
    try {
      if (path.resolve(spec.output) === path.resolve(spec.input)) throw new Error('Escolha um nome diferente do arquivo original.');
      const { args, outDuration } = buildExport(spec, tmpDir);
      await runFfmpeg(args, {
        duration: outDuration, owner,
        onProgress: (p) => { if (!e.sender.isDestroyed()) e.sender.send('editor:progress', p); }
      });
      send('files:changed');
      return { ok: true, file: spec.output };
    } catch (err) {
      try { if (fs.existsSync(spec.output)) fs.unlinkSync(spec.output); } catch { /* ignora */ }
      return { ok: false, error: err.message };
    } finally {
      fs.rm(tmpDir, { recursive: true, force: true }, () => {});
    }
  });
  ipcMain.on('editor:cancel', (e) => { const p = exportProcs.get(e.sender.id); if (p) p.kill(); });
  ipcMain.handle('editor:showFile', (_e, p) => { if (p && fs.existsSync(p)) shell.showItemInFolder(p); });
  ipcMain.handle('editor:openFile', (_e, p) => (p && fs.existsSync(p) ? shell.openPath(p) : null));


  /* ---------- editor: trilhas, mídia, silêncios, legendas, narração ---------- */
  ipcMain.handle('editor:sidecars', (_e, file) => {
    const out = { tracks: {}, clicks: null };
    if (!file) return out;
    ['mic', 'sys'].forEach((k) => { const f = sidecar(file, `${k}.webm`); if (fs.existsSync(f) && fs.statSync(f).size > 0) out.tracks[k] = { file: f, url: pathToFileURL(f).href }; });
    try { out.clicks = JSON.parse(fs.readFileSync(sidecar(file, 'clicks.json'), 'utf8')); } catch { out.clicks = null; }
    return out;
  });
  ipcMain.handle('editor:pickMedia', async (e, kind) => {
    const filters = {
      music: [{ name: 'Áudio', extensions: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'opus', 'flac', 'webm'] }],
      clip: [{ name: 'Vídeo ou imagem', extensions: ['mp4', 'webm', 'mov', 'mkv', 'png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'] }]
    }[kind] || [];
    const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), { title: kind === 'music' ? 'Música de fundo' : 'Vídeo ou imagem', properties: ['openFile'], filters });
    if (r.canceled || !r.filePaths[0]) return null;
    const f = r.filePaths[0];
    const isImg = /\.(png|jpe?g|webp|bmp|gif)$/i.test(f);
    const info = isImg ? {} : (await probe(f)) || {};
    return { file: f, name: path.basename(f), url: pathToFileURL(f).href, kind: isImg ? 'image' : kind === 'music' ? 'audio' : 'video', duration: info.duration || null, hasAudio: !!info.hasAudio };
  });
  ipcMain.handle('editor:silences', async (_e, file, opts = {}) => {
    const db = Math.max(-70, Math.min(-10, Number(opts.db) || -35));
    const min = Math.max(0.3, Math.min(10, Number(opts.min) || 1));
    const src = opts.track && fs.existsSync(opts.track) ? opts.track : file;
    return new Promise((resolve) => {
      if (!ffmpegPath) return resolve([]);
      const p = spawn(ffmpegPath, ['-hide_banner', '-nostdin', '-i', src, '-vn', '-af', `silencedetect=n=${db}dB:d=${min}`, '-f', 'null', '-'], { windowsHide: true });
      let err = '';
      p.stderr.on('data', (d) => { err += d; });
      p.on('error', () => resolve([]));
      p.on('close', () => {
        const out = []; let st = null;
        err.split('\n').forEach((l) => {
          let m = /silence_start: (-?[\d.]+)/.exec(l); if (m) st = Math.max(0, Number(m[1]));
          m = /silence_end: ([\d.]+)/.exec(l); if (m && st != null) { out.push([st, Number(m[1])]); st = null; }
        });
        resolve(out);
      });
    });
  });
  ipcMain.handle('editor:saveText', async (e, defaultPath, text, kind = 'srt') => {
    const r = await dialog.showSaveDialog(BrowserWindow.fromWebContents(e.sender), {
      defaultPath, filters: kind === 'srt' ? [{ name: 'Legenda SRT', extensions: ['srt'] }] : [{ name: 'Texto', extensions: ['txt'] }]
    });
    if (r.canceled || !r.filePath) return null;
    fs.writeFileSync(r.filePath, `﻿${text}`, 'utf8');
    return r.filePath;
  });
  ipcMain.handle('editor:transcribe', async (e, file, opts = {}) => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'recflow-stt-'));
    try {
      const src = opts.track && fs.existsSync(opts.track) ? opts.track : file;
      const progress = (m) => { if (!e.sender.isDestroyed()) e.sender.send('ai:progress', m); };
      progress('Extraindo o áudio…');
      const CH = 1200;   // 20 min por parte (limite de tamanho das APIs)
      await runFfmpeg(['-i', src, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '48k', '-f', 'segment', '-segment_time', String(CH), path.join(tmp, 'p%03d.mp3')]);
      const chunks = fs.readdirSync(tmp).filter((f) => f.endsWith('.mp3')).sort();
      const segs = [];
      for (let i = 0; i < chunks.length; i++) {
        progress(chunks.length > 1 ? `Transcrevendo parte ${i + 1} de ${chunks.length}…` : 'Transcrevendo…');
        const r = await ai.transcribe(path.join(tmp, chunks[i]), { language: opts.language });
        r.forEach((s) => segs.push({ start: s.start + i * CH, end: s.end == null ? null : s.end + i * CH, text: s.text }));
      }
      return { ok: true, segments: segs };
    } catch (err) { return { ok: false, error: err.message }; } finally { fs.rm(tmp, { recursive: true, force: true }, () => {}); }
  });
  ipcMain.handle('editor:narrate', async (_e, videoFile, text, opts = {}) => {
    try {
      const { buffer, ext } = await ai.tts(String(text || '').slice(0, 4000), opts);
      if (!buffer || buffer.length < 100) throw new Error('A API de voz não devolveu áudio.');
      ensureSidecarDir(videoFile);
      const f = sidecar(videoFile, `narr-${Date.now().toString(36)}.${ext}`);
      fs.writeFileSync(f, buffer);
      const info = (await probe(f)) || {};
      return { ok: true, file: f, url: pathToFileURL(f).href, duration: info.duration || 2 };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  /* ---------- IA ---------- */
  const guard = async (fn) => { try { return { ok: true, data: await fn() }; } catch (err) { return { ok: false, error: err.message }; } };
  ipcMain.handle('ai:list', () => ai.list());
  ipcMain.handle('ai:save', (_e, p) => guard(() => ai.save(p)));
  ipcMain.handle('ai:remove', (_e, id) => guard(() => ai.remove(id)));
  ipcMain.handle('ai:setUse', (_e, use, lang) => guard(() => ai.setUse(use, lang)));
  ipcMain.handle('ai:test', (_e, id) => guard(() => ai.test(id)));
  ipcMain.handle('ai:models', (_e, id) => guard(() => ai.models(id)));
  ipcMain.handle('ai:available', () => ai.available());
  ipcMain.handle('ai:task', (_e, name, payload) => guard(() => aiTask(name, payload || {})));
  ipcMain.handle('ai:openLink', (_e, url) => { if (AI_LINKS.includes(url)) shell.openExternal(url); });

  /* ---------- manuais: mesclar e traduzir ---------- */
  ipcMain.handle('mdoc:merge', (_e, dirs, opts) => guard(() => {
    const dir = mdocs.mergeManuals(manualRoot(), dirs, opts || {});
    return { dir };
  }));
  ipcMain.handle('mdoc:translate', (e, dir, lang) => guard(async () => {
    const progress = (m) => { if (!e.sender.isDestroyed()) e.sender.send('ai:progress', m); };
    progress('Traduzindo o manual…');
    const src = mdocs.loadManual(dir);
    const items = [{ id: 'title', text: src.title }, ...(src.subtitle ? [{ id: 'subtitle', text: src.subtitle }] : [])];
    src.screens.forEach((s, i) => {
      items.push({ id: `s${i}`, text: s.name });
      if (s.group) items.push({ id: `g${i}`, text: s.group });
      s.marks.forEach((m, j) => { if (m.text) items.push({ id: `m${i}_${j}`, text: m.text }); });
    });
    const tr = await aiTask('texts', { mode: 'translate', lang, items });
    const code = String(lang).split('-')[0].toLowerCase();
    const { dir: dest, doc } = mdocs.copyManual(dir, code);
    if (tr.title) doc.title = tr.title;
    if (tr.subtitle) doc.subtitle = tr.subtitle;
    doc.screens.forEach((s, i) => {
      if (tr[`s${i}`]) s.name = tr[`s${i}`];
      if (tr[`g${i}`]) s.group = tr[`g${i}`];
      s.marks.forEach((m, j) => { if (tr[`m${i}_${j}`]) m.text = tr[`m${i}_${j}`]; });
    });
    doc.updatedAt = new Date().toISOString();
    mdocs.writeDocs(dest, mdocs.normalize(doc, dest));
    return { dir: dest };
  }));

  /* ---------- identidade visual ---------- */
  ipcMain.handle('brand:chooseLogo', async (e) => {
    const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), {
      title: 'Logo da identidade visual', properties: ['openFile'],
      filters: [{ name: 'Imagens', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }]
    });
    if (r.canceled || !r.filePaths[0]) return null;
    const img = nativeImage.createFromPath(r.filePaths[0]);
    if (img.isEmpty()) return { error: 'Imagem inválida.' };
    settings.brand = { ...settings.brand, logoPath: r.filePaths[0] }; saveSettings(); applyBrand();
    return { path: r.filePaths[0], dataUrl: img.toDataURL() };
  });
  ipcMain.handle('brand:logo', () => {
    const p = settings.brand && settings.brand.logoPath;
    if (!p || !fs.existsSync(p)) return null;
    const img = nativeImage.createFromPath(p);
    return img.isEmpty() ? null : img.toDataURL();
  });

  /* ---------- exportar / importar configurações ---------- */
  ipcMain.handle('settings:export', async (e) => {
    const r = await dialog.showSaveDialog(BrowserWindow.fromWebContents(e.sender), {
      title: 'Exportar configurações', defaultPath: path.join(app.getPath('documents'), `RecFlow-configuracoes_${stamp().slice(0, 10)}.json`),
      filters: [{ name: 'Configurações do RecFlow', extensions: ['json'] }]
    });
    if (r.canceled || !r.filePath) return null;
    const data = { ...settings };
    NO_EXPORT.forEach((k) => delete data[k]);
    fs.writeFileSync(r.filePath, JSON.stringify({ app: 'recflow', kind: 'settings', version: require('./package.json').version, exportedAt: new Date().toISOString(), settings: data }, null, 2));
    return r.filePath;
  });
  ipcMain.handle('settings:import', async (e) => {
    const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), {
      title: 'Importar configurações', properties: ['openFile'], filters: [{ name: 'Configurações do RecFlow', extensions: ['json'] }]
    });
    if (r.canceled || !r.filePaths[0]) return null;
    return importSettings(r.filePaths[0]);
  });

  ipcMain.handle('overlay:init', () => ({ drawing, drawOpts, keys: rec.active && settings.keysShow ? keysConfig() : null }));
  ipcMain.handle('toolbar:init', () => drawOpts);
  ipcMain.on('draw:toggle', (_e, on) => setDrawing(on === undefined || on === null ? !drawing : !!on));
  ipcMain.on('draw:tool', (_e, o) => {
    drawOpts = { ...drawOpts, ...o };
    if (alive(overlayWin)) overlayWin.webContents.send('draw:tool', drawOpts);
    if (alive(toolbarWin)) toolbarWin.webContents.send('draw:tool', drawOpts);
  });
  ipcMain.on('draw:undo', () => alive(overlayWin) && overlayWin.webContents.send('draw:undo'));
  ipcMain.on('draw:clear', () => alive(overlayWin) && overlayWin.webContents.send('draw:clear'));
}

/* ------------------------------------------------------------------ */
/* Ciclo de vida                                                        */
/* ------------------------------------------------------------------ */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const proj = projectFromArgv(argv);
    if (proj && settings) { openProject(proj); return; }
    if (mainWin) { if (mainWin.isMinimized()) mainWin.restore(); mainWin.show(); mainWin.focus(); }
  });

  app.whenReady().then(() => {
    if (process.platform === 'win32') app.setAppUserModelId('br.com.api2dev.recflow');
    settings = loadSettings();
    applyBrand();
    nativeTheme.themeSource = settings.theme || 'system';
    // gt://app/<caminho> -> arquivo dentro da pasta do aplicativo (somente leitura)
    protocol.handle('gt', (req) => {
      const u = new URL(req.url);
      const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '');
      const full = path.normalize(path.join(__dirname, rel));
      if (u.host !== 'app' || !full.startsWith(path.normalize(__dirname + path.sep))) return new Response('negado', { status: 403 });
      const types = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json', '.tflite': 'application/octet-stream' };
      return net.fetch(pathToFileURL(full).href).then((r) => new Response(r.body, {
        status: r.status,
        headers: { 'content-type': types[path.extname(full).toLowerCase()] || 'application/octet-stream', 'access-control-allow-origin': '*' }
      }));
    });
    registerIpc();
    createMainWindow();
    if (settings.manualEnabled) uiaStart();
    if (process.env.RECFLOW_TEST) global.__recflow = { manualMark, manualStatus, manualEnd, mdocs, ai, buildExport, aiTask, rec, scanRecovery };
    const proj = projectFromArgv(process.argv);
    if (proj) openProject(proj);
    syncCamWindow();
    if (systemPreferences.on) {
      systemPreferences.on('accent-color-changed', () => send('accent', accentColor()));
    }
    createTray();
    registerHotkeys();
    setInterval(checkSchedules, 5000);
  });

  app.on('before-quit', (e) => {
    app.isQuitting = true;
    if (rec.active) {
      // Finaliza o arquivo antes de sair
      e.preventDefault();
      if (!pendingQuit) { pendingQuit = true; send('rec:force-stop'); }
    }
  });
  app.on('will-quit', () => { globalShortcut.unregisterAll(); stopHook(); uiaStop(); });
  app.on('window-all-closed', () => app.quit());
}
