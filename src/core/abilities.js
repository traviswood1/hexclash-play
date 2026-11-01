// Unit abilities. Passives are plain descriptions; the rules check them by key (see rules.js).
// Actives take the unit's action for the turn (or its move, with usesMove) and then recharge.
//
// An active ability:
//   cooldown  turns before it can be used again (1 = every turn, 2 = every other turn, ...)
//   target    { type: 'enemy' | 'ally' | 'hex' | 'self', range, sight, radius, includeSelf }
//   usable(state, unit, fromKey)            optional extra condition
//   hexOk(state, unit, k)                   for hex targets: is this hex allowed?
//   resolve({ state, unit, target, api })   does it (api comes from game.js)
//   aiScore({ state, unit, target, fromKey, ai })  how good it looks to the computer (optional)
//   area(state, unit, target)               hexes it hits, when that isn't just target + radius (beams, dashes)
//   signature: true                         a showpiece skill of an expensive unit (drawn by render/skillFx.js)

import { distance, within, parseKey, key as hexKey, DIRS } from './hex.js';
import { liveUnits, unitAt, unitKey, hasSight, cell } from './rules.js';

const enemiesWithin = (state, unit, k, radius) =>
  liveUnits(state).filter(u => u.owner !== unit.owner && distance(unitKey(u), k) <= radius);
const unitsInArea = (state, k, radius, exceptId) =>
  within(k, radius).map(n => unitAt(state, n, exceptId)).filter(Boolean);

// Is k in one of the 6 straight hex lines from `from`, 1..max away?
function inLine(from, k, max) {
  const a = parseKey(from), b = parseKey(k), d = distance(from, k);
  if (!d || d > max) return false;
  return DIRS.some(([dq, dr]) => dq * d === b.q - a.q && dr * d === b.r - a.r);
}
// The hexes (on the board) along the straight line from `from` through `toward`, `len` steps long.
function ray(state, from, toward, len) {
  const a = parseKey(from), b = parseKey(toward), d = distance(from, toward);
  const dq = (b.q - a.q) / d, dr = (b.r - a.r) / d;
  const out = [];
  for (let i = 1; i <= len; i++) {
    const k = hexKey(a.q + dq * i, a.r + dr * i);
    if (!state.map.cells[k]) break;
    out.push(k);
  }
  return out;
}

// Builders for the common kinds of active ability, so new ones are one line each.
// fx tells the renderer how to draw it: 'bolt' (projectile), 'blast' (projectile + burst).

// Ranged strike on one enemy, optionally slowing it.
// sight: false = ignores line of sight (homing magic)
const bolt = ({ name, desc, cooldown, range, dice, slow = false, sight = true }) => ({
  name, kind: 'active', cooldown, desc, fx: 'bolt',
  target: { type: 'enemy', range, sight },
  resolve: ({ unit, target, api }) => {
    api.strike(unit, target, dice, { label: name, ranged: true });
    if (slow && target.alive) api.setStatus(target, 'slowed', 1);
  },
  aiScore: ({ unit, target, fromKey, ai }) => ai.strikeValue(unit, target, dice, { fromKey, ranged: true }) + (slow ? 0.5 : 0),
});

// Area blast at a hex. friendlyFire: allies in the area are hit too.
const blast = ({ name, desc, cooldown, range, radius = 1, dice, friendlyFire }) => ({
  name, kind: 'active', cooldown, desc, fx: 'blast',
  target: { type: 'hex', range, sight: true, radius },
  resolve: ({ state, unit, target, api }) => {
    const victims = friendlyFire ? unitsInArea(state, target, radius, unit.id) : enemiesWithin(state, unit, target, radius);
    for (const v of victims) api.strike(unit, v, dice, { label: name, ranged: true });
  },
  aiScore: ({ state, unit, target, fromKey, ai }) =>
    (friendlyFire ? unitsInArea(state, target, radius, unit.id) : enemiesWithin(state, unit, target, radius))
      .reduce((s, v) => s + (v.owner === unit.owner ? -1.5 : 1) * ai.strikeValue(unit, v, dice, { fromKey, ranged: true }), 0),
});

// Move by jumping straight to a hex (replaces the normal move).
const jump = ({ name, desc, cooldown, range }) => ({
  name, kind: 'active', cooldown, usesMove: true, desc,
  target: { type: 'hex', range },
  hexOk: (state, unit, k) => !unitAt(state, k) && cell(state, k).terrain !== 'lava',
  resolve: ({ unit, target, api }) => api.teleport(unit, target),
});

