'use strict';
/* =====================================================================
 * RecFlow — site de apresentação
 * ===================================================================== */
const CONFIG = { version: '1.0.0' };

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
  ['Consigo gravar só uma parte da tela?', 'Sim. No modo Área, arraste um retângulo em qualquer monitor. Há tamanhos prontos (1920×1080, 1280×720, vertical 1080×1920) e uma borda vermelha mostra o que está sendo gravado.'],
  ['Tenho dois monitores. Funciona?', 'Funciona. Escolha o monitor no modo Tela inteira, ou selecione a área no monitor que quiser: a seleção abre em todas as telas ao mesmo tempo.'],
  ['A janela do RecFlow aparece no vídeo?', 'Não, com a opção "Ocultar a janela do gravador no vídeo" ligada (padrão). A barra de desenho, a borda da área e a contagem também ficam de fora.'],
  ['Os desenhos aparecem quando gravo uma janela?', 'Não. No modo Janela é gravado só o conteúdo daquela janela. Desenho, teclas e efeitos de clique aparecem nos modos Tela inteira e Área.'],
  ['Existe limite de duração?', 'Não há limite definido pelo programa: o vídeo vai sendo salvo no disco enquanto você grava, então o limite é o espaço livre. Na qualidade Média, cada minuto ocupa cerca de 60 MB.'],
  ['O que acontece se eu fechar a janela durante a gravação?', 'O RecFlow continua gravando na bandeja do sistema. Pelo ícone da bandeja você para, pausa ou captura imagens.'],
  ['A gravação agendada funciona com o computador desligado?', 'Não. O RecFlow precisa estar aberto (pode estar minimizado na bandeja) no horário marcado.'],
  ['Qual formato devo usar para enviar pelo WhatsApp?', 'No editor, escolha "WhatsApp / e-mail". O vídeo sai em até 720p e com cerca de 15 MB no total, tamanho aceito pela maioria dos aplicativos e e-mails.']
];
$('#faqList').innerHTML = FAQ.map(([q, a], i) => `<details class="reveal"${i === 0 ? ' open' : ''}><summary>${q}</summary><p>${a}</p></details>`).join('');

$$('[data-version]').forEach((el) => { el.textContent = CONFIG.version; });

