// Read-only rule queries: movement, line of sight, attack ranges and dice.
// Nothing here changes the game state, so the AI can ask "what if I stood there?" freely.

import { UNITS } from './units.js';
import { TERRAIN } from './terrain.js';
import { key, neighborKeys, distance, line } from './hex.js';

// Each attack die hits on HIT or higher, each defense die blocks on BLOCK or higher.
// Damage = hits - blocks. Tweak here to make fights faster or slower.
export const COMBAT = { HIT: 3, BLOCK: 5, MAX_DROP: 3, MELEE_REACH: 2 };

export const def = unit => UNITS[unit.key];
export const has = (unit, ability) => UNITS[unit.key].abilities.includes(ability);
export const unitKey = unit => key(unit.q, unit.r);
export const cell = (state, k) => state.map.cells[k];

export function liveUnits(state) {
  return Object.values(state.units).filter(u => u.alive && u.placed);
}

export function unitAt(state, k, ignoreId) {
  for (const u of Object.values(state.units)) {
    if (u.alive && u.placed && u.id !== ignoreId && key(u.q, u.r) === k) return u;
  }
  return null;
}

export const isEnemy = (a, b) => a.owner !== b.owner;

export function adjacentEnemies(state, k, owner, ignoreId) {
  return neighborKeys(k).map(n => unitAt(state, n, ignoreId)).filter(u => u && u.owner !== owner);
}

export function moveCostInto(unit, to) {
  if (to.terrain === 'water' && has(unit, 'swimmer')) return 1;
  if ((to.terrain === 'snow' || to.terrain === 'ice') && has(unit, 'iceborn')) return 1;
  return TERRAIN[to.terrain].moveCost;
}

// Movement points to step from one hex to its neighbor, or Infinity if the step is impossible.
// Same for every walker: the hex's terrain cost (1 on open ground) plus 1 for each level climbed.
// Drops of more than MAX_DROP levels are not allowed.
export function stepCost(unit, from, to) {
  if (has(unit, 'flight')) return 1;
  const rise = to.elev - from.elev;
  if (rise < -COMBAT.MAX_DROP) return Infinity;
  return moveCostInto(unit, to) + Math.max(0, rise);
}

export const hurtsOnEntry = (unit, c) => !!TERRAIN[c.terrain].damage && !has(unit, 'fireproof');

export function movePoints(unit, state) {
  // Tempo Beat: +1 move near an allied unit that has it
  const tempo = state && liveUnits(state).some(u => u.owner === unit.owner && u.id !== unit.id && has(u, 'speedAura')
    && distance(unitKey(u), unitKey(unit)) <= 2);
  return Math.max(0, def(unit).move - (unit.status.slowed ? 2 : 0) + (tempo ? 1 : 0));
}

// Every hex the unit can end its move on: { key: { cost, hazard, prev } }.
// Rules: can pass allies but not enemies; entering a hex next to an enemy ends the move
// (engagement); flyers ignore terrain, height, engagement and can pass over anyone.
// Phase Shift units ignore engagement and pass through enemies, but still pay for terrain.
export function reachable(state, unit) {
  const fly = has(unit, 'flight');
  const phase = fly || has(unit, 'phaseShift');
  const budget = movePoints(unit, state);
  const start = unitKey(unit);
  const best = { [start]: { cost: 0, hazard: 0, prev: null } };
  const open = [start];
  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) {
      const a = best[open[i]], b = best[open[bi]];
      if (a.cost < b.cost || (a.cost === b.cost && a.hazard < b.hazard)) bi = i;
    }
    const cur = open.splice(bi, 1)[0];
    const node = best[cur];
    if (cur !== start && !phase && adjacentEnemies(state, cur, unit.owner, unit.id).length) continue;
    const from = cell(state, cur);
    for (const n of neighborKeys(cur)) {
      const to = cell(state, n);
      if (!to) continue;
      const occ = unitAt(state, n, unit.id);
      if (occ && occ.owner !== unit.owner && !phase) continue;
      const step = stepCost(unit, from, to);
      const cost = node.cost + step;
      if (cost > budget) continue;
      const hazard = node.hazard + (!fly && hurtsOnEntry(unit, to) ? 1 : 0);
      const old = best[n];
      if (!old || cost < old.cost || (cost === old.cost && hazard < old.hazard)) {
        if (!old) open.push(n);
        best[n] = { cost, hazard, prev: cur };
      }
    }
  }
  delete best[start];
  for (const k of Object.keys(best)) {
    if (unitAt(state, k, unit.id)) delete best[k]; // passed through, can't stop there
    else if (fly && hurtsOnEntry(unit, cell(state, k))) best[k].hazard = 1; // flyers only burn where they land
  }
  return best;
}

export function pathTo(reach, start, dest) {
  const path = [dest];
  let k = dest;
  while (reach[k]?.prev && reach[k].prev !== start) { k = reach[k].prev; path.unshift(k); }
  path.unshift(start);
  return path;
}

// Ranged line of sight. Blocked by a hex in between that is 2+ levels above both ends,
// or by forest in between. Units never block sight.
export function hasSight(state, fromKey, toKey) {
  const a = cell(state, fromKey), b = cell(state, toKey);
  const top = Math.max(a.elev, b.elev) + 2;
  const ks = line(fromKey, toKey);
  for (let i = 1; i < ks.length - 1; i++) {
    const c = cell(state, ks[i]);
    if (!c) continue;
    if (c.elev >= top || TERRAIN[c.terrain].blocksSight) return false;
  }
  return true;
}

