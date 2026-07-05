'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PITCH_X_LABEL_GROUP,
  PITCH_Y_LABEL_GROUP,
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
} = require('../js/latchr-labels.js');

test('normalizeEventLabelEntry accepts strings and objects, drops empties', () => {
  assert.deepEqual(normalizeEventLabelEntry('goal'), { text: 'goal' });
  assert.deepEqual(normalizeEventLabelEntry({ text: 'shot', group: 'Zone' }), { text: 'shot', group: 'Zone' });
  assert.equal(normalizeEventLabelEntry('   '), null);
  assert.equal(normalizeEventLabelEntry(null), null);
  assert.deepEqual(normalizeEventLabelEntry({ label: 'legacy' }), { text: 'legacy' });
});

test('serializeEventLabels filters invalid entries', () => {
  const out = serializeEventLabels(['a', { text: 'b', group: 'G' }, '', null, 42]);
  assert.deepEqual(out, [{ text: 'a' }, { text: 'b', group: 'G' }]);
  assert.deepEqual(serializeEventLabels('not-an-array'), []);
});

test('eventLabelDisplayText prefixes group', () => {
  assert.equal(eventLabelDisplayText({ text: 'x', group: 'G' }), 'G: x');
  assert.equal(eventLabelDisplayText('plain'), 'plain');
});

test('pitch label text and trajectory detection', () => {
  assert.equal(pitchXYLabelText({ x: 1, y: 2 }), 'XY(1.0,2.0)');
  assert.equal(pitchXYLabelText({ x: 1, y: 2, x2: 3, y2: 4 }), 'XY(1.0,2.0)->(3.0,4.0)');
  assert.equal(pitchHasTrajectory({ x: 1, y: 2, x2: 3, y2: 4 }), true);
  assert.equal(pitchHasTrajectory({ x: 1, y: 2 }), false);
  assert.equal(isPitchXYLabelText('XY(1.0,2.0)'), true);
  assert.equal(isPitchXYLabelText('goal'), false);
});

test('isPitchCoordinateLabel recognizes coordinate groups and legacy text', () => {
  assert.equal(isPitchCoordinateLabel({ text: '10.00', group: 'X' }), true);
  assert.equal(isPitchCoordinateLabel({ text: '10.00', group: 'Y2' }), true);
  assert.equal(isPitchCoordinateLabel({ text: 'XY(1.0,2.0)' }), true);
  assert.equal(isPitchCoordinateLabel({ text: 'goal', group: 'Zone' }), false);
});

test('pitchXYPercentText prefers stored norms, falls back to canvas ratio', () => {
  assert.equal(pitchXYPercentText({ x: 1, y: 1, x_norm: 0.25 }, 'x'), '25.00');
  assert.equal(pitchXYPercentText({ x: 64, y: 1, canvas_width: 128 }, 'x'), '50.00');
  assert.equal(pitchXYPercentText({ x: 1, y: 1 }, 'x'), '');
});

test('syncEventPitchXYLabel injects coordinate labels and strips stale ones', () => {
  const ev = {
    pitch_xy: { x: 10, y: 20, x_norm: 0.1, y_norm: 0.2 },
    labels: [{ text: 'goal' }, { text: '99.99', group: 'X' }, { text: 'XY(1.0,2.0)' }],
  };
  syncEventPitchXYLabel(ev);
  const groups = ev.labels.map(l => l.group || '');
  assert.ok(groups.includes(PITCH_X_LABEL_GROUP));
  assert.ok(groups.includes(PITCH_Y_LABEL_GROUP));
  const texts = ev.labels.map(l => l.text);
  assert.ok(texts.includes('goal'));
  assert.equal(texts.includes('99.99'), false, 'stale X label removed');
  assert.equal(texts.includes('XY(1.0,2.0)'), false, 'legacy XY text removed');
});

test('syncEventPitchXYLabel with no pitch keeps labels untouched', () => {
  const ev = { pitch_xy: null, labels: [{ text: 'goal' }, { text: '50.00', group: 'X' }] };
  syncEventPitchXYLabel(ev);
  assert.deepEqual(ev.labels, [{ text: 'goal' }, { text: '50.00', group: 'X' }]);
});

test('pitchXYGroupedLabels emits one label per available axis', () => {
  const out = pitchXYGroupedLabels({ x: 1, y: 2, x_norm: 0.5, y_norm: 0.5, x2: 3, y2: 4, x2_norm: 0.75, y2_norm: 0.25 });
  assert.deepEqual(out.map(l => l.group), ['X', 'Y', 'X2', 'Y2']);
});
