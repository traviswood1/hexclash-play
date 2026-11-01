// Game state and the actions that change it. No DOM, no Three.js: this file runs the same in the
// browser, in Node (tools/sim.mjs), on a future game server, or inside a mobile/Steam wrapper.
//
//   const game = createGame({ seed: 'ash-moss-123' });
//   const { ok, error, events } = dispatch(game, { type: 'pickCorner', player: 0, corner: 'NE' });
//
// The state is plain JSON (save it with JSON.stringify). `events` describe what happened, in order,
// so the renderer can animate them and a server could broadcast them.
//
// Phases: corners -> draft -> placement -> battle -> over
//
// Draft: players take turns (snaking) buying units from the shared pool with a points budget
// (settings.points; each unit has a cost in units.js), up to settings.teamSize units each. A player
// who can't afford anything left, or has a full army, is skipped; the draft ends when nobody can buy.

import { hashSeed, rollD6, createRng } from './rng.js';
import { generateMap, CORNERS } from './mapgen.js';
import { UNITS, DRAFTABLE, SUMMONS } from './units.js';
import { ABILITIES, validTargets } from './abilities.js';
import * as R from './rules.js';
import { key, distance } from './hex.js';

export const PLAYER_COLORS = ['#3d8bff', '#ff4d4d', '#3ccf6e', '#f2c230'];
export const PLAYER_NAMES = ['Blue', 'Red', 'Green', 'Gold'];
export const ACTIVATIONS_PER_TURN = 2; // different units a player may move/act with each turn

export function createGame(opts = {}) {
  const settings = {
    seed: 'hexclash', size: 'medium', biome: 'mixed', symmetry: 'fair',
    players: 2, teamSize: 6, points: 25, ai: [], ...opts,
  };
  const { seed, players, teamSize } = settings;
  const map = generateMap({ ...settings, zoneSize: teamSize + 4 });
  return {
    v: 1,
    settings,
    map,
    rng: hashSeed(`${seed}#dice`),
    players: Array.from({ length: players }, (_, i) => ({
      id: i, name: PLAYER_NAMES[i], color: PLAYER_COLORS[i], corner: null, ai: !!settings.ai[i], spent: 0,
    })),
    phase: 'corners',
    seats: Array.from({ length: players }, (_, i) => i), // turn order, set by corner picks
    queue: Array.from({ length: players }, (_, i) => i), // who picks next in corners/draft/placement
    qi: 0,
    pool: buildPool(seed, teamSize * players + 4),
    units: {},
    nextId: 1,
    turn: null,
    round: 0,
    winner: null,
  };
}

// Every unit type is always in the pool. Only when the players need more units than there are
// types (`count`) are random duplicates added.
function buildPool(seed, count) {
  const rng = createRng(`${seed}#pool`);
  const keys = [...DRAFTABLE];
  const picks = [...keys];
  while (picks.length < count) picks.push(...rng.shuffle([...keys]));
  return picks.slice(0, Math.max(count, keys.length)).sort((a, b) => keys.indexOf(a) - keys.indexOf(b))
    .map((k, i) => ({ pid: i, key: k, takenBy: null }));
}

// ---------- queries for UI / AI ----------

// Corners the current picker may take. The first pick is free; after that, starts are spaced evenly
// around the board from it (2 players: opposite corners; 3 players: every other corner). Player
// counts that don't divide 6 have no spacing rule.
export function allowedCorners(state) {
  const free = CORNERS.filter(c => !state.players.some(p => p.corner === c));
  const first = state.players[state.queue[0]]?.corner;
  const n = state.players.length;
  if (state.phase !== 'corners' || !first || 6 % n) return free;
  const i = CORNERS.indexOf(first), step = 6 / n;
  const spaced = Array.from({ length: n - 1 }, (_, k) => CORNERS[(i + (k + 1) * step) % 6]);
  return free.filter(c => spaced.includes(c));
}

export function currentPlayer(state) {
  if (state.phase === 'battle') return state.turn.player;
  if (state.phase === 'over') return null;
  return state.queue[state.qi];
}

// Draft points a player has left to spend.
export const pointsLeft = (state, p) => state.settings.points - (state.players[p].spent ?? 0);

// Can this player still buy a unit (army not full, and something left in the pool they can afford)?
export function canDraft(state, p) {
  if (playerUnits(state, p).length >= state.settings.teamSize) return false;
  const left = pointsLeft(state, p);
  return state.pool.some(i => i.takenBy === null && UNITS[i.key].cost <= left);
}