export const ABILITIES = {
  // ---------- passives ----------
  shieldWall:   { name: 'Shield Wall',  kind: 'passive', desc: '+1 defense die while next to an ally.' },
  sharpshooter: { name: 'Sharpshooter', kind: 'passive', desc: '+1 range when shooting down at a lower target.' },
  fireproof:    { name: 'Fireproof',    kind: 'passive', desc: 'Lava does not hurt this unit.' },
  iceborn:      { name: 'Iceborn',      kind: 'passive', desc: 'Ice and snow cost 1 to enter, and ice gives no defense penalty.' },
  flank:        { name: 'Flanking',     kind: 'passive', desc: '+2 attack dice if the target is next to another of your units.' },
  stoneskin:    { name: 'Stoneskin',    kind: 'passive', desc: 'Takes 1 less damage from every hit that gets through.' },
  charge:       { name: 'Charge',       kind: 'passive', desc: '+1 attack die after moving 3 or more hexes this turn.' },
  frenzy:       { name: 'Frenzy',       kind: 'passive', desc: '+1 attack die while at half health or less.' },
  arcaneWard:   { name: 'Arcane Ward',  kind: 'passive', desc: '+1 defense die against ranged attacks and spells.' },
  rally:        { name: 'Rally',        kind: 'passive', desc: 'Allies within 2 hexes get +1 attack die.' },
  blessing:     { name: 'Blessing',     kind: 'passive', desc: 'Adjacent allies get +1 defense die.' },
  flight:       { name: 'Flight',       kind: 'passive', desc: 'Flies: ignores terrain cost, height and engagement, and can pass over units.' },
  dive:         { name: 'Dive',         kind: 'passive', desc: '+2 attack dice against a target 2 or more levels below.' },
  regenerate:   { name: 'Regenerate',   kind: 'passive', desc: 'Heals 1 at the start of your turn.' },
  swimmer:      { name: 'Swimmer',      kind: 'passive', desc: 'Water costs 1 to enter and gives +1 defense die instead of -1.' },
  pierce:       { name: 'Pierce',       kind: 'passive', desc: 'Targets roll 1 fewer defense die against this unit.' },
  lifesteal:    { name: 'Lifesteal',    kind: 'passive', desc: 'Heals 1 whenever it deals damage.' },
  stealth:      { name: 'Stealth',      kind: 'passive', desc: '+2 defense dice against ranged attacks and spells.' },
  spiritPressure: { name: 'Spirit Pressure', kind: 'passive', desc: 'Adjacent enemies roll 1 fewer attack die.' },
  regenAura:    { name: 'Repair Field', kind: 'passive', desc: 'Allies within 2 heal 1 at the start of your turn.' },
  deflect:      { name: 'Deflect',      kind: 'passive', desc: 'Ranged attacks and spells against this unit roll 2 fewer attack dice.' },
  speedAura:    { name: 'Tempo Beat',   kind: 'passive', desc: 'Allies within 2 get +1 move.' },
  phaseShift:   { name: 'Phase Shift',  kind: 'passive', desc: 'Ignores engagement and can move through enemies (but not stop on them).' },

  // ---------- actives ----------
  brace: {
    name: 'Brace', kind: 'active', cooldown: 2, desc: '+2 defense dice until your next turn.',
    target: { type: 'self' },
    resolve: ({ unit, api }) => api.setStatus(unit, 'braced', 1),
    aiScore: ({ state, unit, fromKey }) => 0.35 * enemiesWithin(state, unit, fromKey, 5).length,
  },
  volley: {
    name: 'Volley', kind: 'active', cooldown: 3, desc: '3 attack dice against every enemy in a 1-hex radius.',
    target: { type: 'hex', range: 4, sight: true, radius: 1 },
    resolve: ({ state, unit, target, api }) => {
      for (const v of enemiesWithin(state, unit, target, 1)) api.strike(unit, v, 3, { label: 'Volley', ranged: true });
    },
    aiScore: ({ state, unit, target, fromKey, ai }) => enemiesWithin(state, unit, target, 1)
      .reduce((s, v) => s + ai.strikeValue(unit, v, 3, { fromKey, ranged: true }), 0),
  },
  fireball: {
    name: 'Fireball', kind: 'active', cooldown: 2,
    desc: '3 attack dice against EVERY unit in a 1-hex radius, allies included.',
    target: { type: 'hex', range: 4, sight: true, radius: 1 },
    resolve: ({ state, unit, target, api }) => {
      for (const v of unitsInArea(state, target, 1, unit.id)) api.strike(unit, v, 3, { label: 'Fireball', ranged: true });
    },
    aiScore: ({ state, unit, target, fromKey, ai }) => unitsInArea(state, target, 1, unit.id)
      .reduce((s, v) => s + (v.owner === unit.owner ? -1.5 : 1) * ai.strikeValue(unit, v, 3, { fromKey, ranged: true }), 0),
  },
  frostBolt: bolt({ name: 'Frost Bolt', cooldown: 2, range: 4, dice: 4, slow: true,
    desc: '4 attack dice. The target is slowed (-2 move) on its next turn.' }),
  flashFreeze: {
    name: 'Flash Freeze', kind: 'active', cooldown: 3,
    desc: 'In a 1-hex radius: water freezes to ice, lava cools to rock, and enemies are slowed.',
    target: { type: 'hex', range: 3, radius: 1 },
    hexOk: (state, unit, k) => within(k, 1).some(n => ['water', 'lava'].includes(cell(state, n)?.terrain))
      || enemiesWithin(state, unit, k, 1).length > 0,
    resolve: ({ state, unit, target, api }) => {
      for (const n of within(target, 1)) {
        const c = cell(state, n);
        if (c?.terrain === 'water') api.setTerrain(n, 'ice');
        else if (c?.terrain === 'lava') api.setTerrain(n, 'rock');
      }
      for (const v of enemiesWithin(state, unit, target, 1)) api.setStatus(v, 'slowed', 1);
    },
    aiScore: ({ state, unit, target }) => 0.6 * enemiesWithin(state, unit, target, 1).length,
  },
  shadowstep: jump({ name: 'Shadowstep', cooldown: 3, range: 4,
    desc: 'Instead of moving, teleport to any empty hex within 4 (not lava). You can still attack.' }),

  // ---------- added with the larger roster ----------
  leap: jump({ name: 'Leap', cooldown: 2, range: 3,
    desc: 'Instead of moving, leap to any empty hex within 3, over units and cliffs. You can still attack.' }),
  sniperShot: bolt({ name: 'Sniper Shot', cooldown: 3, range: 5, dice: 4, desc: '4 attack dice at an enemy up to 5 hexes away.' }),
  rootSnare: bolt({ name: 'Root Snare', cooldown: 2, range: 3, dice: 2, slow: true,
    desc: '2 attack dice. Roots burst from the ground: the target is slowed (-2 move) on its next turn.' }),
  graveCurse: bolt({ name: 'Grave Curse', cooldown: 2, range: 4, dice: 3, slow: true,
    desc: '3 attack dice. The target is slowed (-2 move) on its next turn.' }),
  firebomb: blast({ name: 'Firebomb', cooldown: 2, range: 3, dice: 2, friendlyFire: true,
    desc: '2 attack dice against EVERY unit in a 1-hex radius, allies included.' }),
  breath: blast({ name: 'Acid Breath', cooldown: 3, range: 2, dice: 3, friendlyFire: false,
    desc: '3 attack dice against every enemy in a 1-hex radius up to 2 hexes away.' }),

  // ---------- added with the expanded roster (docs/roster) ----------
  kunaiFan: blast({ name: 'Kunai Fan', cooldown: 2, range: 3, dice: 2, friendlyFire: false,
    desc: '2 attack dice against every enemy in a 1-hex radius up to 3 hexes away.' }),
  spiritRain: blast({ name: 'Spirit Rain', cooldown: 3, range: 4, dice: 3, friendlyFire: false,
    desc: '3 attack dice against every enemy in a 1-hex radius up to 4 hexes away.' }),
  missileBarrage: blast({ name: 'Missile Barrage', cooldown: 3, range: 4, dice: 3, friendlyFire: false,
    desc: '3 attack dice against every enemy in a 1-hex radius up to 4 hexes away.' }),
  meteor: blast({ name: 'Meteor', cooldown: 3, range: 4, dice: 4, friendlyFire: true,
    desc: '4 attack dice against EVERY unit in a 1-hex radius up to 4 hexes away, allies included.' }),
  foxfire: bolt({ name: 'Foxfire', cooldown: 2, range: 4, dice: 3, sight: false,
    desc: '3 attack dice at an enemy within 4. Homing flames ignore line of sight.' }),
  fanTheHammer: {
    name: 'Fan the Hammer', kind: 'active', cooldown: 3, fx: 'bolt',
    desc: '2 attack dice against each of up to 3 different enemies within 3 (nearest first).',
    target: { type: 'self' },
    usable: (state, unit, fromKey) => fanTargets(state, unit, fromKey).length > 0,
    resolve: ({ state, unit, api }) => {
      for (const v of fanTargets(state, unit, unitKey(unit))) api.strike(unit, v, 2, { label: 'Fan the Hammer', ranged: true });
    },
    aiScore: ({ state, unit, fromKey, ai }) => fanTargets(state, unit, fromKey)
      .reduce((s, v) => s + ai.strikeValue(unit, v, 2, { fromKey, ranged: true }), 0),
  },
  quake: {
    name: 'Quake', kind: 'active', cooldown: 2, desc: '3 attack dice against every adjacent enemy.',
    target: { type: 'self' },
    usable: (state, unit, fromKey) => enemiesWithin(state, unit, fromKey, 1).length > 0,
    resolve: ({ state, unit, api }) => {
      for (const v of enemiesWithin(state, unit, unitKey(unit), 1)) api.strike(unit, v, 3, { label: 'Quake' });
    },
    aiScore: ({ state, unit, fromKey, ai }) => enemiesWithin(state, unit, fromKey, 1)
      .reduce((s, v) => s + ai.strikeValue(unit, v, 3, { fromKey }), 0),
  },
  chainLightning: {
    name: 'Chain Lightning', kind: 'active', cooldown: 2,
    desc: '3 attack dice, then the bolt jumps to up to 2 more enemies within 2 hexes (2 dice each).',
    target: { type: 'enemy', range: 4, sight: true },
    resolve: ({ state, unit, target, api }) => {
      const hit = new Set([target.id]);
      api.strike(unit, target, 3, { label: 'Chain Lightning', ranged: true });
      let from = target;
      for (let jump = 0; jump < 2; jump++) {
        const next = chainNext(state, unit, from, hit);
        if (!next) break;
        hit.add(next.id);
        api.emit({ type: 'zap', from: from.id, to: next.id });
        api.strike(unit, next, 2, { label: 'Chain Lightning', ranged: true });
        from = next;
      }
    },
    aiScore: ({ state, unit, target, fromKey, ai }) => {
      let s = ai.strikeValue(unit, target, 3, { fromKey, ranged: true });
      const hit = new Set([target.id]);
      let from = target;
      for (let jump = 0; jump < 2; jump++) {
        const next = chainNext(state, unit, from, hit);
        if (!next) break;
        hit.add(next.id);
        s += ai.strikeValue(unit, next, 2, { fromKey, ranged: true });
        from = next;
      }
      return s;
    },
  },
  warCry: {
    name: 'War Cry', kind: 'active', cooldown: 3, desc: 'Allies within 3 hexes get +2 attack dice on their next attack.',
    target: { type: 'self' },
    usable: (state, unit, fromKey) => alliesWithin(state, unit, fromKey, 3).length > 0,
    resolve: ({ state, unit, api }) => {
      for (const a of alliesWithin(state, unit, unitKey(unit), 3)) api.setStatus(a, 'empowered', 1);
    },
    aiScore: ({ state, unit, fromKey }) => 0.5 * alliesWithin(state, unit, fromKey, 3)
      .filter(a => !a.status.empowered && enemiesWithin(state, a, unitKey(a), 6).length).length,
  },
  heal: {
    name: 'Heal', kind: 'active', cooldown: 2, desc: 'Restore 4 health to an ally within 3 (or yourself).',
    target: { type: 'ally', range: 3, includeSelf: true },
    usableOn: target => target.hp < target.maxHp,
    resolve: ({ unit, target, api }) => api.heal(target, 4, unit),
    aiScore: ({ target, ai }) => Math.min(4, target.maxHp - target.hp) * 0.45 * ai.value(target),
  },

  // ---------- signature skills of the expensive units (anime-style showpieces) ----------
  starBeam: {
    name: 'Star-Eater Beam', kind: 'active', cooldown: 4, signature: true,
    desc: 'Charges a star in its maw, then fires a beam 5 hexes in a straight line: 3 attack dice against every enemy in it.',
    target: { type: 'hex', range: 5 },
    hexOk: (state, unit, k) => inLine(unitKey(unit), k, 5),
    area: (state, unit, target) => ray(state, unitKey(unit), target, 5),
    resolve: ({ state, unit, target, api }) => {
      const hexes = ray(state, unitKey(unit), target, 5);
      for (const v of liveUnits(state).filter(u => u.owner !== unit.owner && hexes.includes(unitKey(u)))) {
        api.strike(unit, v, 3, { label: 'Star-Eater Beam', ranged: true });
      }
    },
    aiScore: ({ state, unit, target, fromKey, ai }) => {
      const hexes = ray(state, fromKey, target, 5);
      return liveUnits(state).filter(u => u.owner !== unit.owner && hexes.includes(unitKey(u)))
        .reduce((s, v) => s + ai.strikeValue(unit, v, 3, { fromKey, ranged: true }), 0) - 0.05 * distance(fromKey, target);
    },
  },
  demonGate: {
    name: 'Demon Gate Strike', kind: 'active', cooldown: 3, signature: true,
    desc: 'Forces open the demon gate: lose 2 health, then strike an adjacent enemy with 8 attack dice.',
    target: { type: 'enemy', range: 1 },
    usable: (state, unit) => unit.hp > 2,
    resolve: ({ unit, target, api }) => {
      api.damage(unit, 2, 'Demon Gate');
      api.strike(unit, target, 8, { label: 'Demon Gate Strike' });
    },
    aiScore: ({ unit, target, fromKey, ai }) => ai.strikeValue(unit, target, 8, { fromKey }) - 0.35 * 2 * ai.value(unit),
  },
  gateRelease: {
    name: 'Gate Release', kind: 'active', cooldown: 5, signature: true,
    desc: "Releases the sealed blade's true form: +2 attack dice and +1 defense die until the end of your next two turns.",
    target: { type: 'self' },
    usable: (state, unit) => !unit.status.released,
    resolve: ({ unit, api }) => api.setStatus(unit, 'released', 3),
    aiScore: ({ state, unit, fromKey }) => (enemiesWithin(state, unit, fromKey, 6).length ? 1.6 : 0.1),
  },
  thunderDrum: {
    name: "Thunder God's Drumroll", kind: 'active', cooldown: 3, signature: true,
    desc: 'Drums up a storm over a hex within 4: lightning strikes every enemy in a 1-hex radius for 3 attack dice and slows them.',
    target: { type: 'hex', range: 4, sight: true, radius: 1 },
    resolve: ({ state, unit, target, api }) => {
      for (const v of enemiesWithin(state, unit, target, 1)) {
        api.strike(unit, v, 3, { label: "Thunder God's Drumroll", ranged: true });
        if (v.alive) api.setStatus(v, 'slowed', 1);
      }
    },
    aiScore: ({ state, unit, target, fromKey, ai }) => enemiesWithin(state, unit, target, 1)
      .reduce((s, v) => s + ai.strikeValue(unit, v, 3, { fromKey, ranged: true }) + 0.4, 0),
  },
  venomTorrent: {
    name: 'Venom Torrent', kind: 'active', cooldown: 3, signature: true,
    desc: 'All heads spew venom at an enemy within 2: 3 attack dice, and it is poisoned (1 damage at the start of each of its next 2 turns).',
    target: { type: 'enemy', range: 2, sight: true },
    resolve: ({ unit, target, api }) => {
      api.strike(unit, target, 3, { label: 'Venom Torrent', ranged: true });
      if (target.alive) api.setStatus(target, 'poison', 2);
    },
    aiScore: ({ unit, target, fromKey, ai }) => ai.strikeValue(unit, target, 3, { fromKey, ranged: true }) + (target.status.poison ? 0 : 0.6 * ai.value(target)),
  },
  titanFist: {
    name: 'Titan Fist', kind: 'active', cooldown: 3, signature: true,
    desc: 'A giant stone fist bursts out of the ground under an enemy within 3 (no line of sight needed): 3 attack dice, and it is slowed.',
    target: { type: 'enemy', range: 3, sight: false },
    resolve: ({ unit, target, api }) => {
      api.strike(unit, target, 3, { label: 'Titan Fist', ranged: true });
      if (target.alive) api.setStatus(target, 'slowed', 1);
    },
    aiScore: ({ unit, target, fromKey, ai }) => ai.strikeValue(unit, target, 3, { fromKey, ranged: true }) + 0.3,
  },
  carapaceRush: {
    name: 'Carapace Rush', kind: 'active', cooldown: 3, signature: true,
    desc: 'Barrels up to 4 hexes in a straight line to an empty hex, striking every enemy it charges through with 3 attack dice.',
    target: { type: 'hex', range: 4 },
    hexOk: (state, unit, k) => inLine(unitKey(unit), k, 4) && !unitAt(state, k) && cell(state, k).terrain !== 'lava',
    area: (state, unit, target) => ray(state, unitKey(unit), target, distance(unitKey(unit), target)),
    resolve: ({ state, unit, target, api }) => {
      const path = ray(state, unitKey(unit), target, distance(unitKey(unit), target));
      const victims = path.map(k => unitAt(state, k, unit.id)).filter(u => u && u.owner !== unit.owner);
      api.teleport(unit, target, 'dash');
      for (const v of victims) api.strike(unit, v, 3, { label: 'Carapace Rush' });
    },
    aiScore: ({ state, unit, target, fromKey, ai }) => {
      const path = ray(state, fromKey, target, distance(fromKey, target));
      const victims = path.map(k => unitAt(state, k, unit.id)).filter(u => u && u.owner !== unit.owner);
      return victims.reduce((s, v) => s + ai.strikeValue(unit, v, 3, { fromKey }), 0);
    },
  },
  voidFlash: {
    name: 'Void Flash Step', kind: 'active', cooldown: 3, signature: true,
    desc: 'Vanishes and reappears behind an enemy within 4, striking with 5 attack dice. Ignores line of sight and engagement.',
    target: { type: 'enemy', range: 4, sight: false },
    usableOn: (target, state) => !!behind(state, target),
    resolve: ({ state, unit, target, api }) => {
      api.teleport(unit, behind(state, target, unitKey(unit)), 'flash');
      api.strike(unit, target, 5, { label: 'Void Flash Step' });
    },
    aiScore: ({ unit, target, fromKey, ai }) => ai.strikeValue(unit, target, 5, { fromKey }),
  },
  dawnSpear: {
    name: 'Dawn Spear', kind: 'active', cooldown: 2, signature: true,
    desc: 'Hurls a spear of pure light at an enemy within 4: 4 attack dice.',
    target: { type: 'enemy', range: 4, sight: true },
    resolve: ({ unit, target, api }) => api.strike(unit, target, 4, { label: 'Dawn Spear', ranged: true }),
    aiScore: ({ unit, target, fromKey, ai }) => ai.strikeValue(unit, target, 4, { fromKey, ranged: true }),
  },
  conquerorsWill: {
    name: "Conqueror's Will", kind: 'active', cooldown: 4, signature: true,
    desc: 'Unleashes overwhelming will: enemies within 2 are cowed (1 fewer attack die) and slowed on their next turn.',
    target: { type: 'self' },
    usable: (state, unit, fromKey) => enemiesWithin(state, unit, fromKey, 2).length > 0,
    resolve: ({ state, unit, api }) => {
      for (const v of enemiesWithin(state, unit, unitKey(unit), 2)) {
        api.setStatus(v, 'cowed', 1);
        api.setStatus(v, 'slowed', 1);
      }
    },
    aiScore: ({ state, unit, fromKey, ai }) => enemiesWithin(state, unit, fromKey, 2).reduce((s, v) => s + 0.6 * ai.value(v), 0),
  },
  raiseDead: {
    name: 'Raise Dead', kind: 'active', cooldown: 4,
    desc: 'Raises a random minion (Risen Skeleton, Grave Ghoul or Bone Archer) on an empty hex within 2. It acts from your next turn. Up to 2 minions at a time; they crumble if the Necromancer dies.',
    target: { type: 'hex', range: 2 },
    usable: (state, unit) => minionsOf(state, unit).length < 2,
    hexOk: (state, unit, k) => !unitAt(state, k) && cell(state, k).terrain !== 'lava',
    resolve: ({ unit, target, api }) => api.summon(unit, target),
    // a fresh body is worth about one cheap unit; raise it toward the enemy
    aiScore: ({ state, unit, target }) => {
      const foes = liveUnits(state).filter(u => u.owner !== unit.owner);
      const near = foes.length ? Math.min(...foes.map(f => distance(unitKey(f), target))) : 9;
      return 1.3 - 0.06 * near;
    },
  },
  sacredBarrier: {
    name: 'Sacred Barrier', kind: 'active', cooldown: 4, signature: true,
    desc: 'Wraps an ally within 3 (or yourself) in a golden barrier that soaks the next 3 damage, for up to 2 turns.',
    target: { type: 'ally', range: 3, includeSelf: true },
    usableOn: target => !target.status.shield,
    resolve: ({ target, api }) => api.setStatus(target, 'shield', 3, { shieldTurns: 2 }),
    aiScore: ({ state, unit, target, ai }) => (enemiesWithin(state, unit, unitKey(target), 5).length ? 1.1 * ai.value(target) : 0.1),
  },
};

