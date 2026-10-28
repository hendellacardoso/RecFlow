'use strict';
/*
 * Credenciais e chamadas de IA.
 * As chaves ficam criptografadas com o safeStorage do Electron (DPAPI no Windows),
 * num arquivo separado das configurações, e nunca são enviadas para a interface.
 * Cada chave só é usada nas requisições ao provedor escolhido no próprio perfil.
 */
const fs = require('fs');
const path = require('path');
const { app, safeStorage, net } = require('electron');

const PROVIDERS = {
  anthropic: { label: 'Anthropic (Claude)', base: 'https://api.anthropic.com/v1', uses: ['text'] },
  openai: { label: 'OpenAI', base: 'https://api.openai.com/v1', uses: ['text', 'transcribe', 'tts'] },
  gemini: { label: 'Google Gemini', base: 'https://generativelanguage.googleapis.com/v1beta', uses: ['text'] },
  compatible: { label: 'Compatível com OpenAI (Groq, OpenRouter, Ollama, LM Studio…)', base: '', uses: ['text', 'transcribe', 'tts'] },
  http: { label: 'API HTTP própria de voz (ex.: APIVoz)', base: '', uses: ['tts'] }
};
const USES = ['text', 'transcribe', 'tts'];

const file = () => path.join(app.getPath('userData'), 'ai-credentials.json');
let store = null;
const memKeys = new Map();   // usado só se a criptografia do sistema não estiver disponível

function load() {
  if (store) return store;
  try { store = JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { store = {}; }
  if (!Array.isArray(store.profiles)) store.profiles = [];
  store.use = { text: '', transcribe: '', tts: '', ...(store.use || {}) };
  store.lang = store.lang || 'pt-BR';
  return store;
}
function persist() {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(store, null, 2));
}
const canEncrypt = () => { try { return safeStorage.isEncryptionAvailable(); } catch { return false; } };
function getKey(p) {
  if (memKeys.has(p.id)) return memKeys.get(p.id);
  if (p.keyEnc) { try { return safeStorage.decryptString(Buffer.from(p.keyEnc, 'base64')); } catch { return ''; } }
  return '';
}
const mask = (k) => (k ? `••••${k.slice(-4)}` : '');
const uid = () => Math.random().toString(36).slice(2, 10);

/* -------- perfis (sem as chaves) -------- */
function publicProfile(p) {
  const k = getKey(p);
  const { keyEnc, ...rest } = p;
  return { ...rest, hasKey: !!k, keyMask: mask(k), sessionOnly: memKeys.has(p.id) && !p.keyEnc };
}
function list() {
  load();
  return {
    profiles: store.profiles.map(publicProfile), use: store.use, lang: store.lang,
    providers: PROVIDERS, encryption: canEncrypt()
  };
}
const FIELDS = ['name', 'provider', 'baseUrl', 'model', 'sttModel', 'ttsModel', 'voice', 'httpUrl', 'httpHeaders', 'httpBody', 'httpResponse', 'httpJsonPath'];
function save(input) {
  load();
  if (!PROVIDERS[input.provider]) throw new Error('Provedor inválido.');
  let p = store.profiles.find((x) => x.id === input.id);
  if (!p) { p = { id: uid() }; store.profiles.push(p); }
  FIELDS.forEach((f) => { if (f in input) p[f] = String(input[f] ?? '').trim(); });
  if (!p.name) p.name = PROVIDERS[p.provider].label;
  if (typeof input.apiKey === 'string' && input.apiKey.trim()) {
    const k = input.apiKey.trim();
    if (canEncrypt()) { p.keyEnc = safeStorage.encryptString(k).toString('base64'); memKeys.delete(p.id); }
    else { delete p.keyEnc; memKeys.set(p.id, k); }
  }
  if (input.clearKey) { delete p.keyEnc; memKeys.delete(p.id); }
  // perfil novo assume os usos ainda vazios que ele suporta
  PROVIDERS[p.provider].uses.forEach((u) => { if (!store.use[u] || !store.profiles.some((x) => x.id === store.use[u])) store.use[u] = p.id; });
  persist();
  return list();
}
function remove(id) {
  load();
  store.profiles = store.profiles.filter((p) => p.id !== id);
  memKeys.delete(id);
  USES.forEach((u) => { if (store.use[u] === id) store.use[u] = (store.profiles.find((p) => PROVIDERS[p.provider].uses.includes(u)) || {}).id || ''; });
  persist();
  return list();
}
function setUse(use, lang) {
  load();
  USES.forEach((u) => { if (use && u in use) store.use[u] = String(use[u] || ''); });
  if (lang) store.lang = String(lang);
  persist();
  return list();
}
function profileFor(use, id) {
  load();
  const p = store.profiles.find((x) => x.id === (id || store.use[use]));
  if (!p) throw new Error(`Nenhuma credencial de IA configurada para ${use === 'text' ? 'textos e imagens' : use === 'transcribe' ? 'transcrição' : 'narração'}. Cadastre na aba IA.`);
  if (!PROVIDERS[p.provider].uses.includes(use)) throw new Error(`O perfil "${p.name}" não oferece esse recurso.`);
  return p;
}
function available() {
  load();
  const ok = (u) => { try { const p = profileFor(u); return !!getKey(p) || p.provider === 'compatible' || p.provider === 'http'; } catch { return false; } };
  return { text: ok('text'), transcribe: ok('transcribe'), tts: ok('tts'), lang: store.lang };
}