export const playerUnits = (state, p) => Object.values(state.units).filter(u => u.owner === p);
export const liveUnitsOf = (state, p) => playerUnits(state, p).filter(u => u.alive && u.placed);

// What a unit has already done this turn.
export function slotOf(state, unit) {
  const t = state.turn;
  return t?.active === unit.id ? { moved: t.moved, acted: t.acted, movedDistance: t.movedDistance }
    : { moved: false, acted: false, movedDistance: 0 };
}

// Activations still available this turn, counting the active unit's if it has done something.
export function activationsLeft(state) {
  const t = state.turn;
  return t.limit - t.done.length - (t.moved || t.acted ? 1 : 0);
}

export function canActivate(state, unit) {
  if (state.phase !== 'battle' || !unit?.alive || unit.owner !== state.turn.player) return false;
  const t = state.turn;
  if (t.done.includes(unit.id) || t.fresh?.includes(unit.id)) return false; // fresh: raised this turn
  return t.active === unit.id || activationsLeft(state) > 0;
}

// Everything the UI needs to show for a selected unit.
export function unitOptions(state, unit) {
  const t = slotOf(state, unit);
  const ok = canActivate(state, unit);
  const canMove = ok && !t.moved;
  const canAct = ok && !t.acted;
  return {
    canMove, canAct,
    reach: canMove ? R.reachable(state, unit) : {},
    attackTargets: canAct ? R.liveUnits(state).filter(e => R.canAttack(state, unit, e)).map(e => e.id) : [],
    abilities: UNITS[unit.key].abilities.map(k => {
      const ab = ABILITIES[k];
      const cd = unit.cooldowns[k] || 0;
      const slotFree = ab.usesMove ? canMove : canAct;
      const targets = ab.kind === 'active' && slotFree && !cd ? validTargets(state, unit, k) : [];
      return { key: k, ...ab, cooldownLeft: cd, ready: ab.kind === 'active' && slotFree && !cd && targets.length > 0, targets };
    }),
  };
}

// ---------- actions ----------

class RuleError extends Error {}
const fail = msg => { throw new RuleError(msg); };

export function dispatch(state, action) {
  const events = [];
  const emit = e => events.push(e);
  const handler = HANDLERS[action.type];
  try {
    if (!handler) fail(`Unknown action ${action.type}`);
    if (action.player !== currentPlayer(state)) fail('Not your turn.');
    handler(state, action, emit);
  } catch (e) {
    if (e instanceof RuleError) return { ok: false, error: e.message, events: [] };
    throw e;
  }
  return { ok: true, events };
}

