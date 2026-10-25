'use strict';
/*
 * Desfoque do fundo da webcam (segmentação de pessoa com MediaPipe, roda local, sem internet).
 * Uso: const b = new BackgroundBlur(); await b.init(); const canvas = b.process(video, 14);
 */
(function () {
  const BASE = 'gt://app/node_modules/@mediapipe/tasks-vision';
  const MODEL = 'gt://app/assets/selfie_segmenter.tflite';
  let shared = null; // o modelo é carregado uma vez por janela

  async function loadSegmenter() {
    if (shared) return shared;
    shared = (async () => {
      const vision = await import(`${BASE}/vision_bundle.mjs`);
      const fileset = {
        wasmLoaderPath: `${BASE}/wasm/vision_wasm_internal.js`,
        wasmBinaryPath: `${BASE}/wasm/vision_wasm_internal.wasm`
      };
      const opts = (delegate) => ({
        baseOptions: { modelAssetPath: MODEL, delegate },
        runningMode: 'VIDEO', outputCategoryMask: false, outputConfidenceMasks: true
      });
      try { return await vision.ImageSegmenter.createFromOptions(fileset, opts('GPU')); }
      catch { return vision.ImageSegmenter.createFromOptions(fileset, opts('CPU')); }
    })();
    try { return await shared; } catch (e) { shared = null; throw e; }
  }

  class BackgroundBlur {
    constructor() {
      this.seg = null;
      this.small = document.createElement('canvas');   // entrada reduzida para o modelo
      this.mask = document.createElement('canvas');    // máscara (alfa = pessoa)
      this.person = document.createElement('canvas');
      this.out = document.createElement('canvas');
      this.lastTs = 0;
      this.imageData = null;
    }
    async init() { if (!this.seg) this.seg = await loadSegmenter(); return this; }

    process(video, strength = 14) {
      const w = video.videoWidth || video.width, h = video.videoHeight || video.height;
      if (!this.seg || !w || !h) return video;
      if (this.out.width !== w || this.out.height !== h) {
        this.out.width = this.person.width = w; this.out.height = this.person.height = h;
        const sw = 256, sh = Math.max(2, Math.round(256 * h / w));
        this.small.width = this.mask.width = sw; this.small.height = this.mask.height = sh;
        this.imageData = new ImageData(sw, sh);
      }
      const sctx = this.small.getContext('2d', { willReadFrequently: false });
      sctx.drawImage(video, 0, 0, this.small.width, this.small.height);

      let ts = performance.now(); if (ts <= this.lastTs) ts = this.lastTs + 1; this.lastTs = ts;
      const res = this.seg.segmentForVideo(this.small, ts);
      const m = res && res.confidenceMasks && res.confidenceMasks[0];
      if (m) {
        const f = m.getAsFloat32Array(); const d = this.imageData.data;
        for (let i = 0; i < f.length; i++) {
          const a = Math.min(1, Math.max(0, (f[i] - 0.25) / 0.5));   // borda suave
          d[i * 4 + 3] = a * 255;
        }
        this.mask.getContext('2d').putImageData(this.imageData, 0, 0);
        res.confidenceMasks.forEach((x) => x.close());
      }

      // pessoa nítida
      const pctx = this.person.getContext('2d');
      pctx.globalCompositeOperation = 'copy';
      pctx.drawImage(video, 0, 0, w, h);
      pctx.globalCompositeOperation = 'destination-in';
      pctx.filter = 'blur(2px)';
      pctx.drawImage(this.mask, 0, 0, w, h);
      pctx.filter = 'none';
      pctx.globalCompositeOperation = 'source-over';

      // fundo desfocado + pessoa por cima
      const octx = this.out.getContext('2d');
      const r = Math.max(2, strength * (w / 640));
      octx.filter = `blur(${r}px)`;
      octx.drawImage(video, -r * 2, -r * 2, w + r * 4, h + r * 4);
      octx.filter = 'none';
      octx.drawImage(this.person, 0, 0);
      return this.out;
    }
  }
  window.BackgroundBlur = BackgroundBlur;
}());
