'use strict';
(function (root, factory) {
  if (typeof module === 'object' && module !== null && module.exports) {
    module.exports = factory();
  } else {
    root.LatchRNaming = factory();
  }
})(typeof self !== 'undefined' ? self : globalThis, function () {
  const SESSION_NAME_SAFE_DEFAULT = {
    mode: 'competition',
    separator: ' - ',
    order: ['season', 'competition', 'phase', 'matchup', '', ''],
    fields: {
      season: '',
      competition: '',
      phase: '',
      team_a: '',
      team_b: '',
      training_mode: '',
      day_type: '',
      date: '',
    },
  };
  const SESSION_NAME_LIBRARY_SAFE_DEFAULT = {
    seasons: [],
    competitions: [],
    teams: [],
    training_modes: [],
  };

  function sanitizeProjectName(v) {
    const raw = String(v ?? '').trim();
    if (!raw) return '';
    return raw.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim();
  }
  const SESSION_NAME_MODE_COMPETITION = 'competition';
  const SESSION_NAME_MODE_TRAINING = 'training';
  const SESSION_NAME_ORDER_SLOTS = 6;
  const SESSION_NAME_SEPARATOR_OPTIONS = [' - ', '_', ' | ', ' '];
  function sessionNamingMode(v) {
    return String(v || '').trim().toLowerCase() === SESSION_NAME_MODE_TRAINING
      ? SESSION_NAME_MODE_TRAINING
      : SESSION_NAME_MODE_COMPETITION;
  }
  function defaultSessionNamingOrder(mode) {
    return sessionNamingMode(mode) === SESSION_NAME_MODE_TRAINING
      ? ['season', 'training_mode', 'day_type', 'date', 'matchup', '']
      : ['season', 'competition', 'phase', 'matchup', '', ''];
  }
  function defaultSessionNaming(mode) {
    return {
      mode: sessionNamingMode(mode),
      separator: ' - ',
      order: defaultSessionNamingOrder(mode),
      fields: {
        season: '',
        competition: '',
        phase: '',
        team_a: '',
        team_b: '',
        training_mode: '',
        day_type: '',
        date: '',
      },
    };
  }
  function normalizeSessionNamingLibraryValue(value) {
    return sanitizeProjectName(value || '');
  }
  function defaultSessionNamingLibrary() {
    return JSON.parse(JSON.stringify(SESSION_NAME_LIBRARY_SAFE_DEFAULT));
  }
  function normalizeSessionNamingLibrary(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const normalizeList = values => {
      const out = [];
      const seen = new Set();
      (Array.isArray(values) ? values : []).forEach(value => {
        const next = normalizeSessionNamingLibraryValue(value);
        const key = next.toLowerCase();
        if (!next || seen.has(key)) return;
        seen.add(key);
        out.push(next);
      });
      return out;
    };
    return {
      seasons: normalizeList(src.seasons),
      competitions: normalizeList(src.competitions),
      teams: normalizeList(src.teams),
      training_modes: normalizeList(src.training_modes || src.trainingModes),
    };
  }
  function cloneSessionNamingLibrary(raw) {
    return JSON.parse(JSON.stringify(normalizeSessionNamingLibrary(raw)));
  }
  function mergeSessionNamingLibraries(...libs) {
    const out = defaultSessionNamingLibrary();
    const pushAll = (key, values) => {
      const seen = new Set(out[key].map(v => v.toLowerCase()));
      values.forEach(value => {
        const next = normalizeSessionNamingLibraryValue(value);
        const id = next.toLowerCase();
        if (!next || seen.has(id)) return;
        seen.add(id);
        out[key].push(next);
      });
    };
    libs.forEach(lib => {
      const next = normalizeSessionNamingLibrary(lib);
      pushAll('seasons', next.seasons);
      pushAll('competitions', next.competitions);
      pushAll('teams', next.teams);
      pushAll('training_modes', next.training_modes);
    });
    return out;
  }
  function sessionNamingLibraryFromNaming(raw) {
    const meta = normalizeSessionNaming(raw);
    return normalizeSessionNamingLibrary({
      seasons: [meta.fields.season],
      competitions: [meta.fields.competition],
      teams: [meta.fields.team_a, meta.fields.team_b],
      training_modes: [meta.fields.training_mode],
    });
  }
  function sessionNamingTokens(mode) {
    const base = ['', 'season', 'team_a', 'team_b', 'matchup'];
    if (sessionNamingMode(mode) === SESSION_NAME_MODE_TRAINING) {
      return [...base, 'training_mode', 'day_type', 'date'];
    }
    return [...base, 'competition', 'phase'];
  }
  function normalizeSessionNamingToken(mode, token) {
    const value = String(token || '').trim();
    return sessionNamingTokens(mode).includes(value) ? value : '';
  }
  function normalizeSessionNamingDateInput(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    const compact = raw.replace(/[.\-/]/g, '_');
    return /^\d{2}_\d{2}_\d{2,4}$/.test(compact) ? compact : '';
  }
  function normalizeSessionNaming(raw) {
    const mode = sessionNamingMode(raw?.mode);
    const fallback = defaultSessionNaming(mode);
    const fieldsRaw = raw?.fields && typeof raw.fields === 'object' ? raw.fields : raw;
    const next = {
      mode,
      separator: SESSION_NAME_SEPARATOR_OPTIONS.includes(String(raw?.separator || '')) ? String(raw.separator) : fallback.separator,
      order: fallback.order.slice(),
      fields: { ...fallback.fields },
    };
    next.fields.season = sanitizeProjectName(fieldsRaw?.season || '');
    next.fields.competition = sanitizeProjectName(fieldsRaw?.competition || '');
    next.fields.phase = sanitizeProjectName(fieldsRaw?.phase || '');
    next.fields.team_a = sanitizeProjectName(fieldsRaw?.team_a || fieldsRaw?.teamA || '');
    next.fields.team_b = sanitizeProjectName(fieldsRaw?.team_b || fieldsRaw?.teamB || '');
    next.fields.training_mode = sanitizeProjectName(fieldsRaw?.training_mode || fieldsRaw?.trainingMode || '');
    next.fields.day_type = sanitizeProjectName(fieldsRaw?.day_type || fieldsRaw?.dayType || '');
    next.fields.date = normalizeSessionNamingDateInput(fieldsRaw?.date || '');
    const rawOrder = Array.isArray(raw?.order) ? raw.order.slice(0, SESSION_NAME_ORDER_SLOTS) : [];
    const normalizedOrder = rawOrder.map(token => normalizeSessionNamingToken(mode, token));
    if (normalizedOrder.some(Boolean)) {
      while (normalizedOrder.length < SESSION_NAME_ORDER_SLOTS) normalizedOrder.push('');
      next.order = normalizedOrder;
    }
    return next;
  }
  function cloneSessionNaming(raw) {
    return JSON.parse(JSON.stringify(normalizeSessionNaming(raw)));
  }
  function sessionNamingDateToken(value) {
    const raw = normalizeSessionNamingDateInput(value);
    if (!raw) return '';
    if (/^\d{2}_\d{2}_\d{2,4}$/.test(raw)) {
      const parts = raw.split('_');
      const year = parts[2].slice(-2);
      return `${parts[0]}_${parts[1]}_${year}`;
    }
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return '';
    return `${match[3]}_${match[2]}_${match[1].slice(-2)}`;
  }
  function sessionNamingTokenLabel(token) {
    switch (String(token || '').trim()) {
      case 'season': return 'Season';
      case 'competition': return 'Competition / League';
      case 'phase': return 'Phase / Game No.';
      case 'team_a': return 'Team A';
      case 'team_b': return 'Team B';
      case 'matchup': return 'Matchup (A vs B)';
      case 'training_mode': return 'Training Mode';
      case 'day_type': return 'Day Type';
      case 'date': return 'Date (dd_mm_yy)';
      default: return 'Skip';
    }
  }
  function sessionNamingTokenValue(raw, token) {
    const meta = normalizeSessionNaming(raw);
    const key = String(token || '').trim();
    if (!key) return '';
    if (key === 'matchup') {
      const a = String(meta.fields.team_a || '').trim();
      const b = String(meta.fields.team_b || '').trim();
      if (a && b) return `${a} vs ${b}`;
      return a || b || '';
    }
    if (key === 'date') return sessionNamingDateToken(meta.fields.date);
    return String(meta.fields[key] || '').trim();
  }
  function sessionNamingPreview(raw) {
    const meta = normalizeSessionNaming(raw);
    const parts = meta.order.map(token => sessionNamingTokenValue(meta, token)).filter(Boolean);
    return sanitizeProjectName(parts.join(meta.separator));
  }
  function sessionNamingResolvedProjectName(raw, fallback) {
    return sessionNamingPreview(raw) || sanitizeProjectName(fallback) || 'Project';
  }
  function sessionNamingHasData(raw) {
    const meta = normalizeSessionNaming(raw);
    return Object.values(meta.fields).some(v => String(v || '').trim());
  }

  return {
    SESSION_NAME_SAFE_DEFAULT,
    SESSION_NAME_LIBRARY_SAFE_DEFAULT,
    SESSION_NAME_MODE_COMPETITION,
    SESSION_NAME_MODE_TRAINING,
    SESSION_NAME_ORDER_SLOTS,
    SESSION_NAME_SEPARATOR_OPTIONS,
    sanitizeProjectName,
    sessionNamingMode,
    defaultSessionNamingOrder,
    defaultSessionNaming,
    normalizeSessionNamingLibraryValue,
    defaultSessionNamingLibrary,
    normalizeSessionNamingLibrary,
    cloneSessionNamingLibrary,
    mergeSessionNamingLibraries,
    sessionNamingLibraryFromNaming,
    sessionNamingTokens,
    normalizeSessionNamingToken,
    normalizeSessionNamingDateInput,
    normalizeSessionNaming,
    cloneSessionNaming,
    sessionNamingDateToken,
    sessionNamingTokenLabel,
    sessionNamingTokenValue,
    sessionNamingPreview,
    sessionNamingResolvedProjectName,
    sessionNamingHasData,
  };
});