export function attackRange(state, unit, target, fromKey = unitKey(unit)) {
  let r = def(unit).range;
  if (r > 1 && has(unit, 'sharpshooter')) {
    r += Math.max(0, Math.min(1, cell(state, fromKey).elev - cell(state, unitKey(target)).elev));
  }
  return r;
}

// Can `unit` standing at fromKey use its basic attack on `target`?
export function canAttack(state, unit, target, fromKey = unitKey(unit)) {
  if (!target.alive || !target.placed || !isEnemy(unit, target)) return false;
  const tk = unitKey(target);
  const d = distance(fromKey, tk);
  if (def(unit).range === 1) {
    return d === 1 && Math.abs(cell(state, fromKey).elev - cell(state, tk).elev) <= COMBAT.MELEE_REACH;
  }
  return d <= attackRange(state, unit, target, fromKey) && hasSight(state, fromKey, tk);
}

const alliesNear = (state, k, owner, radius, ignoreIds) => liveUnits(state).filter(u =>
  u.owner === owner && !ignoreIds.includes(u.id) && distance(unitKey(u), k) <= radius);

// Attack dice and the reasons, for the dice roll and the UI.
// ctx: { fromKey, movedDistance }  (both optional; the AI passes hypothetical values)
export function attackDice(state, attacker, defender, base, ctx = {}) {
  const fromKey = ctx.fromKey ?? unitKey(attacker);
  const tk = unitKey(defender);
  const mods = [];
  const rise = cell(state, fromKey).elev - cell(state, tk).elev;
  if (rise > 0) mods.push(['High ground', 1]);
  if (has(attacker, 'dive') && rise >= 2) mods.push(['Dive', 2]);
  if (has(attacker, 'flank') && neighborKeys(tk).some(n => {
    const u = unitAt(state, n, attacker.id);
    return u && u.owner === attacker.owner;
  })) mods.push(['Flanking', 2]);
  const moved = ctx.movedDistance ?? (state.turn?.active === attacker.id ? state.turn.movedDistance : 0);
  if (has(attacker, 'charge') && moved >= 3) mods.push(['Charge', 1]);
  if (has(attacker, 'frenzy') && attacker.hp * 2 <= attacker.maxHp) mods.push(['Frenzy', 1]);
  if (alliesNear(state, fromKey, attacker.owner, 2, [attacker.id]).some(u => has(u, 'rally'))) mods.push(['Rallied', 1]);
  if (attacker.status.empowered) mods.push(['War Cry', 2]);
  if (attacker.status.released) mods.push(['Released', 2]);
  if (attacker.status.cowed) mods.push(['Cowed', -1]);
  if (neighborKeys(fromKey).some(n => { const u = unitAt(state, n, attacker.id); return u && u.owner !== attacker.owner && has(u, 'spiritPressure'); })) {
    mods.push(['Spirit pressure', -1]);
  }
  if (ctx.ranged && has(defender, 'deflect')) mods.push(['Deflected', -2]);
  return { dice: Math.max(0, base + mods.reduce((s, m) => s + m[1], 0)), mods };
}

// ctx: { fromKey (attacker's position), ranged }
export function defenseDice(state, attacker, defender, ctx = {}) {
  const fromKey = ctx.fromKey ?? unitKey(attacker);
  const tk = unitKey(defender);
  const c = cell(state, tk);
  const mods = [];
  if (c.terrain === 'water') mods.push(has(defender, 'swimmer') ? ['Swimming', 1] : ['In water', -1]);
  else if (c.terrain === 'ice' && !has(defender, 'iceborn')) mods.push(['On ice', -1]);
  else if (c.terrain === 'forest') mods.push(['Forest cover', 1]);
  if (c.elev > cell(state, fromKey).elev) mods.push(['High ground', 1]);
  const friends = neighborKeys(tk).map(n => unitAt(state, n, defender.id))
    .filter(u => u && u.owner === defender.owner && u.id !== attacker.id);
  if (has(defender, 'shieldWall') && friends.length) mods.push(['Shield wall', 1]);
  if (friends.some(u => has(u, 'blessing'))) mods.push(['Blessed', 1]);
  if (defender.status.braced) mods.push(['Braced', 2]);
  if (defender.status.released) mods.push(['Released', 1]);
  if (ctx.ranged && has(defender, 'arcaneWard')) mods.push(['Arcane ward', 1]);
  if (ctx.ranged && has(defender, 'stealth')) mods.push(['Stealth', 2]);
  if (has(attacker, 'pierce')) mods.push(['Pierced', -1]);
  return { dice: Math.max(0, def(defender).def + mods.reduce((s, m) => s + m[1], 0)), mods };
}

// Exact damage distribution for `a` attack dice vs `d` defense dice. Returns { mean, pKill(hp) }.
const binom = (n, p) => {
  let dist = [1];
  for (let i = 0; i < n; i++) {
    const next = new Array(dist.length + 1).fill(0);
    dist.forEach((v, k) => { next[k] += v * (1 - p); next[k + 1] += v * p; });
    dist = next;
  }
  return dist;
};
export function damageOdds(a, d, reduce = 0) {
  const pHit = (7 - COMBAT.HIT) / 6, pBlock = (7 - COMBAT.BLOCK) / 6;
  const H = binom(a, pHit), B = binom(d, pBlock);
  const dist = new Array(a + 1).fill(0);
  H.forEach((ph, h) => B.forEach((pb, b) => {
    const dmg = Math.max(0, h - b - (h - b > 0 ? reduce : 0));
    dist[dmg] += ph * pb;
  }));
  const mean = dist.reduce((s, p, k) => s + p * k, 0);
  return { mean, pKill: hp => dist.reduce((s, p, k) => s + (k >= hp ? p : 0), 0) };
}
