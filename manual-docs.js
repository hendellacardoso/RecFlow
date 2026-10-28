'use strict';
/*
 * Geração dos documentos do manual a partir do manual.json:
 * HTML (com capa, sumário e zoom nas imagens), TXT, PDF e Word (.docx).
 */
const fs = require('fs');
const path = require('path');
const { BrowserWindow, nativeImage } = require('electron');

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtTime = (t) => { t = Math.max(0, Math.floor(t || 0)); const h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = t % 60; return `${h ? `${h}:` : ''}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`; };
const hasTime = (t) => Number.isFinite(t);
const fmtDate = (iso) => { try { return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'long', timeStyle: 'short' }); } catch { return ''; } };

/* ---------------- Leitura / normalização ---------------- */
function normalize(doc, dir) {
  const d = doc || {};
  const screens = (d.screens || []).map((s, i) => ({
    n: i + 1,
    name: s.name || `Tela ${i + 1}`,
    group: s.group || '',
    file: s.file || `tela_${String(i + 1).padStart(2, '0')}.png`,
    original: s.original || path.join('originais', `tela_${String(i + 1).padStart(2, '0')}.png`),
    scale: s.scale || null,
    videoTime: Number.isFinite(s.videoTime) ? s.videoTime : null,
    marks: (s.marks || []).map((m) => ({
      num: m.num, text: m.text || '', shape: m.shape || 'ellipse', color: m.color || '#ff3b30',
      rect: m.rect || { x: 0, y: 0, w: 10, h: 10 }, fieldName: m.fieldName || '',
      videoTime: Number.isFinite(m.videoTime) ? m.videoTime : null
    }))
  }));
  return {
    app: 'recflow', version: 2,
    title: d.title || 'Manual',
    subtitle: d.subtitle || '',
    author: d.author || '',
    numbering: d.numbering || 'screen',
    startedAt: d.startedAt || new Date().toISOString(),
    updatedAt: d.updatedAt || d.startedAt || new Date().toISOString(),
    recording: d.recording || null,
    video: d.video || null,
    dir: dir || null,
    screens
  };
}
function loadManual(dir) {
  const f = path.join(dir, 'manual.json');
  const doc = normalize(JSON.parse(fs.readFileSync(f, 'utf8')), dir);
  return doc;
}
function listManuals(root) {
  if (!root || !fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(root, e.name, 'manual.json')))
    .map((e) => {
      const dir = path.join(root, e.name);
      try {
        const d = loadManual(dir);
        return {
          dir, folder: e.name, title: d.title, updatedAt: d.updatedAt,
          screens: d.screens.length, items: d.screens.reduce((t, s) => t + s.marks.length, 0)
        };
      } catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

/* ---------------- HTML ---------------- */
function buildHtml(doc, { print = false, logo = null } = {}) {
  if (!print) return buildViewHtml(doc, { logo });
  const when = fmtDate(doc.updatedAt || doc.startedAt);
  const screens = doc.screens.filter((s) => s.marks.length || print);
  let lastGroup = null;
  const toc = screens.map((s) => {
    const g = s.group && s.group !== lastGroup ? `<li class="grp">${esc(s.group)}</li>` : '';
    lastGroup = s.group || null;
    return `${g}<li${s.group ? ' class="in"' : ''}><a href="#tela-${s.n}"><span>${s.n}.</span> ${esc(s.name)}</a><em>${s.marks.length} item(ns)</em></li>`;
  }).join('');
  const sections = screens.map((s) => `
  <section class="tela" id="tela-${s.n}">
    ${s.group ? `<span class="cap">${esc(s.group)}</span>` : ''}
    <h2><span class="tn">${s.n}</span>${esc(s.name)}${doc.video && hasTime(s.videoTime) ? (print
      ? `<span class="vt">Vídeo: ${fmtTime(s.videoTime)}</span>`
      : `<button class="vt" data-t="${s.videoTime}" title="Assistir a partir deste momento">▶ Ver no vídeo · ${fmtTime(s.videoTime)}</button>`) : ''}</h2>
    <figure><img src="${esc(s.file)}" alt="${esc(s.name)}"></figure>
    <ol class="itens">${s.marks.map((m) => `
      <li><span class="n" style="background:${esc(m.color)}">${m.num}</span><div><p>${esc(m.text || '(sem descrição)').replace(/\n/g, '<br>')}</p>${m.fieldName ? `<small>${esc(m.fieldName)}</small>` : ''}</div></li>`).join('')}
    </ol>
  </section>`).join('');

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(doc.title)}</title>
<style>
  :root { --c: #e5484d; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 16px/1.6 "Segoe UI", system-ui, -apple-system, Arial, sans-serif; color: #1f2937; background: ${print ? '#fff' : '#f4f5f8'}; }
  .wrap { max-width: 1080px; margin: 0 auto; padding: ${print ? '0' : '32px 20px 60px'}; }
  .capa { background: #fff; border-radius: ${print ? '0' : '18px'}; padding: ${print ? '0' : '56px 48px'}; ${print ? '' : 'box-shadow: 0 8px 30px rgba(15,23,42,.08);'} margin-bottom: 28px; }
  .capa img.logo { max-height: 90px; max-width: 260px; margin-bottom: 28px; }
  .capa h1 { font-size: ${print ? '40px' : '36px'}; line-height: 1.15; margin: 0 0 10px; letter-spacing: -.02em; color: #111827; }
  .capa .sub { font-size: 19px; color: #4b5563; margin: 0 0 22px; }
  .capa .meta { color: #6b7280; font-size: 14px; display: flex; gap: 18px; flex-wrap: wrap; }
  .sumario { background: #fff; border-radius: 18px; padding: ${print ? '0' : '28px 36px'}; ${print ? '' : 'box-shadow: 0 8px 30px rgba(15,23,42,.06);'} margin-bottom: 32px; }
  .sumario h2 { margin: 0 0 12px; font-size: 22px; }
  .sumario ol { list-style: none; margin: 0; padding: 0; }
  .sumario li { display: flex; align-items: baseline; gap: 10px; padding: 8px 0; border-bottom: 1px dashed #e5e7eb; }
  .sumario a { color: #111827; text-decoration: none; flex: 1; }
  .sumario a:hover { color: var(--c); }
  .sumario a span { color: #9ca3af; font-variant-numeric: tabular-nums; margin-right: 4px; }
  .sumario em { color: #9ca3af; font-style: normal; font-size: 13px; }
  .sumario li.grp { font-weight: 700; border-bottom: 0; padding-top: 14px; color: #111827; }
  .sumario li.in { padding-left: 18px; }
  .cap { display: block; font-size: 12px; text-transform: uppercase; letter-spacing: .08em; color: #9ca3af; margin-bottom: 4px; }
  .tela { background: #fff; border-radius: 18px; padding: ${print ? '0' : '28px 32px 30px'}; ${print ? '' : 'box-shadow: 0 8px 30px rgba(15,23,42,.06);'} margin-bottom: 28px; }
  .tela h2 { display: flex; align-items: center; gap: 12px; font-size: 22px; margin: 0 0 16px; }
  .tn { width: 34px; height: 34px; border-radius: 10px; background: #111827; color: #fff; display: grid; place-items: center; font-size: 15px; flex: none; }
  figure { margin: 0; }
  figure img { width: 100%; border: 1px solid #e5e7eb; border-radius: 10px; display: block; ${print ? '' : 'cursor: zoom-in; transition: box-shadow .2s;'} }
  ${print ? '' : 'figure img:hover { box-shadow: 0 10px 30px rgba(0,0,0,.12); }'}
  .itens { list-style: none; padding: 0; margin: 20px 0 0; display: grid; gap: 12px; }
  .itens li { display: flex; gap: 12px; align-items: flex-start; }
  .itens p { margin: 2px 0 0; }
  .n { flex: none; width: 28px; height: 28px; border-radius: 50%; color: #fff; font-weight: 700; display: grid; place-items: center; font-size: 13.5px; box-shadow: 0 0 0 2px #fff, 0 1px 4px rgba(0,0,0,.3); -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  small { display: block; color: #9ca3af; font-size: 12.5px; }
  .tela h2 { flex-wrap: wrap; }
  .vt { margin-left: auto; font: 600 13px "Segoe UI", system-ui, sans-serif; color: #fff; background: var(--c); border: 0; border-radius: 99px; padding: 6px 12px; cursor: pointer; }
  span.vt { background: #f3f4f6; color: #4b5563; cursor: default; }
  .video { background: #fff; border-radius: 18px; padding: 24px 28px 28px; box-shadow: 0 8px 30px rgba(15,23,42,.06); margin-bottom: 28px; }
  .video.mini { position: fixed; top: auto; bottom: 16px; right: 16px; width: 360px; padding: 8px; z-index: 5; }
  .video.mini h2 { display: none; }
  .video h2 { margin: 0 0 12px; font-size: 22px; }
  .video video { width: 100%; border-radius: 10px; background: #000; display: block; max-height: 60vh; }
  .video-ref { color: #4b5563; margin: 0 0 24px; }
  footer { color: #9ca3af; font-size: 13px; text-align: center; margin-top: 30px; }
  /* zoom */
  .zoom { position: fixed; inset: 0; background: rgba(10,12,18,.92); display: none; align-items: center; justify-content: center; z-index: 10; cursor: zoom-out; padding: 20px; }
  .zoom.on { display: flex; }
  .zoom img { max-width: 100%; max-height: 100%; border-radius: 8px; box-shadow: 0 20px 60px rgba(0,0,0,.6); background: #fff; }
  .zoom.full { overflow: auto; align-items: flex-start; justify-content: flex-start; }
  .zoom.full img { max-width: none; max-height: none; cursor: zoom-out; }
  .zoom .tip { position: fixed; bottom: 14px; left: 50%; transform: translateX(-50%); color: #cbd5e1; font-size: 13px; background: rgba(0,0,0,.5); padding: 6px 12px; border-radius: 99px; }
  ${print ? `
  @page { size: A4; margin: 16mm 14mm 18mm; }
  .capa { height: 245mm; display: flex; flex-direction: column; justify-content: center; page-break-after: always; }
  .sumario { page-break-after: always; }
  .tela { page-break-before: always; }
  .tela:first-of-type { page-break-before: auto; }
  figure img { max-height: 150mm; object-fit: contain; }
  .itens li { page-break-inside: avoid; }
  footer { display: none; }` : `
  @media print { body { background: #fff; } .capa, .sumario, .tela { box-shadow: none; padding: 0; } .tela { page-break-before: always; } .zoom { display: none !important; } }`}
</style>
</head>
<body>
<div class="wrap">
  <header class="capa">
    ${logo ? `<img class="logo" src="${logo}" alt="">` : ''}
    <h1>${esc(doc.title)}</h1>
    ${doc.subtitle ? `<p class="sub">${esc(doc.subtitle)}</p>` : ''}
    <div class="meta">
      ${doc.author ? `<span>Autor: ${esc(doc.author)}</span>` : ''}
      <span>Atualizado em ${esc(when)}</span>
      <span>${screens.length} tela(s) · ${screens.reduce((t, s) => t + s.marks.length, 0)} item(ns)</span>
    </div>
  </header>
  ${doc.video ? (print
    ? `<p class="video-ref">Vídeo deste manual: <b>${esc(path.basename(doc.video))}</b> (abra o manual.html para assistir)</p>`
    : `<section class="video" id="video"><h2>Vídeo</h2><video id="mv" src="${esc(doc.video.split(path.sep).join('/'))}" controls preload="metadata"></video></section>`) : ''}
  ${screens.length > 1 ? `<nav class="sumario"><h2>Sumário</h2><ol>${toc}</ol></nav>` : ''}
  ${sections}
  <footer>Gerado pelo RecFlow</footer>
</div>
${print ? '' : `<div class="zoom" id="zoom"><img alt=""><span class="tip">Clique na imagem para ver no tamanho real · Esc fecha</span></div>
<script>
  (function () {
    var z = document.getElementById('zoom'), zi = z.querySelector('img');
    document.querySelectorAll('figure img').forEach(function (img) {
      img.addEventListener('click', function () { zi.src = img.src; z.classList.remove('full'); z.classList.add('on'); });
    });
    zi.addEventListener('click', function (e) { e.stopPropagation(); z.classList.toggle('full'); });
    z.addEventListener('click', function () { z.classList.remove('on', 'full'); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') z.classList.remove('on', 'full'); });
    // "Ver no vídeo": toca a partir do momento da tela, num player flutuante
    var mv = document.getElementById('mv'), vs = document.getElementById('video');
    document.querySelectorAll('.vt[data-t]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (!mv) return;
        vs.classList.add('mini');
        mv.currentTime = parseFloat(b.dataset.t) || 0; mv.play();
      });
    });
    if (vs) { var io = new IntersectionObserver(function (en) { if (en[0].isIntersecting) vs.classList.remove('mini'); }); var mark = document.createElement('div'); vs.parentNode.insertBefore(mark, vs); io.observe(mark); }
  })();
</script>`}
</body>
</html>`;
}


/* ---------------- HTML para leitura (com painel lateral em árvore) ---------------- */
const ICON = {
  book: '<svg viewBox="0 0 20 20"><path d="M3 4.5A1.5 1.5 0 014.5 3H9v13H4.5A1.5 1.5 0 013 14.5z" fill="#3b82f6"/><path d="M17 4.5A1.5 1.5 0 0015.5 3H11v13h4.5a1.5 1.5 0 001.5-1.5z" fill="#60a5fa"/><path d="M9 3h2v13H9z" fill="#1d4ed8"/></svg>',
  page: '<svg viewBox="0 0 20 20"><path d="M5 2h7l4 4v12H5z" fill="#fff" stroke="#94a3b8"/><path d="M12 2v4h4" fill="none" stroke="#94a3b8"/><path d="M7.5 9h6M7.5 11.5h6M7.5 14h4" stroke="#cbd5e1"/></svg>',
  video: '<svg viewBox="0 0 20 20"><rect x="2" y="4" width="16" height="12" rx="2.5" fill="#e5484d"/><path d="M8.5 7.5l4 2.5-4 2.5z" fill="#fff"/></svg>',
  manual: '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="8" fill="#3b82f6"/><path d="M10 6.2v.1M10 9v5" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>'
};
function buildViewHtml(doc, { logo = null } = {}) {
  const when = fmtDate(doc.updatedAt || doc.startedAt);
  const screens = doc.screens.filter((s) => s.marks.length);
  const short = (t, n = 52) => { const x = String(t || '(sem descrição)').replace(/\s+/g, ' ').trim(); return x.length > n ? `${x.slice(0, n - 1)}…` : x; };

  // árvore: capítulos (grupos de telas seguidas) -> telas -> itens
  const nodes = [];
  screens.forEach((s) => {
    const last = nodes[nodes.length - 1];
    if (s.group) {
      if (last && last.type === 'group' && last.name === s.group) last.screens.push(s);
      else nodes.push({ type: 'group', name: s.group, screens: [s] });
    } else nodes.push({ type: 'screen', screen: s });
  });
  const screenNode = (s) => `
      <li class="node scr" data-target="tela-${s.n}">
        <div class="row"><button class="tg" aria-label="Abrir/fechar"></button><a href="#tela-${s.n}">${ICON.page}<span class="lbl">${s.n}. ${esc(s.name)}</span></a></div>
        <ul>${s.marks.map((m) => `<li class="leaf" data-target="t${s.n}-i${m.num}"><a href="#t${s.n}-i${m.num}"><span class="dot" style="background:${esc(m.color)}">${m.num}</span><span class="lbl">${esc(short(m.text))}</span></a></li>`).join('')}</ul>
      </li>`;
  const tree = nodes.map((nd) => (nd.type === 'group' ? `
    <li class="node grp open">
      <div class="row"><button class="tg" aria-label="Abrir/fechar"></button><a href="#tela-${nd.screens[0].n}">${ICON.book}<span class="lbl">${esc(nd.name)}</span></a></div>
      <ul>${nd.screens.map(screenNode).join('')}</ul>
    </li>` : screenNode(nd.screen))).join('');

  const sections = screens.map((s) => `
    <section class="tela" id="tela-${s.n}">
      ${s.group ? `<span class="cap">${esc(s.group)}</span>` : ''}
      <h2><span class="tn">${s.n}</span><span class="tt">${esc(s.name)}</span>${doc.video && hasTime(s.videoTime) ? `<button class="vt" data-t="${s.videoTime}" title="Assistir a partir deste momento">▶ Ver no vídeo · ${fmtTime(s.videoTime)}</button>` : ''}</h2>
      <figure><img src="${esc(s.file)}" alt="${esc(s.name)}" loading="lazy"></figure>
      <ol class="itens">${s.marks.map((m) => `
        <li id="t${s.n}-i${m.num}"><span class="n" style="background:${esc(m.color)}">${m.num}</span><div><p>${esc(m.text || '(sem descrição)').replace(/\n/g, '<br>')}</p>${m.fieldName ? `<small>${esc(m.fieldName)}</small>` : ''}</div></li>`).join('')}
      </ol>
    </section>`).join('');
  const videoSrc = doc.video ? esc(doc.video.split(path.sep).join('/')) : '';

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(doc.title)}</title>
<style>
  :root { --c: #e5484d; --side: 320px; --line: #e5e7eb; --hl: #fff3a6; }
  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; scroll-padding-top: 16px; }
  body { margin: 0; font: 16px/1.6 "Segoe UI", system-ui, -apple-system, Arial, sans-serif; color: #1f2937; background: #f4f5f8; }
  /* painel lateral */
  .side { position: fixed; top: 0; left: 0; bottom: 0; width: var(--side); background: #fff; border-right: 1px solid var(--line); display: flex; flex-direction: column; z-index: 4; }
  .side-head { padding: 14px 14px 10px; border-bottom: 1px solid var(--line); background: linear-gradient(#f8fafc, #fff); }
  .side-title { display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 15px; line-height: 1.3; }
  .side-title svg { width: 20px; height: 20px; flex: none; }
  .search { margin-top: 10px; width: 100%; border: 1px solid var(--line); border-radius: 8px; padding: 7px 10px; font: 13.5px "Segoe UI", system-ui, sans-serif; outline: none; }
  .search:focus { border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59,130,246,.15); }
  .side-tools { display: flex; gap: 6px; margin-top: 8px; }
  .side-tools button { flex: 1; border: 1px solid var(--line); background: #fff; border-radius: 7px; padding: 4px 6px; font: 12px "Segoe UI", sans-serif; color: #4b5563; cursor: pointer; }
  .side-tools button:hover { background: #f3f4f6; }
  .tree { flex: 1; overflow: auto; padding: 8px 6px 20px; font-size: 13.5px; }
  .tree ul { list-style: none; margin: 0; padding: 0; }
  .tree ul ul { padding-left: 18px; display: none; }
  .tree li.open > ul { display: block; }
  .tree .row, .tree .leaf > a, .tree .top > a { display: flex; align-items: center; gap: 2px; }
  .tree a { flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px; color: #1f2937; text-decoration: none; padding: 3px 6px; border-radius: 4px; }
  .tree a:hover { background: #eef2ff; }
  .tree svg { width: 17px; height: 17px; flex: none; }
  .tree .lbl { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tree .tg { width: 16px; height: 16px; flex: none; border: 1px solid #9ca3af; border-radius: 3px; background: #fff; cursor: pointer; padding: 0; position: relative; }
  .tree .tg::before, .tree .tg::after { content: ''; position: absolute; background: #4b5563; left: 3px; right: 3px; top: 6.5px; height: 1.5px; }
  .tree .tg::after { left: 6.5px; right: auto; width: 1.5px; top: 3px; height: 8px; }
  .tree li.open > .row .tg::after { display: none; }
  .tree .top { margin-bottom: 2px; }
  .tree .top > a { padding-left: 22px; font-weight: 600; }
  .tree .leaf > a { padding-left: 22px; color: #4b5563; font-size: 13px; }
  .tree .dot { width: 17px; height: 17px; border-radius: 50%; color: #fff; font-size: 10.5px; font-weight: 700; display: grid; place-items: center; flex: none; }
  .tree .grp > .row a { font-weight: 600; }
  .tree .on > .row > a, .tree .leaf.on > a { background: var(--hl); color: #111827; }
  .tree li.hide { display: none; }
  .tree mark { background: #fde68a; color: inherit; border-radius: 2px; }
  .side-foot { padding: 8px 14px; border-top: 1px solid var(--line); font-size: 11.5px; color: #9ca3af; }
  /* conteúdo */
  main { margin-left: var(--side); padding: 28px 32px 60px; }
  .wrap { max-width: 1080px; margin: 0 auto; }
  .capa { background: #fff; border-radius: 18px; padding: 44px 44px 36px; box-shadow: 0 8px 30px rgba(15,23,42,.08); margin-bottom: 26px; }
  .capa img.logo { max-height: 80px; max-width: 240px; margin-bottom: 22px; }
  .capa h1 { font-size: 34px; line-height: 1.15; margin: 0 0 8px; letter-spacing: -.02em; color: #111827; }
  .capa .sub { font-size: 18px; color: #4b5563; margin: 0 0 18px; }
  .capa .meta { color: #6b7280; font-size: 14px; display: flex; gap: 18px; flex-wrap: wrap; }
  .tela, .video { background: #fff; border-radius: 18px; padding: 26px 30px 28px; box-shadow: 0 8px 30px rgba(15,23,42,.06); margin-bottom: 26px; }
  .cap { display: block; font-size: 12px; text-transform: uppercase; letter-spacing: .08em; color: #9ca3af; margin-bottom: 4px; }
  .tela h2, .video h2 { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; font-size: 22px; margin: 0 0 16px; }
  .tn { width: 34px; height: 34px; border-radius: 10px; background: #111827; color: #fff; display: grid; place-items: center; font-size: 15px; flex: none; }
  .vt { margin-left: auto; font: 600 13px "Segoe UI", system-ui, sans-serif; color: #fff; background: var(--c); border: 0; border-radius: 99px; padding: 6px 12px; cursor: pointer; }
  figure { margin: 0; }
  figure img { width: 100%; border: 1px solid var(--line); border-radius: 10px; display: block; cursor: zoom-in; transition: box-shadow .2s; }
  figure img:hover { box-shadow: 0 10px 30px rgba(0,0,0,.12); }
  .itens { list-style: none; padding: 0; margin: 20px 0 0; display: grid; gap: 10px; }
  .itens li { display: flex; gap: 12px; align-items: flex-start; padding: 6px 8px; margin: 0 -8px; border-radius: 10px; transition: background .4s; }
  .itens li.flash { background: var(--hl); }
  .itens p { margin: 2px 0 0; }
  .n { flex: none; width: 28px; height: 28px; border-radius: 50%; color: #fff; font-weight: 700; display: grid; place-items: center; font-size: 13.5px; box-shadow: 0 0 0 2px #fff, 0 1px 4px rgba(0,0,0,.3); }
  small { display: block; color: #9ca3af; font-size: 12.5px; }
  .video video { width: 100%; border-radius: 10px; background: #000; display: block; max-height: 62vh; }
  .video.mini { position: fixed; bottom: 16px; right: 16px; width: 380px; padding: 8px; margin: 0; z-index: 6; }
  .video.mini h2 { display: none; }
  .video .close-mini { display: none; position: absolute; top: -10px; right: -10px; width: 26px; height: 26px; border-radius: 50%; border: 0; background: #111827; color: #fff; cursor: pointer; }
  .video.mini .close-mini { display: block; }
  footer { color: #9ca3af; font-size: 13px; text-align: center; margin-top: 30px; }
  .menu-btn { display: none; position: fixed; top: 12px; left: 12px; z-index: 7; border: 0; background: #111827; color: #fff; border-radius: 10px; padding: 8px 12px; font: 600 13px "Segoe UI", sans-serif; cursor: pointer; }
  /* zoom */
  .zoom { position: fixed; inset: 0; background: rgba(10,12,18,.92); display: none; align-items: center; justify-content: center; z-index: 10; cursor: zoom-out; padding: 20px; }
  .zoom.on { display: flex; }
  .zoom img { max-width: 100%; max-height: 100%; border-radius: 8px; box-shadow: 0 20px 60px rgba(0,0,0,.6); background: #fff; }
  .zoom.full { overflow: auto; align-items: flex-start; justify-content: flex-start; }
  .zoom.full img { max-width: none; max-height: none; }
  .zoom .tip { position: fixed; bottom: 14px; left: 50%; transform: translateX(-50%); color: #cbd5e1; font-size: 13px; background: rgba(0,0,0,.5); padding: 6px 12px; border-radius: 99px; }
  @media (max-width: 900px) {
    .side { transform: translateX(-100%); transition: transform .25s; box-shadow: 0 0 40px rgba(0,0,0,.25); }
    body.side-open .side { transform: none; }
    .side-head { padding-top: 56px; }
    main { margin-left: 0; padding: 60px 14px 40px; }
    .menu-btn { display: block; }
    .capa { padding: 28px 22px; }
    .tela, .video { padding: 18px 16px; }
  }
  @media print {
    .side, .menu-btn, .zoom, .vt { display: none !important; }
    main { margin: 0; padding: 0; } body { background: #fff; }
    .capa, .tela, .video { box-shadow: none; } .tela { page-break-before: always; } .video { display: none; }
  }
</style>
</head>
<body>
<button class="menu-btn" id="menuBtn">☰ Sumário</button>
<aside class="side" id="side">
  <div class="side-head">
    <div class="side-title">${ICON.manual}<span>${esc(doc.title)}</span></div>
    <input class="search" id="search" type="search" placeholder="Pesquisar no manual…">
    <div class="side-tools"><button id="expAll">Abrir tudo</button><button id="colAll">Recolher tudo</button></div>
  </div>
  <nav class="tree" id="tree">
    <ul>
      <li class="top" data-target="capa"><a href="#capa">${ICON.manual}<span class="lbl">Início</span></a></li>
      ${doc.video ? `<li class="top" data-target="video"><a href="#video">${ICON.video}<span class="lbl">Vídeo</span></a></li>` : ''}
      ${tree}
    </ul>
  </nav>
  <div class="side-foot">${screens.length} tela(s) · ${screens.reduce((t, s) => t + s.marks.length, 0)} item(ns)</div>
</aside>
<main>
  <div class="wrap">
    <header class="capa" id="capa">
      ${logo ? `<img class="logo" src="${logo}" alt="">` : ''}
      <h1>${esc(doc.title)}</h1>
      ${doc.subtitle ? `<p class="sub">${esc(doc.subtitle)}</p>` : ''}
      <div class="meta">
        ${doc.author ? `<span>Autor: ${esc(doc.author)}</span>` : ''}
        <span>Atualizado em ${esc(when)}</span>
      </div>
    </header>
    ${doc.video ? `<section class="video" id="video"><button class="close-mini" id="closeMini" title="Fechar">✕</button><h2>Vídeo</h2><video id="mv" src="${videoSrc}" controls preload="metadata"></video></section>` : ''}
    ${sections}
    <footer>Gerado pelo RecFlow</footer>
  </div>
</main>
<div class="zoom" id="zoom"><img alt=""><span class="tip">Clique na imagem para ver no tamanho real · Esc fecha</span></div>
<script>
(function () {
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var tree = $('#tree');
  // abrir/fechar nós
  $$('.tg', tree).forEach(function (b) { b.addEventListener('click', function () { b.closest('li').classList.toggle('open'); }); });
  $('#expAll').onclick = function () { $$('.node', tree).forEach(function (n) { n.classList.add('open'); }); };
  $('#colAll').onclick = function () { $$('.node', tree).forEach(function (n) { n.classList.remove('open'); }); };
  // clique num item: destaca o item no texto
  $$('.leaf a', tree).forEach(function (a) {
    a.addEventListener('click', function () {
      var t = document.getElementById(a.getAttribute('href').slice(1));
      if (t) { t.classList.add('flash'); setTimeout(function () { t.classList.remove('flash'); }, 1600); }
      document.body.classList.remove('side-open');
    });
  });
  $$('.row a, .top a', tree).forEach(function (a) { a.addEventListener('click', function () { document.body.classList.remove('side-open'); }); });
  // destaca no painel a tela que está sendo lida
  var current = null;
  function mark(id) {
    if (id === current) return; current = id;
    $$('.on', tree).forEach(function (n) { n.classList.remove('on'); });
    var li = tree.querySelector('[data-target="' + id + '"]');
    if (!li) return;
    li.classList.add('on');
    var p = li.parentElement.closest('li'); while (p) { p.classList.add('open'); p = p.parentElement.closest('li'); }
    var r = li.getBoundingClientRect(), tr = tree.getBoundingClientRect();
    if (r.top < tr.top || r.bottom > tr.bottom) li.scrollIntoView({ block: 'nearest' });
  }
  var io = new IntersectionObserver(function (en) {
    en.forEach(function (e) { if (e.isIntersecting) mark(e.target.id); });
  }, { rootMargin: '-35% 0px -60% 0px' });
  $$('#capa, #video, .tela').forEach(function (s) { io.observe(s); });
  // pesquisa
  var orig = new Map();
  $$('.lbl', tree).forEach(function (l) { orig.set(l, l.textContent); });
  var bodyText = {};
  $$('.tela').forEach(function (s) { bodyText[s.id] = s.textContent.toLowerCase(); });
  $('#search').addEventListener('input', function (e) {
    var q = e.target.value.trim().toLowerCase();
    orig.forEach(function (txt, l) {
      if (!q) { l.textContent = txt; return; }
      var i = txt.toLowerCase().indexOf(q);
      var h = function (x) { return x.replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); };
      l.innerHTML = i < 0 ? h(txt) : h(txt.slice(0, i)) + '<mark>' + h(txt.slice(i, i + q.length)) + '</mark>' + h(txt.slice(i + q.length));
    });
    $$('.scr', tree).forEach(function (n) {
      var id = n.dataset.target; var hit = !q || (bodyText[id] || '').indexOf(q) >= 0;
      n.classList.toggle('hide', !hit);
      $$('.leaf', n).forEach(function (lf) { var t = orig.get($('.lbl', lf)) || ''; lf.classList.toggle('hide', !!q && t.toLowerCase().indexOf(q) < 0 && (n.querySelector('.row .lbl').textContent.toLowerCase().indexOf(q) < 0)); });
      if (q && hit) n.classList.add('open');
    });
    $$('.grp', tree).forEach(function (g) { var any = $$('.scr', g).some(function (n) { return !n.classList.contains('hide'); }); g.classList.toggle('hide', !any); if (q && any) g.classList.add('open'); });
  });
  // menu no celular
  var mb = $('#menuBtn');
  var setMb = function () { mb.textContent = document.body.classList.contains('side-open') ? '✕ Fechar' : '☰ Sumário'; };
  mb.onclick = function () { document.body.classList.toggle('side-open'); setMb(); };
  new MutationObserver(setMb).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  // zoom
  var z = $('#zoom'), zi = $('img', z);
  $$('figure img').forEach(function (img) { img.addEventListener('click', function () { zi.src = img.src; z.classList.remove('full'); z.classList.add('on'); }); });
  zi.addEventListener('click', function (e) { e.stopPropagation(); z.classList.toggle('full'); });
  z.addEventListener('click', function () { z.classList.remove('on', 'full'); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') z.classList.remove('on', 'full'); });
  // vídeo
  var mv = $('#mv'), vs = $('#video');
  $$('.vt[data-t]').forEach(function (b) { b.addEventListener('click', function () { if (!mv) return; vs.classList.add('mini'); mv.currentTime = parseFloat(b.dataset.t) || 0; mv.play(); }); });
  if (vs) {
    $('#closeMini').onclick = function () { mv.pause(); vs.classList.remove('mini'); };
    var spot = document.createElement('div'); vs.parentNode.insertBefore(spot, vs);
    new IntersectionObserver(function (en) { if (en[0].isIntersecting) vs.classList.remove('mini'); }).observe(spot);
  }
})();
</script>
</body>
</html>`;
}

/* ---------------- TXT ---------------- */
function buildTxt(doc) {
  const out = [doc.title];
  if (doc.subtitle) out.push(doc.subtitle);
  out.push(`Atualizado em ${fmtDate(doc.updatedAt || doc.startedAt)}`);
  if (doc.video) out.push(`Vídeo: ${path.basename(doc.video)}`);
  out.push('');
  doc.screens.filter((s) => s.marks.length).forEach((s) => {
    if (s.group) out.push(`[${s.group}]`);
    out.push(`${s.n}. ${s.name} (${s.file})${doc.video && hasTime(s.videoTime) ? ` - vídeo ${fmtTime(s.videoTime)}` : ''}`);
    s.marks.forEach((m) => out.push(`  ${m.num} - ${(m.text || '(sem descrição)').replace(/\n/g, '\r\n      ')}`));
    out.push('');
  });
  return `﻿${out.join('\r\n')}`;
}

function writeDocs(dir, doc) {
  const clean = { ...doc }; delete clean.dir;
  fs.writeFileSync(path.join(dir, 'manual.json'), JSON.stringify(clean, null, 2));
  fs.writeFileSync(path.join(dir, 'descricoes.txt'), buildTxt(doc), 'utf8');
  fs.writeFileSync(path.join(dir, 'manual.html'), buildHtml(doc));
}

/* ---------------- PDF ---------------- */
async function exportPdf(dir, doc, out, { logo = null } = {}) {
  const tmp = path.join(dir, '.impressao.html');
  fs.writeFileSync(tmp, buildHtml(doc, { print: true, logo }));
  const w = new BrowserWindow({ show: false, width: 1200, height: 1600, webPreferences: { offscreen: false } });
  try {
    await w.loadFile(tmp);
    await w.webContents.executeJavaScript(`Promise.race([Promise.all([...document.images].map((i) => { i.loading = 'eager'; return i.decode().catch(() => {}); })), new Promise((r) => setTimeout(r, 15000))])`);
    const footer = `<div style="font-size:8.5px;width:100%;padding:0 14mm;color:#9ca3af;display:flex;justify-content:space-between;font-family:Segoe UI,Arial,sans-serif">
      <span>${esc(doc.title)}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`;
    const pdf = await w.webContents.printToPDF({
      pageSize: 'A4', printBackground: true, preferCSSPageSize: true,
      displayHeaderFooter: true, headerTemplate: '<div></div>', footerTemplate: footer
    });
    fs.writeFileSync(out, pdf);
    return out;
  } finally {
    w.destroy();
    fs.rm(tmp, { force: true }, () => {});
  }
}

/* ---------------- Word (.docx) ---------------- */
async function exportDocx(dir, doc, out, { logo = null } = {}) {
  const D = require('docx');
  const {
    Document, Packer, Paragraph, TextRun, HeadingLevel, ImageRun, AlignmentType, PageBreak, Bookmark,
    InternalHyperlink, Footer, PageNumber, ShadingType
  } = D;
  const MAX_W = 600, MAX_H = 760; // área útil da página A4 (px a 96 dpi)
  const fit = (w, h) => { const k = Math.min(MAX_W / w, MAX_H / h, 1); return { width: Math.round(w * k), height: Math.round(h * k) }; };
  const children = [];

  // capa
  if (logo) {
    const img = nativeImage.createFromDataURL(logo);
    if (!img.isEmpty()) {
      const s = img.getSize(); const k = Math.min(240 / s.width, 90 / s.height, 1);
      children.push(new Paragraph({ spacing: { before: 1800, after: 400 }, children: [new ImageRun({ type: 'png', data: img.toPNG(), transformation: { width: Math.round(s.width * k), height: Math.round(s.height * k) } })] }));
    }
  }
  children.push(new Paragraph({ heading: HeadingLevel.TITLE, spacing: { before: logo ? 0 : 3000, after: 200 }, children: [new TextRun({ text: doc.title, bold: true, size: 64 })] }));
  if (doc.subtitle) children.push(new Paragraph({ spacing: { after: 400 }, children: [new TextRun({ text: doc.subtitle, size: 32, color: '4B5563' })] }));
  if (doc.author) children.push(new Paragraph({ children: [new TextRun({ text: `Autor: ${doc.author}`, color: '6B7280' })] }));
  children.push(new Paragraph({ children: [new TextRun({ text: `Atualizado em ${fmtDate(doc.updatedAt || doc.startedAt)}`, color: '6B7280' })] }));
  if (doc.video) children.push(new Paragraph({ spacing: { before: 200 }, children: [new TextRun({ text: `Vídeo: ${path.basename(doc.video)} (abra o manual.html para assistir)`, color: '6B7280' })] }));
  children.push(new Paragraph({ children: [new PageBreak()] }));

  const screens = doc.screens.filter((s) => s.marks.length);
  // sumário com links
  if (screens.length > 1) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('Sumário')] }));
    let lastG = null;
    screens.forEach((s) => {
      if (s.group && s.group !== lastG) children.push(new Paragraph({ spacing: { before: 160, after: 80 }, children: [new TextRun({ text: s.group, bold: true })] }));
      lastG = s.group || null;
      children.push(new Paragraph({
      spacing: { after: 120 }, indent: s.group ? { left: 360 } : undefined,
      children: [new InternalHyperlink({ anchor: `tela_${s.n}`, children: [new TextRun({ text: `${s.n}.  ${s.name}`, style: 'Hyperlink' })] }),
        new TextRun({ text: `   (${s.marks.length} item(ns))`, color: '9CA3AF', size: 20 })]
      }));
    });
    children.push(new Paragraph({ children: [new PageBreak()] }));
  }

  screens.forEach((s, i) => {
    if (s.group) children.push(new Paragraph({ pageBreakBefore: i > 0, spacing: { after: 0 }, children: [new TextRun({ text: s.group.toUpperCase(), color: '9CA3AF', size: 18 })] }));
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_1, pageBreakBefore: i > 0 && !s.group,
      children: [new Bookmark({ id: `tela_${s.n}`, children: [new TextRun(`${s.n}. ${s.name}`)] })]
    }));
    if (doc.video && hasTime(s.videoTime)) children.push(new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: `Momento no vídeo: ${fmtTime(s.videoTime)}`, color: '6B7280', size: 20 })] }));
    const f = path.join(dir, s.file);
    if (fs.existsSync(f)) {
      const img = nativeImage.createFromPath(f); const sz = img.getSize();
      children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 240 }, children: [new ImageRun({ type: 'png', data: fs.readFileSync(f), transformation: fit(sz.width, sz.height) })] }));
    }
    s.marks.forEach((m) => {
      const lines = (m.text || '(sem descrição)').split('\n');
      const runs = [new TextRun({ text: ` ${m.num} `, bold: true, color: 'FFFFFF', shading: { type: ShadingType.CLEAR, fill: m.color.replace('#', ''), color: 'auto' } }), new TextRun('  ')];
      lines.forEach((l, j) => runs.push(new TextRun({ text: l, break: j > 0 ? 1 : 0 })));
      children.push(new Paragraph({ spacing: { after: m.fieldName ? 0 : 160 }, children: runs }));
      if (m.fieldName) children.push(new Paragraph({ spacing: { after: 160 }, indent: { left: 420 }, children: [new TextRun({ text: m.fieldName, color: '9CA3AF', size: 18 })] }));
    });
  });

  const document = new Document({
    creator: doc.author || 'RecFlow', title: doc.title, description: doc.subtitle || '',
    styles: { default: { document: { run: { font: 'Segoe UI', size: 22 } } } },
    sections: [{
      properties: { page: { margin: { top: 1000, bottom: 1000, left: 1000, right: 1000 } } },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [new TextRun({ text: `${doc.title}   ·   `, color: '9CA3AF', size: 16 }), new TextRun({ children: [PageNumber.CURRENT], color: '9CA3AF', size: 16 })]
          })]
        })
      },
      children
    }]
  });
  fs.writeFileSync(out, await Packer.toBuffer(document));
  return out;
}

module.exports = { fmtTime, normalize, loadManual, listManuals, buildHtml, buildTxt, writeDocs, exportPdf, exportDocx };