/* -------- HTTP -------- */
const baseOf = (p) => (p.baseUrl || PROVIDERS[p.provider].base || '').replace(/\/+$/, '');
async function request(url, { method = 'POST', headers = {}, body, timeout = 120000, raw = false } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  let res;
  try {
    res = await net.fetch(url, { method, headers, body, signal: ctrl.signal });
  } catch (e) {
    clearTimeout(t);
    throw new Error(e.name === 'AbortError' ? 'O provedor de IA demorou demais para responder.' : `Sem conexão com o provedor de IA (${e.message}).`);
  }
  clearTimeout(t);
  if (!res.ok) {
    let msg = '';
    try { const j = await res.json(); msg = (j.error && (j.error.message || j.error)) || j.message || JSON.stringify(j).slice(0, 300); } catch { try { msg = (await res.text()).slice(0, 300); } catch { /* sem corpo */ } }
    const hint = { 401: 'chave inválida ou sem permissão', 403: 'acesso negado', 404: 'endereço ou modelo não encontrado', 429: 'limite de uso ou saldo esgotado', 413: 'arquivo grande demais' }[res.status];
    throw new Error(`IA respondeu ${res.status}${hint ? ` (${hint})` : ''}${msg ? `: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}` : ''}`);
  }
  if (raw) return res;
  return res.json();
}
function authHeaders(p) {
  const key = getKey(p);
  if (p.provider === 'anthropic') return { 'x-api-key': key, 'anthropic-version': '2023-06-01' };
  if (p.provider === 'gemini') return { 'x-goog-api-key': key };
  return key ? { Authorization: `Bearer ${key}` } : {};
}
const splitDataUrl = (u) => { const m = /^data:([^;]+);base64,(.*)$/s.exec(u || ''); return m ? { mime: m[1], data: m[2] } : null; };

