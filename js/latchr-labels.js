'use strict';
(function (root, factory) {
  if (typeof module === 'object' && module !== null && module.exports) {
    module.exports = factory(require('./latchr-shared.js'), require('./latchr-time.js'));
  } else {
    root.LatchRLabels = factory(root.LatchRShared, root.LatchRTime);
  }
})(typeof self !== 'undefined' ? self : globalThis, function (shared, time) {
  const { normalizePitchXY } = shared;
  const { clamp } = time;

  const PITCH_XY_LEGACY_LABEL_GROUP = 'pitch_xy';
  const PITCH_X_LABEL_GROUP = 'X';
  const PITCH_Y_LABEL_GROUP = 'Y';
  const PITCH_X2_LABEL_GROUP = 'X2';
  const PITCH_Y2_LABEL_GROUP = 'Y2';

  function normalizeEventLabelEntry(raw) {
    if (typeof raw === 'string') {
      const text = raw.trim();
      return text ? { text } : null;
    }
    if (!raw || typeof raw !== 'object') return null;
    const text = String(raw.text ?? raw.label ?? raw['label-text'] ?? '').trim();
    if (!text) return null;
    const group = String(raw.group ?? raw['label-group'] ?? '').trim();
    return group ? { text, group } : { text };
  }
  function serializeEventLabels(labels) {
    const out = [];
    (Array.isArray(labels) ? labels : []).forEach(raw => {
      const next = normalizeEventLabelEntry(raw);
      if (next) out.push(next);
    });
    return out;
  }
  function eventLabelDisplayText(raw) {
    const lbl = normalizeEventLabelEntry(raw);
    if (!lbl) return '';
    const group = String(lbl.group || '').trim();
    return group ? `${group}: ${lbl.text}` : lbl.text;
  }
  function pitchXYLabelText(pitch) {
    const p = normalizePitchXY(pitch);
    if (!p) return '';
    const base = `XY(${p.x.toFixed(1)},${p.y.toFixed(1)})`;
    return pitchHasTrajectory(p) ? `${base}->(${p.x2.toFixed(1)},${p.y2.toFixed(1)})` : base;
  }
  function pitchHasTrajectory(pitch) {
    const p = normalizePitchXY(pitch);
    return !!(p && Number.isFinite(+p.x2) && Number.isFinite(+p.y2));
  }
  function isPitchXYLabelText(text) {
    return /^xy\(\s*-?\d+(?:\.\d+)?,\s*-?\d+(?:\.\d+)?\s*\)$/i.test(String(text || '').trim());
  }
  function isPitchCoordinateLabel(raw) {
    const lbl = normalizeEventLabelEntry(raw);
    if (!lbl) return false;
    const group = String(lbl.group || '').trim().toLowerCase();
    return group === PITCH_X_LABEL_GROUP.toLowerCase()
      || group === PITCH_Y_LABEL_GROUP.toLowerCase()
      || group === PITCH_X2_LABEL_GROUP.toLowerCase()
      || group === PITCH_Y2_LABEL_GROUP.toLowerCase()
      || group === PITCH_XY_LEGACY_LABEL_GROUP
      || isPitchXYLabelText(lbl.text);
  }
  function pitchXYPercentText(pitch, axis) {
    const p = normalizePitchXY(pitch);
    if (!p) return '';
    const isX = axis === 'x' || axis === 'x2';
    const isEnd = axis === 'x2' || axis === 'y2';
    let norm = Number(isEnd ? (isX ? p.x2_norm : p.y2_norm) : (isX ? p.x_norm : p.y_norm));
    if (!Number.isFinite(norm)) {
      const pos = Number(isEnd ? (isX ? p.x2 : p.y2) : (isX ? p.x : p.y));
      const size = Number(isX ? p.canvas_width : p.canvas_height);
      if (!Number.isFinite(pos) || !Number.isFinite(size) || size <= 0) return '';
      norm = clamp(pos / size, 0, 1);
    }
    return (clamp(norm, 0, 1) * 100).toFixed(2);
  }
  function pitchXYGroupedLabels(pitch) {
    const x = pitchXYPercentText(pitch, 'x');
    const y = pitchXYPercentText(pitch, 'y');
    const x2 = pitchXYPercentText(pitch, 'x2');
    const y2 = pitchXYPercentText(pitch, 'y2');
    const out = [];
    if (x) out.push({ text: x, group: PITCH_X_LABEL_GROUP });
    if (y) out.push({ text: y, group: PITCH_Y_LABEL_GROUP });
    if (x2) out.push({ text: x2, group: PITCH_X2_LABEL_GROUP });
    if (y2) out.push({ text: y2, group: PITCH_Y2_LABEL_GROUP });
    return out;
  }
  function syncEventPitchXYLabel(ev) {
    if (!ev || typeof ev !== 'object') return;
    const pitch = normalizePitchXY(ev.pitch_xy);
    ev.pitch_xy = pitch;
    const next = serializeEventLabels(ev.labels).filter(lbl => {
      const group = String(lbl.group || '').trim().toLowerCase();
      if (!pitch) return true;
      if (group === PITCH_XY_LEGACY_LABEL_GROUP) return false;
      if (group === PITCH_X_LABEL_GROUP.toLowerCase() || group === PITCH_Y_LABEL_GROUP.toLowerCase()) return false;
      if (group === PITCH_X2_LABEL_GROUP.toLowerCase() || group === PITCH_Y2_LABEL_GROUP.toLowerCase()) return false;
      return !isPitchXYLabelText(lbl.text);
    });
    ev.labels = pitch ? [...pitchXYGroupedLabels(pitch), ...next] : next;
  }

  return {
    PITCH_XY_LEGACY_LABEL_GROUP,
    PITCH_X_LABEL_GROUP,
    PITCH_Y_LABEL_GROUP,
    PITCH_X2_LABEL_GROUP,
    PITCH_Y2_LABEL_GROUP,
    normalizeEventLabelEntry,
    serializeEventLabels,
    eventLabelDisplayText,
    pitchXYLabelText,
    pitchHasTrajectory,
    isPitchXYLabelText,
    isPitchCoordinateLabel,
    pitchXYPercentText,
    pitchXYGroupedLabels,
    syncEventPitchXYLabel,
  };
});