// The empty hex next to `target` farthest from `fromKey` ("behind" it), or null if it's surrounded.
function behind(state, target, fromKey = null) {
  const tk = unitKey(target);
  const free = within(tk, 1).filter(k => k !== tk && state.map.cells[k] && !unitAt(state, k) && cell(state, k).terrain !== 'lava');
  if (!free.length) return null;
  return fromKey ? free.sort((a, b) => distance(b, fromKey) - distance(a, fromKey) || (a < b ? -1 : 1))[0] : free[0];
}

// up to 3 enemies within 3 that the unit can see, nearest first
function fanTargets(state, unit, k) {
  return liveUnits(state)
    .filter(u => u.owner !== unit.owner && distance(unitKey(u), k) <= 3 && hasSight(state, k, unitKey(u)))
    .sort((a, b) => distance(unitKey(a), k) - distance(unitKey(b), k) || a.id - b.id)
    .slice(0, 3);
}

// Living minions this unit has raised.
export function minionsOf(state, unit) {
  return liveUnits(state).filter(u => u.summoner === unit.id);
}

function alliesWithin(state, unit, k, radius) {
  return liveUnits(state).filter(u => u.owner === unit.owner && u.id !== unit.id && distance(unitKey(u), k) <= radius);
}

function chainNext(state, unit, from, hit) {
  const fk = unitKey(from);
  return liveUnits(state)
    .filter(u => u.owner !== unit.owner && !hit.has(u.id) && distance(unitKey(u), fk) <= 2)
    .sort((a, b) => distance(unitKey(a), fk) - distance(unitKey(b), fk) || a.id - b.id)[0] ?? null;
}

