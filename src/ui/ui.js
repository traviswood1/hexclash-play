// HTML overlay: setup panel, phase panel (corners / draft / placement / battle), unit card, log.
// Buttons carry data-act attributes; one click listener forwards them to the controller.
import { UNITS } from '../core/units.js';
import { ABILITIES } from '../core/abilities.js';
import { TERRAIN } from '../core/terrain.js';
import { MAP_SIZES, BIOMES, SYMMETRY, CORNERS, CORNER_NAMES } from '../core/mapgen.js';
import { COMBAT } from '../core/rules.js';
import { SWORD, SHIELD } from './icons.js';
import { THEMES } from '../render/environment.js';
import { FILTERS, sortPool, sortControlsHtml } from './draftScreen.js';
import { playerUnits, liveUnitsOf, actionsLeft, canActivate, unitOptions, slotOf, allowedCorners } from '../core/game.js';

// Highlight colours on the board, shared with main.js so the legend always matches.
export const HIGHLIGHT = {
  move: '#4fc3ff', risky: '#ffd23a', attack: '#ff4d4d', range: '#ff8f6b', target: '#b78cff', area: '#ffb347', ready: '#ffd76a',
};

// Status effects: short name and what they do (bottom bar chips, unit cards).
export const STATUS_INFO = {
  slowed:    { name: 'Slowed', icon: '🐌', desc: '-2 move until the end of its next turn.' },
  braced:    { name: 'Braced', icon: '🛡', desc: '+2 defense dice until the start of its next turn.' },
  empowered: { name: 'War Cry', icon: '📯', desc: '+2 attack dice on its next attack.' },
  shield:    { name: 'Barrier', icon: '🔰', desc: 'Soaks up damage before health is lost. Fades after 2 turns.' },
  released:  { name: 'Released', icon: '⚡', desc: '+2 attack dice and +1 defense die while it lasts.' },
  poison:    { name: 'Poisoned', icon: '☠', desc: 'Loses 1 health at the start of each of its turns.' },
  cowed:     { name: 'Cowed', icon: '😨', desc: '-1 attack die until the end of its next turn.' },
};
// e.g. "Barrier 3" / "Poisoned 2": the number is what's left (shield points, poison turns, release turns)
export const statusLabel = (unit, k) => `${STATUS_INFO[k]?.name ?? k}${['shield', 'poison', 'released'].includes(k) && unit.status[k] > 0 ? ` ${unit.status[k]}` : ''}`;

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export class UI {
  constructor(handlers) {
    this.h = handlers;
    this.log = [];
    $('hud').addEventListener('click', e => {
      // phones: the side panel's handle folds it down to a strip so the board stays visible
      if (e.target.closest('.side-handle')) { $('side').classList.toggle('folded'); return; }
      const logToggle = e.target.closest('.log-toggle');
      if (logToggle) {
        this.logOpen = !this.logOpen;
        const tray = logToggle.parentElement;
        tray.classList.toggle('open', this.logOpen);
        logToggle.querySelector('i').textContent = this.logOpen ? '▾' : '▸';
        const log = tray.querySelector('.log');
        log.scrollTop = log.scrollHeight;
        return;
      }
      const el = e.target.closest('[data-act]');
      if (!el || el.disabled) return;
      const fn = this.h[el.dataset.act];
      if (fn) fn(el.dataset.arg, el);
    });
    $('hud').addEventListener('change', e => {
      if (e.target.dataset.setting) this.h.setting(e.target.dataset.setting, e.target.value);
    });
    // Enter in the room-code box joins
    $('hud').addEventListener('keydown', e => {
      if (e.key !== 'Enter' || e.target.dataset.setting !== 'joinCode') return;
      this.h.setting('joinCode', e.target.value);
      this.h.joinOnline();
    });
    // status chips: hover for what the effect does
    $('hud').addEventListener('mouseover', e => {
      const chip = e.target.closest('[data-status]');
      if (!chip) { if (this.statusTip) { this.statusTip = false; this.hideTip(); } return; }
      const info = STATUS_INFO[chip.dataset.status];
      if (!info) return;
      this.statusTip = true;
      const r = chip.getBoundingClientRect();
      this.showTip(`<div class="st-tip"><b>${info.icon} ${esc(info.name)}</b><div>${esc(info.desc)}</div></div>`, r.left - 10, r.top - 40);
    });
    $('hud').addEventListener('mouseover', e => {
      const el = e.target.closest('[data-peek]');
      if (el) this.h.peek(el.dataset.peek);
    });
    $('btnNew').onclick = () => this.h.newGame();
    $('btnCamera').onclick = () => this.h.camera();
    $('btnHelp').onclick = () => this.showHelp();
    $('btnSettings').onclick = () => this.h.settings();
    // battle: whose turn, actions left and the selected unit's Move / Attack / skills, along the bottom
    const bar = document.createElement('div');
    bar.id = 'actionBar';
    bar.className = 'panel hidden';
    $('hud').append(bar);
    // the right-hand panel is a tray that slides in from the right edge, closed by default: the unit pool on
    // the setup screen, the armies and battle log during a battle (phones fold it to a strip instead)
    this.poolOpen = false;
    this.unitsOpen = false;
    this.poolFilter = 'all';
    this.poolSearch = '';
    this.poolSortKey = 'cost';
    this.poolSortDir = 'desc';
    const redrawPool = () => {
      const box = document.querySelector('.pt-sort');
      if (box) box.innerHTML = sortControlsHtml(this.poolSortKey, this.poolSortDir);
      if (this.poolGame) $('ptGrid').innerHTML = this.poolGridHtml(this.poolGame);
    };
    $('hud').addEventListener('change', e => {
      if (e.target.dataset.sort === undefined || !e.target.closest('#side')) return;
      this.poolSortKey = e.target.value;
      redrawPool();
    });
    $('hud').addEventListener('click', e => {
      if (!e.target.closest('#side [data-sort-dir]')) return;
      this.poolSortDir = this.poolSortDir === 'asc' ? 'desc' : 'asc';
      redrawPool();
    });
    // pool tray: filters, search and hover cards (the grid is redrawn in place so the search box keeps focus)
    $('hud').addEventListener('input', e => {
      if (e.target.dataset.poolSearch === undefined) return;
      this.poolSearch = e.target.value;
      if (this.poolGame) $('ptGrid').innerHTML = this.poolGridHtml(this.poolGame);
    });
    $('hud').addEventListener('click', e => {
      const f = e.target.closest('[data-pool-filter]');
      if (!f || !this.poolGame) return;
      this.poolFilter = f.dataset.poolFilter;
      document.querySelectorAll('[data-pool-filter]').forEach(b => b.classList.toggle('on', b === f));
      $('ptGrid').innerHTML = this.poolGridHtml(this.poolGame);
    });
    $('hud').addEventListener('mouseover', e => {
      const tile = e.target.closest('[data-pool-key]');
      if (!tile) { if (this.poolTipKey) { this.poolTipKey = null; this.hideTip(); } return; }
      if (tile.dataset.poolKey === this.poolTipKey) return;
      this.poolTipKey = tile.dataset.poolKey;
      const r = $('side').getBoundingClientRect(), t = tile.getBoundingClientRect();
      this.showTip(this.unitCardHtml(this.poolGame, { type: this.poolTipKey }), r.left, t.top + t.height / 2, 'left');
    });
    const tab = document.createElement('button');
    tab.id = 'poolTab';
    tab.className = 'hidden';
    tab.onclick = () => {
      if (this.trayMode === 'units') this.unitsOpen = !this.unitsOpen; else this.poolOpen = !this.poolOpen;
      this.syncTray();
    };
    $('hud').append(tab);
  }

  player(game, p) {
    const pl = game.players[p];
    return `<span class="chip"><span class="dot" style="background:${pl.color}"></span>${esc(pl.name)}${pl.ai ? ' (CPU)' : ''}</span>`;
  }

  // ---------- setup ----------
  // net: the online session (main.js `online` plus { config, connected }); the guest sees the host's settings, locked
  renderSetup(settings, show, net = {}) {
    const el = $('setup');
    el.classList.toggle('hidden', !show);
    if (!show) return;
    const online = settings.opponent === 'online';
    const guest = online && net.role === 'guest';
    const c = net.config ?? settings;
    const lock = guest ? 'disabled' : '';
    const opts = (obj, cur, label = v => v.name ?? v) => Object.entries(obj)
      .map(([k, v]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${esc(label(v))}</option>`).join('');
    el.innerHTML = `
      <h2>New battle</h2>
      <div class="field"><label>Map seed (same seed = same map)</label>
        <div class="seed"><input data-setting="seed" value="${esc(c.seed)}" ${lock}><button data-act="randomSeed" title="Random seed" ${lock}>Roll</button></div></div>
      <div class="row">
        <div class="field"><label>Size</label><select data-setting="size" ${lock}>${opts(MAP_SIZES, c.size)}</select></div>
        <div class="field"><label>Biome</label><select data-setting="biome" ${lock}>${opts(BIOMES, c.biome)}</select></div>
      </div>
      <div class="field"><label>Symmetry (fairness)</label><select data-setting="symmetry" ${lock}>${opts(SYMMETRY, c.symmetry)}</select></div>
      <div class="row">
        <div class="field"><label>Army points</label><select data-setting="points" ${lock}>${[15, 20, 25, 30, 35, 40].map(n => `<option ${n == c.points ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
        <div class="field"><label>Max units</label><select data-setting="teamSize" ${lock}>${[4, 5, 6, 7].map(n => `<option ${n == c.teamSize ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
      </div>
      <div class="row">
        <div class="field"><label>Opponent</label><select data-setting="opponent" ${online && net.state !== 'idle' ? 'disabled' : ''}>
          <option value="cpu" ${settings.opponent === 'cpu' ? 'selected' : ''}>Computer</option>
          <option value="human" ${settings.opponent === 'human' ? 'selected' : ''}>Hotseat (2 players)</option>
          <option value="online" ${online ? 'selected' : ''}>Online friend</option></select></div>
      </div>
      ${online ? this.onlineHtml(net) : '<div class="stack"><button class="primary big" data-act="start">Start draft</button></div>'}
      <h3>Terrain</h3>
      <div class="legend">${Object.values(TERRAIN).map(t =>
        `<span title="${esc(t.desc)}"><i class="swatch" style="background:#${t.color.toString(16).padStart(6, '0')}"></i>${t.name}</span>`).join('')}</div>
      <p class="muted" style="font-size:12px;margin:10px 0 0">Drag to rotate, right-drag or WASD to pan, scroll to zoom. Reroll until you like the map.</p>`;
  }

  // Host / join / waiting / connected, under the setup fields when the opponent is "Online friend".
  onlineHtml(net) {
    const err = net.error ? `<p class="net-err">${esc(net.error)}</p>` : '';
    const leave = '<button data-act="leaveOnline">Leave</button>';
    if (net.connected) {
      return net.role === 'host'
        ? `<div class="net-box"><p><span class="dot" style="background:#4f8cff"></span> Your friend is here. You play <b>Blue</b>.</p>
            <p class="muted">They see your settings. Change anything, then start.</p>
            <div class="stack"><button class="primary big" data-act="start">Start draft</button>${leave}</div></div>`
        : `<div class="net-box"><p><span class="dot" style="background:#ff5c5c"></span> Connected. You play <b>Red</b>.</p>
            <p class="muted">Waiting for your friend to start the game…</p><div class="stack">${leave}</div></div>`;
    }
    if (net.state === 'opening') return `<div class="net-box"><p class="muted">Opening a room…</p></div>`;
    if (net.state === 'waiting') {
      return `<div class="net-box"><p>Send your friend this code:</p><div class="net-code">${esc(net.code)}</div>
        <p class="muted">Waiting for them to join… They pick <b>Online friend</b>, type the code and press Join.</p>
        <div class="stack">${leave}</div></div>`;
    }
    if (net.state === 'joining') return `<div class="net-box"><p class="muted">Joining ${esc(net.code)}…</p></div>`;
    return `<div class="net-box">${err}
      <div class="stack"><button class="primary big" data-act="hostOnline">Host a game</button></div>
      <div class="field"><label>Or join a friend's game</label>
        <div class="seed"><input data-setting="joinCode" placeholder="Room code" maxlength="8" autocapitalize="characters" value="${esc(net.joinCode ?? '')}"><button data-act="joinOnline">Join</button></div></div>
      <p class="muted" style="font-size:12px">Both players need this page open. The host picks the map and settings.</p></div>`;
  }

  // Move breakdown beside the pointer: cost per step (terrain + climbing), total against the unit's move.
  moveTipHtml(plan, TERRAIN) {
    const steps = plan.steps.map(st => `<span class="mv-step">${esc(TERRAIN[st.terrain].name)} ${st.base}${st.climb ? ` <i>+${st.climb}↑</i>` : ''}${st.lava ? ' <b class="hot">burns 2</b>' : ''}</span>`).join('');
    const head = plan.ok ? `<b>Move ${plan.cost} / ${plan.budget}</b>` : `<b class="no">Can't move here</b>`;
    return `<div class="mv-tip">${head}${plan.steps.length ? `<div class="mv-steps">${steps}</div>` : ''}
      ${plan.reason ? `<div class="muted">${esc(plan.reason)}</div>` : ''}
</div>`;
  }

  // A message box with an OK button.
  showNotice(title, text) {
    const m = $('modal');
    m.classList.remove('hidden');
    m.innerHTML = `<div class="box settings"><h1>${esc(title)}</h1><p>${esc(text)}</p>
      <div style="text-align:right;margin-top:12px"><button class="primary" data-act="closeModal">OK</button></div></div>`;
  }

  // ---------- battle action bar (bottom of the screen) ----------
  // Compact: whose turn, the turn's action pips, and for the selected unit just Move / Attack / its skills.
  // ctx: { screen, human, selectedId, abilityKey, mode, busy }
  renderActionBar(game, ctx) {
    const el = $('actionBar');
    const show = ctx.screen === 'game' && (game.phase === 'battle' || game.phase === 'over');
    el.classList.toggle('hidden', !show);
    if (!show) return;
    if (game.phase === 'over') {
      const w = game.winner;
      el.innerHTML = `<b class="ab-big">${w === null ? 'Draw!' : `${esc(game.players[w].name)} wins!`}</b>
        <button class="primary" data-act="newGame">New battle</button>`;
      return;
    }
    const t = game.turn, pl = game.players[t.player], left = actionsLeft(game);
    const pips = Array.from({ length: t.actions }, (_, i) => `<i class="${i < left ? '' : 'used'}"></i>`).join('');
    // three centred lines: turn + actions left / selected unit + statuses / its options
    const line = (html, cls = '') => `<div class="ab-line ${cls}">${html}</div>`;
    const turn = line(`<span class="ab-turn" style="--pc:${pl.color}"><span class="dot" style="background:${pl.color}"></span>${esc(pl.name)}</span>
      <span class="ab-round">Round ${game.round}</span>
      <span class="ab-pips" title="Actions left this turn: a move, an attack or a skill costs 1. Units can move again and again, but attack once per turn.">${pips}</span>`, 'ab-top');
    const end = ctx.human ? `<button class="primary ab-end" data-act="endTurn" ${ctx.busy ? 'disabled' : ''} title="End turn (Enter)">End turn</button>` : '';
    if (!ctx.human) {
      el.innerHTML = turn + line(`<span class="ab-wait"><span class="ab-spin"></span>${pl.ai ? 'Thinking…' : 'Their turn…'}</span>`);
      return;
    }
    const sel = ctx.selectedId && game.units[ctx.selectedId];
    if (!sel || !canActivate(game, sel)) {
      el.innerHTML = turn + line(`<span class="ab-hint">${left ? 'Pick a unit' : 'No actions left'}</span>${end}`);
      return;
    }
    const o = unitOptions(game, sel), slot = slotOf(game, sel);
    const canMove = o.canMove && Object.keys(o.reach).length > 0; // moving again is allowed (1 action each)
    const canAttack = !slot.acted && o.attackTargets.length > 0;
    const btn = (act, label, on, ok, title) => `<button class="ab-btn ${on ? 'on' : ''}" data-act="${act}" ${ok ? '' : 'disabled'} title="${esc(title)}">${label}</button>`;
    const skills = o.abilities.filter(a => a.kind === 'active').map(a => {
      if (ctx.abilityKey === a.key) return `<button class="ab-btn skill on" data-act="cancel" title="Cancel">✕ ${esc(a.name)}</button>`;
      const why = a.cooldownLeft ? `${a.cooldownLeft}` : '';
      return `<button class="ab-btn skill" data-act="ability" data-arg="${a.key}" ${a.ready ? '' : 'disabled'} title="${esc(a.name)}: ${esc(a.desc)}">${esc(a.name)}${why ? `<small>⟳${why}</small>` : ''}</button>`;
    }).join('');
    const statuses = Object.keys(sel.status).filter(k => STATUS_INFO[k]).map(k =>
      `<span class="ab-status" data-status="${k}">${STATUS_INFO[k].icon} ${esc(statusLabel(sel, k))}</span>`).join('');
    el.innerHTML = turn
      + line(`<span class="ab-sel">${esc(UNITS[sel.key].name)}</span>${statuses}`, 'ab-unit')
      + line(`${btn('modeMove', 'Move', !ctx.abilityKey && ctx.mode === 'move', canMove, canMove ? `Show where it can move${slot.moved ? ' (again, 1 action)' : ''}` : 'Nowhere to move')}
      ${btn('modeAttack', 'Attack', !ctx.abilityKey && ctx.mode === 'attack', !slot.acted, slot.acted ? 'Already attacked this turn' : canAttack ? 'Show range and enemies you can hit' : 'Show range (no enemy in range yet)')}
      ${skills}${end}`);
  }

  // ---------- top bar ----------
  renderPhase(game, ctx) {
    const el = $('phase');
    if (ctx.screen === 'setup') { el.innerHTML = '<span class="hint">Preview the battlefield, then start the draft</span>'; return; }
    const p = game.phase === 'over' ? null : (game.phase === 'battle' ? game.turn.player : game.queue[game.qi]);
    const hint = {
      corners: 'Pick a starting corner (click a glowing zone)',
      draft: 'Draft a unit from the pool',
      placement: 'Click hexes in your zone to place units',
      battle: '', // the action bar explains the battle
      over: '',
    }[game.phase];
    const round = game.phase === 'battle' ? `<span class="tag">Round ${game.round}</span>` : '';
    el.innerHTML = `${p !== null ? this.player(game, p) : ''}${round}<span class="hint">${hint}</span>`;
  }

  // ---------- right panel ----------
  renderSide(game, ctx) {
    const el = $('side');
    this.setup = ctx.screen === 'setup';
    this.trayMode = this.setup ? 'pool' : ['battle', 'over'].includes(game.phase) ? 'units' : null;
    this.syncTray();
    if (this.setup) { el.innerHTML = this.poolHtml(game); return; }
    const fn = { corners: this.cornersHtml, draft: this.draftHtml, placement: this.placementHtml, battle: this.battleHtml, over: this.battleHtml }[game.phase];
    // the handle only shows on phones (styles.css); a new phase starts folded so the board is visible
    if (this.sidePhase !== game.phase) { this.sidePhase = game.phase; el.classList.toggle('folded', game.phase === 'battle'); }
    el.innerHTML = '<button class="side-handle" aria-label="Show or hide the panel"><i></i></button>' + fn.call(this, game, ctx) + this.logHtml();
    const log = el.querySelector('.log');
    if (log) log.scrollTop = log.scrollHeight;
  }

  syncTray() {
    const mode = this.trayMode;
    const open = mode === 'pool' ? this.poolOpen : mode === 'units' ? this.unitsOpen : false;
    const side = $('side'), tab = $('poolTab');
    side.classList.toggle('tray', !!mode);
    side.classList.toggle('pooltray', mode === 'pool');
    side.classList.toggle('open', open);
    tab.classList.toggle('hidden', !mode);
    tab.classList.toggle('open', open);
    tab.classList.toggle('units', mode === 'units');
    tab.textContent = mode === 'units' ? (open ? 'Hide units ▸' : '◂ Units') : (open ? 'Hide pool ▸' : '◂ Unit pool');
  }

  // Setup screen's pool tray: search, role filters and a portrait grid; hovering a tile shows its full card.
  poolHtml(game) {
    this.poolGame = game;
    return `<h2>Unit pool</h2>
      <div class="pt-filters">${Object.entries(FILTERS).map(([k, f]) => `<button data-pool-filter="${k}" class="${k === this.poolFilter ? 'on' : ''}">${f.name}</button>`).join('')}
        <span class="pt-sort">${sortControlsHtml(this.poolSortKey, this.poolSortDir)}</span>
        <input data-pool-search placeholder="Search name or role" value="${esc(this.poolSearch)}"></div>
      <div class="pt-grid" id="ptGrid">${this.poolGridHtml(game)}</div>`;
  }

  poolGridHtml(game) {
    const f = FILTERS[this.poolFilter] ?? FILTERS.all, q = this.poolSearch.toLowerCase();
    const items = game.pool.filter(it => {
      const d = UNITS[it.key];
      return f.test(d) && (!q || d.name.toLowerCase().includes(q) || d.role.toLowerCase().includes(q));
    });
    sortPool(items, this.poolSortKey, this.poolSortDir);
    return items.map(it => {
      const d = UNITS[it.key], url = this.portraits?.[it.key];
      const img = url ? `<img src="${url}" alt="" loading="lazy">` : `<span class="ph" style="background:${d.color}">${esc(d.name[0])}</span>`;
      return `<div class="ds-tile ${it.takenBy !== null ? 'taken' : ''}" data-pool-key="${it.key}">${img}<span class="cost">${d.cost}</span><div class="nm">${esc(d.name)}</div></div>`;
    }).join('') || '<p class="muted">No units match.</p>';
  }

  // portraits for the pool tray: { key: url } (main.js loads them at startup)
  setPortraits(urls) {
    this.portraits = urls;
    const grid = $('ptGrid');
    if (grid && this.poolGame) grid.innerHTML = this.poolGridHtml(this.poolGame);
  }

  cornersHtml(game, ctx) {
    const open = allowedCorners(game);
    return `<h2>Choose your corner</h2>
      <div class="corners">${CORNERS.map(c => {
        const owner = game.players.find(p => p.corner === c);
        return `<button data-act="pickCorner" data-arg="${c}" ${owner || !open.includes(c) || !ctx.human ? 'disabled' : ''}>
          ${owner ? `<span class="dot" style="background:${owner.color}"></span> ` : ''}${CORNER_NAMES[c]}</button>`;
      }).join('')}</div>
      <p class="muted" style="font-size:12px">Click a glowing zone on the board or a button. The first pick is free; everyone else starts evenly spaced from it (2 players: the opposite corner). The first to pick deploys first and takes the first turn; the others get the first unit picks. The units you'll draft stand on the left.</p>
      ${this.poolListHtml(game, false)}`;
  }

  draftHtml(game, ctx) {
    const pts = game.players.map(p => `${p.name} ${game.settings.points - p.spent}`).join(' · ');
    return `${this.rostersHtml(game, ctx)}
      <p class="muted" style="font-size:12px">Points left: ${pts}. Buy units with your ${game.settings.points} points (up to ${game.settings.teamSize}); picks snake A, B, B, A, A…</p>
      ${this.poolListHtml(game, ctx.human)}`;
  }

  // compact text version of the pool (the 3D gallery is the main view)
  poolListHtml(game, pickable) {
    return `<details><summary class="muted" style="cursor:pointer;font-size:12px">Pool as a list</summary><div class="roster" style="margin-top:6px">${game.pool.map(item => {
      const d = UNITS[item.key];
      const taken = item.takenBy !== null;
      return `<div class="ru ${taken ? 'dead' : ''}" ${!taken && pickable ? `data-act="draft" data-arg="${item.pid}"` : ''} data-peek="type:${item.key}">
        <span class="dot" style="background:${taken ? game.players[item.takenBy].color : d.color}"></span><span class="nm">${esc(d.name)}</span><span class="tag">${d.role}</span></div>`;
    }).join('')}</div></details>`;
  }

  placementHtml(game, ctx) {
    const p = game.queue[game.qi];
    const units = playerUnits(game, p);
    const allPlaced = units.every(u => u.placed);
    return `<h2>Deploy your army</h2>
      <p class="muted" style="font-size:12px">Click a unit, then a hex in your zone. Click a placed unit to move it.</p>
      <div class="roster">${units.map(u => `
        <div class="ru ${ctx.placingId === u.id ? 'sel' : ''}" data-act="placeSelect" data-arg="${u.id}" data-peek="unit:${u.id}">
          <span class="dot" style="background:${UNITS[u.key].color}"></span><span class="nm">${esc(UNITS[u.key].name)}</span>
          <span class="tag">${u.placed ? 'placed' : 'waiting'}</span></div>`).join('')}</div>
      <div class="row" style="margin-top:10px">
        <button data-act="autoPlace" ${ctx.human ? '' : 'disabled'}>Auto place</button>
        <button class="primary" data-act="confirmPlacement" ${allPlaced && ctx.human ? '' : 'disabled'}>Ready</button>
      </div>`;
  }

  battleHtml(game, ctx) {
    let top = '';
    if (game.phase === 'battle') {
      top = ''; // turn, activations and End turn live in the action bar
    } else {
      const w = game.winner;
      top = `<h2>${w === null ? 'Draw!' : `${esc(game.players[w].name)} wins!`}</h2>
        <button class="primary big" data-act="newGame">New battle</button>`;
    }
    return top + this.rostersHtml(game, ctx);
  }

  rostersHtml(game, ctx) {
    return game.players.map(pl => {
      const units = playerUnits(game, pl.id);
      const rows = units.map(u => {
        const d = UNITS[u.key];
        const f = u.hp / u.maxHp;
        const done = game.phase === 'battle' && u.alive && u.owner === game.turn.player && !canActivate(game, u);
        return `<div class="ru ${!u.alive ? 'dead' : ''} ${done ? 'done' : ''} ${ctx.selectedId === u.id || ctx.inspectId === u.id ? 'sel' : ''}"
          ${u.alive && u.placed ? `data-act="selectUnit" data-arg="${u.id}"` : ''} data-peek="unit:${u.id}">
          <span class="dot" style="background:${d.color}"></span><span class="nm">${esc(d.name)}</span>
          <span class="hpbar ${f <= 0.34 ? 'low' : ''}"><i style="width:${f * 100}%"></i></span></div>`;
      }).join('') || '<div class="muted" style="font-size:12px">No units yet</div>';
      return `<h3><span class="dot" style="background:${pl.color}"></span> ${esc(pl.name)}${pl.ai ? ' (CPU)' : ''}
        ${game.phase === 'battle' || game.phase === 'over' ? `· ${liveUnitsOf(game, pl.id).length} left` : ''}</h3><div class="roster">${rows}</div>`;
    }).join('');
  }

  // ---------- unit card ----------
  // what: { unit, type, options (for the active player's selected unit), abilityKey }
  renderUnitCard(game, what) {
    $('unitCard').innerHTML = what ? this.unitCardHtml(game, what) : '';
  }

  // Attack preview next to the pointer: dice, expected damage and kill chance.
  showAttackTip(p, x, y) {
    this.showTip(`<div class="atk-tip"><b>${p.label} ${esc(p.target)}</b>
      <div class="dice-line"><span class="sw">${SWORD}</span>${p.atk} vs <span class="sh">${SHIELD}</span>${p.def}</div>
      <div class="muted">Hits on ${COMBAT.HIT}+, blocks on ${COMBAT.BLOCK}+ · about <b>${p.mean.toFixed(1)}</b> damage · <b>${Math.round(p.kill * 100)}%</b> to finish it (${p.hp} HP left)</div>
      ${p.mods.length ? `<div class="mods">${p.mods.map(([n, v]) => `<span class="tag">${esc(n)} ${v > 0 ? '+' : ''}${v}</span>`).join('')}</div>` : ''}
      <div class="tip-foot">${p.touch ? 'Tap again' : 'Click'} to ${p.label.toLowerCase()}</div></div>`, x, y);
  }

  // Floating card next to the pointer (draft gallery).
  // side 'left': the tip sits to the left of x (e.g. beside the pool tray on the right edge)
  showTip(html, x, y, side = 'right') {
    const el = $('tip');
    el.innerHTML = html;
    el.classList.remove('hidden');
    const w = el.offsetWidth, h = el.offsetHeight;
    el.style.left = `${side === 'left' ? Math.max(8, x - w - 12) : Math.min(window.innerWidth - w - 8, x + 18)}px`;
    el.style.top = `${Math.max(56, Math.min(window.innerHeight - h - 8, y - h / 2))}px`;
  }
  hideTip() { $('tip').classList.add('hidden'); }

  unitCardHtml(game, what) {
    const unit = what.unit;
    const d = UNITS[unit?.key ?? what.type];
    const owner = unit ? game.players[unit.owner] : null;
    const opts = what.options;
    const f = unit ? unit.hp / unit.maxHp : 1;
    const statuses = unit ? Object.keys(unit.status).filter(s => STATUS_INFO[s]).map(s =>
      `<span class="status" data-status="${s}" title="${esc(STATUS_INFO[s].desc)}">${STATUS_INFO[s].icon} ${esc(statusLabel(unit, s))}</span>`).join('') : '';
    return `
      <div class="uc-head"><span class="dot" style="background:${owner?.color ?? d.color};width:14px;height:14px"></span>
        <div><div class="name">${esc(d.name)}</div><div class="muted" style="font-size:12px">${d.role}${owner ? ` · ${esc(owner.name)}` : ''}</div></div></div>
      ${unit ? `<div class="row"><span class="hpbar wide ${f <= 0.34 ? 'low' : ''}"><i style="width:${f * 100}%"></i></span><b style="flex:none">${unit.hp}/${unit.maxHp}</b></div>` : ''}
      <div class="uc-stats">
        <div><b>${unit ? unit.maxHp : d.hp}</b><small>HP</small></div><div><b>${d.move}</b><small>Move</small></div>
        <div><b>${d.atk}</b><small>Atk</small></div><div><b>${d.def}</b><small>Def</small></div>
        <div><b>${d.range === 1 ? 'Melee' : d.range}</b><small>Range</small></div></div>
      ${d.abilities.includes('flight') ? '<div class="muted" style="font-size:12px">Flies: ignores height and terrain when moving</div>' : ''}
      ${statuses ? `<div class="statuses" style="margin-top:6px">${statuses}</div>` : ''}
      <div class="ability attackrow ${opts ? (opts.canAct ? (opts.attackTargets.length ? 'ready' : '') : 'spent') : ''}">
        <div class="an"><span>Attack <span class="tag">action</span></span>${opts ? `<span class="tag">${!opts.canAct ? 'used' : opts.attackTargets.length ? `${opts.attackTargets.length} in range` : 'none in range'}</span>` : ''}</div>
        <div class="adesc">${d.atk} attack dice, ${d.range === 1 ? 'against an adjacent enemy' : `range ${d.range}${d.abilities.includes('sharpshooter') ? ' (+ height)' : ''}, needs line of sight`}.</div></div>
      ${d.abilities.map(k => {
        const ab = ABILITIES[k];
        const o = opts?.abilities.find(a => a.key === k);
        const cd = unit?.cooldowns[k];
        let btn = '';
        if (ab.kind === 'active' && opts) {
          btn = what.abilityKey === k ? `<button data-act="cancel">Cancel</button>`
            : `<button data-act="ability" data-arg="${k}" ${o?.ready ? '' : 'disabled'}>${cd ? `${cd} turn${cd > 1 ? 's' : ''}` : 'Use'}</button>`;
        } else if (cd) btn = `<span class="tag">recharging ${cd}</span>`;
        return `<div class="ability ${ab.kind} ${what.abilityKey === k ? 'targeting' : ''}">
          <div class="an"><span>${esc(ab.name)} <span class="tag">${ab.kind === 'active' ? (ab.usesMove ? 'replaces move' : `action · cd ${ab.cooldown}`) : 'passive'}</span></span>${btn}</div>
          <div class="adesc">${esc(ab.desc)}</div></div>`;
      }).join('')}${what.footer ? `<div class="tip-foot">${what.footer}</div>` : ''}`;
  }

  // ---------- hex tooltip ----------
  renderHexInfo(game, k) {
    const el = $('hexInfo');
    const c = k && game.map.cells[k];
    if (!c) { el.innerHTML = ''; return; }
    const t = TERRAIN[c.terrain];
    el.innerHTML = `<b>${t.name}</b> · level ${c.elev} · <span class="muted">${esc(t.desc)}</span>`;
  }

  // ---------- log ----------
  addLog(html) {
    this.log.push(html);
    if (this.log.length > 120) this.log.shift();
  }
  clearLog() { this.log = []; }
  // Folded by default to the latest line; the header opens the full log (this.logOpen, kept between renders).
  logHtml() {
    if (!this.log.length) return '';
    return `<div class="log-tray ${this.logOpen ? 'open' : ''}">
      <button class="log-toggle"><span>Battle log</span><small>${this.log.length}</small><i>${this.logOpen ? '▾' : '▸'}</i></button>
      <div class="log-last">${this.log[this.log.length - 1]}</div>
      <div class="log">${this.log.map(l => `<div>${l}</div>`).join('')}</div></div>`;
  }
  unitName(game, id) {
    const u = game.units[id];
    return `<span style="color:${game.players[u.owner].color};font-weight:600">${esc(UNITS[u.key].name)}</span>`;
  }
  strikeLog(game, e) {
    const dice = (rolls, ok, cls, icon) => rolls.map(v => `<span class="die ${v >= ok ? cls : ''}">${v >= ok ? icon : ''}</span>`).join('');
    const mods = m => m.length ? ` <span class="muted">(${m.map(([l, v]) => `${l} ${v > 0 ? '+' : ''}${v}`).join(', ')})</span>` : '';
    return `${this.unitName(game, e.attacker)} ${esc(e.label)} → ${this.unitName(game, e.target)}<br>
      ${dice(e.atkRolls, COMBAT.HIT, 'hit', SWORD)}${mods(e.atkMods)} vs ${dice(e.defRolls, COMBAT.BLOCK, 'block', SHIELD) || '<span class="muted">no dice</span>'}${mods(e.defMods)}
      → <b style="color:${e.damage ? 'var(--bad)' : 'var(--muted)'}">${e.damage ? `${e.damage} damage` : 'no damage'}</b>`;
  }

  // ---------- transient messages ----------
  // The d20 roll for first pick (game.initiative.rounds; a tie rolls again). speed: 1 full, 0.4 quick, 0 skip.
  // Resolves when done; a click skips it.
  showInitiative(game, speed = 1) {
    const rounds = game.initiative?.rounds ?? [];
    if (!speed || !rounds.length) return Promise.resolve();
    const el = document.createElement('div');
    el.id = 'initiative';
    $('hud').append(el);
    let skip = false;
    el.onclick = () => { skip = true; };
    const sleep = ms => new Promise(r => setTimeout(r, skip ? 0 : ms * speed));
    const die = (p, v, cls = '') => `<div class="d20 ${cls}" style="--pc:${game.players[p].color}"><b>${v}</b><span>${esc(game.players[p].name)}</span></div>`;
    return (async () => {
      for (let r = 0; r < rounds.length; r++) {
        const rolls = rounds[r], last = r === rounds.length - 1;
        const frame = (dice, note) => { el.innerHTML = `<div class="init-box"><h2>Roll for first pick</h2><div class="dice-row">${dice}</div><p>${note}</p><small>click to skip</small></div>`; };
        // tumbling faces that slow down before they land (about 2.5 s)
        for (let t = 0; t < 22 && !skip; t++) {
          frame(rolls.map((_, p) => die(p, 1 + Math.floor(Math.random() * 20), 'spin')).join(''), 'Rolling…');
          await sleep(50 + t * t * 0.45);
        }
        const top = Math.max(...rolls);
        const winner = rolls.indexOf(top);
        frame(rolls.map((v, p) => die(p, v, last && p === winner ? 'win' : '')).join(''),
          last ? `<b style="color:${game.players[winner].color}">${esc(game.players[winner].name)}</b> picks the first corner` : 'Tie! Roll again');
        await sleep(last ? 2200 : 1300);
      }
      el.remove();
    })();
  }

  banner(text, color = '#fff') {
    const el = $('callout');
    el.textContent = text;
    el.style.color = color;
    el.classList.add('show');
    clearTimeout(this.bannerT);
    this.bannerT = setTimeout(() => el.classList.remove('show'), 1100);
  }
  toast(text) {
    const el = $('toast');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(this.toastT);
    this.toastT = setTimeout(() => el.classList.remove('show'), 2200);
  }

  // Settings that can change at any time, mid-game included. Changes apply as soon as they're picked.
  showSettings(settings) {
    const m = $('modal');
    m.classList.remove('hidden');
    const opts = (list, cur) => list.map(([k, name]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${esc(name)}</option>`).join('');
    m.innerHTML = `<div class="box settings"><h1>Settings</h1>
      <div class="field"><label>Backdrop</label><select data-setting="backdrop">${opts(Object.entries(THEMES).map(([k, t]) => [k, t.name]), settings.backdrop)}</select></div>
      <div class="field"><label>Draft pick timer</label><select data-setting="draftTimer">${opts([[0, 'Off'], [20, '20 seconds'], [30, '30 seconds'], [45, '45 seconds'], [60, '60 seconds']].map(([k, n]) => [String(k), n]), String(settings.draftTimer))}</select></div>
      <div class="field"><label>Health bar style</label><select data-setting="hpStyle">${opts([['pips', 'Hex pips'], ['pill', 'Pill bar'], ['plate', 'Shield plate'], ['minimal', 'Minimal line']], settings.hpStyle)}</select></div>
      <div class="field"><label>Graphics</label><select data-setting="graphics">${opts([['auto', 'Auto (low on phones)'], ['high', 'High (shadows)'], ['low', 'Low (faster)']], settings.graphics)}</select></div>
      <div class="field"><label>Dice roll animation</label><select data-setting="dice">${opts([['full', 'Full'], ['quick', 'Quick'], ['off', 'Off']], settings.dice)}</select></div>
      <div style="text-align:right;margin-top:12px"><button class="primary" data-act="closeModal">Done</button></div></div>`;
  }

  showHelp() {
    const m = $('modal');
    m.classList.remove('hidden');
    m.innerHTML = `<div class="box"><h1>How to play</h1>
      <h3>Setup</h3><ul>
        <li>Generate a map you like. The board is a big hexagon with 6 possible start corners. Fair symmetry gives every start corner the same ground.</li>
        <li><b>Corner draft</b>: everyone rolls a <b>d20</b> (ties roll again); the highest picks any start corner first; everyone else starts evenly spaced from it (2 players: the opposite corner, 3 players: every other corner). The first to pick deploys first and takes the first turn; the others get the first unit picks.</li>
        <li><b>Unit draft</b>: the pool stands beside the board. Hover a unit for its stats and abilities; take turns picking (snake order).</li>
        <li><b>Deploy</b>: place your units in your corner zone.</li></ul>
      <h3>Your turn</h3><ul>
        <li>You have <b>4 actions</b> each turn. A <b>move</b>, an <b>attack</b> or a <b>skill</b> costs 1 action. Spread them over any of your units: a unit can move as many times as you have actions, but attacks or uses an action skill only once per turn. <b>Enter</b> ends your turn.</li>
        <li>Click one of your units to see where it can move (the <b>Move</b> button); hover a hex for the move cost. <b>Attack</b> shows its range; for ranged units, hover a hex to see the line of sight (green clear, red blocked). Hover any unit for its stats and abilities.</li>
        <li><b>Moving</b> costs 1 per hex, plus 1 for each level up (a 2-level step costs 3). Some terrain costs more to enter. Drops of up to 3 levels cost nothing extra; bigger drops aren't allowed. Flyers ignore height and terrain.</li>
        <li>You can walk through allies, not enemies.</li>
        <li>Ranged attacks need line of sight: forest and hexes 2+ levels above both units block it.</li></ul>
      <h3>Combat</h3><ul>
        <li>Roll attack dice: each <b>sword</b> is a hit (${7 - COMBAT.HIT} of 6 faces). The defender rolls defense dice: each <b>shield</b> blocks one hit (${7 - COMBAT.BLOCK} of 6 faces). Blank faces do nothing. Damage = hits − blocks.</li>
        <li>Higher ground: +1 attack die when attacking down, +1 defense die when defending up high.</li>
        <li>Forest +1 defense, water and ice −1 defense, lava deals 2 damage on entry.</li>
        <li>Destroy every enemy unit to win.</li></ul>
      <h3>Camera</h3><ul>
        <li>Left-drag to rotate, right-drag to pan, scroll to zoom toward the pointer.</li>
        <li><b>W A S D</b> or arrows to pan, <b>Q / E</b> to rotate, <b>R / F</b> to zoom. The Camera button resets the view.</li></ul>
      <div style="text-align:right;margin-top:12px"><button class="primary" data-act="closeModal">Got it</button></div></div>`;
  }
  closeModal() { $('modal').classList.add('hidden'); }
}

function statsHtml(d) {
  return `<div class="stats"><span>HP <b>${d.hp}</b></span><span>Mv <b>${d.move}</b></span><span>Atk <b>${d.atk}</b></span>
    <span>Def <b>${d.def}</b></span><span>Rng <b>${d.range === 1 ? 'M' : d.range}</b></span></div>`;
}
