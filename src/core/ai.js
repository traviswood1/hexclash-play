// Computer opponent. aiAction(state) returns the next action for whoever is up, or null.
// It is greedy: each step it scores every (unit, destination, action) and takes the best.
// Pure like the rest of core/, so tools/sim.mjs can pit it against itself.

import { UNITS } from './units.js';
import { ABILITIES, validTargets } from './abilities.js';
import { CORNERS, oppositeCorner } from './mapgen.js';
import { currentPlayer, liveUnitsOf, playerUnits, canActivate, slotOf, pointsLeft, allowedCorners } from './game.js';
import * as R from './rules.js';
import { distance } from './hex.js';
import { hashSeed } from './rng.js';

export function aiAction(state) {
  const player = currentPlayer(state);
  if (player === null || player === undefined) return null;
  switch (state.phase) {
    case 'corners': return { type: 'pickCorner', player, corner: chooseCorner(state, player) };
    case 'draft': return { type: 'draft', player, pid: chooseDraft(state, player) };
    case 'placement':
      return playerUnits(state, player).some(u => !u.placed)
        ? { type: 'autoPlace', player } : { type: 'confirmPlacement', player };
    case 'battle': return chooseBattleAction(state, player);
    default: return null;
  }
}

function chooseCorner(state, player) {
  const free = allowedCorners(state); // after the first pick, starts are spaced evenly
  const taken = state.players.map(p => p.corner).filter(Boolean);
  // Ground quality: higher zones are better. Prefer corners far from the enemy (opposite first).
  const ground = c => state.map.zones[c].reduce((s, k) => s + state.map.cells[k].elev, 0) / state.map.zones[c].length;
  const apart = c => taken.length ? Math.min(...taken.map(t => {
    const d = Math.abs(CORNERS.indexOf(t) - CORNERS.indexOf(c));
    return Math.min(d, 6 - d);
  })) : 0;
  const score = c => ground(c) + 2 * apart(c) + (taken.some(t => oppositeCorner(t) === c) ? 1 : 0)
    + (hashSeed(`${state.settings.seed}${c}${player}`) % 100) / 1000;
  return free.sort((a, b) => score(b) - score(a))[0];
}

function chooseDraft(state, player) {
  const mine = playerUnits(state, player).map(u => u.key);
  const hasRanged = mine.some(k => UNITS[k].range > 1);
  const score = item => {
    const d = UNITS[item.key];
    let s = d.cost; // strength: costs are tuned from sim win rates, so they rank units better than the old ratings
    if (mine.includes(item.key)) s -= 1.5;
    if (!hasRanged && d.range > 1) s += 1.5;
    if (item.key === 'cleric' && mine.length >= 2 && !mine.includes('cleric')) s += 1;
    if (item.key === 'fire_mage' && state.map.keys.some(k => state.map.cells[k].terrain === 'lava')) s += 0.5;
    if (item.key === 'troll' && state.map.keys.filter(k => state.map.cells[k].terrain === 'water').length > 15) s += 0.7;
    // Points: spread the budget over the army it can still build (about 5.5 points a unit), and
    // don't leave points stranded that can't buy anything (the cheapest unit costs 3).
    const left = pointsLeft(state, player), slots = state.settings.teamSize - mine.length;
    const planned = Math.max(1, Math.min(slots, Math.round(left / 5.5)));
    const after = left - d.cost;
    s -= Math.abs(d.cost - left / planned) * 0.8;
    if (slots > 1 && after > 0 && after < 3) s -= after;
    return s + (hashSeed(`${state.settings.seed}${item.pid}${player}`) % 100) / 200;
  };
  const left = pointsLeft(state, player);
  return state.pool.filter(p => p.takenBy === null && UNITS[p.key].cost <= left).sort((a, b) => score(b) - score(a))[0].pid;
}

// Unit worth, used to weigh damage: strong units and nearly-dead ones are better targets.
const value = u => (UNITS[u.key].rating / 7) * (1 + 0.5 * (1 - u.hp / u.maxHp));

function strikeValue(state, moved, attacker, defender, dice, { ranged = false } = {}) {
  const a = R.attackDice(state, attacker, defender, dice, { movedDistance: moved, ranged });
  const d = R.defenseDice(state, attacker, defender, { ranged });
  const odds = R.damageOdds(a.dice, d.dice, R.has(defender, 'stoneskin') ? 1 : 0);
  return value(defender) * (odds.mean + 3 * odds.pKill(defender.hp));
}

// Pretend the unit stands at k while fn runs, so every rule sees the hypothetical position.
function standingAt(unit, state, k, fn) {
  const { q, r } = unit;
  const c = state.map.cells[k];
  unit.q = c.q; unit.r = c.r;
  try { return fn(); } finally { unit.q = q; unit.r = r; }
}

