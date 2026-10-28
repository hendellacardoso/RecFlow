'use strict';
/*
 * Gravação pelo FFmpeg com codificação na placa de vídeo (NVENC, Quick Sync, AMF)
 * ou no processador (x264). O vídeo vai em segmentos .mkv (resistentes a quedas);
 * a pausa encerra o segmento atual e a retomada abre outro. No fim, os segmentos
 * são juntados (sem recodificar) com o áudio gravado pela interface.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const HW = [
  { id: 'h264_nvenc', label: 'NVIDIA (NVENC)' },
  { id: 'h264_qsv', label: 'Intel (Quick Sync)' },
  { id: 'h264_amf', label: 'AMD (AMF)' }
];
const CPU = { id: 'libx264', label: 'Processador (x264)' };

function tryEncoder(ffmpeg, id) {
  return new Promise((resolve) => {
    let done = false;
    const p = spawn(ffmpeg, ['-hide_banner', '-nostdin', '-f', 'lavfi', '-i', 'color=c=black:s=640x360:r=30', '-frames:v', '8',
      '-vf', 'format=nv12', '-c:v', id, '-f', 'null', '-'], { windowsHide: true });
    const t = setTimeout(() => { if (!done) { done = true; try { p.kill(); } catch { /* ignora */ } resolve(false); } }, 15000);
    p.on('error', () => { if (!done) { done = true; clearTimeout(t); resolve(false); } });
    p.on('close', (code) => { if (!done) { done = true; clearTimeout(t); resolve(code === 0); } });
  });
}
// Lista os codificadores que realmente funcionam neste computador
async function detect(ffmpeg) {
  const out = [CPU];
  for (const e of HW) if (await tryEncoder(ffmpeg, e.id)) out.push(e);
  return out;
}

function encoderArgs(enc, fps, mbps) {
  const b = `${mbps}M`, max = `${Math.round(mbps * 1.5)}M`, buf = `${mbps * 2}M`, g = String(Math.round(fps * 2));
  switch (enc) {
    case 'h264_nvenc': return ['-c:v', 'h264_nvenc', '-preset', 'p4', '-tune', 'll', '-rc', 'vbr', '-b:v', b, '-maxrate', max, '-bufsize', buf, '-g', g];
    case 'h264_qsv': return ['-c:v', 'h264_qsv', '-preset', 'veryfast', '-b:v', b, '-maxrate', max, '-g', g];
    case 'h264_amf': return ['-c:v', 'h264_amf', '-usage', 'lowlatency', '-quality', 'speed', '-rc', 'vbr_peak', '-b:v', b, '-maxrate', max, '-g', g];
    default: return ['-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-b:v', b, '-maxrate', max, '-bufsize', buf, '-g', g];
  }
}

// Entrada de captura conforme o sistema. rect em pixels físicos (área virtual da tela)
function inputArgs({ grabber, rect, local, outputIdx, fps }) {
  const { x, y, w, h } = rect;
  if (process.platform === 'win32') {
    if (grabber === 'ddagrab') {
      return {
        args: ['-f', 'lavfi', '-i', `ddagrab=output_idx=${outputIdx || 0}:framerate=${fps}:draw_mouse=1:offset_x=${local.x}:offset_y=${local.y}:video_size=${w}x${h}`],
        pre: 'hwdownload,format=bgra'
      };
    }
    return {
      args: ['-f', 'gdigrab', '-framerate', String(fps), '-draw_mouse', '1', '-offset_x', String(x), '-offset_y', String(y), '-video_size', `${w}x${h}`, '-i', 'desktop'],
      pre: ''
    };
  }
  if (process.platform === 'darwin') throw new Error('A gravação pelo FFmpeg está disponível apenas no Windows.');
  return {
    args: ['-f', 'x11grab', '-framerate', String(fps), '-draw_mouse', '1', '-video_size', `${w}x${h}`, '-i', `${process.env.DISPLAY || ':0'}+${x},${y}`],
    pre: ''
  };
}

