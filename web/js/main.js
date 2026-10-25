'use strict';
/* =====================================================================
 * RecFlow — site de apresentação
 * Ajuste aqui os links de download.
 * ===================================================================== */
const CONFIG = {
  version: '1.0.0',
  // Instalador: publique o arquivo dist/RecFlow-Setup.exe em uma Release do GitHub
  // (ou troque por outro endereço, ex.: 'download/RecFlow-Setup.exe' se hospedar junto com o site)
  downloadUrl: 'https://github.com/hendellacardoso/gravacao-video/releases/latest/download/RecFlow-Setup.exe',
  sourceUrl: 'https://github.com/hendellacardoso/gravacao-video/archive/refs/heads/main.zip',
  repoUrl: 'https://github.com/hendellacardoso/gravacao-video'
};

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const ICONS = {
  modes: '<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M8 20h8M12 16v4"/>',
  area: '<path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4"/><rect x="8" y="8" width="8" height="8" rx="1"/>',
  cam: '<rect x="3" y="7" width="13" height="10" rx="2"/><path d="M16 10.5l5-3v9l-5-3z"/>',
  audio: '<path d="M3 12h2l2-6 4 14 3-10 2 4h5"/>',
  pen: '<path d="M4 20l4-1 11-11-3-3L5 16z"/><path d="M14 6l3 3"/>',
  keys: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
  timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M9 2h6"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/>',
  bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  logo: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/>',
  wave: '<path d="M2 12c2 0 2-6 4-6s2 12 4 12 2-12 4-12 2 12 4 12 2-6 4-6"/>',
  blur: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/><path d="M2 4l2 2M22 4l-2 2" opacity=".5"/>',
  edit: '<path d="M4 4h16v12H4z"/><path d="M4 20h16M9 9l5 3-5 3z"/>',
  export: '<path d="M12 15V3M7 8l5-5 5 5"/><path d="M5 13v6a2 2 0 002 2h10a2 2 0 002-2v-6"/>',
  folder: '<path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>',
  theme: '<circle cx="12" cy="12" r="9"/><path d="M12 3v18" /><path d="M12 3a9 9 0 010 18z" fill="currentColor" stroke="none"/>'
};
const svg = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;

/* ---------------- Recursos ---------------- */
const FEATURES = [
  { i: 'modes', c: '#3b82f6', t: '4 modos de gravação', d: 'Tela inteira, área selecionada (em qualquer monitor), uma janela específica ou só a webcam.' },
  { i: 'cam', c: '#22c55e', t: 'Webcam junto com a tela', d: 'Janela flutuante em círculo ou retângulo que você arrasta e redimensiona, até no meio da gravação.' },
  { i: 'audio', c: '#f59e0b', t: 'Áudio com gráfico ao vivo', d: 'Som do sistema e microfone mixados, com volume, gráfico em tempo real e teste de 5 segundos.' },
  { i: 'wave', c: '#14b8a6', t: 'Redução de ruído forte', d: 'IA RNNoise remove ventilador, teclado e ruído de fundo do microfone.', tag: 'IA' },
  { i: 'blur', c: '#a855f7', t: 'Fundo desfocado', d: 'Desfoca o fundo da webcam sem tela verde, direto no seu computador.', tag: 'IA' },
  { i: 'pen', c: '#ef4444', t: 'Desenho na tela', d: 'Caneta, marca-texto, setas e formas por cima de qualquer programa, mais efeito nos cliques.' },
  { i: 'keys', c: '#0ea5e9', t: 'Teclas no vídeo', d: 'Mostra atalhos e o que é digitado, com modo "só atalhos" para proteger senhas.' },
  { i: 'timer', c: '#f97316', t: 'Contagem regressiva', d: '3, 5 ou 10 segundos para você se preparar antes de começar.' },
  { i: 'bolt', c: '#eab308', t: 'Atalhos globais', d: 'F12 grava, Shift+F12 pausa, F11 captura a tela. Todos configuráveis.' },
  { i: 'calendar', c: '#6366f1', t: 'Gravação agendada', d: 'Defina dia, hora e duração. O RecFlow grava sozinho, mesmo minimizado na bandeja.' },
  { i: 'logo', c: '#ec4899', t: 'Logo / marca d\'água', d: 'Coloque sua marca em todas as gravações, com posição, tamanho e opacidade.' },
  { i: 'edit', c: '#3b82f6', t: 'Editor completo', d: 'Corte, zoom animado, textos e desenhos, com linha do tempo, forma de onda e desfazer.' },
  { i: 'export', c: '#22c55e', t: 'Exporte do seu jeito', d: 'MP4 em 3 qualidades, versão leve para WhatsApp/e-mail ou GIF animado.' },
  { i: 'folder', c: '#f59e0b', t: 'Projetos salvos', d: 'Guarde a edição em um arquivo .gtproj e continue depois com um duplo clique.' },
  { i: 'theme', c: '#94a3b8', t: 'Tema claro e escuro', d: 'Segue o Windows, usa a sua cor de destaque e esconde a própria janela do vídeo.' }
];
$('#features').innerHTML = FEATURES.map((f) => `
  <article class="feature reveal" style="--c:${f.c}">
    <div class="ic">${svg(f.i)}</div>
    <h3>${f.t}${f.tag ? `<span class="tag">${f.tag}</span>` : ''}</h3>
    <p>${f.d}</p>
  </article>`).join('');

