// HTML overlay: setup panel, phase panel (corners / draft / placement / battle), unit card, log.
// Buttons carry data-act attributes; one click listener forwards them to the controller.
import { UNITS } from '../core/units.js';
import { ABILITIES } from '../core/abilities.js';
import { TERRAIN } from '../core/terrain.js';
import { MAP_SIZES, BIOMES, SYMMETRY, CORNERS, CORNER_NAMES } from '../core/mapgen.js';
import { COMBAT } from '../core/rules.js';
import { SWORD, SHIELD } from './icons.js';
import { THEMES } from '../render/environment.js';
import { playerUnits, liveUnitsOf, activationsLeft, canActivate, unitOptions, slotOf } from '../core/game.js';

// Highlight colours on the board, shared with main.js so the legend always matches.
export const HIGHLIGHT = {
  move: '#4fc3ff', risky: '#ffd23a', attack: '#ff4d4d', target: '#b78cff', area: '#ffb347', ready: '#ffd76a',
};

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export class UI {
  constructor(handlers) {
    this.h = handlers;
    this.log = [];
    $('hud').addEventListener('click', e => {
      // phones: the side panel's handle folds it down to a strip so the board stays visible
      if (e.target.closest('.side-handle')) { $('side').classList.toggle('folded'); return; }
      const el = e.target.closest('[data-act]');
      if (!el || el.disabled) return;
      const fn = this.h[el.dataset.act];
      if (fn) fn(el.dataset.arg, el);
    });
    $('hud').addEventListener('change', e => {
      if (e.target.dataset.setting) this.h.setting(e.target.dataset.setting, e.target.value);
    });
    $('hud').addEventListener('mouseover', e => {
      const el = e.target.closest('[data-peek]');
      if (el) this.h.peek(el.dataset.peek);
    });
    $('btnNew').onclick = () => this.h.newGame();
    $('btnCamera').onclick = () => this.h.camera();
    $('btnHelp').onclick = () => this.showHelp();
    $('btnSettings').onclick = () => this.h.settings();
    // battle: what's happening and what you can do, across the top of the board
    const bar = document.createElement('div');
    bar.id = 'actionBar';
    bar.className = 'panel hidden';
    $('hud').append(bar);
    // map setup: the unit pool is a tray that slides in from the right edge, closed by default
    this.poolOpen = false;
    const tab = document.createElement('button');
    tab.id = 'poolTab';
    tab.className = 'hidden';
    tab.onclick = () => { this.poolOpen = !this.poolOpen; this.syncTray(); };
    $('hud').append(tab);
  }

  player(game, p) {
    const pl = game.players[p];
    return `<span class="chip"><span class="dot" style="background:${pl.color}"></span>${esc(pl.name)}${pl.ai ? ' (CPU)' : ''}</span>`;
  }

  // ---------- setup ----------
  renderSetup(settings, show) {
    const el = $('setup');
    el.classList.toggle('hidden', !show);
    if (!show) return;
    const opts = (obj, cur, label = v => v.name ?? v) => Object.entries(obj)
      .map(([k, v]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${esc(label(v))}</option>`).join('');
    el.innerHTML = `
      <h2>New battle</h2>
      <div class="field"><label>Map seed (same seed = same map)</label>
        <div class="seed"><input data-setting="seed" value="${esc(settings.seed)}"><button data-act="randomSeed" title="Random seed">Roll</button></div></div>
      <div class="row">
        <div class="field"><label>Size</label><select data-setting="size">${opts(MAP_SIZES, settings.size)}</select></div>
        <div class="field"><label>Biome</label><select data-setting="biome">${opts(BIOMES, settings.biome)}</select></div>
      </div>
      <div class="field"><label>Symmetry (fairness)</label><select data-setting="symmetry">${opts(SYMMETRY, settings.symmetry)}</select></div>
      <div class="row">
        <div class="field"><label>Army points</label><select data-setting="points">${[15, 20, 25, 30, 35, 40].map(n => `<option ${n == settings.points ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
        <div class="field"><label>Max units</label><select data-setting="teamSize">${[4, 5, 6, 7].map(n => `<option ${n == settings.teamSize ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
      </div>
      <div class="row">
        <div class="field"><label>Opponent</label><select data-setting="opponent">
          <option value="cpu" ${settings.opponent === 'cpu' ? 'selected' : ''}>Computer</option>
          <option value="human" ${settings.opponent === 'human' ? 'selected' : ''}>Hotseat (2 players)</option></select></div>
      </div>
      <div class="stack"><button class="primary big" data-act="start">Start draft</button></div>
      <h3>Terrain</h3>
      <div class="legend">${Object.values(TERRAIN).map(t =>
        `<span title="${esc(t.desc)}"><i class="swatch" style="background:#${t.color.toString(16).padStart(6, '0')}"></i>${t.name}</span>`).join('')}</div>
      <p class="muted" style="font-size:12px;margin:10px 0 0">Drag to rotate, right-drag or WASD to pan, scroll to zoom. Reroll until you like the map.</p>`;
  }

  // ---------- battle action bar ----------
  // Always answers: whose turn is it, how many units can still act, what is the selected unit able to
  // do right now, and how do I do it. ctx: { screen, human, selectedId, abilityKey, busy }
  renderActionBar(game, ctx) {
    const el = $('actionBar');
    const show = ctx.screen === 'game' && (game.phase === 'battle' || game.phase === 'over');
    el.classList.toggle('hidden', !show);
    if (!show) return;
    if (game.phase === 'over') {
      const w = game.winner;
      el.innerHTML = `<div class="ab-row"><b class="ab-big">${w === null ? 'Draw!' : `${esc(game.players[w].name)} wins!`}</b>
        <span class="muted">Every enemy unit has fallen.</span><button class="primary" data-act="newGame">New battle</button></div>`;
      return;
    }
    const t = game.turn, pl = game.players[t.player];
    const used = t.limit - activationsLeft(game);
    const pips = Array.from({ length: t.limit }, (_, i) => `<i class="${i < used ? 'used' : ''}"></i>`).join('');
    const head = `<div class="ab-row">
      <span class="ab-turn" style="--pc:${pl.color}"><span class="dot" style="background:${pl.color}"></span>${esc(pl.name)}'s turn</span>
      <span class="tag">Round ${game.round}</span>
      <span class="ab-pips" title="Each turn you activate up to ${t.limit} different units">${pips}<small>${activationsLeft(game)} of ${t.limit} unit${t.limit === 1 ? '' : 's'} left to activate</small></span>
      <span class="ab-gap"></span>
      ${ctx.human ? `<button class="primary" data-act="endTurn" ${ctx.busy ? 'disabled' : ''} title="Enter">End turn</button>` : ''}</div>`;
    if (!ctx.human) {
      el.innerHTML = head + `<div class="ab-guide"><span class="ab-spin"></span>${esc(pl.name)}${pl.ai ? ' (computer)' : ''} is taking its turn…</div>`;
      return;
    }
    const sel = ctx.selectedId && game.units[ctx.selectedId];
    const legend = keys => `<div class="ab-legend">${keys.map(([c, label]) => `<span><i style="background:${HIGHLIGHT[c]}"></i>${label}</span>`).join('')}</div>`;
    if (!sel || !canActivate(game, sel)) {
      const ready = liveUnitsOf(game, t.player).filter(u => canActivate(game, u));
      const chips = ready.map(u => `<button class="ab-chip" data-act="selectUnit" data-arg="${u.id}"><span class="dot" style="background:${UNITS[u.key].color}"></span>${esc(UNITS[u.key].name)}</button>`).join('');
      el.innerHTML = head + (ready.length
        ? `<div class="ab-guide"><b>Pick a unit to activate.</b> Click one of your glowing units, or a name here:</div><div class="ab-chips">${chips}</div>${legend([['ready', 'can act']])}`
        : `<div class="ab-guide"><b>All your activations are used.</b> Press <b>End turn</b> (or Enter).</div>`);
      return;
    }
    const d = UNITS[sel.key], o = unitOptions(game, sel), slot = slotOf(game, sel);
    const nReach = Object.keys(o.reach).length, nAtk = o.attackTargets.length;
    const actives = o.abilities.filter(a => a.kind === 'active');
    const step = (n, label, done, detail) => `<div class="ab-step ${done ? 'done' : ''}"><span class="n">${done ? '✓' : n}</span><div><b>${label}</b><small>${detail}</small></div></div>`;
    const moveDetail = slot.moved ? 'done' : nReach ? `click a blue hex (${d.move} move)` : 'nowhere to go';
    const actDetail = slot.acted ? 'done' : nAtk ? `click a red enemy to attack (${nAtk} in range)` : actives.some(a => a.ready) ? 'use an ability below' : 'no target in range yet';
    const abButtons = actives.map(a => {
      const why = a.cooldownLeft ? `${a.cooldownLeft} turn${a.cooldownLeft > 1 ? 's' : ''}` : !a.ready ? (a.usesMove ? (slot.moved ? 'moved' : 'no target') : (slot.acted ? 'acted' : 'no target')) : '';
      return ctx.abilityKey === a.key ? `<button class="ab-ab on" data-act="cancel">Cancel ${esc(a.name)}</button>`
        : `<button class="ab-ab" data-act="ability" data-arg="${a.key}" ${a.ready ? '' : 'disabled'} title="${esc(a.desc)}">${esc(a.name)}${why ? ` <small>${why}</small>` : ''}</button>`;
    }).join('');
    let guide;
    if (ctx.abilityKey) {
      const ab = ABILITIES[ctx.abilityKey];
      const what = { hex: 'a purple hex', enemy: 'a purple enemy', ally: 'a purple ally', self: 'yourself' }[ab.target.type];
      guide = `<b>${esc(ab.name)}:</b> click ${what} to use it${ab.target.radius || ab.area ? '; orange shows what it hits' : ''}. Right-click or Esc to cancel.`;
    } else if (slot.moved && slot.acted) guide = `<b>${esc(d.name)} is done.</b> Pick another unit${activationsLeft(game) ? '' : ' (none left)'} or End turn.`;
    else {
      const can = [!slot.moved && nReach ? '<b>move</b>' : '', !slot.acted && (nAtk || actives.some(a => a.ready && !a.usesMove)) ? '<b>attack or use an ability</b>' : ''].filter(Boolean);
      guide = `<b>${esc(d.name)}</b> can ${can.join(' and ') || 'do nothing more'}${can.length === 2 ? ', in either order' : ''}${!slot.acted && !nAtk && !slot.moved ? ' (move closer to get an enemy in range)' : ''}. Picking another unit ends this one's activation.`;
    }
    el.innerHTML = head + `<div class="ab-row ab-unit">
        ${step(1, 'Move', slot.moved, moveDetail)}${step(2, 'Action', slot.acted, actDetail)}
        ${abButtons ? `<div class="ab-abs">${abButtons}</div>` : ''}</div>
      <div class="ab-guide">${guide}</div>
      ${legend(ctx.abilityKey ? [['target', 'ability target'], ['area', 'area hit']] : [['move', 'move'], ['risky', 'move through lava'], ['attack', 'attack'], ['ready', 'other units that can act']])}`;
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
    this.syncTray();
    if (this.setup) { el.innerHTML = this.poolHtml(game, false, ctx); return; }
    const fn = { corners: this.cornersHtml, draft: this.draftHtml, placement: this.placementHtml, battle: this.battleHtml, over: this.battleHtml }[game.phase];
    // the handle only shows on phones (styles.css); a new phase starts folded so the board is visible
    if (this.sidePhase !== game.phase) { this.sidePhase = game.phase; el.classList.toggle('folded', game.phase === 'battle'); }
    el.innerHTML = '<button class="side-handle" aria-label="Show or hide the panel"><i></i></button>' + fn.call(this, game, ctx) + this.logHtml();
    const log = el.querySelector('.log');
    if (log) log.scrollTop = log.scrollHeight;
  }

  syncTray() {
    const open = this.setup && this.poolOpen;
    $('side').classList.toggle('tray', this.setup);
    $('side').classList.toggle('open', open);
    $('poolTab').classList.toggle('hidden', !this.setup);
    $('poolTab').classList.toggle('open', open);
    $('poolTab').textContent = open ? 'Hide pool ▸' : '◂ Unit pool';
  }

  poolHtml(game, pickable, ctx) {
    return `<h2>Unit pool</h2><p class="muted" style="margin:0 0 8px;font-size:12px">${game.pool.length} units to draft from. Hover for details.</p>
      <div class="pool">${game.pool.map(item => {
        const d = UNITS[item.key];
        const taken = item.takenBy !== null;
        const owner = taken ? `<span class="owner dot" style="background:${game.players[item.takenBy].color}"></span>` : '';
        return `<div class="card ${taken ? 'taken' : pickable ? 'pickable' : ''}" style="--accent:${d.color}"
          ${!taken && pickable ? `data-act="draft" data-arg="${item.pid}"` : ''} data-peek="type:${item.key}">
          ${owner}<div class="name">${esc(d.name)}</div><div class="role">${d.role}</div>
          ${statsHtml(d)}
          <div class="abil">${d.abilities.map(a => ABILITIES[a].name).join(' · ')}</div></div>`;
      }).join('')}</div>`;
  }

  cornersHtml(game, ctx) {
    return `<h2>Choose your corner</h2>
      <div class="corners">${CORNERS.map(c => {
        const owner = game.players.find(p => p.corner === c);
        return `<button data-act="pickCorner" data-arg="${c}" ${owner || !ctx.human ? 'disabled' : ''}>
          ${owner ? `<span class="dot" style="background:${owner.color}"></span> ` : ''}${CORNER_NAMES[c]}</button>`;
      }).join('')}</div>
      <p class="muted" style="font-size:12px">Click a glowing zone on the board or a button. The first to pick a corner deploys first and takes the first turn; the other player gets the first unit pick. The units you'll draft stand on the left.</p>
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
  showTip(html, x, y) {
    const el = $('tip');
    el.innerHTML = html;
    el.classList.remove('hidden');
    const w = el.offsetWidth, h = el.offsetHeight;
    el.style.left = `${Math.min(window.innerWidth - w - 8, x + 18)}px`;
    el.style.top = `${Math.max(56, Math.min(window.innerHeight - h - 8, y - h / 2))}px`;
  }
  hideTip() { $('tip').classList.add('hidden'); }

  unitCardHtml(game, what) {
    const unit = what.unit;
    const d = UNITS[unit?.key ?? what.type];
    const owner = unit ? game.players[unit.owner] : null;
    const opts = what.options;
    const f = unit ? unit.hp / unit.maxHp : 1;
    const statuses = unit ? Object.keys(unit.status).filter(s => s !== 'shieldTurns').map(s => `<span class="status">${{ slowed: 'Slowed', braced: 'Braced', empowered: 'War Cry', shield: `Barrier ${unit.status.shield}`,
      released: `Released (${unit.status.released - 1 > 0 ? `${unit.status.released - 1} more` : 'last'} turn)`, poison: `Poison ${unit.status.poison}`, cowed: 'Cowed' }[s] ?? s}</span>`).join('') : '';
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
        <div class="ad">${d.atk} attack dice, ${d.range === 1 ? 'against an adjacent enemy' : `range ${d.range}${d.abilities.includes('sharpshooter') ? ' (+ height)' : ''}, needs line of sight`}.</div></div>
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
          <div class="ad">${esc(ab.desc)}</div></div>`;
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
  logHtml() {
    return this.log.length ? `<h3>Battle log</h3><div class="log">${this.log.map(l => `<div>${l}</div>`).join('')}</div>` : '';
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
  banner(text, color = '#fff') {
    const el = $('banner');
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
        <li>Generate a map you like. The board is a big hexagon with 6 possible start corners. Symmetry makes matching corners identical (3-way: every other corner; 6-way: all of them).</li>
        <li><b>Corner draft</b>: players pick a start corner. The first to pick deploys first and takes the first turn; the other player gets the first unit pick.</li>
        <li><b>Unit draft</b>: the pool stands beside the board. Hover a unit for its stats and abilities; take turns picking (snake order).</li>
        <li><b>Deploy</b>: place your units in your corner zone.</li></ul>
      <h3>Your turn</h3><ul>
        <li>Activate up to <b>2 different units</b>. Each can <b>move once</b> and <b>act once</b> (attack or an active ability), in either order. <b>Enter</b> ends your turn.</li>
        <li><b>Moving</b> costs 1 per hex, plus 1 for each level up (a 2-level step costs 3). Some terrain costs more to enter. Drops of up to 3 levels cost nothing extra; bigger drops aren't allowed. Flyers ignore height and terrain.</li>
        <li>Entering a hex next to an enemy stops your move (engagement). You can walk through allies, not enemies.</li>
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
