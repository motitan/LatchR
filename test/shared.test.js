'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizePitchXY,
  normalizeTemplateSchemaKeys,
  rgbToHex,
  hexToRgb,
} = require('../js/latchr-shared.js');

test('normalizePitchXY rejects missing or non-numeric coordinates', () => {
  assert.equal(normalizePitchXY(null), null);
  assert.equal(normalizePitchXY({}), null);
  assert.equal(normalizePitchXY({ x: 'a', y: 2 }), null);
  assert.equal(normalizePitchXY({ x: 1 }), null);
});

test('normalizePitchXY rounds coordinates and clamps norms', () => {
  const out = normalizePitchXY({ x: 1.23456, y: 2.98765, x_norm: 1.5, y_norm: -0.2 });
  assert.equal(out.x, 1.235);
  assert.equal(out.y, 2.988);
  assert.equal(out.x_norm, 1);
  assert.equal(out.y_norm, 0);
});

test('normalizePitchXY keeps trajectory only when both ends are numeric', () => {
  const withTraj = normalizePitchXY({ x: 0, y: 0, x2: 10, y2: 20 });
  assert.equal(withTraj.x2, 10);
  assert.equal(withTraj.y2, 20);
  const noTraj = normalizePitchXY({ x: 0, y: 0, x2: 10 });
  assert.equal('x2' in noTraj, false);
});

test('normalizePitchXY keeps canvas size only when positive', () => {
  const out = normalizePitchXY({ x: 0, y: 0, canvas_width: 0, canvas_height: 720 });
  assert.equal('canvas_width' in out, false);
  assert.equal(out.canvas_height, 720);
});

test('normalizePitchXY carries page metadata', () => {
  const out = normalizePitchXY({ x: 0, y: 0, page_index: 1.6, page_name: ' Pitch ' });
  assert.equal(out.page_index, 2);
  assert.equal(out.page_name, 'Pitch');
});

test('normalizeTemplateSchemaKeys migrates legacy tagging-* keys', () => {
  const legacy = {
    'tagging-pages': [{ 'template_page-index': 0 }],
    'tagging-window': { 'tagging-window-items': [{ 'tagging-window-item-id': 1 }] },
  };
  const out = normalizeTemplateSchemaKeys(legacy);
  assert.ok(Array.isArray(out['event-pages']));
  assert.ok(out['event-window']);
  assert.equal(out['event-window']['event-window-items'][0]['event-window-item-id'], 1);
  assert.equal('tagging-pages' in out, false);
});

test('normalizeTemplateSchemaKeys passes through modern and non-object input', () => {
  const modern = { 'event-pages': [] };
  assert.equal(normalizeTemplateSchemaKeys(modern), modern);
  assert.equal(normalizeTemplateSchemaKeys(null), null);
  const arr = [1, 2];
  assert.equal(normalizeTemplateSchemaKeys(arr), arr);
});

test('rgbToHex and hexToRgb round-trip; invalid hex falls back', () => {
  assert.equal(rgbToHex(216, 208, 198), '#d8d0c6');
  assert.deepEqual(hexToRgb('#d8d0c6'), [216, 208, 198]);
  assert.deepEqual(hexToRgb('nope'), [38, 79, 130]);
  assert.equal(rgbToHex(300, -5, 12.6), '#ff000d');
});