/* ---------------- Galeria ---------------- */
const SHOTS = [
  { id: 'inicio-gravando', cat: 'gravacao', t: 'Gravando a tela', d: 'Escolha do monitor, pré-visualização ao vivo, tempo, tamanho e nível do áudio.' },
  { id: 'selecao-area', cat: 'gravacao', t: 'Seleção de área', d: 'Arraste para marcar a região, com o tamanho exato em pixels e medidas prontas.' },
  { id: 'desenho-teclas-video', cat: 'gravacao', t: 'Desenho e teclas no vídeo', d: 'Setas, círculos, marca-texto, efeito de clique e atalhos aparecendo na gravação.' },
  { id: 'contagem', cat: 'gravacao', t: 'Contagem regressiva', d: 'Aparece antes de começar e não entra no vídeo.' },
  { id: 'editor', cat: 'editor', t: 'Editor: texto e desenho', d: 'Linha do tempo com miniaturas, forma de onda, cortes, zoom e anotações.' },
  { id: 'editor-zoom', cat: 'editor', t: 'Editor: zoom em área', d: 'Escolha a área com o retângulo; a entrada e a saída do zoom são suaves.' },
  { id: 'editor-exportar', cat: 'editor', t: 'Editor: exportação', d: 'MP4, WhatsApp/e-mail ou GIF, com barra de progresso.' },
  { id: 'editor-claro', cat: 'editor', t: 'Editor no tema claro', d: 'Segue o tema e a cor de destaque do Windows.' },
  { id: 'audio', cat: 'config', t: 'Áudio', d: 'Gráfico ao vivo do som do sistema e do microfone, redução de ruído e teste de 5 segundos.' },
  { id: 'webcam', cat: 'config', t: 'Webcam', d: 'Câmera, formato, tamanho, espelhamento, fundo desfocado e posições rápidas.' },
  { id: 'video-logo', cat: 'config', t: 'Vídeo, contagem e logo', d: 'Contagem regressiva, marca d\'água, tema e pasta de saída.' },
  { id: 'desenho-teclas', cat: 'config', t: 'Desenho e teclas', d: 'Efeitos de clique e exibição das teclas: posição, tamanho, tempo e modo "só atalhos".' },
  { id: 'atalhos', cat: 'config', t: 'Atalhos', d: 'Clique e pressione a nova combinação para trocar qualquer atalho.' },
  { id: 'agendamento', cat: 'config', t: 'Agendamento', d: 'Grave em um horário marcado, com duração definida.' },
  { id: 'arquivos', cat: 'config', t: 'Arquivos', d: 'Vídeos, imagens, GIFs e projetos, com editar, abrir e mostrar na pasta.' },
  { id: 'inicio-claro', cat: 'config', t: 'Tema claro', d: 'Toda a interface também no tema claro.' },
  { id: 'audio-claro', cat: 'config', t: 'Áudio no tema claro', d: 'Gráficos ao vivo também no tema claro.' },
  { id: 'sobre', cat: 'config', t: 'Sobre', d: 'Versão e contato do desenvolvedor.' }
];
const CATS = [['todos', 'Todas'], ['gravacao', 'Gravação'], ['editor', 'Editor'], ['config', 'Configurações']];
let galleryFilter = 'todos';
let visibleShots = SHOTS;

