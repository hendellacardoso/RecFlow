'use strict';
// Cartões de abertura/encerramento com a identidade visual (usado na prévia e no editor de vídeo)
(function () {
  const hex = (c, d) => (/^#[0-9a-f]{6}$/i.test(c || '') ? c : d);
  function shade(c, k) {
    const n = parseInt(c.slice(1), 16);
    const f = (v) => Math.max(0, Math.min(255, Math.round(k < 0 ? v * (1 + k) : v + (255 - v) * k)));
    return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
  }
  function wrap(ctx, text, maxW, maxLines) {
    const words = String(text || '').split(/\s+/).filter(Boolean);
    const lines = []; let cur = '';
    words.forEach((w) => {
      const t = cur ? `${cur} ${w}` : w;
      if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
    });
    if (cur) lines.push(cur);
    if (lines.length > maxLines) { const l = lines.slice(0, maxLines); l[maxLines - 1] = `${l[maxLines - 1].replace(/\s+\S*$/, '')}…`; return l; }
    return lines;
  }
  /**
   * opts: { brand, logo (Image|null), title, subtitle, kind: 'intro'|'outro' }
   */
  function drawCard(ctx, W, H, opts) {
    const b = opts.brand || {};
    const c1 = hex(b.color, '#e5484d'), c2 = hex(b.color2, '#111827');
    const font = '"Segoe UI", system-ui, -apple-system, Arial, sans-serif';
    ctx.save();
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, c2); g.addColorStop(1, shade(c2, -0.45));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // formas decorativas
    ctx.globalAlpha = 0.9; ctx.fillStyle = c1;
    ctx.beginPath(); ctx.arc(W * 1.02, H * 1.05, H * 0.6, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 0.22; ctx.lineWidth = H * 0.018; ctx.strokeStyle = c1;
    ctx.beginPath(); ctx.arc(W * 1.02, H * 1.05, H * 0.8, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
    const x = W * 0.08;
    let y = H * 0.16;
    if (opts.logo && opts.logo.naturalWidth) {
      const lh = H * 0.15, lw = Math.min(W * 0.3, (lh * opts.logo.naturalWidth) / opts.logo.naturalHeight);
      const k = Math.min(lw / opts.logo.naturalWidth, lh / opts.logo.naturalHeight);
      ctx.drawImage(opts.logo, x, y, opts.logo.naturalWidth * k, opts.logo.naturalHeight * k);
    }
    const outro = opts.kind === 'outro';
    const title = opts.title || (outro ? 'Obrigado por assistir!' : 'Tutorial');
    ctx.font = `700 ${Math.round(H * 0.092)}px ${font}`;
    const lines = wrap(ctx, title, W * 0.72, 2);
    const lh = H * 0.11;
    y = H * 0.5 - ((lines.length - 1) * lh) / 2;
    ctx.fillStyle = c1; ctx.fillRect(x, y - H * 0.13, W * 0.07, H * 0.014);
    ctx.fillStyle = '#ffffff'; ctx.textBaseline = 'middle';
    lines.forEach((l, i) => ctx.fillText(l, x, y + i * lh));
    y += (lines.length - 1) * lh + H * 0.1;
    const sub = opts.subtitle || (outro ? (b.site || b.footer || '') : (b.name || ''));
    if (sub) {
      ctx.font = `400 ${Math.round(H * 0.045)}px ${font}`; ctx.fillStyle = 'rgba(255,255,255,.78)';
      wrap(ctx, sub, W * 0.7, 2).forEach((l, i) => ctx.fillText(l, x, y + i * H * 0.06));
    }
    const foot = outro ? (b.footer && b.footer !== sub ? b.footer : '') : (b.site || '');
    if (foot) {
      ctx.font = `500 ${Math.round(H * 0.032)}px ${font}`; ctx.fillStyle = 'rgba(255,255,255,.6)';
      ctx.fillText(foot, x, H * 0.9);
    }
    ctx.restore();
  }
  function cardPng(W, H, opts) {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    drawCard(c.getContext('2d'), W, H, opts);
    return c.toDataURL('image/png');
  }
  window.RFBrand = { drawCard, cardPng };
}());
