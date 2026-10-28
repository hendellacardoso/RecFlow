'use strict';
/* Marcações do manual (elipse/retângulo + número em círculo), usadas na captura e no editor de manual */
(function () {
function geom(rect, shape, s) {
  const pad = 6 * s;
  const r = 13 * s;
  if (shape === 'ellipse') {
    const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
    const rx = (rect.w / 2) * 1.25 + pad, ry = (rect.h / 2) * 1.8 + pad;
    return {
      shape, cx, cy, rx, ry,
      badge: { x: cx + rx * Math.SQRT1_2, y: cy - ry * Math.SQRT1_2, r },
      box: { x: cx - rx, y: cy - ry, w: rx * 2, h: ry * 2 }
    };
  }
  const x = rect.x - pad, y = rect.y - pad, w = rect.w + pad * 2, h = rect.h + pad * 2;
  return { shape, x, y, w, h, badge: { x: x + w, y, r }, box: { x, y, w, h } };
}
function pathFor(c, g, s) {
  c.beginPath();
  if (g.shape === 'ellipse') c.ellipse(g.cx, g.cy, g.rx, g.ry, 0, 0, Math.PI * 2);
  else if (g.shape === 'roundrect') c.roundRect(g.x, g.y, g.w, g.h, Math.min(10 * s, g.h / 2));
  else c.rect(g.x, g.y, g.w, g.h);
}
function drawMark(c, mark, s) {
  const g = geom(mark.rect, mark.shape, s);
  c.save();
  c.lineJoin = 'round';
  // contorno com "halo" branco para destacar em qualquer fundo
  pathFor(c, g, s); c.strokeStyle = 'rgba(255,255,255,0.85)'; c.lineWidth = 6.5 * s; c.stroke();
  pathFor(c, g, s); c.strokeStyle = mark.color; c.lineWidth = 3.2 * s; c.stroke();
  // número em círculo
  const b = g.badge;
  c.shadowColor = 'rgba(0,0,0,0.35)'; c.shadowBlur = 5 * s; c.shadowOffsetY = 1.5 * s;
  c.beginPath(); c.arc(b.x, b.y, b.r, 0, Math.PI * 2); c.fillStyle = mark.color; c.fill();
  c.shadowColor = 'transparent';
  c.lineWidth = 2.2 * s; c.strokeStyle = '#fff'; c.stroke();
  c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle';
  const txt = String(mark.num);
  c.font = `700 ${(txt.length > 2 ? 11 : txt.length > 1 ? 12.5 : 14) * s}px "Segoe UI", system-ui, sans-serif`;
  c.fillText(txt, b.x, b.y + 0.5 * s);
  c.restore();
  return g;
}

  window.RFMarks = { geom, drawMark };
}());