/* -------- texto (com imagens opcionais) -------- */
async function chat({ system = '', prompt, images = [], maxTokens = 1500, profileId } = {}) {
  const p = profileFor('text', profileId);
  if (!p.model) throw new Error(`Informe o modelo no perfil "${p.name}" (aba IA).`);
  const base = baseOf(p);
  const imgs = images.map(splitDataUrl).filter(Boolean);
  if (p.provider === 'anthropic') {
    const j = await request(`${base}/messages`, {
      headers: { ...authHeaders(p), 'content-type': 'application/json' },
      body: JSON.stringify({
        model: p.model, max_tokens: maxTokens, system: system || undefined,
        messages: [{ role: 'user', content: [...imgs.map((i) => ({ type: 'image', source: { type: 'base64', media_type: i.mime, data: i.data } })), { type: 'text', text: prompt }] }]
      })
    });
    return (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('').trim();
  }
  if (p.provider === 'gemini') {
    const j = await request(`${base}/models/${encodeURIComponent(p.model)}:generateContent`, {
      headers: { ...authHeaders(p), 'content-type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: system ? { parts: [{ text: system }] } : undefined,
        contents: [{ role: 'user', parts: [...imgs.map((i) => ({ inline_data: { mime_type: i.mime, data: i.data } })), { text: prompt }] }]
      })
    });
    const parts = (((j.candidates || [])[0] || {}).content || {}).parts || [];
    return parts.map((x) => x.text || '').join('').trim();
  }
  if (!base) throw new Error(`Informe o endereço (URL base) no perfil "${p.name}".`);
  const content = imgs.length ? [{ type: 'text', text: prompt }, ...images.map((u) => ({ type: 'image_url', image_url: { url: u } }))] : prompt;
  const j = await request(`${base}/chat/completions`, {
    headers: { ...authHeaders(p), 'content-type': 'application/json' },
    body: JSON.stringify({ model: p.model, messages: [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content }] })
  });
  const msg = ((j.choices || [])[0] || {}).message || {};
  return String(Array.isArray(msg.content) ? msg.content.map((c) => c.text || '').join('') : msg.content || '').trim();
}
// extrai JSON da resposta (aceita ```json ... ``` e texto em volta)
function parseJson(txt) {
  const s = String(txt || '').replace(/```(?:json)?/gi, '');
  const a = s.indexOf('['), o = s.indexOf('{');
  const start = a >= 0 && (o < 0 || a < o) ? a : o;
  if (start < 0) throw new Error('A IA não devolveu dados no formato esperado.');
  const end = s.lastIndexOf(s[start] === '[' ? ']' : '}');
  return JSON.parse(s.slice(start, end + 1));
}

/* -------- modelos e teste -------- */
async function models(id) {
  load();
  const p = store.profiles.find((x) => x.id === id);
  if (!p) throw new Error('Perfil não encontrado.');
  const base = baseOf(p);
  if (p.provider === 'http') return [];
  if (!base) throw new Error(`Informe o endereço (URL base) no perfil "${p.name}".`);
  if (p.provider === 'gemini') {
    const j = await request(`${base}/models?pageSize=200`, { method: 'GET', headers: authHeaders(p) });
    return (j.models || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent')).map((m) => m.name.replace(/^models\//, ''));
  }
  const j = await request(`${base}/models${p.provider === 'anthropic' ? '?limit=100' : ''}`, { method: 'GET', headers: authHeaders(p) });
  return (j.data || []).map((m) => m.id).sort();
}
async function test(id) {
  load();
  const p = store.profiles.find((x) => x.id === id);
  if (!p) throw new Error('Perfil não encontrado.');
  if (p.provider === 'http') {
    const { buffer } = await tts('Teste de narração do RecFlow.', { profileId: id });
    return `Voz gerada (${Math.round(buffer.length / 1024)} KB).`;
  }
  if (!p.model) { const m = await models(id); return `Conexão OK. ${m.length} modelo(s) disponível(is). Escolha um modelo.`; }
  const r = await chat({ prompt: 'Responda apenas: OK', maxTokens: 20, profileId: id });
  return `Conexão OK. Resposta do modelo: "${r.slice(0, 60)}"`;
}

/* -------- transcrição (formato OpenAI /audio/transcriptions) -------- */
function multipart(fields, fileField, fileName, fileBuf, mime) {
  const boundary = `----recflow${uid()}${uid()}`;
  const parts = [];
  Object.entries(fields).forEach(([k, v]) => {
    (Array.isArray(v) ? v : [v]).forEach((x) => parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${x}\r\n`)));
  });
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${fileField}"; filename="${fileName}"\r\nContent-Type: ${mime}\r\n\r\n`), fileBuf, Buffer.from(`\r\n--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), type: `multipart/form-data; boundary=${boundary}` };
}
async function transcribe(audioFile, { language } = {}) {
  const p = profileFor('transcribe');
  const base = baseOf(p);
  if (!base) throw new Error(`Informe o endereço (URL base) no perfil "${p.name}".`);
  const model = p.sttModel || 'whisper-1';
  const fields = { model, response_format: model.includes('gpt-4o') ? 'json' : 'verbose_json' };
  if (!model.includes('gpt-4o')) fields['timestamp_granularities[]'] = 'segment';
  const lang = String(language || load().lang || '').split('-')[0];
  if (lang) fields.language = lang;
  const mp = multipart(fields, 'file', path.basename(audioFile), fs.readFileSync(audioFile), 'audio/mpeg');
  const j = await request(`${base}/audio/transcriptions`, { headers: { ...authHeaders(p), 'content-type': mp.type }, body: mp.body, timeout: 600000 });
  if (Array.isArray(j.segments) && j.segments.length) return j.segments.map((s) => ({ start: Number(s.start) || 0, end: Number(s.end) || 0, text: String(s.text || '').trim() })).filter((s) => s.text);
  return j.text ? [{ start: 0, end: null, text: String(j.text).trim() }] : [];
}