function renderTabs() {
  $('#galleryTabs').innerHTML = CATS.map(([k, l]) =>
    `<button role="tab" data-cat="${k}" aria-selected="${k === galleryFilter}" class="${k === galleryFilter ? 'on' : ''}">${l}</button>`).join('');
  $$('#galleryTabs button').forEach((b) => { b.onclick = () => { galleryFilter = b.dataset.cat; renderTabs(); renderGallery(); }; });
}
function renderGallery() {
  visibleShots = galleryFilter === 'todos' ? SHOTS : SHOTS.filter((s) => s.cat === galleryFilter);
  $('#gallery').innerHTML = visibleShots.map((s, i) => `
    <figure class="shot" tabindex="0" data-i="${i}" style="animation-delay:${i * 35}ms">
      <img src="img/${s.id}-thumb.webp" alt="${s.t}" loading="lazy" width="640" height="400">
      <figcaption><b>${s.t}</b><span>${s.d}</span></figcaption>
    </figure>`).join('');
  $$('#gallery .shot').forEach((el) => {
    const open = () => openLightbox(visibleShots, Number(el.dataset.i));
    el.onclick = open;
    el.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } };
  });
}
renderTabs(); renderGallery();

/* ---------------- Lightbox ---------------- */
const lb = $('#lightbox');
let lbList = [], lbIndex = 0, lastFocus = null;
function openLightbox(list, index) {
  lbList = list; lbIndex = index; lastFocus = document.activeElement;
  lb.hidden = false; document.body.style.overflow = 'hidden';
  showLb(); $('#lbClose').focus();
}
function showLb() {
  const s = lbList[lbIndex];
  const img = $('#lbImg');
  img.style.opacity = '0';
  img.onload = () => { img.style.transition = 'opacity .2s'; img.style.opacity = '1'; };
  img.src = `img/${s.id}.webp`; img.alt = s.t;
  $('#lbTitle').textContent = s.t; $('#lbText').textContent = s.d;
  $('#lbCount').textContent = lbList.length > 1 ? `${lbIndex + 1} de ${lbList.length}` : '';
  $('#lbPrev').hidden = $('#lbNext').hidden = lbList.length < 2;
  // pré-carrega as vizinhas
  [lbIndex + 1, lbIndex - 1].forEach((j) => { const n = lbList[(j + lbList.length) % lbList.length]; if (n) new Image().src = `img/${n.id}.webp`; });
}
function stepLb(d) { lbIndex = (lbIndex + d + lbList.length) % lbList.length; showLb(); }
function closeLb() { lb.hidden = true; document.body.style.overflow = ''; if (lastFocus) lastFocus.focus(); }
$('#lbClose').onclick = closeLb;
$('#lbPrev').onclick = () => stepLb(-1);
$('#lbNext').onclick = () => stepLb(1);
lb.addEventListener('click', (e) => { if (e.target === lb) closeLb(); });
document.addEventListener('keydown', (e) => {
  if (lb.hidden) return;
  if (e.key === 'Escape') closeLb();
  else if (e.key === 'ArrowLeft') stepLb(-1);
  else if (e.key === 'ArrowRight') stepLb(1);
});
let touchX = null;
lb.addEventListener('touchstart', (e) => { touchX = e.touches[0].clientX; }, { passive: true });
lb.addEventListener('touchend', (e) => {
  if (touchX === null) return;
  const dx = e.changedTouches[0].clientX - touchX; touchX = null;
  if (Math.abs(dx) > 50) stepLb(dx < 0 ? 1 : -1);
});
// imagens avulsas da página (hero, editor, destaques)
document.addEventListener('click', (e) => {
  const f = e.target.closest('[data-open]');
  if (!f) return;
  const i = SHOTS.findIndex((s) => s.id === f.dataset.open);
  if (i >= 0) openLightbox(SHOTS, i);
});

/* ---------------- Exemplos do editor ---------------- */
$$('.switcher button').forEach((b) => {
  b.onclick = () => {
    $$('.switcher button').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-selected', String(x === b)); });
    const img = $('#editorImg');
    img.style.opacity = '0';
    setTimeout(() => { img.src = `img/${b.dataset.swap}.webp`; img.onload = () => { img.style.opacity = '1'; }; }, 150);
    $('#editorFrame').dataset.open = b.dataset.swap;
  };
});