/* ---------------- Guia de uso ---------------- */
const GUIDE = [
  { id: 'gravar', t: 'Gravar a tela', img: 'inicio-gravando',
    intro: 'Escolha o que gravar na barra de cima e aperte REC (ou F12).',
    steps: [
      '<b>Tela inteira:</b> clique no monitor que deve ser gravado.',
      '<b>Área:</b> arraste um retângulo em qualquer monitor; Enter confirma e Esc cancela.',
      '<b>Janela:</b> escolha a janela na lista. A gravação acompanha a janela mesmo se ela for movida.',
      '<b>Webcam:</b> grava só a câmera, com o microfone se estiver ativado.',
      'Durante a gravação, o tempo, o tamanho do arquivo e o nível do áudio aparecem no topo. Shift+F12 pausa.'
    ],
    tip: 'Fechar a janela não interrompe a gravação: o RecFlow continua na bandeja do sistema.' },
  { id: 'audio', t: 'Áudio', img: 'audio',
    intro: 'Grave o som do computador e o microfone juntos, cada um com seu volume.',
    steps: [
      'Na aba <b>Áudio</b>, ative <b>Som do sistema</b> e/ou <b>Microfone</b>.',
      'Os gráficos mostram o sinal em tempo real. "Saturando!" em vermelho indica volume alto demais.',
      'Escolha a <b>redução de ruído</b>: Padrão, ou Forte para ventilador, teclado e ruído de fundo.',
      'Clique em <b>Gravar 5 s</b> para gravar um trecho de teste e ouvir como ficou.'
    ],
    tip: 'Durante a gravação, você ainda pode ajustar o volume de cada fonte.' },
  { id: 'webcam', t: 'Webcam', img: 'webcam',
    intro: 'A webcam aparece numa janela flutuante e sai no vídeo exatamente onde estiver.',
    steps: [
      'Ative pela aba <b>Webcam</b>, pelo botão de câmera no topo ou com <b>Ctrl+Shift+W</b>.',
      '<b>Arraste</b> para mudar de lugar; use a <b>roda do mouse</b> ou o canto inferior para mudar o tamanho.',
      'Escolha círculo ou retângulo, espelhe a imagem e use os botões de <b>posição rápida</b>.',
      'Marque <b>Desfocar o fundo</b> para esconder o ambiente sem tela verde.'
    ],
    tip: 'No modo Área, se a webcam estiver fora da área, ela vai sozinha para o canto ao começar a gravar.' },
  { id: 'desenho', t: 'Desenho e teclas', img: 'desenho-teclas-video',
    intro: 'Explique enquanto grava, desenhando por cima de qualquer programa.',
    steps: [
      'Aperte <b>Ctrl+Shift+D</b> para abrir as ferramentas de desenho.',
      'Use caneta, marca-texto, linha, seta, retângulo, elipse ou borracha, com cores e espessuras.',
      '<b>Ctrl+Z</b> desfaz o último traço, <b>Ctrl+Shift+X</b> limpa tudo e <b>Esc</b> sai do modo desenho.',
      'Na aba <b>Desenho e teclas</b>, ative os efeitos de clique e a exibição das teclas pressionadas.'
    ],
    tip: 'Ao digitar senhas, ative "Mostrar só atalhos": aparecem apenas combinações com Ctrl, Alt ou Win.' },
  { id: 'editor', t: 'Editar o vídeo', img: 'editor',
    intro: 'Ao parar a gravação, o editor abre com o vídeo (ou use Editar na aba Arquivos).',
    steps: [
      '<b>Cortar:</b> I e O marcam início e fim; X remove um trecho a partir do ponto atual.',
      '<b>Zoom:</b> com a ferramenta Zoom (Z), arraste um retângulo sobre a área a ampliar.',
      '<b>Texto:</b> com a ferramenta Texto (T), clique no vídeo e escreva; arraste para posicionar.',
      '<b>Desenho:</b> com a ferramenta Desenho (D), risque setas e formas sobre o vídeo.',
      'Cada item vira um bloco na linha do tempo: arraste para mover e estique pelas bordas para mudar a duração.'
    ],
    tip: 'A linha do tempo mostra miniaturas e a forma de onda do áudio, e pode ser aproximada para ajustes finos.' },
  { id: 'exportar', t: 'Exportar e projetos', img: 'editor-exportar',
    intro: 'Escolha o formato ao lado do botão Exportar e acompanhe o progresso.',
    steps: [
      '<b>MP4</b> em alta qualidade, normal ou arquivo menor.',
      '<b>WhatsApp / e-mail:</b> até 720p e cerca de 15 MB no total.',
      '<b>GIF animado:</b> ideal para trechos curtos em documentação e chats.',
      '<b>Salvar projeto (Ctrl+S)</b> guarda cortes, zooms, textos e desenhos num arquivo .gtproj para continuar depois.'
    ],
    tip: 'O vídeo original nunca é alterado: a exportação sempre cria um arquivo novo.' },
  { id: 'extras', t: 'Logo, contagem e agenda', img: 'video-logo',
    intro: 'Recursos para deixar as gravações com cara profissional.',
    steps: [
      '<b>Contagem regressiva</b> de 3, 5 ou 10 segundos antes de começar (aba Vídeo).',
      '<b>Logo / marca d\'água</b> em todas as gravações, com posição, tamanho e opacidade.',
      '<b>Gravação agendada</b> com data, hora e duração (aba Agendamento).',
      '<b>Tema</b> claro, escuro ou igual ao Windows, usando a sua cor de destaque.'
    ],
    tip: 'Gravações agendadas começam sem contagem, no horário exato.' }
];
let guideIdx = 0;
function renderGuide() {
  $('#guideNav').innerHTML = GUIDE.map((g, i) =>
    `<button role="tab" aria-selected="${i === guideIdx}" class="${i === guideIdx ? 'on' : ''}" data-g="${i}"><span>${String(i + 1).padStart(2, '0')}</span>${g.t}</button>`).join('');
  $$('#guideNav button').forEach((b) => { b.onclick = () => { guideIdx = Number(b.dataset.g); renderGuide(); }; });
  const g = GUIDE[guideIdx];
  $('#guideBody').innerHTML = `
    <div class="guide-text">
      <h3>${g.t}</h3>
      <p class="guide-intro">${g.intro}</p>
      <ol class="guide-steps">${g.steps.map((x) => `<li>${x}</li>`).join('')}</ol>
      <p class="guide-tip"><b>Dica:</b> ${g.tip}</p>
    </div>
    <figure class="frame" data-open="${g.img}"><img src="img/${g.img}.webp" alt="${g.t}" loading="lazy"></figure>`;
}
renderGuide();