const HANDLERS = {
  pickCorner(state, { player, corner }, emit) {
    if (state.phase !== 'corners') fail('Not picking corners now.');
    if (!CORNERS.includes(corner)) fail('No such corner.');
    if (state.players.some(p => p.corner === corner)) fail('That corner is taken.');
    if (!allowedCorners(state).includes(corner)) fail('Pick a highlighted corner: starts stay evenly spaced around the board.');
    state.players[player].corner = corner;
    emit({ type: 'corner', player, corner });
    state.qi++;
    // anyone left with only one possible corner gets it straight away (2 players: the opposite corner)
    while (state.qi < state.queue.length) {
      const options = allowedCorners(state);
      if (options.length !== 1) return;
      const p = state.queue[state.qi++];
      state.players[p].corner = options[0];
      emit({ type: 'corner', player: p, corner: options[0], auto: true });
    }
    // Balance: picking a corner first is an edge (the better ground), and so is moving last (the
    // other side has to walk into range first). So the first to pick a corner deploys first and
    // moves first, and the others, in reverse corner order, get the earlier unit picks. The draft
    // snakes back and forth.
    state.seats = [...state.queue];
    const base = [...state.queue].reverse();
    state.queue = [];
    for (let round = 0; round < state.settings.teamSize; round++) {
      state.queue.push(...(round % 2 ? [...base].reverse() : base));
    }
    state.qi = 0;
    state.phase = 'draft';
    emit({ type: 'phase', phase: 'draft' });
    nextDrafter(state, emit);
  },

  draft(state, { player, pid }, emit) {
    if (state.phase !== 'draft') fail('Not drafting now.');
    const item = state.pool.find(p => p.pid === pid);
    if (!item || item.takenBy !== null) fail('That unit is not available.');
    const cost = UNITS[item.key].cost;
    if (cost > pointsLeft(state, player)) fail(`Not enough points (${UNITS[item.key].name} costs ${cost}).`);
    if (playerUnits(state, player).length >= state.settings.teamSize) fail('Your army is full.');
    item.takenBy = player;
    state.players[player].spent += cost;
    const unit = addUnit(state, item.key, player);
    emit({ type: 'draft', player, pid, unit: unit.id, key: item.key, cost });
    state.qi++;
    nextDrafter(state, emit);
  },

  place(state, { player, unitId, hex }, emit) {
    if (state.phase !== 'placement') fail('Not placing units now.');
    const unit = state.units[unitId];
    if (!unit || unit.owner !== player) fail('Not your unit.');
    if (!state.map.zones[state.players[player].corner].includes(hex)) fail('Place units inside your start zone.');
    const other = R.unitAt(state, hex, unit.id);
    if (other) {
      if (other.owner !== player) fail('That hex is taken.');
      // swap with the unit already there
      if (unit.placed) [other.q, other.r] = [unit.q, unit.r];
      else other.placed = false;
      emit({ type: 'placed', unit: other.id });
    }
    const { q, r } = state.map.cells[hex];
    Object.assign(unit, { q, r, placed: true });
    emit({ type: 'placed', unit: unit.id });
  },

  autoPlace(state, { player }, emit) {
    if (state.phase !== 'placement') fail('Not placing units now.');
    const zone = state.map.zones[state.players[player].corner];
    const center = key(0, 0); // board center
    const free = zone.filter(k => !R.unitAt(state, k)).sort((a, b) => distance(a, center) - distance(b, center));
    // melee in front, ranged behind
    const todo = playerUnits(state, player).filter(u => !u.placed)
      .sort((a, b) => UNITS[a.key].range - UNITS[b.key].range || a.id - b.id);
    for (const u of todo) {
      const k = free.shift();
      const { q, r } = state.map.cells[k];
      Object.assign(u, { q, r, placed: true });
      emit({ type: 'placed', unit: u.id });
    }
  },

  confirmPlacement(state, { player }, emit) {
    if (state.phase !== 'placement') fail('Not placing units now.');
    if (playerUnits(state, player).some(u => !u.placed)) fail('Place all your units first.');
    emit({ type: 'placementDone', player });
    if (++state.qi < state.queue.length) return;
    state.phase = 'battle';
    state.round = 1;
    emit({ type: 'phase', phase: 'battle' });
    startTurn(state, state.seats[0], emit);
  },

  move(state, { player, unitId, to }, emit) {
    const unit = activatable(state, player, unitId);
    if (slotOf(state, unit).moved) fail('This unit already moved.');
    const reach = R.reachable(state, unit);
    if (!reach[to]) fail('Cannot move there.');
    const full = R.pathTo(reach, R.unitKey(unit), to);
    const fly = R.has(unit, 'flight');
    // Walk the path; lava burns on entry (flyers only where they land). Stop early on death.
    let hp = unit.hp, path = [full[0]];
    const burns = [];
    for (let i = 1; i < full.length; i++) {
      path.push(full[i]);
      const c = state.map.cells[full[i]];
      if (R.hurtsOnEntry(unit, c) && (!fly || i === full.length - 1)) {
        burns.push(full[i]);
        hp -= 2;
        if (hp <= 0) break;
      }
    }
    const end = state.map.cells[path[path.length - 1]];
    Object.assign(unit, { q: end.q, r: end.r });
    commit(state, unit, { moved: true, movedDistance: path.length - 1 });
    emit({ type: 'move', unit: unit.id, path, fly });
    for (let i = 0; i < burns.length && unit.alive; i++) applyDamage(state, emit, unit, 2, 'Lava');
  },

  attack(state, { player, unitId, target }, emit) {
    const unit = activatable(state, player, unitId);
    if (slotOf(state, unit).acted) fail('This unit already acted.');
    const victim = state.units[target];
    if (!victim || !R.canAttack(state, unit, victim)) fail('Cannot attack that.');
    commit(state, unit, { acted: true });
    const ranged = UNITS[unit.key].range > 1;
    emit({ type: 'attack', unit: unit.id, target: victim.id, ranged });
    strike(state, emit, unit, victim, UNITS[unit.key].atk, { label: 'Attack', ranged });
    delete unit.status.empowered;
  },

  ability(state, { player, unitId, ability, target }, emit) {
    const unit = activatable(state, player, unitId);
    const ab = ABILITIES[ability];
    if (!ab || ab.kind !== 'active' || !UNITS[unit.key].abilities.includes(ability)) fail('No such ability.');
    if (unit.cooldowns[ability]) fail(`${ab.name} is recharging.`);
    const slot = slotOf(state, unit);
    if (ab.usesMove ? slot.moved : slot.acted) fail(`This unit already ${ab.usesMove ? 'moved' : 'acted'}.`);
    if (!validTargets(state, unit, ability).includes(target)) fail('Invalid target.');
    commit(state, unit, ab.usesMove ? { moved: true } : { acted: true });
    unit.cooldowns[ability] = ab.cooldown;
    const tgt = typeof target === 'number' ? state.units[target] : target;
    emit({ type: 'ability', unit: unit.id, ability, target });
    let struck = false;
    const api = {
      emit,
      strike: (a, d, dice, opts) => { struck = true; strike(state, emit, a, d, dice, opts); },
      heal: (u, n) => heal(state, emit, u, n),
      damage: (u, n, source) => applyDamage(state, emit, u, n, source),
      // raise a random minion for `by` on hex k; it can't be activated until its owner's next turn
      summon: (by, k) => {
        const key = SUMMONS[rollD6(state) - 1];
        const m = addUnit(state, key, by.owner);
        const { q, r } = state.map.cells[k];
        Object.assign(m, { q, r, placed: true, summoner: by.id });
        (state.turn.fresh ??= []).push(m.id);
        emit({ type: 'summon', unit: m.id, by: by.id, key, hex: k });
      },
      setStatus: (u, name, v, extra = {}) => { u.status[name] = v; Object.assign(u.status, extra); emit({ type: 'status', unit: u.id, status: name }); },
      setTerrain: (k, terrain) => { state.map.cells[k].terrain = terrain; emit({ type: 'terrain', hex: k, terrain }); },
      teleport: (u, k, style = 'blink') => {
        const from = R.unitKey(u);
        const { q, r } = state.map.cells[k];
        Object.assign(u, { q, r });
        emit({ type: 'teleport', unit: u.id, from, to: k, style });
      },
    };
    ab.resolve({ state, unit, target: tgt, api });
    if (struck) delete unit.status.empowered;
  },

  endTurn(state, { player }, emit) {
    if (state.phase !== 'battle') fail('Not in battle.');
    for (const u of liveUnitsOf(state, player)) {
      delete u.status.slowed;
      delete u.status.cowed;
      for (const k of Object.keys(u.cooldowns)) if (--u.cooldowns[k] <= 0) delete u.cooldowns[k];
    }
    // next seat that still has units
    const seats = state.seats;
    let i = seats.indexOf(player);
    for (let n = 0; n < seats.length; n++) {
      i = (i + 1) % seats.length;
      if (i === 0) state.round++;
      if (liveUnitsOf(state, seats[i]).length) break;
    }
    startTurn(state, seats[i], emit);
  },
};