/* ---------------- FAQ ---------------- */
const FAQ = [
  ['Funciona em quais versões do Windows?', 'Windows 10 (versão 2004 ou mais recente) e Windows 11, 64 bits. É nessas versões que a janela do RecFlow fica oculta no vídeo.'],
  ['Precisa de internet?', 'Não. A gravação, a edição, a redução de ruído e o desfoque do fundo rodam no seu computador. Nada é enviado para a nuvem.'],
  ['Consigo gravar o som do computador e o microfone juntos?', 'Sim. Ative os dois na aba Áudio, ajuste o volume de cada um e use o teste de 5 segundos para ouvir como ficou.'],
  ['Onde ficam os vídeos?', 'Por padrão, em Vídeos\\RecFlow. Você pode trocar a pasta na aba Vídeo e ver tudo na aba Arquivos.'],
  ['Posso continuar uma edição depois?', 'Sim. No editor, use Salvar projeto (Ctrl+S). O arquivo .gtproj abre com duplo clique quando o RecFlow está instalado.'],
  ['Como mostro as teclas sem expor senhas?', 'Na aba Desenho e teclas, ative "Mostrar só atalhos". Assim só aparecem combinações com Ctrl, Alt ou Win, nunca o texto digitado.'],
  ['O Windows mostrou um aviso ao instalar. É normal?', 'Sim. O SmartScreen avisa sobre programas novos sem assinatura digital. Clique em "Mais informações" e depois em "Executar assim mesmo".']
];
$('#faqList').innerHTML = FAQ.map(([q, a], i) => `<details class="reveal"${i === 0 ? ' open' : ''}><summary>${q}</summary><p>${a}</p></details>`).join('');

/* ---------------- Download ---------------- */
$$('[data-version]').forEach((el) => { el.textContent = CONFIG.version; });
$$('[data-download]').forEach((a) => {
  if (a.id === 'dlMain') a.href = CONFIG.downloadUrl;
});
$('#dlSource').href = CONFIG.sourceUrl;
$('#dlRepo').href = CONFIG.repoUrl;
$('#dlRepo').target = '_blank'; $('#dlRepo').rel = 'noopener';

/* ---------------- Tema ---------------- */
const root = document.documentElement;
function storedTheme() { try { return localStorage.getItem('recflow-theme'); } catch { return null; } }
function setTheme(t, save) {
  root.dataset.theme = t;
  $('meta[name="theme-color"]').content = t === 'light' ? '#f6f7fb' : '#0b0f1a';
  if (save) { try { localStorage.setItem('recflow-theme', t); } catch { /* sem armazenamento */ } }
}
setTheme(storedTheme() || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'));
$('#themeToggle').onclick = () => setTheme(root.dataset.theme === 'light' ? 'dark' : 'light', true);

/* ---------------- Menu, cabeçalho e navegação ---------------- */
const nav = $('#nav'), menuBtn = $('#menuBtn');
menuBtn.onclick = () => {
  const open = !nav.classList.contains('open');
  nav.classList.toggle('open', open); menuBtn.setAttribute('aria-expanded', String(open));
};
$$('#nav a').forEach((a) => { a.onclick = () => { nav.classList.remove('open'); menuBtn.setAttribute('aria-expanded', 'false'); }; });
const header = $('.header');
const onScroll = () => header.classList.toggle('scrolled', scrollY > 8);
addEventListener('scroll', onScroll, { passive: true }); onScroll();

// destaca no menu a seção visível
const links = new Map($$('#nav a').map((a) => [a.getAttribute('href').slice(1), a]));
const spy = new IntersectionObserver((entries) => {
  entries.forEach((en) => {
    if (en.isIntersecting && en.target.id === 'inicio') links.forEach((l) => l.classList.remove('active'));
    if (en.isIntersecting && links.has(en.target.id)) {
      links.forEach((a) => a.classList.remove('active'));
      links.get(en.target.id).classList.add('active');
    }
  });
}, { rootMargin: '-45% 0px -50% 0px' });
links.forEach((_, id) => { const s = document.getElementById(id); if (s) spy.observe(s); });
spy.observe(document.getElementById('inicio'));

// animação ao aparecer
const rv = new IntersectionObserver((entries) => {
  entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('in'); rv.unobserve(en.target); } });
}, { threshold: 0.12 });
$$('.reveal').forEach((el) => rv.observe(el));

$('#year').textContent = String(new Date().getFullYear());