/* ---------------- Atalhos ---------------- */
const KBD = {
  kbdGlobal: [['F12', 'Iniciar / parar a gravação'], ['Shift+F12', 'Pausar / retomar'], ['F11', 'Capturar imagem (PNG)'],
    ['Ctrl+Shift+D', 'Abrir / fechar o desenho'], ['Ctrl+Shift+X', 'Limpar os desenhos'], ['Ctrl+Shift+W', 'Mostrar / ocultar a webcam']],
  kbdEditor: [['Espaço', 'Reproduzir / pausar'], ['← →', 'Quadro a quadro (Shift: 1 segundo)'], ['I / O', 'Marcar início / fim'],
    ['X', 'Remover trecho'], ['Z · T · D · V', 'Zoom · Texto · Desenho · Selecionar'], ['Delete', 'Excluir o item selecionado'],
    ['Ctrl+Z / Ctrl+Y', 'Desfazer / refazer'], ['Ctrl+S', 'Salvar projeto'], ['Ctrl+E', 'Exportar vídeo'], ['Ctrl+O', 'Abrir projeto']],
  kbdDraw: [['Ctrl+Z', 'Desfazer o último traço'], ['Shift (arrastando)', 'Linha reta, quadrado ou círculo'], ['Esc', 'Sair do modo desenho'],
    ['Enter', 'Confirmar a área (seleção)'], ['Esc', 'Cancelar a seleção de área']]
};
const kbd = (k) => k.split(/(\s[·/]\s)/).map((part) => (/\s[·/]\s/.test(part) ? `<span class="sep">${part.trim()}</span>` : part.split('+').map((x) => `<kbd>${x}</kbd>`).join('<span class="plus">+</span>'))).join('');
Object.entries(KBD).forEach(([id, rows]) => {
  $(`#${id}`).innerHTML = rows.map(([k, d]) => `<tr><td>${kbd(k)}</td><td>${d}</td></tr>`).join('');
});

/* ---------------- Formatos ---------------- */
const FORMATS = {
  head: ['Formato', 'Resolução', 'Tamanho', 'Som', 'Melhor para'],
  rows: [
    ['MP4 · alta qualidade', 'Original', 'Maior', 'Sim', 'Arquivo final, YouTube, edição posterior'],
    ['MP4 · normal', 'Original', 'Médio', 'Sim', 'Uso geral, aulas e tutoriais'],
    ['MP4 · arquivo menor', 'Original', 'Menor', 'Sim', 'Guardar muitos vídeos, enviar por link'],
    ['WhatsApp / e-mail', 'Até 720p', '~15 MB', 'Sim', 'Mensagens e anexos de e-mail'],
    ['GIF animado', 'Até 960 px', 'Varia', 'Não', 'Trechos curtos em documentação e chats']
  ]
};
$('#formatTable').innerHTML = `<thead><tr>${FORMATS.head.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
  <tbody>${FORMATS.rows.map((r) => `<tr>${r.map((c, i) => (i === 0 ? `<th scope="row">${c}</th>` : `<td>${c}</td>`)).join('')}</tr>`).join('')}</tbody>`;

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
