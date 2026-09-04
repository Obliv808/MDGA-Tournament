/* ============================================================
   MDGA Arena Tournament Bracket — app.js
   Single-elimination generator with seeding + byes.
   Pure logic, no dependencies. State persists to localStorage.
   ============================================================ */
(function () {
  'use strict';

  const STORAGE_KEY = 'mdga_tournament_v1';
  const NS = 'http://www.w3.org/2000/svg';
  const MIN_TEAMS = 2;
  const MAX_TEAMS = 32;

  const BRACKET_TYPES = {
    '2v2': { label: '2v2 Arena', players: 2 },
    '3v3': { label: '3v3 Arena', players: 3 },
    '5v5': { label: '5v5 Arena', players: 5 }
  };

  // Player count for a bracket type. Handles the three built-in presets
  // plus custom "NvN" labels generated from Solo Shuffle team sizes.
  function playerCountFor(type) {
    if (BRACKET_TYPES[type]) return BRACKET_TYPES[type].players;
    const n = parseInt(String(type), 10);
    return n > 0 ? n : 1;
  }

  /* ---------------- State ---------------- */
  let state = null;
  let lastWinners = {};   // key "r-i" -> winner (0/1/null) from last render

  function defaultTeams(count, playerCount) {
    return Array.from({ length: count }, () => ({
      name: '',
      players: new Array(playerCount).fill(''),
      roles: new Array(playerCount).fill('dps')
    }));
  }

  function freshState() {
    return {
      guildName: 'Make Durotar Great Again',
      abbr: 'MDGA',
      mode: 'bracket',
      bracketType: '3v3',
      matchFormat: 1,
      teamCount: 8,
      teams: defaultTeams(8, BRACKET_TYPES['3v3'].players),
      scores: {},
      view: 'setup',
      arenaUseRoles: false,
      soloPlayers: [],
      soloTeamSize: 3,
      soloUseRoles: false
    };
  }

  function saveState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return freshState();
      const s = JSON.parse(raw);
      const base = freshState();
      // merge with defaults for safety
      state = Object.assign(base, s);
      state.bracketType = (BRACKET_TYPES[state.bracketType] || /^\d+v\d+$/.test(state.bracketType)) ? state.bracketType : '3v3';
      if (![1, 3, 5].includes(state.matchFormat)) state.matchFormat = 1;
      const pc = playerCountFor(state.bracketType);
      // normalise teams
      if (!Array.isArray(state.teams) || state.teams.length < MIN_TEAMS) {
        state.teamCount = 8;
        state.teams = defaultTeams(8, pc);
      }
      state.teamCount = state.teams.length;
      state.teams = state.teams.map(t => ({
        name: (t && t.name) || '',
        players: Array.from({ length: pc }, (_, i) => ((t && t.players && t.players[i]) || '')),
        roles: Array.from({ length: pc }, (_, i) => ((t && Array.isArray(t.roles) && t.roles[i] === 'healer') ? 'healer' : 'dps'))
      }));
      if (!state.scores || typeof state.scores !== 'object') state.scores = {};
      state.view = (state.view === 'bracket' || state.view === 'setup') ? state.view : 'setup';
      state.mode = state.mode === 'solo' ? 'solo' : 'bracket';
      state.arenaUseRoles = !!state.arenaUseRoles;
      state.soloUseRoles = !!state.soloUseRoles;
      state.soloPlayers = Array.isArray(state.soloPlayers)
        ? state.soloPlayers
            .map(p => {
              if (typeof p === 'string') return { name: p.trim(), role: 'dps' };
              if (p && typeof p === 'object' && typeof p.name === 'string') {
                return { name: p.name.trim(), role: p.role === 'healer' ? 'healer' : 'dps' };
              }
              return null;
            })
            .filter(p => p && p.name)
        : [];
      const sz = Math.round(+state.soloTeamSize);
      state.soloTeamSize = Number.isFinite(sz) && sz >= 1 ? Math.min(99, Math.max(1, sz)) : 3;
      return state;
    } catch (e) {
      return freshState();
    }
  }

  function invalidateScores() { state.scores = {}; saveState(); }

  /* ---------------- Bracket math ---------------- */
  function nextPow2(n) { let p = 1; while (p < n) p *= 2; return p; }

  // Standard tournament seed order for a bracket of size B (power of 2).
  // Guarantees seed 1 & 2 in opposite halves, etc.
  function seedOrder(B) {
    if (B === 1) return [1];
    const half = seedOrder(B / 2);
    const res = [];
    for (const s of half) { res.push(s); res.push(B + 1 - s); }
    return res;
  }

  // Pure: derives the whole bracket from teams + scores.
  function computeBracket() {
    const teams = state.teams;
    const N = teams.length;
    if (N < MIN_TEAMS) return null;
    const B = nextPow2(N);
    const order = seedOrder(B);
    const needed = Math.ceil(state.matchFormat / 2);

    // Round 0 placement from seeding; positions beyond N are byes.
    let level = [];
    for (let i = 0; i < B; i += 2) {
      const sa = order[i], sb = order[i + 1];
      const ta = sa <= N ? teams[sa - 1] : null;
      const tb = sb <= N ? teams[sb - 1] : null;
      if (ta) ta._seed = sa;
      if (tb) tb._seed = sb;
      level.push({ a: ta, b: tb });
    }

    const rounds = [];
    let champion = null;
    while (level.length > 0) {
      for (let i = 0; i < level.length; i++) {
        const m = level[i];
        const sc = state.scores[rounds.length + '-' + i] || { a: 0, b: 0 };
        m.scoreA = sc.a || 0;
        m.scoreB = sc.b || 0;
        if (rounds.length === 0) {
          // Round 1: a missing side is a structural BYE -> the other team advances.
          if (m.a && !m.b) m.winner = 0;
          else if (!m.a && m.b) m.winner = 1;
          else if (m.scoreA >= needed) m.winner = 0;   // A reached required games
          else if (m.scoreB >= needed) m.winner = 1;
          else m.winner = null;
        } else {
          // Later rounds: a missing side means PENDING (upstream undecided), not a bye.
          if (m.a && m.b && m.scoreA >= needed) m.winner = 0;
          else if (m.a && m.b && m.scoreB >= needed) m.winner = 1;
          else m.winner = null;
        }
      }
      rounds.push(level);
      if (level.length === 1) {
        // Only crown a champion once the final is actually decided.
        const fin = level[0];
        champion = fin.winner === 0 ? fin.a : (fin.winner === 1 ? fin.b : null);
        break;
      }
      const next = [];
      for (let i = 0; i < level.length; i += 2) {
        const wA = level[i].winner === null ? null : (level[i].winner === 0 ? level[i].a : level[i].b);
        const wB = level[i + 1].winner === null ? null : (level[i + 1].winner === 0 ? level[i + 1].a : level[i + 1].b);
        next.push({ a: wA, b: wB });
      }
      level = next;
    }
    return { B, N, rounds, champion, numRounds: Math.log2(B), needed };
  }

  function roundLabel(count) {
    if (count === 2) return 'Grand Final';
    if (count === 4) return 'Semifinals';
    if (count === 8) return 'Quarterfinals';
    return 'Round of ' + count;
  }

  /* ---------------- DOM refs ---------------- */
  let els = {};
  function cacheEls() {
    els = {
      subtitle: document.getElementById('bracketSubtitle'),
      setupView: document.getElementById('setupView'),
      bracketView: document.getElementById('bracketView'),
      bracketTypeRow: document.getElementById('bracketTypeRow'),
      matchFormatRow: document.getElementById('matchFormatRow'),
      teamCountValue: document.getElementById('teamCountValue'),
      incTeams: document.getElementById('incTeams'),
      decTeams: document.getElementById('decTeams'),
      teamList: document.getElementById('teamList'),
      shuffleBtn: document.getElementById('shuffleBtn'),
      resetTeamsBtn: document.getElementById('resetTeamsBtn'),
      generateBtn: document.getElementById('generateBtn'),
      editSetupBtn: document.getElementById('editSetupBtn'),
      newTournamentBtn: document.getElementById('newTournamentBtn'),
      printBtn: document.getElementById('printBtn'),
      infoType: document.getElementById('infoType'),
      infoFormat: document.getElementById('infoFormat'),
      infoTeams: document.getElementById('infoTeams'),
      champBanner: document.getElementById('championBanner'),
      champName: document.getElementById('champName'),
      canvas: document.getElementById('bracketCanvas'),
      copyResultsBtn: document.getElementById('copyResultsBtn'),
      byePreview: document.getElementById('byePreview'),
      arenaUseRolesToggle: document.getElementById('arenaUseRolesToggle'),
      modeBar: document.getElementById('modeBar'),
      soloView: document.getElementById('soloView'),
      soloSizeInput: document.getElementById('soloSizeInput'),
      soloSizePresets: document.getElementById('soloSizePresets'),
      soloUseRolesToggle: document.getElementById('soloUseRolesToggle'),
      soloPasteBox: document.getElementById('soloPasteBox'),
      soloPasteAddBtn: document.getElementById('soloPasteAddBtn'),
      soloAddInput: document.getElementById('soloAddInput'),
      soloAddRole: document.getElementById('soloAddRole'),
      soloAddBtn: document.getElementById('soloAddBtn'),
      soloChips: document.getElementById('soloChips'),
      soloShuffleBtn: document.getElementById('soloShuffleBtn'),
      soloClearBtn: document.getElementById('soloClearBtn'),
      soloStatus: document.getElementById('soloStatus'),
      soloResults: document.getElementById('soloResults')
    };
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ---------------- Setup view ---------------- */
  function renderSetup() {
    els.teamCountValue.textContent = state.teams.length;
    // toggle button active states
    els.bracketTypeRow.querySelectorAll('.toggle-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.type === state.bracketType));
    els.matchFormatRow.querySelectorAll('.toggle-btn').forEach(b =>
      b.classList.toggle('active', +b.dataset.format === state.matchFormat));
    if (els.arenaUseRolesToggle) els.arenaUseRolesToggle.checked = !!state.arenaUseRoles;

    let html = '';
    state.teams.forEach((t, i) => {
      if (!Array.isArray(t.roles) || t.roles.length !== t.players.length) {
        t.roles = t.players.map((_, idx) => (t.roles && t.roles[idx]) || 'dps');
      }
      const players = t.players.map((p, j) => {
        const isHealer = t.roles[j] === 'healer';
        return `<div class="player-row"><span class="player-index">${j + 1}</span>` +
          `<input class="player-input" data-team="${i}" data-player="${j}" value="${escapeHtml(p)}" placeholder="Player ${j + 1}">` +
          `<button type="button" class="role-toggle ${isHealer ? 'role-healer' : 'role-dps'}" data-action="toggle-role" data-team="${i}" data-player="${j}" title="${isHealer ? 'Healer \u2014 click to set DPS' : 'DPS \u2014 click to set Healer'}">${isHealer ? 'H' : 'D'}</button></div>`;
      }).join('');

      let roleCheckHtml = '';
      if (state.arenaUseRoles) {
        const filled = t.players.map((p, j) => ({ p, role: t.roles[j] })).filter(x => x.p && x.p.trim());
        if (filled.length > 0) {
          const healerCount = filled.filter(x => x.role === 'healer').length;
          const ok = healerCount === 1;
          const msg = ok ? '&#10003; 1 healer' : (healerCount === 0 ? '&#9888; No healer set' : `&#9888; ${healerCount} healers (need 1)`);
          roleCheckHtml = `<div class="role-check ${ok ? 'ok' : 'warn'}">${msg}</div>`;
        }
      }

      html += (
        `<div class="team-card">
          <div class="team-head">
            <span class="seed-badge">${i + 1}</span>
            <input class="team-name-input" data-team="${i}" data-field="name" value="${escapeHtml(t.name)}" placeholder="Team ${i + 1}">
            <div class="reorder">
              <button type="button" data-action="up" data-team="${i}" title="Move up">&#9650;</button>
              <button type="button" data-action="down" data-team="${i}" title="Move down">&#9660;</button>
            </div>
            <button type="button" class="team-del" data-action="del" data-team="${i}" title="Remove team">&times;</button>
          </div>
          <div class="players">${players}</div>
          ${roleCheckHtml}
        </div>`
      );
    });
    els.teamList.innerHTML = html;
    renderByePreview();
  }

  /* ---------------- Bye preview (setup) ---------------- */
  // Returns the seeds that receive byes for the current team count.
  function byeSeeds() {
    const N = state.teams.length;
    const B = nextPow2(N);
    if (B <= N) return [];
    const order = seedOrder(B);
    const seeds = [];
    for (let i = 0; i < B; i += 2) {
      const sa = order[i], sb = order[i + 1];
      if (sa > N && sb <= N) seeds.push(sb);   // A empty, B is a real team -> B gets bye
      else if (sb > N && sa <= N) seeds.push(sa);
    }
    return seeds.sort((a, b) => a - b);
  }

  function renderByePreview() {
    const box = els.byePreview;
    if (!box) return;
    const N = state.teams.length;
    const B = nextPow2(N);
    const byes = byeSeeds();

    if (byes.length === 0) {
      box.classList.remove('hidden');
      box.innerHTML = `<div class="bye-ok">&#10003; Full bracket of ${B} teams &mdash; no byes.</div>`;
      return;
    }

    const names = byes.map(s => {
      const t = state.teams[s - 1];
      return `seed ${s}${t && t.name.trim() ? ' ' + escapeHtml(t.name) : ''}`;
    }).join(', ');

    const lopsided = byes.length >= Math.ceil(N / 2);
    // Suggest the nearest "clean" counts: next power of two, and B-1 if > N.
    let suggestions = [];
    if (B <= MAX_TEAMS && B > N) suggestions.push(B);        // pad to full bracket
    const prevPow2 = Math.floor(Math.log2(N));
    const lower = Math.pow(2, prevPow2);
    if (lower >= MIN_TEAMS && lower < N) suggestions.push(lower);  // drop below current pow2
    suggestions = [...new Set(suggestions)].sort((a, b) => a - b);
    const suggestHtml = suggestions.length
      ? `<div class="bye-suggest">Consider <button type="button" class="count-chip" data-count="${suggestions[0]}">${suggestions[0]}</button>` +
        (suggestions.length > 1 ? ` or <button type="button" class="count-chip" data-count="${suggestions[1]}">${suggestions[1]}</button>` : '') +
        ` teams.</div>`
      : '';

    box.classList.remove('hidden');
    box.innerHTML =
      `<div class="bye-warn">&#9888; ${byes.length} of ${N} teams get a bye: <strong>${names}</strong>.</div>` +
      (lopsided ? `<div class="bye-lop">That leaves an uneven bracket &mdash; most teams skip round one.</div>` : '') +
      suggestHtml;
  }

  function setTeamCount(n) {
    n = Math.max(MIN_TEAMS, Math.min(MAX_TEAMS, n));
    const pc = playerCountFor(state.bracketType);
    if (n > state.teams.length) {
      while (state.teams.length < n) state.teams.push({ name: '', players: new Array(pc).fill(''), roles: new Array(pc).fill('dps') });
    } else if (n < state.teams.length) {
      state.teams = state.teams.slice(0, n);
    }
    state.teamCount = n;
    invalidateScores();   // roster shape changed
    saveState();
    renderSetup();
  }

  function reorder(i, dir) {
    const j = i + dir;
    if (j < 0 || j >= state.teams.length) return;
    const tmp = state.teams[i]; state.teams[i] = state.teams[j]; state.teams[j] = tmp;
    invalidateScores();
    saveState();
    renderSetup();
  }

  function shuffleTeams() {
    // Fisher-Yates on team order (keeps rosters with their teams)
    for (let i = state.teams.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [state.teams[i], state.teams[j]] = [state.teams[j], state.teams[i]];
    }
    invalidateScores();
    saveState();
    renderSetup();
  }

  function resetTeams() {
    if (!confirm('Clear all team names and player rosters?\n\nThis keeps your bracket type, match format, and number of teams.')) return;
    const pc = playerCountFor(state.bracketType);
    state.teams.forEach(t => { t.name = ''; t.players = new Array(pc).fill(''); t.roles = new Array(pc).fill('dps'); });
    invalidateScores();
    saveState();
    renderSetup();
  }

  function setBracketType(type) {
    if (!BRACKET_TYPES[type] || type === state.bracketType) return;
    state.bracketType = type;
    const pc = BRACKET_TYPES[type].players;
    // resize each team's roster, preserving existing names + roles
    state.teams.forEach(t => {
      const next = new Array(pc).fill('');
      const nextRoles = new Array(pc).fill('dps');
      for (let i = 0; i < Math.min(pc, t.players.length); i++) {
        next[i] = t.players[i];
        nextRoles[i] = (t.roles && t.roles[i] === 'healer') ? 'healer' : 'dps';
      }
      t.players = next;
      t.roles = nextRoles;
    });
    saveState();
    renderSetup();
  }

  function setMatchFormat(f) {
    f = +f;
    if (![1, 3, 5].includes(f) || f === state.matchFormat) return;
    state.matchFormat = f;
    invalidateScores();   // winning threshold changed
    saveState();
    renderSetup();
  }

  /* ---------------- Solo Shuffle Wargames ---------------- */
  // Split on newlines or commas, trim, drop blanks.
  function parseNames(raw) {
    return String(raw || '')
      .split(/[\n,]+/)
      .map(s => s.trim())
      .filter(Boolean);
  }

  // Adds names, skipping case-insensitive duplicates already in the list.
  function addSoloNames(names, role) {
    if (!names || !names.length) return 0;
    role = role === 'healer' ? 'healer' : 'dps';
    const seen = new Set(state.soloPlayers.map(p => p.name.toLowerCase()));
    let added = 0;
    names.forEach(n => {
      const key = n.toLowerCase();
      if (!seen.has(key)) { state.soloPlayers.push({ name: n, role }); seen.add(key); added++; }
    });
    if (added > 0) { saveState(); renderSoloChips(); }
    return added;
  }

  function toggleSoloPlayerRole(idx) {
    const p = state.soloPlayers[idx]; if (!p) return;
    p.role = p.role === 'healer' ? 'dps' : 'healer';
    saveState();
    renderSoloChips();
  }

  function removeSoloPlayer(idx) {
    state.soloPlayers.splice(idx, 1);
    saveState();
    renderSoloChips();
  }

  function clearSoloPlayers() {
    state.soloPlayers = [];
    saveState();
    renderSoloChips();
    lastSoloTeams = [];
    lastSoloByes = [];
    if (els.soloResults) els.soloResults.innerHTML = '';
  }

  function setSoloTeamSize(n) {
    n = Math.max(1, Math.min(99, Math.round(n) || 1));
    state.soloTeamSize = n;
    saveState();
    renderSoloChips();
  }

  function renderSoloChips() {
    if (!els.soloChips) return;
    const list = state.soloPlayers;
    els.soloChips.innerHTML = list.map((p, i) => {
      const isHealer = p.role === 'healer';
      return `<span class="solo-chip">` +
        `<button type="button" class="role-toggle ${isHealer ? 'role-healer' : 'role-dps'}" data-action="toggle-role" data-index="${i}" title="${isHealer ? 'Healer \u2014 click to set DPS' : 'DPS \u2014 click to set Healer'}">${isHealer ? 'H' : 'D'}</button>` +
        `<span class="chip-name">${escapeHtml(p.name)}</span>` +
        `<button type="button" class="chip-remove" data-action="remove" data-index="${i}" title="Remove ${escapeHtml(p.name)}">&times;</button></span>`;
    }).join('');

    els.soloSizeInput.value = state.soloTeamSize;
    els.soloSizePresets.querySelectorAll('.toggle-btn').forEach(b =>
      b.classList.toggle('active', +b.dataset.size === state.soloTeamSize));
    if (els.soloUseRolesToggle) els.soloUseRolesToggle.checked = !!state.soloUseRoles;

    const n = list.length, size = state.soloTeamSize;
    els.soloStatus.classList.remove('hidden', 'warn');
    if (n === 0) {
      els.soloStatus.textContent = 'Add players above, then shuffle them into teams.';
    } else if (state.soloUseRoles) {
      const healerCount = list.filter(p => p.role === 'healer').length;
      const dpsCount = n - healerCount;
      const dpsPerTeam = Math.max(size - 1, 0);
      const maxByDps = dpsPerTeam > 0 ? Math.floor(dpsCount / dpsPerTeam) : healerCount;
      const maxTeams = Math.min(healerCount, maxByDps);
      let msg = `${n} players (${healerCount} healer${healerCount === 1 ? '' : 's'}, ${dpsCount} dps) \u2192 up to ${maxTeams} team${maxTeams === 1 ? '' : 's'} of ${size} (1 healer each)`;
      if (maxTeams === 0) {
        msg = `Need at least 1 healer${dpsPerTeam > 0 ? ' and ' + dpsPerTeam + ' dps' : ''} per team of ${size}. ` + msg;
        els.soloStatus.classList.add('warn');
      }
      els.soloStatus.textContent = msg;
    } else {
      const fullTeams = Math.floor(n / size);
      const leftover = n % size;
      let msg = `${n} player${n === 1 ? '' : 's'} \u2192 ${fullTeams} team${fullTeams === 1 ? '' : 's'} of ${size}`;
      if (leftover > 0) {
        msg += `, ${leftover} on standby (bye)`;
        els.soloStatus.classList.add('warn');
      }
      els.soloStatus.textContent = msg;
    }
  }

  let lastSoloTeams = [];
  let lastSoloByes = [];

  function fisherYates(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function shuffleSolo() {
    if (state.soloUseRoles) shuffleSoloWithRoles();
    else shuffleSoloPlain();
  }

  function shuffleSoloPlain() {
    const size = state.soloTeamSize;
    const pool = fisherYates(state.soloPlayers.slice());
    if (pool.length < size) {
      alert(`You need at least ${size} player${size === 1 ? '' : 's'} to form one team of ${size}.`);
      return;
    }
    const teams = [];
    let i = 0;
    for (; i + size <= pool.length; i += size) teams.push(pool.slice(i, i + size));
    const byes = pool.slice(i);
    renderSoloResults(teams, byes);
  }

  // Guarantees exactly 1 healer per team, with the remaining slots filled
  // by DPS. Number of teams is capped by whichever role runs out first.
  function shuffleSoloWithRoles() {
    const size = state.soloTeamSize;
    const dpsPerTeam = Math.max(size - 1, 0);
    const healers = fisherYates(state.soloPlayers.filter(p => p.role === 'healer').slice());
    const dps = fisherYates(state.soloPlayers.filter(p => p.role !== 'healer').slice());
    const maxByDps = dpsPerTeam > 0 ? Math.floor(dps.length / dpsPerTeam) : healers.length;
    const numTeams = Math.min(healers.length, maxByDps);

    if (numTeams < 1) {
      alert(`Not enough players to form a team of ${size} with 1 healer each. You need at least 1 healer${dpsPerTeam > 0 ? ' and ' + dpsPerTeam + ' DPS' : ''} per team.`);
      return;
    }

    const teams = [];
    for (let t = 0; t < numTeams; t++) {
      const team = [healers[t]].concat(dps.slice(t * dpsPerTeam, (t + 1) * dpsPerTeam));
      teams.push(fisherYates(team));
    }
    const byes = healers.slice(numTeams).concat(dps.slice(numTeams * dpsPerTeam));
    renderSoloResults(teams, byes);
  }

  function renderSoloResults(teams, byes) {
    lastSoloTeams = teams;
    lastSoloByes = byes;

    let html = '';
    if (teams.length) {
      html += `<div class="solo-results-toolbar">
        <div class="solo-results-count">${teams.length} team${teams.length === 1 ? '' : 's'} of ${state.soloTeamSize}${state.soloUseRoles ? ' \u2022 1 healer each' : ''}</div>
        <button type="button" class="primary-btn" data-action="generate-bracket">Generate Bracket &rarr;</button>
      </div>`;
    }
    html += '<div class="solo-team-grid">';
    teams.forEach((team, i) => {
      html += `<div class="solo-team-card">
        <div class="solo-team-head"><span class="seed-badge">${i + 1}</span><span class="solo-team-name">Team ${i + 1}</span></div>
        <ul>${team.map(p => `<li><span class="role-tag ${p.role === 'healer' ? 'healer' : 'dps'}">${p.role === 'healer' ? 'H' : 'D'}</span>${escapeHtml(p.name)}</li>`).join('')}</ul>
      </div>`;
    });
    html += '</div>';
    if (byes.length) {
      html += `<div class="solo-byes">
        <div class="solo-byes-title">Byes this round</div>
        <div class="solo-byes-list">${byes.map(p => `<span>${p.role === 'healer' ? 'H \u00b7 ' : ''}${escapeHtml(p.name)}</span>`).join('')}</div>
      </div>`;
    }
    els.soloResults.innerHTML = html;
  }

  // Sends the last shuffled solo teams into the Arena Bracket flow, just
  // like a normal roster, then jumps straight to the generated bracket.
  function generateBracketFromSolo() {
    if (lastSoloTeams.length < MIN_TEAMS) {
      alert('You need at least 2 full teams to generate a bracket. Add more players or lower the team size.');
      return;
    }
    if (lastSoloByes.length > 0) {
      const ok = confirm(`${lastSoloByes.length} player${lastSoloByes.length === 1 ? "" : "s"} didn't fill a full team and will sit this bracket out. Continue?`);
      if (!ok) return;
    }
    const size = state.soloTeamSize;
    state.bracketType = size + 'v' + size;
    state.matchFormat = [1, 3, 5].includes(state.matchFormat) ? state.matchFormat : 1;
    state.arenaUseRoles = state.soloUseRoles;
    state.teams = lastSoloTeams.map((team, i) => ({
      name: 'Team ' + (i + 1),
      players: team.map(p => p.name),
      roles: team.map(p => p.role === 'healer' ? 'healer' : 'dps')
    }));
    state.teamCount = state.teams.length;
    invalidateScores();
    saveState();
    renderSetup();
    setMode('bracket');
    showView('bracket');
    renderBracket();
  }

  /* ---------------- Bracket view ---------------- */
  function sideHtml(team, opts) {
    const { winner, isBye, isTbd, enabled, score, max, r, i, sideKey } = opts;
    let cls = 'side';
    if (winner) cls += ' winner';
    if (isBye) cls += ' bye';
    if (isTbd) cls += ' tbd';

    let nameText, rosterHtml = '';
    if (team) {
      nameText = team.name.trim() ? team.name : ('Team ' + (team._seed || '?'));
      const rosterEntries = team.players
        .map((p, idx) => ({ name: p, role: (team.roles && team.roles[idx] === 'healer') ? 'healer' : 'dps' }))
        .filter(e => e.name && e.name.trim());
      if (rosterEntries.length) {
        const rosterText = rosterEntries.map(e => (e.role === 'healer' ? 'H: ' : '') + e.name).join(' \u00b7 ');
        rosterHtml = `<span class="roster">${escapeHtml(rosterText)}</span>`;
      }
    } else if (isBye) {
      nameText = 'BYE';
    } else {
      nameText = 'TBD';
    }

    let nameCls = 'team-name';
    let winAttr = '';
    if (team && enabled) {
      nameCls += ' clickable';
      winAttr = ` data-action="win" data-round="${r}" data-index="${i}" data-side="${sideKey}"`;
    }
    const scoreInput = enabled
      ? `<input class="score" type="number" min="0" max="${max}" value="${score}" data-round="${r}" data-index="${i}" data-side="${sideKey}">`
      : '';

    return `<div class="${cls}"><span class="${nameCls}"${winAttr}>${escapeHtml(nameText)}${rosterHtml}</span>${scoreInput}</div>`;
  }

  function matchHtml(m, r, i) {
    const needed = Math.ceil(state.matchFormat / 2);
    const isR0 = r === 0;
    const hasA = !!m.a, hasB = !!m.b;
    const active = hasA && hasB;

    let html;
    if (active) {
      // Both teams known -> scoreable.
      html = sideHtml(m.a, { winner: m.winner === 0, isBye: false, isTbd: false, enabled: true, score: m.scoreA, max: needed, r, i, sideKey: 'a' })
           + sideHtml(m.b, { winner: m.winner === 1, isBye: false, isTbd: false, enabled: true, score: m.scoreB, max: needed, r, i, sideKey: 'b' });
    } else if (isR0 && hasA) {
      // Round 1 structural bye -> A advances.
      html = sideHtml(m.a, { winner: true, isBye: false, isTbd: false, enabled: false, score: m.scoreA, max: needed, r, i, sideKey: 'a' })
           + sideHtml(null, { winner: false, isBye: true, isTbd: false, enabled: false, score: 0, max: needed, r, i, sideKey: 'b' });
    } else if (isR0 && hasB) {
      // Round 1 structural bye -> B advances.
      html = sideHtml(null, { winner: false, isBye: true, isTbd: false, enabled: false, score: 0, max: needed, r, i, sideKey: 'a' })
           + sideHtml(m.b, { winner: true, isBye: false, isTbd: false, enabled: false, score: m.scoreB, max: needed, r, i, sideKey: 'b' });
    } else {
      // Later round, one or both sides still pending (upstream undecided).
      html = sideHtml(hasA ? m.a : null, { winner: false, isBye: false, isTbd: !hasA, enabled: false, score: 0, max: needed, r, i, sideKey: 'a' })
           + sideHtml(hasB ? m.b : null, { winner: false, isBye: false, isTbd: !hasB, enabled: false, score: 0, max: needed, r, i, sideKey: 'b' });
    }

    let clearBtn = '';
    if (active && m.winner !== null) {
      clearBtn = `<button type="button" class="clear-result" data-action="clear" data-round="${r}" data-index="${i}" title="Clear result">&times;</button>`;
    }
    return `<div class="match${m.winner !== null ? ' decided' : ''}" data-round="${r}" data-index="${i}">${clearBtn}${html}</div>`;
  }

  function renderBracket() {
    const b = computeBracket();
    if (!b) { alert('You need at least 2 teams to generate a bracket.'); return; }

    els.infoType.textContent = state.bracketType;
    els.infoFormat.textContent = 'Best of ' + state.matchFormat;
    els.infoTeams.textContent = b.N + (b.N === 1 ? ' team' : ' teams');
    els.subtitle.textContent = `${state.bracketType} Arena \u2022 Best of ${state.matchFormat} \u2022 ${b.N} Teams`;

    let html = '';
    for (let r = 0; r < b.rounds.length; r++) {
      const count = b.B / Math.pow(2, r);
      html += `<div class="round"><div class="round-label">${roundLabel(count)}</div><div class="matches">`;
      for (let i = 0; i < b.rounds[r].length; i++) html += matchHtml(b.rounds[r][i], r, i);
      html += `</div></div>`;
    }
    // Champion slot
    const champName = b.champion ? (b.champion.name.trim() || ('Team ' + (b.champion._seed || '?'))) : '\u2014';
    html += `<div class="round"><div class="round-label">Winner</div><div class="matches"><div class="champ-slot"><div class="champ-box"><div class="lbl">Champions</div><div class="val">${escapeHtml(champName)}</div></div></div></div></div>`;

    els.canvas.innerHTML = html;

    // Big champion banner
    if (b.champion) {
      const rosterEntries = b.champion.players
        .map((p, idx) => ({ name: p, role: (b.champion.roles && b.champion.roles[idx] === 'healer') ? 'healer' : 'dps' }))
        .filter(e => e.name && e.name.trim());
      const name = b.champion.name.trim() || ('Team ' + (b.champion._seed || '?'));
      const rosterText = rosterEntries.map(e => (e.role === 'healer' ? 'H: ' : '') + e.name).join(' \u00b7 ');
      els.champName.innerHTML = escapeHtml(name) + (rosterEntries.length ? `<span class="champ-roster">${escapeHtml(rosterText)}</span>` : '');
      els.champBanner.classList.remove('hidden');
    } else {
      els.champBanner.classList.add('hidden');
    }

    // record winners for change detection
    lastWinners = {};
    for (let r = 0; r < b.rounds.length; r++)
      for (let i = 0; i < b.rounds[r].length; i++)
        lastWinners[r + '-' + i] = b.rounds[r][i].winner;

    requestAnimationFrame(drawConnectors);
  }

  /* ---------------- Copy results (plain text for Discord) ---------------- */
  function teamLabel(t) {
    return t && t.name.trim() ? t.name : ('Team ' + (t._seed || '?'));
  }

  function buildResultsText(b) {
    const L = [];
    L.push(state.guildName + ' \u2014 Arena Tournament');
    L.push(state.bracketType + ' \u2022 Best of ' + state.matchFormat + ' \u2022 ' + b.N + ' teams' + (b.N < b.B ? ' (' + (b.B - b.N) + ' byes)' : ''));
    L.push('');
    for (let r = 0; r < b.rounds.length; r++) {
      const count = b.B / Math.pow(2, r);
      L.push(roundLabel(count).toUpperCase());
      for (let i = 0; i < b.rounds[r].length; i++) {
        const m = b.rounds[r][i];
        if (!m.a && !m.b) continue;
        if (r === 0 && m.a && !m.b) { L.push('  ' + teamLabel(m.a) + '  \u2014 BYE'); continue; }
        if (r === 0 && !m.a && m.b) { L.push('  ' + teamLabel(m.b) + '  \u2014 BYE'); continue; }
        const la = m.a ? teamLabel(m.a) : 'TBD';
        const lb = m.b ? teamLabel(m.b) : 'TBD';
        if (m.winner !== null) {
          L.push('  ' + m.scoreA + '\u2013' + m.scoreB + '   ' + la + ' vs ' + lb + '   \u2192 ' + teamLabel(m.winner === 0 ? m.a : m.b));
        } else {
          L.push('  \u2014     ' + la + ' vs ' + lb);
        }
      }
      L.push('');
    }
    if (b.champion) {
      const rosterEntries = b.champion.players
        .map((p, idx) => ({ name: p, role: (b.champion.roles && b.champion.roles[idx] === 'healer') ? 'healer' : 'dps' }))
        .filter(e => e.name && e.name.trim());
      const rosterText = rosterEntries.map(e => (e.role === 'healer' ? 'H: ' : '') + e.name).join(', ');
      L.push('\ud83c\udfc6 CHAMPIONS: ' + teamLabel(b.champion) + (rosterEntries.length ? ' (' + rosterText + ')' : ''));
    } else {
      L.push('Champion: TBD');
    }
    return L.join('\n');
  }

  let copyTimer = null;
  function flashBtn(btn, label) {
    const orig = btn.textContent;
    btn.textContent = label;
    btn.classList.add('flash');
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => { btn.textContent = orig; btn.classList.remove('flash'); }, 1600);
  }

  function fallbackCopy(text, cb) {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.focus(); ta.select();
    try { document.execCommand('copy'); } catch (e) { /* ignore */ }
    document.body.removeChild(ta);
    if (cb) cb();
  }

  function copyResults() {
    const b = computeBracket();
    if (!b) { alert('Generate a bracket first.'); return; }
    const text = buildResultsText(b);
    const done = () => flashBtn(els.copyResultsBtn, 'Copied!');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
    } else {
      fallbackCopy(text, done);
    }
  }

  /* ---------------- Connectors (SVG overlay) ---------------- */
  function drawConnectors() {
    const canvas = els.canvas;
    let svg = canvas.querySelector('svg.connectors');
    if (!svg) {
      svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('class', 'connectors');
      canvas.insertBefore(svg, canvas.firstChild);
    }
    const W = canvas.scrollWidth, H = canvas.scrollHeight;
    svg.setAttribute('width', W);
    svg.setAttribute('height', H);
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    const b = computeBracket();
    if (!b) return;

    function rel(el) {
      const er = el.getBoundingClientRect(), cr = canvas.getBoundingClientRect();
      return { l: er.left - cr.left, t: er.top - cr.top, r: er.right - cr.left, b: er.bottom - cr.top, w: er.width, h: er.height };
    }
    function path(x0, y0, x1, y1) {
      const midX = (x0 + x1) / 2;
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', `M ${x0} ${y0} L ${midX} ${y0} L ${midX} ${y1} L ${x1} ${y1}`);
      p.setAttribute('fill', 'none');
      p.setAttribute('stroke', 'rgba(212,169,78,.5)');
      p.setAttribute('stroke-width', '2');
      p.setAttribute('stroke-linecap', 'round');
      svg.appendChild(p);
    }

    const matchEls = {};
    canvas.querySelectorAll('.match').forEach(m => { matchEls[m.dataset.round + '-' + m.dataset.index] = m; });
    const champEl = canvas.querySelector('.champ-box');

    for (let r = 0; r < b.rounds.length; r++) {
      for (let i = 0; i < b.rounds[r].length; i++) {
        const el = matchEls[r + '-' + i];
        if (!el) continue;
        const s = rel(el);
        const x0 = s.r, y0 = s.t + s.h / 2;
        if (r === b.rounds.length - 1) {
          if (champEl) { const c = rel(champEl); path(x0, y0, c.l, c.t + c.h / 2); }
        } else {
          const parent = matchEls[(r + 1) + '-' + Math.floor(i / 2)];
          if (parent) { const p = rel(parent); path(x0, y0, p.l, p.t + p.h / 2); }
        }
      }
    }
  }

  /* ---------------- Mode + view switching ---------------- */
  // Shows/hides the three top-level sections (setupView, bracketView, soloView)
  // based on the current mode ('bracket' | 'solo') and, within bracket mode,
  // the current view ('setup' | 'bracket').
  function applyModeVisibility() {
    const isSolo = state.mode === 'solo';
    els.modeBar.querySelectorAll('.mode-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.mode === state.mode));
    els.soloView.classList.toggle('hidden', !isSolo);
    els.setupView.classList.toggle('hidden', isSolo || state.view !== 'setup');
    els.bracketView.classList.toggle('hidden', isSolo || state.view !== 'bracket');
    if (isSolo) els.subtitle.textContent = 'Solo Shuffle Wargames';
    else if (state.view === 'setup') els.subtitle.textContent = 'Arena Tournament Bracket Generator';
  }

  function setMode(mode) {
    if (mode !== 'bracket' && mode !== 'solo') return;
    state.mode = mode;
    saveState();
    applyModeVisibility();
    if (mode === 'solo') renderSoloChips();
    window.scrollTo(0, 0);
  }

  function showView(name) {
    state.view = (name === 'bracket') ? 'bracket' : 'setup';
    saveState();
    applyModeVisibility();
    window.scrollTo(0, 0);
  }

  /* ---------------- Events ---------------- */
  function bindEvents() {
    // Bracket type + match format toggles
    els.bracketTypeRow.addEventListener('click', e => {
      const btn = e.target.closest('.toggle-btn'); if (!btn) return;
      setBracketType(btn.dataset.type);
    });
    els.matchFormatRow.addEventListener('click', e => {
      const btn = e.target.closest('.toggle-btn'); if (!btn) return;
      setMatchFormat(btn.dataset.format);
    });

    // Team count stepper
    els.incTeams.addEventListener('click', () => setTeamCount(state.teams.length + 1));
    els.decTeams.addEventListener('click', () => setTeamCount(state.teams.length - 1));

    // Team list: text inputs (no re-render -> keeps focus)
    els.teamList.addEventListener('input', e => {
      const t = e.target;
      const teamIdx = +t.dataset.team;
      if (!state.teams[teamIdx]) return;
      if (t.dataset.field === 'name') state.teams[teamIdx].name = t.value;
      else if (t.dataset.player !== undefined) state.teams[teamIdx].players[+t.dataset.player] = t.value;
      saveState();
    });

    // Team list: structural actions
    els.teamList.addEventListener('click', e => {
      const btn = e.target.closest('[data-action]'); if (!btn) return;
      const i = +btn.dataset.team;
      const action = btn.dataset.action;
      if (action === 'up') reorder(i, -1);
      else if (action === 'down') reorder(i, 1);
      else if (action === 'toggle-role') {
        const team = state.teams[i]; if (!team) return;
        const j = +btn.dataset.player;
        if (!Array.isArray(team.roles) || team.roles.length !== team.players.length) {
          team.roles = team.players.map((_, idx) => (team.roles && team.roles[idx]) || 'dps');
        }
        team.roles[j] = team.roles[j] === 'healer' ? 'dps' : 'healer';
        saveState();
        renderSetup();
      }
      else if (action === 'del') {
        if (state.teams.length <= MIN_TEAMS) { alert('You need at least 2 teams.'); return; }
        state.teams.splice(i, 1);
        state.teamCount = state.teams.length;
        invalidateScores();
        saveState();
        renderSetup();
      }
    });

    els.shuffleBtn.addEventListener('click', shuffleTeams);
    els.resetTeamsBtn.addEventListener('click', resetTeams);

    // Bye preview: quick-set team count chips
    els.byePreview.addEventListener('click', e => {
      const chip = e.target.closest('.count-chip'); if (!chip) return;
      setTeamCount(+chip.dataset.count);
    });

    // Role requirement toggle (Arena)
    els.arenaUseRolesToggle.addEventListener('change', () => {
      state.arenaUseRoles = els.arenaUseRolesToggle.checked;
      saveState();
      renderSetup();
    });

    els.generateBtn.addEventListener('click', () => {
      if (state.teams.length < MIN_TEAMS) { alert('You need at least 2 teams.'); return; }
      if (state.arenaUseRoles) {
        const bad = [];
        state.teams.forEach((t, i) => {
          const filled = t.players.map((p, j) => ({ p, role: t.roles && t.roles[j] })).filter(x => x.p && x.p.trim());
          if (filled.length > 0) {
            const healerCount = filled.filter(x => x.role === 'healer').length;
            if (healerCount !== 1) bad.push(t.name.trim() || ('Team ' + (i + 1)));
          }
        });
        if (bad.length) {
          const ok = confirm(`These teams don't have exactly 1 healer: ${bad.join(', ')}. Continue anyway?`);
          if (!ok) return;
        }
      }
      showView('bracket');
      renderBracket();
    });

    els.editSetupBtn.addEventListener('click', () => { showView('setup'); renderSetup(); });

    els.newTournamentBtn.addEventListener('click', () => {
      if (!confirm('Start a new tournament? This clears all teams and scores.')) return;
      const keepSoloPlayers = state.soloPlayers, keepSoloSize = state.soloTeamSize;
      state = freshState();
      state.soloPlayers = keepSoloPlayers;
      state.soloTeamSize = keepSoloSize;
      saveState();
      renderSetup();
      showView('setup');
    });

    els.printBtn.addEventListener('click', () => window.print());

    // Copy results to clipboard
    els.copyResultsBtn.addEventListener('click', copyResults);

    // Mode bar (Arena Bracket <-> Solo Shuffle)
    els.modeBar.addEventListener('click', e => {
      const btn = e.target.closest('.mode-btn'); if (!btn) return;
      setMode(btn.dataset.mode);
    });

    // Solo Shuffle: team size
    els.soloSizeInput.addEventListener('change', () => setSoloTeamSize(+els.soloSizeInput.value));
    els.soloSizePresets.addEventListener('click', e => {
      const btn = e.target.closest('.toggle-btn'); if (!btn) return;
      setSoloTeamSize(+btn.dataset.size);
    });

    // Solo Shuffle: role requirement toggle
    els.soloUseRolesToggle.addEventListener('change', () => {
      state.soloUseRoles = els.soloUseRolesToggle.checked;
      saveState();
      renderSoloChips();
    });

    // Solo Shuffle: adding players
    els.soloPasteAddBtn.addEventListener('click', () => {
      addSoloNames(parseNames(els.soloPasteBox.value), 'dps');
      els.soloPasteBox.value = '';
    });
    function addSingleSoloPlayer() {
      const v = els.soloAddInput.value.trim();
      if (!v) return;
      addSoloNames([v], els.soloAddRole.value);
      els.soloAddInput.value = '';
      els.soloAddInput.focus();
    }
    els.soloAddBtn.addEventListener('click', addSingleSoloPlayer);
    els.soloAddInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); addSingleSoloPlayer(); }
    });

    // Solo Shuffle: remove a player chip, or toggle their role
    els.soloChips.addEventListener('click', e => {
      const btn = e.target.closest('[data-action]'); if (!btn) return;
      const idx = +btn.dataset.index;
      if (btn.dataset.action === 'remove') removeSoloPlayer(idx);
      else if (btn.dataset.action === 'toggle-role') toggleSoloPlayerRole(idx);
    });

    // Solo Shuffle: shuffle / clear
    els.soloShuffleBtn.addEventListener('click', shuffleSolo);
    els.soloClearBtn.addEventListener('click', () => {
      if (!state.soloPlayers.length) return;
      if (!confirm('Clear all players from the solo shuffle list?')) return;
      clearSoloPlayers();
    });

    // Solo Shuffle: generate a bracket from the last shuffle result
    els.soloResults.addEventListener('click', e => {
      const btn = e.target.closest('[data-action="generate-bracket"]'); if (!btn) return;
      generateBracketFromSolo();
    });

    // Bracket: score entry
    els.canvas.addEventListener('input', e => {
      const t = e.target;
      if (!t.classList.contains('score')) return;
      const r = +t.dataset.round, i = +t.dataset.index, side = t.dataset.side;
      const needed = Math.ceil(state.matchFormat / 2);
      let v = parseInt(t.value, 10);
      if (isNaN(v)) v = 0;
      v = Math.max(0, Math.min(needed, v));
      t.value = v;
      const key = r + '-' + i;
      state.scores[key] = state.scores[key] || { a: 0, b: 0 };
      state.scores[key][side] = v;
      saveState();
      const nb = computeBracket();
      const m = nb.rounds[r][i];
      if (m.winner !== lastWinners[key]) renderBracket();
    });

    // Bracket: quick-win by clicking a team name, or clear a decided result
    els.canvas.addEventListener('click', e => {
      const t = e.target.closest('[data-action]'); if (!t) return;
      const action = t.dataset.action;
      const r = +t.dataset.round, i = +t.dataset.index;
      const key = r + '-' + i;
      if (action === 'win') {
        const side = t.dataset.side;
        const needed = Math.ceil(state.matchFormat / 2);
        state.scores[key] = state.scores[key] || { a: 0, b: 0 };
        state.scores[key][side] = needed;
        saveState();
        renderBracket();
      } else if (action === 'clear') {
        delete state.scores[key];
        saveState();
        renderBracket();
      }
    });

    // Redraw connectors on resize / font load
    let rt;
    window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(drawConnectors, 150); });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => {
      if (!els.bracketView.classList.contains('hidden')) drawConnectors();
    });
  }

  /* ---------------- Init ---------------- */
  function init() {
    cacheEls();
    state = loadState();
    bindEvents();
    renderSetup();
    renderSoloChips();
    // Restore the last view, but only land on the bracket if it's actually valid.
    if (state.view === 'bracket' && state.teams.length < MIN_TEAMS) state.view = 'setup';
    applyModeVisibility();
    if (state.mode === 'bracket' && state.view === 'bracket') renderBracket();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
