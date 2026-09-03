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

  /* ---------------- State ---------------- */
  let state = null;
  let lastWinners = {};   // key "r-i" -> winner (0/1/null) from last render

  function defaultTeams(count, playerCount) {
    return Array.from({ length: count }, () => ({
      name: '',
      players: new Array(playerCount).fill('')
    }));
  }

  function freshState() {
    return {
      guildName: 'Make Durotar Great Again',
      abbr: 'MDGA',
      bracketType: '3v3',
      matchFormat: 1,
      teamCount: 8,
      teams: defaultTeams(8, BRACKET_TYPES['3v3'].players),
      scores: {}
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
      state.bracketType = BRACKET_TYPES[state.bracketType] ? state.bracketType : '3v3';
      if (![1, 3, 5].includes(state.matchFormat)) state.matchFormat = 1;
      const pc = BRACKET_TYPES[state.bracketType].players;
      // normalise teams
      if (!Array.isArray(state.teams) || state.teams.length < MIN_TEAMS) {
        state.teamCount = 8;
        state.teams = defaultTeams(8, pc);
      }
      state.teamCount = state.teams.length;
      state.teams = state.teams.map(t => ({
        name: (t && t.name) || '',
        players: Array.from({ length: pc }, (_, i) => ((t && t.players && t.players[i]) || ''))
      }));
      if (!state.scores || typeof state.scores !== 'object') state.scores = {};
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
      generateBtn: document.getElementById('generateBtn'),
      editSetupBtn: document.getElementById('editSetupBtn'),
      newTournamentBtn: document.getElementById('newTournamentBtn'),
      printBtn: document.getElementById('printBtn'),
      infoType: document.getElementById('infoType'),
      infoFormat: document.getElementById('infoFormat'),
      infoTeams: document.getElementById('infoTeams'),
      champBanner: document.getElementById('championBanner'),
      champName: document.getElementById('champName'),
      canvas: document.getElementById('bracketCanvas')
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

    let html = '';
    state.teams.forEach((t, i) => {
      const players = t.players.map((p, j) => (
        `<div class="player-row"><span class="player-index">${j + 1}</span>` +
        `<input class="player-input" data-team="${i}" data-player="${j}" value="${escapeHtml(p)}" placeholder="Player ${j + 1}"></div>`
      )).join('');
      html += (
        `<div class="team-card">
          <button type="button" class="team-del" data-action="del" data-team="${i}" title="Remove team">&times;</button>
          <div class="team-head">
            <span class="seed-badge">${i + 1}</span>
            <input class="team-name-input" data-team="${i}" data-field="name" value="${escapeHtml(t.name)}" placeholder="Team ${i + 1}">
            <div class="reorder">
              <button type="button" data-action="up" data-team="${i}" title="Move up">&#9650;</button>
              <button type="button" data-action="down" data-team="${i}" title="Move down">&#9660;</button>
            </div>
          </div>
          <div class="players">${players}</div>
        </div>`
      );
    });
    els.teamList.innerHTML = html;
  }

  function setTeamCount(n) {
    n = Math.max(MIN_TEAMS, Math.min(MAX_TEAMS, n));
    const pc = BRACKET_TYPES[state.bracketType].players;
    if (n > state.teams.length) {
      while (state.teams.length < n) state.teams.push({ name: '', players: new Array(pc).fill('') });
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

  function setBracketType(type) {
    if (!BRACKET_TYPES[type] || type === state.bracketType) return;
    state.bracketType = type;
    const pc = BRACKET_TYPES[type].players;
    // resize each team's roster, preserving existing names
    state.teams.forEach(t => {
      const next = new Array(pc).fill('');
      for (let i = 0; i < Math.min(pc, t.players.length); i++) next[i] = t.players[i];
      t.players = next;
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
      const roster = team.players.filter(p => p && p.trim());
      if (roster.length) rosterHtml = `<span class="roster">${escapeHtml(roster.join(' \u00b7 '))}</span>`;
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

    return `<div class="match${m.winner !== null ? ' decided' : ''}" data-round="${r}" data-index="${i}">${html}</div>`;
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
      const roster = b.champion.players.filter(p => p && p.trim());
      const name = b.champion.name.trim() || ('Team ' + (b.champion._seed || '?'));
      els.champName.innerHTML = escapeHtml(name) + (roster.length ? `<span class="champ-roster">${escapeHtml(roster.join(' \u00b7 '))}</span>` : '');
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

  /* ---------------- View switching ---------------- */
  function showView(name) {
    const setup = name === 'setup';
    els.setupView.classList.toggle('hidden', !setup);
    els.bracketView.classList.toggle('hidden', setup);
    if (setup) els.subtitle.textContent = 'Arena Tournament Bracket Generator';
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

    els.generateBtn.addEventListener('click', () => {
      if (state.teams.length < MIN_TEAMS) { alert('You need at least 2 teams.'); return; }
      showView('bracket');
      renderBracket();
    });

    els.editSetupBtn.addEventListener('click', () => { showView('setup'); renderSetup(); });

    els.newTournamentBtn.addEventListener('click', () => {
      if (!confirm('Start a new tournament? This clears all teams and scores.')) return;
      state = freshState();
      saveState();
      renderSetup();
      showView('setup');
    });

    els.printBtn.addEventListener('click', () => window.print());

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

    // Bracket: quick-win by clicking a team name
    els.canvas.addEventListener('click', e => {
      const t = e.target.closest('[data-action="win"]'); if (!t) return;
      const r = +t.dataset.round, i = +t.dataset.index, side = t.dataset.side;
      const needed = Math.ceil(state.matchFormat / 2);
      const key = r + '-' + i;
      state.scores[key] = state.scores[key] || { a: 0, b: 0 };
      state.scores[key][side] = needed;
      saveState();
      renderBracket();
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
    showView('setup');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
