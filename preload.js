'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (ch, ...a) => ipcRenderer.invoke(ch, ...a);
const send = (ch, ...a) => ipcRenderer.send(ch, ...a);

contextBridge.exposeInMainWorld('api', {
  // configurações
  getSettings: () => invoke('settings:get'),
  openExternal: (url) => invoke('app:openExternal', url),
  setSettings: (patch) => invoke('settings:set', patch),

  // fontes de captura
  listSources: () => invoke('sources:list'),
  captureTarget: () => invoke('capture:target'),
  selectRegion: () => invoke('region:select'),
  regionResult: (r) => send('region:result', r),
  regionStart: () => send('region:start'),

  // gravação
  recBegin: (opts) => invoke('rec:begin', opts),
  recChunk: (buf) => invoke('rec:chunk', buf),
  recEnd: () => invoke('rec:end'),
  recPaused: (p) => send('rec:paused', p),

  // captura de imagem
  screenshot: () => invoke('screenshot:take'),
  frameResponse: (id, dataUrl) => send('frame:response', id, dataUrl),

  // arquivos
  listFiles: () => invoke('files:list'),
  openFile: (p) => invoke('files:open', p),
  showFile: (p) => invoke('files:show', p),
  deleteFile: (p) => invoke('files:delete', p),
  openFolder: () => invoke('folder:open'),
  chooseFolder: () => invoke('folder:choose'),

  // desenho
  drawToggle: (on) => send('draw:toggle', on),
  drawTool: (opts) => send('draw:tool', opts),
  drawUndo: () => send('draw:undo'),
  drawClear: () => send('draw:clear'),
  overlayInit: () => invoke('overlay:init'),
  toolbarInit: () => invoke('toolbar:init'),

  // webcam flutuante
  camInit: () => invoke('cam:init'),
  camDragStart: (type) => send('cam:drag-start', type),
  camDrag: () => send('cam:drag'),
  camDragEnd: () => send('cam:drag-end'),
  camWheel: (dir) => send('cam:wheel', dir),
  camPlace: (corner) => send('cam:place', corner),
  camHide: () => send('cam:hide'),

  // editor
  openEditor: (file) => invoke('editor:open', file),
  editorInfo: (file) => invoke('editor:info', file),
  editorThumbs: (file, duration, count) => invoke('editor:thumbs', file, duration, count),
  editorWaveform: (file, points) => invoke('editor:waveform', file, points),
  editorSaveDialog: (defaultPath, kind) => invoke('editor:saveDialog', defaultPath, kind),
  editorExport: (spec) => invoke('editor:export', spec),
  editorCancel: () => send('editor:cancel'),
  editorShowFile: (p) => invoke('editor:showFile', p),
  editorOpenFile: (p) => invoke('editor:openFile', p),

  // projetos (.gtproj)
  projectLoad: (p) => invoke('project:load', p),
  projectSave: (p, data) => invoke('project:save', p, data),
  projectOpen: (p) => invoke('project:open', p),

  // contagem regressiva e marca d'água
  countdown: (s) => invoke('countdown:run', s),
  countdownCancel: () => send('countdown:cancel'),
  wmChoose: () => invoke('wm:choose'),
  wmRead: () => invoke('wm:read'),

  // modo manual
  manualInit: () => invoke('manual:init'),
  manualSave: (data) => invoke('manual:save', data),
  manualClose: () => send('manual:close'),
  manualStatus: () => invoke('manual:status'),
  manualEnd: () => invoke('manual:end'),
  manualOpenFolder: (which) => invoke('manual:openFolder', which),
  manualOpenHtml: () => invoke('manual:openHtml'),
  manualChooseDir: () => invoke('manual:chooseDir'),
  manualSetTitle: (t) => invoke('manual:setTitle', t),
  // manuais salvos e editor de manual
  mdocList: () => invoke('mdoc:list'),
  mdocEdit: (dir) => invoke('mdoc:edit', dir),
  mdocOpenOther: () => invoke('mdoc:openOther'),
  mdocLoad: (dir) => invoke('mdoc:load', dir),
  mdocSave: (dir, doc, pngs, originals) => invoke('mdoc:save', dir, doc, pngs, originals),
  mdocPickImage: () => invoke('mdoc:pickImage'),
  mdocPickVideo: (dir) => invoke('mdoc:pickVideo', dir),
  mdocExport: (dir, kind, opts) => invoke('mdoc:export', dir, kind, opts),
  mdocOpenHtml: (dir) => invoke('mdoc:openHtml', dir),
  mdocOpenFolder: (dir) => invoke('mdoc:openFolder', dir),
  mdocOpenFile: (f) => invoke('mdoc:openFile', f),
  mdocHasLogo: () => invoke('mdoc:hasLogo'),

  // eventos vindos do processo principal
  on: (channel, fn) => {
    const h = (_e, ...args) => fn(...args);
    ipcRenderer.on(channel, h);
    return () => ipcRenderer.removeListener(channel, h);
  }
});
