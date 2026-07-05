'use strict';
(function (root, factory) {
  if (typeof module === 'object' && module !== null && module.exports) {
    module.exports = factory();
  } else {
    root.LatchRTime = factory();
  }
})(typeof self !== 'undefined' ? self : globalThis, function () {
  const r1 = v => Math.round(+v * 10) / 10;
  const r3 = v => +(+v || 0).toFixed(3);
  const p2 = n => String(Math.max(0, Math.trunc(+n))).padStart(2, '0');
  const fmt = s => { s = Math.max(0, +s || 0); return `${p2(s / 3600)}:${p2((s % 3600) / 60)}:${p2(s % 60)}`; };
  const fmtMS = s => {
    s = Math.max(0, +s || 0);
    const mm = Math.floor(s / 60);
    const ss = Math.floor(s % 60);
    return `${String(mm).padStart(2, '0')}:${p2(ss)}`;
  };
  const fms = s => (+s).toFixed(3);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, +v || 0));

  function parseFilterSeconds(text) {
    const raw = String(text || '').trim();
    if (!raw) return NaN;
    if (/^\d+(\.\d+)?$/.test(raw)) return +raw;
    const parts = raw.split(':').map(s => s.trim()).filter(Boolean);
    if (parts.some(p => !/^\d+(\.\d+)?$/.test(p))) return NaN;
    if (parts.length === 2) return (+parts[0] * 60) + (+parts[1]);
    if (parts.length === 3) return (+parts[0] * 3600) + (+parts[1] * 60) + (+parts[2]);
    return NaN;
  }

  function parseSignedSeconds(text) {
    if (typeof text === 'number') return Number.isFinite(text) ? text : NaN;
    const raw = String(text || '').trim();
    if (!raw) return NaN;
    const sign = raw.startsWith('-') ? -1 : 1;
    const body = raw.replace(/^[+-]\s*/, '').replace(/s$/i, '').trim();
    if (!body) return NaN;
    if (/^\d+(\.\d+)?$/.test(body)) return sign * (+body);
    const parsed = parseFilterSeconds(body);
    return Number.isFinite(parsed) ? sign * parsed : NaN;
  }
  function timeRoundForDelta(delta) {
    const d = Math.abs(+delta || 0);
    if (d < 0.0995) return r3;
    if (Math.abs((d * 10) - Math.round(d * 10)) > 0.0005) return r3;
    return r1;
  }
  function fmtSignedSeconds(sec) {
    const s = +sec || 0;
    const sign = s >= 0 ? '+' : '-';
    const abs = Math.abs(s);
    const rounded = Math.abs(abs - Math.round(abs)) < 0.0001 ? String(Math.round(abs)) : abs.toFixed(1);
    return `${sign}${rounded}s`;
  }

  return {
    r1,
    r3,
    p2,
    fmt,
    fmtMS,
    fms,
    clamp,
    parseFilterSeconds,
    parseSignedSeconds,
    timeRoundForDelta,
    fmtSignedSeconds,
  };
});