function activatable(state, player, unitId) {
  if (state.phase !== 'battle') fail('Not in battle.');
  const unit = state.units[unitId];
  if (!unit || !unit.alive || unit.owner !== player) fail('Not your unit.');
  if (state.turn.done.includes(unit.id)) fail('That unit already finished this turn.');
  if (state.turn.fresh?.includes(unit.id)) fail('It was just raised: it can act from your next turn.');
  if (!canActivate(state, unit)) fail(`You can only activate ${state.turn.limit} units per turn.`);
  return unit;
}

// Make `unit` the active one (finishing the previous active unit if it did anything), then record what it did.
function commit(state, unit, changes) {
  const t = state.turn;
  if (t.active !== unit.id) {
    if (t.active && (t.moved || t.acted)) t.done.push(t.active);
    Object.assign(t, { active: unit.id, moved: false, acted: false, movedDistance: 0 });
  }
  Object.assign(t, changes);
}

// Move the draft on to the next player who can still buy something; end it when nobody can.
function nextDrafter(state, emit) {
  while (state.qi < state.queue.length && !canDraft(state, state.queue[state.qi])) state.qi++;
  if (state.qi < state.queue.length) return;
  // Placement follows turn order: the first mover reveals first.
  state.queue = [...state.seats];
  state.qi = 0;
  state.phase = 'placement';
  emit({ type: 'phase', phase: 'placement' });
}