class Capture {
  /**
   * opts: { ffmpeg, dir, base, input: {args, pre}, encoder, fps, mbps, wm: {file, width, x, y, opacity} | null }
   */
  constructor(opts) {
    this.o = opts;
    this.segments = [];
    this.proc = null;
    this.lastError = '';
  }
  args(file) {
    const { input, encoder, fps, mbps, wm } = this.o;
    const pix = encoder === 'libx264' ? 'yuv420p' : 'nv12';
    const a = ['-hide_banner', '-y', '-stats_period', '0.05', '-thread_queue_size', '512', ...input.args];
    let filter;
    if (wm) {
      a.push('-loop', '1', '-i', wm.file);
      filter = ['-filter_complex',
        `[0:v]${input.pre ? `${input.pre},` : ''}null[b];[1:v]scale=${wm.width}:-2,format=rgba,colorchannelmixer=aa=${(wm.opacity / 100).toFixed(2)}[w];` +
        `[b][w]overlay=${wm.x}:${wm.y}:format=auto,format=${pix}[v]`, '-map', '[v]'];
    } else {
      filter = ['-vf', `${input.pre ? `${input.pre},` : ''}format=${pix}`];
    }
    return [...a, ...filter, ...encoderArgs(encoder, fps, mbps), '-r', String(fps), '-an', '-f', 'matroska', file];
  }
  // abre um segmento e espera o primeiro quadro
  startSegment() {
    return new Promise((resolve, reject) => {
      const file = path.join(this.o.dir, `${this.o.base}.seg${String(this.segments.length + 1).padStart(3, '0')}.mkv`);
      const p = spawn(this.o.ffmpeg, this.args(file), { windowsHide: true });
      this.proc = p;
      let err = '', started = false;
      const t = setTimeout(() => { if (!started) { started = true; try { p.kill(); } catch { /* ignora */ } reject(new Error('O FFmpeg não começou a gravar (tempo esgotado).')); } }, 20000);
      p.stderr.on('data', (d) => {
        const s = d.toString(); err = (err + s).slice(-6000);
        if (!started && /frame=\s*\d+/.test(s)) { started = true; clearTimeout(t); this.segments.push(file); resolve(file); }
      });
      p.on('error', (e) => { if (!started) { started = true; clearTimeout(t); reject(e); } });
      p.on('close', (code) => {
        this.lastError = err;
        if (this.proc === p) this.proc = null;
        if (!started) {
          started = true; clearTimeout(t);
          reject(new Error(err.trim().split('\n').slice(-3).join('\n') || `FFmpeg terminou (${code}).`));
        } else if (this.onExit && !p.__stopping) this.onExit(code, err);
      });
    });
  }
  stopSegment() {
    return new Promise((resolve) => {
      const p = this.proc;
      if (!p) return resolve();
      p.__stopping = true;
      const t = setTimeout(() => { try { p.kill(); } catch { /* ignora */ } }, 8000);
      p.once('close', () => { clearTimeout(t); resolve(); });
      try { p.stdin.write('q'); p.stdin.end(); } catch { try { p.kill(); } catch { /* ignora */ } }
    });
  }
  bytes() {
    return this.segments.reduce((t, f) => { try { return t + fs.statSync(f).size; } catch { return t; } }, 0);
  }
}

// Junta os segmentos de vídeo (sem recodificar) e o áudio num MP4
function muxArgs({ segments, audio, out, listFile }) {
  const segs = segments.filter((f) => { try { return fs.statSync(f).size > 0; } catch { return false; } });
  if (!segs.length) throw new Error('Nenhum vídeo foi gravado.');
  fs.writeFileSync(listFile, `${segs.map((f) => `file '${f.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n')}\n`);
  const hasAudio = audio && fs.existsSync(audio) && fs.statSync(audio).size > 0;
  return [
    '-fflags', '+genpts', '-f', 'concat', '-safe', '0', '-i', listFile,
    ...(hasAudio ? ['-i', audio] : []),
    '-map', '0:v', ...(hasAudio ? ['-map', '1:a', '-c:a', 'aac', '-b:a', '192k'] : []),
    '-c:v', 'copy', '-movflags', '+faststart', out
  ];
}

module.exports = { detect, inputArgs, Capture, muxArgs, CPU, HW };