/* -------- narração (texto para fala) -------- */
const extOf = (ct) => (/wav/.test(ct) ? 'wav' : /ogg|opus/.test(ct) ? 'ogg' : /aac|mp4|m4a/.test(ct) ? 'm4a' : 'mp3');
const jsonEsc = (s) => JSON.stringify(String(s)).slice(1, -1);
const dig = (o, p) => String(p || '').split('.').filter(Boolean).reduce((a, k) => (a == null ? a : a[k]), o);
async function tts(text, { profileId, voice } = {}) {
  const p = profileFor('tts', profileId);
  const key = getKey(p);
  if (p.provider === 'http') {
    if (!p.httpUrl) throw new Error(`Informe a URL da API de voz no perfil "${p.name}".`);
    const fill = (s, esc) => String(s || '').replace(/\{\{(\w+)\}\}/g, (_m, k) => {
      const v = k === 'text' ? text : k === 'key' ? key : k === 'voice' ? (voice || p.voice || '') : '';
      return esc ? jsonEsc(v) : v;
    });
    const headers = {};
    fill(p.httpHeaders || 'Content-Type: application/json', false).split(/\r?\n/).forEach((l) => {
      const i = l.indexOf(':'); if (i > 0) headers[l.slice(0, i).trim()] = l.slice(i + 1).trim();
    });
    const res = await request(fill(p.httpUrl, false), { headers, body: fill(p.httpBody || '{"text":"{{text}}"}', true), raw: true });
    const ct = res.headers.get('content-type') || '';
    if (!/json/.test(ct) && (p.httpResponse || 'audio') === 'audio') return { buffer: Buffer.from(await res.arrayBuffer()), ext: extOf(ct) };
    const j = await res.json();
    const v = dig(j, p.httpJsonPath || 'audio');
    if (!v || typeof v !== 'string') throw new Error(`A resposta da API de voz não tem o campo "${p.httpJsonPath || 'audio'}".`);
    if (/^https?:/.test(v)) { const r2 = await request(v, { method: 'GET', raw: true }); return { buffer: Buffer.from(await r2.arrayBuffer()), ext: extOf(r2.headers.get('content-type') || '') }; }
    const d = splitDataUrl(v);
    return { buffer: Buffer.from(d ? d.data : v, 'base64'), ext: d ? extOf(d.mime) : 'mp3' };
  }
  const base = baseOf(p);
  const res = await request(`${base}/audio/speech`, {
    headers: { ...authHeaders(p), 'content-type': 'application/json' },
    body: JSON.stringify({ model: p.ttsModel || 'tts-1', voice: voice || p.voice || 'alloy', input: text, response_format: 'mp3' }),
    raw: true
  });
  return { buffer: Buffer.from(await res.arrayBuffer()), ext: 'mp3' };
}

module.exports = { PROVIDERS, list, save, remove, setUse, available, chat, parseJson, models, test, transcribe, tts, lang: () => load().lang };