function bestActionAt(state, unit, k, moved) {
  const ai = {
    value,
    strikeValue: (a, d, dice, opts) => strikeValue(state, moved, a, d, dice, opts),
  };
  let best = { score: 0, action: null };
  const d = UNITS[unit.key];
  for (const e of R.liveUnits(state)) {
    if (!R.canAttack(state, unit, e)) continue;
    const s = ai.strikeValue(unit, e, d.atk, { ranged: d.range > 1 });
    if (s > best.score) best = { score: s, action: { type: 'attack', target: e.id } };
  }
  for (const abKey of d.abilities) {
    const ab = ABILITIES[abKey];
    if (ab.kind !== 'active' || ab.usesMove || !ab.aiScore || unit.cooldowns[abKey]) continue;
    for (const target of validTargets(state, unit, abKey)) {
      const tgt = typeof target === 'number' ? state.units[target] : target;
      // abilities are a little worse than their raw score so the AI keeps them for good moments
      const s = 0.9 * ab.aiScore({ state, unit, target: tgt, fromKey: k, ai });
      if (s > best.score) best = { score: s, action: { type: 'ability', ability: abKey, target } };
    }
  }
  return best;
}

function positionScore(state, unit, k) {
  const d = UNITS[unit.key];
  const enemies = R.liveUnits(state).filter(e => e.owner !== unit.owner);
  if (!enemies.length) return 0;
  const c = state.map.cells[k];
  const near = Math.min(...enemies.map(e => distance(R.unitKey(e), k)));
  let s = 0;
  // the longer the battle drags on, the harder units push in, so standoffs end
  const push = 1 + Math.max(0, state.round - 8) * 0.15;
  if (d.range > 1) s -= 0.25 * push * Math.max(0, near - d.range) + 0.1 * Math.max(0, d.range - near) + (near <= 1 ? 0.8 : 0);
  else s -= 0.3 * push * near;
  s += 0.15 * c.elev;
  if (c.terrain === 'forest') s += 0.2;
  if (c.terrain === 'water') s += R.has(unit, 'swimmer') ? 0.3 : -0.25;
  if (c.terrain === 'ice' && !R.has(unit, 'iceborn')) s -= 0.15;
  // danger: enemies that could reach and hit this hex next turn
  let threat = 0;
  for (const e of enemies) {
    const ed = UNITS[e.key];
    if (distance(R.unitKey(e), k) <= ed.move + ed.range) threat += Math.max(0, ed.atk * 0.5 - d.def / 3);
  }
  // Respect the kill zone: don't end a move where enemies can reach and hit you next turn unless it's
  // worth it (an attack from here adds its own score). Without this, whoever closed in first got hit
  // first, and the player moving second won ~62% of games. Eases off as the battle drags on.
  return s - (0.35 / push) * threat / Math.max(0.5, unit.hp / 4);
}

function chooseBattleAction(state, player) {
  const end = { type: 'endTurn', player };
  let best = null;
  for (const u of liveUnitsOf(state, player)) {
    if (!canActivate(state, u)) continue;
    const slot = slotOf(state, u);
    const start = R.unitKey(u);
    const spots = [{ k: start, hazard: 0, moved: slot.movedDistance }];
    // a unit can move again (each move costs an action), but once it has acted it only moves on
    // when that clearly helps, so spare actions aren't wasted shuffling back and forth
    for (const [k, info] of Object.entries(R.reachable(state, u))) {
      if (info.hazard * 2 >= u.hp) continue; // don't walk into lava to die
      spots.push({ k, hazard: info.hazard, moved: slot.movedDistance + distance(start, k) });
    }
    // Score each plan as a gain over doing nothing with this unit, so units are compared fairly.
    const idle = positionScore(state, u, start);
    for (const spot of spots) {
      const plan = standingAt(u, state, spot.k, () => {
        const act = slot.acted ? { score: 0, action: null } : bestActionAt(state, u, spot.k, spot.moved);
        const moveCost = spot.k !== start ? (slot.moved ? 0.35 : 0.1) : 0; // spending an action to reposition
        return { act, gain: act.score + positionScore(state, u, spot.k) - spot.hazard * 1.2 - idle - moveCost };
      });
      if (!best || plan.gain > best.gain) best = { unit: u, spot, start, ...plan };
    }
  }
  if (!best || best.gain <= 0.05) return end;
  const { unit, spot, start, act } = best;
  if (spot.k !== start) return { type: 'move', player, unitId: unit.id, to: spot.k };
  if (act.action) return { ...act.action, player, unitId: unit.id };
  return end;
}
