'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SESSION_NAME_MODE_TRAINING,
  sanitizeProjectName,
  sessionNamingMode,
  defaultSessionNaming,
  normalizeSessionNaming,
  normalizeSessionNamingDateInput,
  sessionNamingDateToken,
  sessionNamingTokenValue,
  sessionNamingPreview,
  sessionNamingResolvedProjectName,
  sessionNamingHasData,
  normalizeSessionNamingLibrary,
  mergeSessionNamingLibraries,
  sessionNamingLibraryFromNaming,
} = require('../js/latchr-naming.js');

test('sanitizeProjectName strips filesystem-unsafe characters', () => {
  assert.equal(sanitizeProjectName('A/B:C*D?'), 'A_B_C_D_');
  assert.equal(sanitizeProjectName('  spaced   out  '), 'spaced out');
  assert.equal(sanitizeProjectName(''), '');
});

test('sessionNamingMode defaults to competition', () => {
  assert.equal(sessionNamingMode('training'), 'training');
  assert.equal(sessionNamingMode('TRAINING'), SESSION_NAME_MODE_TRAINING);
  assert.equal(sessionNamingMode('whatever'), 'competition');
});

test('normalizeSessionNaming falls back to defaults for junk input', () => {
  const out = normalizeSessionNaming({ separator: '<<>>', order: ['bogus'] });
  const def = defaultSessionNaming('competition');
  assert.equal(out.separator, def.separator);
  assert.deepEqual(out.order, def.order);
});

test('normalizeSessionNaming keeps a partially valid custom order, padded to 6 slots', () => {
  const out = normalizeSessionNaming({ order: ['matchup', 'season'] });
  assert.equal(out.order.length, 6);
  assert.equal(out.order[0], 'matchup');
  assert.equal(out.order[1], 'season');
});

test('date input accepts ISO and dd_mm_yy-like forms only', () => {
  assert.equal(normalizeSessionNamingDateInput('2026-07-06'), '2026-07-06');
  assert.equal(normalizeSessionNamingDateInput('06/07/2026'), '06_07_2026');
  assert.equal(normalizeSessionNamingDateInput('06.07.26'), '06_07_26');
  assert.equal(normalizeSessionNamingDateInput('yesterday'), '');
});

test('sessionNamingDateToken renders dd_mm_yy', () => {
  assert.equal(sessionNamingDateToken('2026-07-06'), '06_07_26');
  assert.equal(sessionNamingDateToken('06_07_2026'), '06_07_26');
  assert.equal(sessionNamingDateToken(''), '');
});

test('matchup token joins both teams, falls back to either one', () => {
  const both = { fields: { team_a: 'Salvador', team_b: 'Burgos' } };
  assert.equal(sessionNamingTokenValue(both, 'matchup'), 'Salvador vs Burgos');
  const one = { fields: { team_a: 'Salvador' } };
  assert.equal(sessionNamingTokenValue(one, 'matchup'), 'Salvador');
});

test('preview joins only non-empty tokens with the separator', () => {
  const naming = {
    mode: 'competition',
    separator: ' - ',
    order: ['season', 'competition', 'phase', 'matchup', '', ''],
    fields: { season: '25-26', competition: 'Liga', team_a: 'A', team_b: 'B' },
  };
  assert.equal(sessionNamingPreview(naming), '25-26 - Liga - A vs B');
});

test('resolved project name falls back when naming is empty', () => {
  assert.equal(sessionNamingResolvedProjectName({}, 'My Video'), 'My Video');
  assert.equal(sessionNamingResolvedProjectName({}, ''), 'Project');
  assert.equal(sessionNamingHasData({}), false);
});

test('library normalization dedupes case-insensitively', () => {
  const out = normalizeSessionNamingLibrary({ teams: ['Ajax', 'ajax', ' AJAX ', 'PSV'] });
  assert.deepEqual(out.teams, ['Ajax', 'PSV']);
});

test('library merge unions values across sources', () => {
  const merged = mergeSessionNamingLibraries(
    { teams: ['Ajax'] },
    { teams: ['psv'], seasons: ['25-26'] },
  );
  assert.deepEqual(merged.teams, ['Ajax', 'psv']);
  assert.deepEqual(merged.seasons, ['25-26']);
});

test('library extraction pulls fields from a naming object', () => {
  const lib = sessionNamingLibraryFromNaming({
    fields: { season: '25-26', team_a: 'A', team_b: 'B', training_mode: 'Gym' },
  });
  assert.deepEqual(lib.seasons, ['25-26']);
  assert.deepEqual(lib.teams, ['A', 'B']);
  assert.deepEqual(lib.training_modes, ['Gym']);
});
