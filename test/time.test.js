'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  r1, r3, p2, fmt, fmtMS, fms, clamp,
  parseFilterSeconds, parseSignedSeconds, timeRoundForDelta, fmtSignedSeconds,
} = require('../js/latchr-time.js');

test('rounding helpers', () => {
  assert.equal(r1(1.26), 1.3);
  assert.equal(r3(1.23456), 1.235);
  assert.equal(p2(7), '07');
  assert.equal(clamp(5, 0, 3), 3);
  assert.equal(clamp(-1, 0, 3), 0);
  assert.equal(clamp('x', 0, 3), 0);
});

test('fmt renders HH:MM:SS and clamps negatives', () => {
  assert.equal(fmt(3661), '01:01:01');
  assert.equal(fmt(-5), '00:00:00');
  assert.equal(fmt('bad'), '00:00:00');
});

test('fmtMS renders MM:SS', () => {
  assert.equal(fmtMS(75), '01:15');
  assert.equal(fmtMS(0), '00:00');
});

test('fms renders 3-decimal seconds', () => {
  assert.equal(fms(1.5), '1.500');
});

test('parseFilterSeconds accepts seconds, MM:SS and HH:MM:SS', () => {
  assert.equal(parseFilterSeconds('90'), 90);
  assert.equal(parseFilterSeconds('1:30'), 90);
  assert.equal(parseFilterSeconds('01:00:05'), 3605);
  assert.ok(Number.isNaN(parseFilterSeconds('abc')));
  assert.ok(Number.isNaN(parseFilterSeconds('')));
});

test('parseSignedSeconds handles signs, clock format and s suffix', () => {
  assert.equal(parseSignedSeconds('+2s'), 2);
  assert.equal(parseSignedSeconds('-1:30'), -90);
  assert.equal(parseSignedSeconds('0.5'), 0.5);
  assert.ok(Number.isNaN(parseSignedSeconds('junk')));
});

test('timeRoundForDelta picks fine rounding for sub-0.1s deltas', () => {
  assert.equal(timeRoundForDelta(0.033)(1.23456), 1.235);
  assert.equal(timeRoundForDelta(0.5)(1.23456), 1.2);
});

test('fmtSignedSeconds formats compactly with sign', () => {
  assert.equal(fmtSignedSeconds(2), '+2s');
  assert.equal(fmtSignedSeconds(-0.5), '-0.5s');
  assert.equal(fmtSignedSeconds(0), '+0s');
});
