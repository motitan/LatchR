'use strict';
(function (root, factory) {
  if (typeof module === 'object' && module !== null && module.exports) {
    module.exports = factory();
  } else {
    root.LatchRShared = factory();
  }
})(typeof self !== 'undefined' ? self : globalThis, function () {
  const clamp = (v, a, b) => Math.max(a, Math.min(b, +v || 0));

  function normalizePitchXY(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const x = Number(raw.x);
    const y = Number(raw.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const out = {
      x: Number(x.toFixed(3)),
      y: Number(y.toFixed(3)),
    };
    const xn = Number(raw.x_norm);
    const yn = Number(raw.y_norm);
    if (Number.isFinite(xn)) out.x_norm = Number(clamp(xn, 0, 1).toFixed(6));
    if (Number.isFinite(yn)) out.y_norm = Number(clamp(yn, 0, 1).toFixed(6));
    const x2 = Number(raw.x2);
    const y2 = Number(raw.y2);
    if (Number.isFinite(x2) && Number.isFinite(y2)) {
      out.x2 = Number(x2.toFixed(3));
      out.y2 = Number(y2.toFixed(3));
      const x2n = Number(raw.x2_norm);
      const y2n = Number(raw.y2_norm);
      if (Number.isFinite(x2n)) out.x2_norm = Number(clamp(x2n, 0, 1).toFixed(6));
      if (Number.isFinite(y2n)) out.y2_norm = Number(clamp(y2n, 0, 1).toFixed(6));
    }
    const cw = Number(raw.canvas_width);
    const ch = Number(raw.canvas_height);
    if (Number.isFinite(cw) && cw > 0) out.canvas_width = Number(cw.toFixed(3));
    if (Number.isFinite(ch) && ch > 0) out.canvas_height = Number(ch.toFixed(3));
    const pageIndex = Number(raw.page_index);
    if (Number.isFinite(pageIndex)) out.page_index = Math.round(pageIndex);
    const pageName = String(raw.page_name || '').trim();
    if (pageName) out.page_name = pageName;
    return out;
  }

  function normalizeTemplateSchemaKeys(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
    let text = '';
    try {
      text = JSON.stringify(raw);
    } catch (_) {
      return raw;
    }
    const migrated = text
      .replace(/"tagging-pages":/g, '"event-pages":')
      .replace(/"tagging-window-items-extra-pages":/g, '"event-window-items-extra-pages":')
      .replace(/"tagging-window-items":/g, '"event-window-items":')
      .replace(/"tagging-window-item/g, '"event-window-item')
      .replace(/"tagging-window-canvas_/g, '"event-window-canvas_')
      .replace(/"tagging-window":/g, '"event-window":');
    if (migrated === text) return raw;
    try {
      return JSON.parse(migrated);
    } catch (_) {
      return raw;
    }
  }

  function rgbToHex(r, g, b) {
    const c = n => Math.max(0, Math.min(255, Math.round(+n || 0))).toString(16).padStart(2, '0');
    return `#${c(r)}${c(g)}${c(b)}`;
  }
  function hexToRgb(hex) {
    const h = String(hex || '').trim().replace('#', '');
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return [38, 79, 130];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }

  return {
    normalizePitchXY,
    normalizeTemplateSchemaKeys,
    rgbToHex,
    hexToRgb,
  };
});
