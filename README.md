<p align="center"><img src="assets/icon.png" width="128" alt="RecFlow"></p>

# RecFlow

Gravador de tela com editor de vídeo para Windows, feito com Electron (HTML, CSS e JavaScript). Gratuito e de código aberto (licença MIT).

## Download

Baixe o instalador mais recente em **[Releases](https://github.com/hendellacardoso/RecFlow/releases/latest)** (`RecFlow-Setup.exe`). Requer Windows 10 ou 11 (64 bits). Para desinstalar: Configurações do Windows › Aplicativos › RecFlow › Desinstalar.

## Recursos

- **Modos de gravação:** tela inteira (escolha do monitor), área retangular em qualquer monitor, janela específica e somente webcam
- **Áudio:** som do sistema e microfone mixados, com volume ajustável (também durante a gravação), gráfico do sinal em tempo real e teste de 5 segundos (grava e toca)
- **Editor após a gravação:** reproduzir quadro a quadro, linha do tempo com miniaturas e forma de onda, cortar início/fim e remover trechos, zoom animado em uma área, textos, desenhos, desfazer/refazer
- **Exportar** em MP4 (3 qualidades), **WhatsApp/e-mail** (até 720p, ~15 MB) ou **GIF animado**
- **Projetos (.gtproj):** salve a edição e continue depois; com o app instalado, abre com duplo clique
- **Marcações para manual:** durante a gravação, **Insert** pausa, tira o print, contorna o campo em foco (elipse, arredondado ou retângulo) com o número em círculo e pede a explicação; **Shift+Insert** começa uma tela nova. Gera `tela_01.png`, `descricoes.txt` e `manual.html` (numeração por tela ou contínua)
- **Manual em HTML** com painel lateral em árvore (capítulos → telas → itens), pesquisa, zoom nas imagens e o **vídeo da gravação** com "Ver no vídeo" em cada tela
- **Editor de manual:** título, subtítulo, autor, capítulos, nomes das telas, reordenar, excluir, trocar print, mover/adicionar marcações, escolher o vídeo (original ou editado) e reajustar os tempos
- **Exportar o manual em PDF e Word (.docx)** com capa, logo, sumário e numeração de páginas
- **Contagem regressiva** (3, 5 ou 10 s) antes de gravar
- **Teclas pressionadas no vídeo** (posição, tamanho, tempo e modo "só atalhos")
- **Fundo desfocado na webcam** (IA local, sem tela verde)
- **Redução de ruído forte** no microfone (RNNoise, IA local)
- **Logo / marca d'água** opcional em todas as gravações
- **Webcam junto com a tela:** janela flutuante que você arrasta e redimensiona a qualquer momento (inclusive gravando), em círculo ou retângulo, com espelhamento e posicionamento rápido. Atalho Ctrl+Shift+W mostra/oculta
- **Desenho na tela:** caneta, marca-texto, linha, seta, retângulo, elipse, borracha, cores, espessuras, desfazer e limpar. A barra de ferramentas não aparece no vídeo
- **Efeitos de clique:** círculo amarelo (esquerdo), vermelho (direito) e verde (meio)
- **Atalhos globais configuráveis:** F12 grava/para, Shift+F12 pausa, F11 captura imagem, Ctrl+Shift+D desenho, Ctrl+Shift+X limpa
- **Gravação agendada:** data/hora de início e duração
- **Captura de imagem (PNG)**, pausa/retomada, bandeja do sistema, lista de arquivos
- Saída em **MP4 (H.264/AAC)** ou **WebM (VP9/Opus)**, de 15 a 60 fps e 4 níveis de qualidade
- A janela do gravador pode ficar oculta no vídeo (Windows 10 2004 ou mais recente)
- Tema claro, escuro ou igual ao Windows, com a cor de destaque do sistema e barra de rolagem fina
- **Recuperação de gravações:** se o app ou o PC cair durante a gravação, na próxima abertura aparece a opção de recuperar o vídeo
- **Espaço em disco:** aviso antes e durante a gravação, com parada segura quando o disco está quase cheio
- **Limite por arquivo** (tempo ou tamanho): continua numa parte nova ou para a gravação
- **Gravação pela placa de vídeo** (opcional): FFmpeg com NVENC (NVIDIA), Quick Sync (Intel) ou AMF (AMD), nos modos Tela inteira e Área
- **Trilhas separadas** de microfone e som do sistema, com volume de cada uma no editor
- **Zoom automático:** a posição dos cliques fica guardada e o editor sugere zooms; também sugere cortes nos silêncios
- **Editor:** música de fundo (abaixa sozinha quando há voz), abertura e encerramento (vídeo, imagem ou cartão com a identidade visual), legendas e narração
- **Identidade visual:** cores, logo e rodapé aplicados nos manuais e nos cartões do editor
- **Mesclar manuais** (cada um vira um capítulo) e **traduzir manuais**
- **Exportar e importar configurações**
- **IA (opcional, com sua própria chave):** Anthropic, OpenAI, Google Gemini, serviços compatíveis com OpenAI (Groq, OpenRouter, Ollama, LM Studio) e API de voz própria (ex.: APIVoz). Sugere a descrição dos campos do manual, preenche e revisa textos, sugere nomes e capítulos, traduz, gera legendas, título/descrição/capítulos para o YouTube e narração. As chaves ficam criptografadas no Windows (DPAPI) e só são enviadas ao provedor escolhido

## Como rodar

Requisitos: [Node.js](https://nodejs.org) 20 ou mais recente.

```bash
npm install
npm start
```

## Gerar instalador (.exe)

```bash
npm run dist
```

O instalador fica na pasta `dist/`. Para publicar uma versão no GitHub, rode `publicar-versao.bat`: ele cria a tag e o GitHub Actions gera o instalador (assinado pelo SignPath, quando configurado) e publica em Releases.

## Estrutura

```
main.js          Processo principal: janelas, captura, gravação em disco, atalhos, bandeja, agendamento
preload.js       Ponte segura (contextBridge) entre a interface e o processo principal
src/index.html   Interface principal
src/renderer.js  Motor de gravação (MediaRecorder + canvas + Web Audio) e lógica da interface
src/styles.css   Tema escuro
src/selector.*   Seleção de área
src/overlay.*    Camada de desenho e efeitos de clique (aparece no vídeo)
src/toolbar.*    Barra de ferramentas de desenho (não aparece no vídeo)
src/border.html  Borda vermelha da área gravada
src/cam.*        Janela flutuante da webcam
src/editor.*     Editor de vídeo (a exportação usa o FFmpeg do pacote ffmpeg-static)
src/blur.js      Desfoque do fundo da webcam (MediaPipe)
src/countdown.*  Contagem regressiva
src/manual.*     Janela de marcação do modo manual (detecção do campo via UI Automation do Windows)
src/manual-editor.*  Editor de manual
src/marks.js     Desenho das marcações (elipse/retângulo + número)
manual-docs.js   Geração do manual: HTML, TXT, PDF e Word; mesclar e copiar manuais
ai.js            Credenciais de IA (criptografadas) e chamadas aos provedores
hwrec.js         Gravação pelo FFmpeg com a placa de vídeo
src/brand.js     Cartões de abertura/encerramento com a identidade visual
assets/selfie_segmenter.tflite  Modelo de IA que separa a pessoa do fundo
```

As configurações ficam em `%APPDATA%\RecFlow\settings.json` (as credenciais de IA em `ai-credentials.json`, criptografadas) (as da versão anterior, "Gravador de Tela", são copiadas automaticamente). Os vídeos novos vão para `Vídeos\RecFlow` (dá para trocar na aba Vídeo).

## Observações

- Arquivos auxiliares de cada gravação (trilhas separadas, cliques, narrações) ficam na pasta oculta `.recflow`, ao lado dos vídeos.
- Depois de atualizar o projeto, rode `npm install` de novo (FFmpeg, MediaPipe, RNNoise e docx vêm como pacotes).
- O duplo clique em arquivos `.gtproj` funciona com o app instalado pelo `npm run dist`. Rodando com `npm start`, use "Abrir projeto…".

- Os efeitos de clique usam o módulo nativo opcional `uiohook-napi`. Se ele não instalar, o resto funciona normalmente.
- Desenho e efeitos de clique aparecem nos modos **Tela inteira** e **Área**. No modo **Janela**, apenas o conteúdo da própria janela é gravado.
- A gravação agendada só dispara com o programa aberto (pode estar minimizado na bandeja).
- Arquivos WebM gravados pelo navegador não trazem a duração no cabeçalho; alguns players demoram para permitir avançar. O MP4 (padrão) não tem esse problema.

## Code signing policy

Free code signing provided by [SignPath.io](https://about.signpath.io), certificate by [SignPath Foundation](https://signpath.org).

- Committers and reviewers: [Hendell A. Cardoso](https://github.com/hendellacardoso)
- Approvers: [Hendell A. Cardoso](https://github.com/hendellacardoso)

Detalhes em [CODE_SIGNING_POLICY.md](CODE_SIGNING_POLICY.md).

## Privacidade

This program will not transfer any information to other networked systems unless specifically requested by the user or the person installing or operating it. O RecFlow não envia nenhum dado ao desenvolvedor; os recursos de IA são opcionais e usam o provedor e a chave que você cadastrar. Veja [PRIVACY.md](PRIVACY.md).

## Licença

[MIT](LICENSE) © 2026 Hendell A. Cardoso. Inclui o FFmpeg (via ffmpeg-static, licença GPL/LGPL), MediaPipe (Apache-2.0) e RNNoise (BSD).

## Sobre

- **Desenvolvedor:** Hendell A. Cardoso
- **E-mail:** suporte@api2dev.com.br
- **WhatsApp:** (62) 9.9314-8955
- **Website:** https://api2dev.com.br