// All legal targets for an active ability: unit ids (enemy/ally/self) or hex keys (hex).
export function validTargets(state, unit, abilityKey, fromKey = unitKey(unit)) {
  const ab = ABILITIES[abilityKey];
  if (!ab || ab.kind !== 'active') return [];
  if (ab.usable && !ab.usable(state, unit, fromKey)) return [];
  const t = ab.target;
  if (t.type === 'self') return [unit.id];
  if (t.type === 'hex') {
    return state.map.keys.filter(k => distance(fromKey, k) <= t.range
      && (!t.sight || hasSight(state, fromKey, k))
      && (!ab.hexOk || ab.hexOk(state, unit, k)));
  }
  return liveUnits(state).filter(u => {
    const enemy = u.owner !== unit.owner;
    if (t.type === 'enemy' ? !enemy : enemy) return false;
    if (u.id === unit.id && !t.includeSelf) return false;
    const uk = unitKey(u);
    if (distance(fromKey, uk) > t.range) return false;
    if (t.sight && !hasSight(state, fromKey, uk)) return false;
    return !ab.usableOn || ab.usableOn(u, state);
  }).map(u => u.id);
}

// Hexes an ability would affect if aimed at `target` (for the UI's area preview).
export function abilityArea(state, abilityKey, target, unit = null) {
  const ab = ABILITIES[abilityKey];
  if (ab.area && unit) return ab.area(state, unit, target);
  const k = typeof target === 'string' ? target : unitKey(state.units[target]);
  return ab.target.radius ? within(k, ab.target.radius).filter(n => state.map.cells[n]) : [k];
}