function addUnit(state, key, owner) {
  const d = UNITS[key];
  const unit = {
    id: state.nextId++, key, owner, hp: d.hp, maxHp: d.hp,
    q: null, r: null, placed: false, alive: true, status: {}, cooldowns: {},
  };
  state.units[unit.id] = unit;
  return unit;
}


function startTurn(state, player, emit) {
  const limit = Math.min(ACTIVATIONS_PER_TURN, liveUnitsOf(state, player).length);
  state.turn = { player, active: null, moved: false, acted: false, movedDistance: 0, done: [], limit };
  emit({ type: 'turn', player, round: state.round });
  for (const u of liveUnitsOf(state, player)) {
    delete u.status.braced;
    if (u.status.shieldTurns && --u.status.shieldTurns <= 0) { delete u.status.shield; delete u.status.shieldTurns; }
    if (R.has(u, 'regenerate') && u.hp < u.maxHp) heal(state, emit, u, 1);
    if (u.status.released && --u.status.released <= 0) { delete u.status.released; emit({ type: 'status', unit: u.id, status: 'releaseEnds' }); }
  }
  // poison bites at the start of the poisoned unit's turn
  for (const u of liveUnitsOf(state, player)) {
    if (!u.status.poison) continue;
    if (--u.status.poison <= 0) delete u.status.poison;
    applyDamage(state, emit, u, 1, 'Poison');
    if (state.phase === 'over') return;
  }
  // Repair Field: each unit with it mends allies within 2
  const units = liveUnitsOf(state, player);
  for (const medic of units.filter(u => R.has(u, 'regenAura'))) {
    for (const ally of units) {
      if (ally.id !== medic.id && ally.hp < ally.maxHp && distance(R.unitKey(ally), R.unitKey(medic)) <= 2) heal(state, emit, ally, 1);
    }
  }
}

function strike(state, emit, attacker, defender, base, { label, ranged = false }) {
  if (!defender.alive) return;
  const a = R.attackDice(state, attacker, defender, base, { ranged });
  const d = R.defenseDice(state, attacker, defender, { ranged });
  const atkRolls = Array.from({ length: a.dice }, () => rollD6(state));
  const defRolls = Array.from({ length: d.dice }, () => rollD6(state));
  const hits = atkRolls.filter(v => v >= R.COMBAT.HIT).length;
  const blocks = defRolls.filter(v => v >= R.COMBAT.BLOCK).length;
  let damage = Math.max(0, hits - blocks);
  if (damage > 0 && R.has(defender, 'stoneskin')) damage--;
  emit({
    type: 'strike', attacker: attacker.id, target: defender.id, label, ranged,
    atkRolls, defRolls, atkMods: a.mods, defMods: d.mods, hits, blocks, damage,
  });
  if (damage) applyDamage(state, emit, defender, damage, label);
  if (damage && attacker.alive && R.has(attacker, 'lifesteal')) heal(state, emit, attacker, 1);
}

function applyDamage(state, emit, unit, amount, source) {
  if (unit.status.shield) { // Aegis soaks damage first
    const absorbed = Math.min(unit.status.shield, amount);
    unit.status.shield -= absorbed;
    amount -= absorbed;
    if (!unit.status.shield) { delete unit.status.shield; delete unit.status.shieldTurns; }
    emit({ type: 'absorb', unit: unit.id, amount: absorbed, left: unit.status.shield ?? 0 });
    if (!amount) return;
  }
  unit.hp = Math.max(0, unit.hp - amount);
  emit({ type: 'damage', unit: unit.id, amount, hp: unit.hp, source });
  if (unit.hp > 0) return;
  unit.alive = false;
  emit({ type: 'death', unit: unit.id });
  // a fallen summoner's minions crumble with it
  for (const m of Object.values(state.units)) {
    if (m.alive && m.summoner === unit.id) { m.alive = false; emit({ type: 'death', unit: m.id, crumble: true }); }
  }
  const standing = state.players.filter(p => liveUnitsOf(state, p.id).length);
  if (standing.length <= 1) {
    state.phase = 'over';
    state.winner = standing[0]?.id ?? null;
    emit({ type: 'gameOver', winner: state.winner });
  }
}

function heal(state, emit, unit, amount) {
  const n = Math.min(amount, unit.maxHp - unit.hp);
  if (n <= 0) return;
  unit.hp += n;
  emit({ type: 'heal', unit: unit.id, amount: n, hp: unit.hp });
}
