// Controller: turns clicks into game actions, plays the resulting events as animations, runs the CPU.
import * as THREE from 'three';
import { createView } from './render/view.js';
import { BoardView } from './render/board.js';
import { UnitsView } from './render/unitsView.js';
import { DraftGallery } from './render/gallery.js';
import { createEnvironment, loadTable, THEMES } from './render/environment.js';
import { initFx, updateFx, floatText, burst, rise, zap, wait, tween } from './render/fx.js';
import { loadManifest, preloadUnits } from './render/loader.js';
import { createGame, dispatch, currentPlayer, unitOptions, canActivate, playerUnits, allowedCorners } from './core/game.js';
import { aiAction } from './core/ai.js';
import { ABILITIES, abilityArea } from './core/abilities.js';
import { UNITS, DRAFTABLE } from './core/units.js';
import { CORNERS, CORNER_NAMES, SYMMETRY, MAP_SIZES, BIOMES } from './core/mapgen.js';
import { unitAt, unitKey, reachable, COMBAT, attackDice, defenseDice, damageOdds, has } from './core/rules.js';
import { randomSeed, hashSeed } from './core/rng.js';
import { RelayLink, normalizeCode } from './net/relay.js';
import { UI, HIGHLIGHT } from './ui/ui.js';
import { DiceTray, DICE_MODES } from './ui/dice.js';
import { DraftScreen } from './ui/draftScreen.js';
import { renderPortraits } from './render/portraits.js';
import * as SFX from './render/skillFx.js';
import { attackStyle, fireRanged, meleeHit } from './render/attackFx.js';

const SETTINGS_KEY = 'hexclash.settings';
const DEFAULTS = { seed: randomSeed(), size: 'medium', biome: 'mixed', symmetry: 'fair', teamSize: 6, points: 25, opponent: 'cpu', dice: 'full', backdrop: 'night', draftTimer: 30, hpStyle: 'pips', graphics: 'auto' };
// Graphics 'auto' picks low on phones and tablets (touch-first or small screens).
const resolveGraphics = g => g !== 'auto' ? g
  : matchMedia('(pointer: coarse)').matches || Math.min(screen.width, screen.height) < 700 ? 'low' : 'high';
export const POINT_OPTIONS = [15, 20, 25, 30, 35, 40];
export const TIMER_OPTIONS = [0, 20, 30, 45, 60]; // seconds per draft pick, 0 = no clock
const COLORS = { ...HIGHLIGHT, enemyReach: '#ff9f6b', zone: '#ffffff' };

const settings = loadSettings();
const view = createView(document.getElementById('stage'));
view.setQuality(resolveGraphics(settings.graphics));
initFx(view.scene, view.camera, view.renderer, document.getElementById('floaters'));
const board = new BoardView(view.scene);
board.setDetail(resolveGraphics(settings.graphics));
let manifest = { units: {} };
const tableReady = loadTable(); // the stump table the board stands on
try {
  manifest = await loadManifest();
  const loading = document.getElementById('loading');
  loading.innerHTML = '<div>Raising the battlefield…</div><div class="lbar"><i></i></div><small></small>';
  await preloadUnits(manifest, (done, total) => {
    loading.querySelector('i').style.width = `${(done / total) * 100}%`;
    loading.querySelector('small').textContent = `Loading miniatures ${done}/${total}`;
  });
} catch (e) {
  console.warn('[assets]', e.message, '- using placeholder figures');
}
await tableReady;
const env = createEnvironment(view.scene, { sun: view.sun, hemi: view.hemi, renderer: view.renderer });
env.setTheme(settings.backdrop);
const units = new UnitsView(view.scene, board, manifest);
units.barStyle = settings.hpStyle;
const gallery = new DraftGallery(view.scene, manifest, { camera: view.camera, canvas: view.renderer.domElement, layer: document.getElementById('plates') });

let game = null;
let busy = false;
let aiTimer = null;
const ctx = { screen: 'setup', selectedId: null, inspectId: null, abilityKey: null, placingId: null, hoverKey: null, hoverUnit: null, peek: null };

const ui = new UI({
  setting(name, value) {
    if (name === 'joinCode') { online.joinCode = value; return; }
    settings[name] = ['teamSize', 'points', 'draftTimer'].includes(name) ? +value : value;
    saveSettings();
    if (name === 'backdrop') return env.setTheme(value); // scenery only: keep the map as is
    if (name === 'dice') return; // read when next needed
    if (name === 'draftTimer') return sendConfig();
    if (name === 'hpStyle') return units.setBarStyle(value);
    if (name === 'graphics') { const q = resolveGraphics(value); view.setQuality(q); board.setDetail(q); return; }
    if (name === 'opponent' && value !== 'online') leaveOnline();
    preview();
  },
  randomSeed() { settings.seed = randomSeed(); saveSettings(); preview(); },
  start() {
    if (settings.opponent === 'online') {
      if (online.role !== 'host' || !net.connected) return;
      net.send({ t: 'start' });
    }
    start();
  },
  newGame() { if (onlineGame()) net.send({ t: 'newGame' }); backToSetup(); },
  hostOnline,
  joinOnline,
  leaveOnline: () => { leaveOnline(); refresh(); },
  camera: () => view.resetCamera(),
  settings: () => ui.showSettings(settings),
  closeModal: () => ui.closeModal(),
  pickCorner: corner => act({ type: 'pickCorner', player: currentPlayer(game), corner }),
  draft: pid => draft.stage === 'picking' && act({ type: 'draft', player: currentPlayer(game), pid: +pid }),
  placeSelect(id) { ctx.placingId = +id; refresh(); },
  autoPlace: () => act({ type: 'autoPlace', player: currentPlayer(game) }),
  confirmPlacement: () => act({ type: 'confirmPlacement', player: currentPlayer(game) }),
  selectUnit(id) {
    const u = game.units[+id];
    if (isHuman() && game.phase === 'battle' && canActivate(game, u)) select(u.id); else inspect(u.id);
    focus(u.id);
  },
  ability: useAbility,
  cancel,
  endTurn: () => act({ type: 'endTurn', player: currentPlayer(game) }),
  peek(what) { if (ctx.peek !== what) { ctx.peek = what; renderCard(); } },
});

// Dice tray (Full / Quick / Off is picked in Settings)
const diceTray = new DiceTray(document.getElementById('dice'));

// ---------- game flow ----------

// The match settings. Online, the host's settings are used on both sides (sent with every change).
function matchConfig() {
  if (online.role === 'guest' && online.config) return online.config;
  const { seed, size, biome, symmetry, teamSize, points, draftTimer } = settings;
  return { seed, size, biome, symmetry, teamSize, points, draftTimer };
}

function preview() {
  const c = matchConfig();
  game = createGame({
    seed: c.seed, size: c.size, biome: c.biome, symmetry: c.symmetry,
    teamSize: c.teamSize, points: c.points, ai: [false, settings.opponent === 'cpu'],
  });
  sendConfig();
  Object.assign(ctx, { selectedId: null, inspectId: null, abilityKey: null, placingId: null, peek: null, focusedFor: null });
  endDraft();
  board.build(game.map);
  env.fit(board.size.width / 2);
  gallery.build(game.pool, board.size);
  gallery.sync(game);
  units.clear();
  showGallery(true, 'board'); // the pool's table stands beside the map, but the map is the focus
  ui.clearLog();
  refresh();
}

// The draft gallery stands beside the board during the corner pick and the draft.
// The camera frames whatever is on show.
// focus: 'board' frames the map, 'both' frames board + gallery, 'gallery' zooms in on the gallery.
// Either way the camera can pan over both.
function showGallery(on, focus = 'both') {
  gallery.show(on);
  ui.hideTip();
  const { width, depth } = board.size;
  if (!on) { view.frame(width, depth); return; }
  const a = gallery.area;
  const both = { minX: Math.min(a.minX, -width / 2), maxX: width / 2, minZ: Math.min(a.minZ, -depth / 2), maxZ: Math.max(a.maxZ, depth / 2) };
  if (focus === 'board') { view.frame(width, depth, 0, 0, both); return; }
  const f = focus === 'gallery' ? a : both;
  view.frame(f.maxX - f.minX, f.maxZ - f.minZ, (f.minX + f.maxX) / 2, (f.minZ + f.maxZ) / 2, both);
}

function start() {
  ctx.screen = 'game';
  showGallery(true, 'board');
  ui.addLog('Pick your starting corners.');
  ui.banner('Choose a corner', '#e8bd57');
  refresh();
  maybeAI();
}

// Is it this screen's turn to act? (Not the CPU's, and online not the friend's.)
const isHuman = () => {
  if (ctx.screen !== 'game' || !game) return false;
  const p = currentPlayer(game);
  if (p === null || p === undefined) return false;
  return onlineGame() ? p === online.me : !game.players[p].ai;
};

// Online, both screens run the same game: every action is applied on both sides in the same order.
// The rules are deterministic (dice come from the seeded game state), so the games stay identical; a
// hash of the state travels with each action to catch it if they ever don't.
async function act(action, { remote = null } = {}) {
  if (busy || !game) return false;
  if (onlineGame() && !remote && action.player !== online.me) return false; // the friend's turn
  const res = dispatch(game, action);
  if (!res.ok) {
    if (remote) { desync(`their move was refused here (${res.error})`); return false; }
    ui.toast(res.error);
    return false;
  }
  if (onlineGame()) {
    if (remote) { if (remote.hash !== stateHash()) desync('the game states differ'); }
    else net.send({ t: 'action', action, hash: stateHash() });
  }
  busy = true;
  try { await play(res.events); } finally { busy = false; }
  afterAction();
  pumpRemote();
  return true;
}

function afterAction() {
  const sel = ctx.selectedId && game.units[ctx.selectedId];
  if (sel) {
    const o = game.phase === 'battle' && canActivate(game, sel) ? unitOptions(game, sel) : null;
    if (!o || !isHuman() || (!o.canMove && !o.canAct)) ctx.selectedId = null;
  }
  if (ctx.inspectId && !game.units[ctx.inspectId]?.alive) ctx.inspectId = null;
  ctx.abilityKey = null;
  if (game.phase === 'placement') {
    const p = currentPlayer(game);
    const placing = game.units[ctx.placingId];
    if (!placing || placing.owner !== p || placing.placed) ctx.placingId = playerUnits(game, p).find(u => !u.placed)?.id ?? null;
    if (isHuman() && ctx.focusedFor !== p) { ctx.focusedFor = p; focusZone(game.players[p].corner); }
  }
  refresh();
  maybeAI();
}

function maybeAI() {
  clearTimeout(aiTimer);
  if (ctx.screen !== 'game' || !game || game.phase === 'over' || isHuman() || onlineGame()) return;
  if (game.phase === 'draft' && draft.stage !== 'picking') return; // not during the map preview
  aiTimer = setTimeout(async () => {
    const action = aiAction(game);
    if (!action) return;
    const ok = await act(action);
    if (!ok && game.phase === 'battle') await act({ type: 'endTurn', player: action.player });
  }, { battle: 420, draft: 1600 }[game.phase] ?? 280); // draft: a moment to "think", like a player would
}

// ---------- event playback ----------

const pname = p => `<b style="color:${game.players[p].color}">${game.players[p].name}</b>`;

async function play(events) {
  let terrainChanged = false;
  let strikes = 0; // after the first roll in a batch (area spells), the rest roll quickly
  for (const e of events) {
    switch (e.type) {
      case 'corner':
        ui.addLog(`${pname(e.player)} takes the ${CORNER_NAMES[e.corner].toLowerCase()} corner.`);
        break;
      case 'draft':
        ui.addLog(`${pname(e.player)} drafts ${UNITS[e.key].name}.`);
        gallery.sync(game);
        if (gallery.hovered === e.pid) galleryHover(null);
        renderDraft();
        break;
      case 'placed':
        units.sync(game);
        break;
      case 'phase':
        if (e.phase === 'battle') ui.clearLog();
        if (e.phase === 'draft') startDraft();
        if (e.phase === 'placement') { endDraft(); showGallery(false); }
        ui.banner({ draft: 'Unit draft', placement: 'Deploy', battle: 'Battle!' }[e.phase], '#e8bd57');
        await wait(0.5);
        break;
      case 'turn':
        ui.addLog(`— ${pname(e.player)}'s turn (round ${e.round}) —`);
        ui.banner(`${game.players[e.player].name}'s turn`, game.players[e.player].color);
        break;
      case 'move':
        units.setSelected(e.unit);
        await units.move(e.unit, e.path, e.fly);
        break;
      case 'teleport':
        await units.teleport(e.unit, e.to, e.style);
        break;
      case 'attack': {
        units.setSelected(e.unit);
        const key = game.units[e.unit].key, color = new THREE.Color(UNITS[key].color).getHex(), style = attackStyle(key);
        const to = units.center(e.target);
        await units.strikeAt(e.unit, to, { ranged: e.ranged, color, fire: (from, at) => fireRanged(style, from, at, color) });
        if (!e.ranged) await meleeHit(style, units.views.get(e.unit).root.position, to, color);
        break;
      }
      case 'ability':
        units.setSelected(e.unit);
        await abilityFx(e);
        break;
      case 'strike':
        if (e.label === 'Void Flash Step') await SFX.voidSlash(units.center(e.target));
        if (e.label === 'Carapace Rush') burst(units.views.get(e.target).root.position, 0xd8c8a0, 1.2);
        ui.addLog(ui.strikeLog(game, e));
        if (settings.dice !== 'off') {
          await diceTray.roll(e, {
            names: { attacker: ui.unitName(game, e.attacker), defender: ui.unitName(game, e.target) },
            rules: { hit: COMBAT.HIT, block: COMBAT.BLOCK },
            quick: settings.dice === 'quick' || strikes > 0,
          });
        }
        strikes++;
        if (!e.damage) floatText(units.center(e.target), e.hits ? 'Blocked' : 'Miss', '#c7cbe0', true);
        break;
      case 'damage': {
        const pos = units.center(e.unit);
        if (pos) floatText(pos, `-${e.amount}`, '#ff5b5b');
        if (e.source === 'Lava') ui.addLog(`${ui.unitName(game, e.unit)} is burned by lava: <b style="color:var(--bad)">${e.amount} damage</b>`);
        units.hit(e.unit);
        units.setHp(e.unit, e.hp, game.units[e.unit].maxHp);
        await wait(0.3);
        break;
      }
      case 'heal': {
        const pos = units.center(e.unit);
        if (pos) { floatText(pos, `+${e.amount}`, '#7dffb0'); rise(units.views.get(e.unit).root.position, 0x7dffb0); }
        ui.addLog(`${ui.unitName(game, e.unit)} heals ${e.amount}.`);
        units.setHp(e.unit, e.hp, game.units[e.unit].maxHp);
        break;
      }
      case 'status': {
        const pos = units.center(e.unit);
        if (pos) floatText(pos, { slowed: 'Slowed', braced: 'Braced', empowered: 'War Cry!', shield: 'Barrier!', released: 'RELEASED!',
          releaseEnds: 'Release fades', poison: 'Poisoned', cowed: 'Cowed' }[e.status] ?? e.status, '#aee6ff', true);
        const sv = units.views.get(e.unit);
        if (sv) units.syncAuras(sv, game.units[e.unit]); // show or drop status auras
        break;
      }
      case 'absorb': {
        const pos = units.center(e.unit);
        if (pos) { floatText(pos, `Barrier -${e.amount}`, '#ffd76a', true); burst(units.views.get(e.unit).root.position, 0xffd76a, 0.9); }
        ui.addLog(`${ui.unitName(game, e.unit)}'s barrier absorbs ${e.amount}${e.left ? ` (${e.left} left)` : ' and breaks'}.`);
        break;
      }
      case 'summon': {
        ui.addLog(`${ui.unitName(game, e.by)} raises a ${UNITS[e.key].name}!`);
        units.sync(game);
        const pos = board.worldPos(e.hex);
        SFX.raiseDead(pos);
        await units.rise(e.unit);
        floatText(pos.clone().add(new THREE.Vector3(0, 1.2, 0)), UNITS[e.key].name, '#9fffb0', true);
        break;
      }
      case 'death':
        ui.addLog(e.crumble ? `${ui.unitName(game, e.unit)} crumbles to dust.` : `${ui.unitName(game, e.unit)} is destroyed!`);
        await units.die(e.unit);
        break;
      case 'terrain':
        terrainChanged = true;
        break;
      case 'zap':
        await zap(units.center(e.from), units.center(e.to));
        break;
      case 'gameOver':
        await wait(0.4);
        if (e.winner === null) ui.banner('Draw!');
        else ui.banner(`${game.players[e.winner].name} wins!`, game.players[e.winner].color);
        ui.addLog(e.winner === null ? 'The battle ends in a draw.' : `${pname(e.winner)} wins the battle!`);
        break;
    }
  }
  if (terrainChanged) board.build(game.map);
  units.sync(game);
}

async function abilityFx(e) {
  const caster = game.units[e.unit];
  const ab = ABILITIES[e.ability];
  ui.addLog(`${ui.unitName(game, e.unit)} uses <b>${ab.name}</b>.`);
  const self = units.views.get(e.unit).root.position.clone();
  const target = typeof e.target === 'number' ? units.center(e.target) : board.worldPos(e.target).add(new THREE.Vector3(0, 0.4, 0));
  const shoot = (color, style) => units.strikeAt(e.unit, target, { ranged: true, color, projectileStyle: style });
  switch (e.ability) {
    case 'fireball': await shoot(0xff6a2a, { size: 0.9, arc: 1 }); await burst(target, 0xff6a2a, 2.2); break;
    case 'volley': await shoot(0xe6f5b0, { size: 0.35, arc: 2.5 }); burst(target, 0xe6f5b0, 2); break;
    case 'frostBolt': await shoot(0x9fe6ff, { size: 0.6, arc: 0.2 }); burst(target, 0x9fe6ff, 0.8); break;
    case 'flashFreeze': await units.strikeAt(e.unit, target, {}); await burst(target, 0xbfefff, 2.4); break;
    case 'chainLightning': await units.strikeAt(e.unit, target, {}); await zap(units.center(e.unit), target); break;
    case 'quake': await units.strikeAt(e.unit, null, {}); await burst(self, 0xc9a26b, 2.4); break;
    case 'warCry': burst(self, 0xe8bd57, 3.5); await rise(self, 0xe8bd57); break;
    case 'brace': await rise(self, 0x9fc4ff); break;
    case 'heal': if (caster.id !== e.target) await units.strikeAt(e.unit, target, {}); break;
    // ---- signature skills (render/skillFx.js) ----
    case 'starBeam': {
      const view = units.views.get(e.unit);
      await units.face(view, target);
      const from = units.center(e.unit);
      const hexes = abilityArea(game, 'starBeam', e.target, caster);
      const end = board.worldPos(hexes[hexes.length - 1] ?? e.target).add(new THREE.Vector3(0, 0.5, 0));
      await SFX.starBeam(from, end);
      break;
    }
    case 'demonGate': await SFX.demonGate(self, target); await units.strikeAt(e.unit, target, {}); break;
    case 'gateRelease': await SFX.gateRelease(self); break;
    case 'thunderDrum': {
      await units.strikeAt(e.unit, null, {}); // the drum strike
      const spots = abilityArea(game, 'thunderDrum', e.target).map(k => board.worldPos(k));
      await SFX.thunderDrum(target, spots);
      break;
    }
    case 'venomTorrent': await units.face(units.views.get(e.unit), target); await SFX.venomTorrent(units.center(e.unit), target); break;
    case 'titanFist': await units.strikeAt(e.unit, null, {}); await SFX.titanFist(target); break;
    case 'raiseDead': await units.strikeAt(e.unit, target, {}); break; // a beckoning gesture; the summon event raises it
    case 'carapaceRush': break; // the dash itself is the effect (teleport style 'dash')
    case 'voidFlash': break;    // flash step (teleport style 'flash'), the slash plays on the strike below
    case 'dawnSpear': await units.strikeAt(e.unit, target, { ranged: false }); await SFX.dawnSpear(units.center(e.unit), target); break;
    case 'conquerorsWill': await SFX.conquerorsWill(self, 2); break;
    case 'sacredBarrier': if (caster.id !== e.target) await units.strikeAt(e.unit, target, {}); await SFX.sacredBarrier(target); break;
    default: { // builder-made abilities: bolt = projectile, blast = projectile + burst
      const fx = ab.fx;
      const color = new THREE.Color(UNITS[caster.key].color).getHex();
      if (fx === 'bolt') { await shoot(color, { size: 0.55, arc: 0.4 }); burst(target, color, 0.8); }
      else if (fx === 'blast') { await shoot(color, { size: 0.8, arc: 1.2 }); await burst(target, color, 2.2); }
      break;
    }
  }
}

// ---------- selection & abilities ----------

function select(id) {
  Object.assign(ctx, { selectedId: id, inspectId: null, abilityKey: null });
  refresh();
}
function inspect(id) {
  Object.assign(ctx, { inspectId: id, selectedId: null, abilityKey: null });
  refresh();
}
function cancel() {
  if (ctx.abilityKey) ctx.abilityKey = null;
  else Object.assign(ctx, { selectedId: null, inspectId: null });
  refresh();
}

function useAbility(k) {
  const u = game.units[ctx.selectedId];
  if (!u || !isHuman()) return;
  const o = unitOptions(game, u).abilities.find(a => a.key === k);
  if (!o?.ready) return;
  if (o.target.type === 'self') act({ type: 'ability', player: u.owner, unitId: u.id, ability: k, target: u.id });
  else { ctx.abilityKey = k; refresh(); }
}

function focus(id) {
  const v = units.views.get(id);
  if (v) panTo(v.root.position.clone());
}

function focusZone(corner) {
  const keys = game.map.zones[corner];
  const c = keys.reduce((s, k) => s.add(board.worldPos(k)), new THREE.Vector3()).divideScalar(keys.length);
  panTo(c.multiplyScalar(0.5)); // halfway: the zone comes out from under the panels, the board stays in view
}

function panTo(to) {
  const from = view.controls.target.clone();
  const camFrom = view.camera.position.clone(), offset = to.clone().sub(from);
  tween(0.35, t => {
    view.controls.target.lerpVectors(from, to, t);
    view.camera.position.copy(camFrom).addScaledVector(offset, t);
  });
}

// ---------- board clicks ----------

function handleClick(k, unitId) {
  if (!game || busy || ctx.screen !== 'game') return;
  if (!isHuman()) { if (unitId) inspect(unitId); return; }
  const p = currentPlayer(game);
  const u = unitId ? game.units[unitId] : null;

  if (game.phase === 'corners') {
    const corner = CORNERS.find(c => game.map.zones[c].includes(k));
    if (corner) act({ type: 'pickCorner', player: p, corner });
    return;
  }
  if (game.phase === 'placement') {
    if (u && u.owner === p) { ctx.placingId = u.id; refresh(); return; }
    if (!game.map.zones[game.players[p].corner].includes(k)) { ui.toast('Place units inside your glowing zone.'); return; }
    const id = ctx.placingId ?? playerUnits(game, p).find(x => !x.placed)?.id;
    if (id) act({ type: 'place', player: p, unitId: id, hex: k });
    return;
  }
  if (game.phase !== 'battle') { if (u) inspect(u.id); return; }

  const sel = ctx.selectedId && game.units[ctx.selectedId];
  if (ctx.abilityKey && sel) {
    const ab = ABILITIES[ctx.abilityKey];
    const target = ab.target.type === 'hex' ? k : unitId;
    const o = unitOptions(game, sel).abilities.find(a => a.key === ctx.abilityKey);
    if (target !== null && o.targets.includes(target)) {
      act({ type: 'ability', player: p, unitId: sel.id, ability: ctx.abilityKey, target });
    } else cancel();
    return;
  }
  if (u && u.owner === p) {
    if (canActivate(game, u)) select(u.id);
    else { inspect(u.id); ui.toast('That unit already finished this turn.'); }
    return;
  }
  const opts = sel ? unitOptions(game, sel) : null;
  if (u && opts?.attackTargets.includes(u.id)) { act({ type: 'attack', player: p, unitId: sel.id, target: u.id }); return; }
  if (u) { inspect(u.id); return; }
  if (opts?.reach[k]) { act({ type: 'move', player: p, unitId: sel.id, to: k }); return; }
  cancel();
}

// ---------- rendering the UI state ----------

function refresh() {
  if (!game) return;
  ui.renderSetup(settings, ctx.screen === 'setup', { ...online, config: matchConfig(), connected: net.connected });
  ui.renderPhase(game, { ...ctx, human: isHuman() });
  ui.renderActionBar(game, { ...ctx, human: isHuman(), busy });
  ui.renderSide(game, { ...ctx, human: isHuman() });
  renderCard();
  refreshHighlights();
  units.sync(game);
  units.setSelected(ctx.selectedId ?? ctx.inspectId ?? ctx.placingId);
  units.setDimmed(game.phase === 'battle'
    ? Object.values(game.units).filter(u => u.alive && u.owner === game.turn.player && !canActivate(game, u)).map(u => u.id) : []);
  units.sync(game);
}

function renderCard() {
  let what = null;
  const sel = ctx.selectedId && game.units[ctx.selectedId];
  if (sel) what = { unit: sel, options: isHuman() && canActivate(game, sel) ? unitOptions(game, sel) : null, abilityKey: ctx.abilityKey };
  else if (ctx.inspectId) what = { unit: game.units[ctx.inspectId] };
  else if (ctx.hoverUnit && game.units[ctx.hoverUnit]?.alive) what = { unit: game.units[ctx.hoverUnit] };
  else if (ctx.peek) {
    const [kind, v] = ctx.peek.split(':');
    what = kind === 'type' ? { type: v } : { unit: game.units[+v] };
  }
  ui.renderUnitCard(game, what);
}

function refreshHighlights() {
  const items = [];
  const zone = (c, color, strong) => game.map.zones[c].forEach(k => items.push({ key: k, color, strong }));
  const owner = c => game.players.find(p => p.corner === c);
  if (ctx.screen === 'setup') {
    CORNERS.forEach(c => zone(c, COLORS.zone));
  } else if (game.phase === 'corners') {
    const open = allowedCorners(game); // after the first pick, only the evenly spaced corners are left
    const hoverCorner = CORNERS.find(c => open.includes(c) && game.map.zones[c].includes(ctx.hoverKey));
    CORNERS.forEach(c => (owner(c) || open.includes(c)) && zone(c, owner(c)?.color ?? (c === hoverCorner && isHuman() ? '#ffe08a' : COLORS.zone), c === hoverCorner));
  } else if (game.phase === 'draft') {
    CORNERS.forEach(c => owner(c) && zone(c, owner(c).color));
  } else if (game.phase === 'placement') {
    const p = game.players[currentPlayer(game)];
    game.map.zones[p.corner].forEach(k => !unitAt(game, k) && items.push({ key: k, color: p.color }));
  } else if (game.phase === 'battle') {
    const sel = ctx.selectedId && game.units[ctx.selectedId];
    if (sel && isHuman()) {
      const o = unitOptions(game, sel);
      if (ctx.abilityKey) {
        const ab = o.abilities.find(a => a.key === ctx.abilityKey);
        for (const t of ab.targets) items.push({ key: typeof t === 'number' ? unitKey(game.units[t]) : t, color: COLORS.target });
        const hovered = ab.target.type === 'hex' ? ctx.hoverKey : unitAt(game, ctx.hoverKey)?.id;
        if (hovered !== undefined && hovered !== null && ab.targets.includes(hovered)) {
          abilityArea(game, ctx.abilityKey, hovered, sel).forEach(k => items.push({ key: k, color: COLORS.area, strong: true }));
        }
      } else {
        Object.keys(o.reach).forEach(k => items.push({ key: k, color: o.reach[k].hazard ? COLORS.risky : COLORS.move }));
        o.attackTargets.forEach(id => items.push({ key: unitKey(game.units[id]), color: COLORS.attack, strong: true }));
      }
      readyUnits(sel.id).forEach(u => items.push({ key: unitKey(u), color: COLORS.ready }));
      items.push({ key: unitKey(sel), color: '#ffffff' });
    } else if (isHuman() && !ctx.inspectId) {
      // nothing selected: make the units that can still act stand out
      readyUnits().forEach(u => items.push({ key: unitKey(u), color: COLORS.ready, strong: true }));
    } else if (ctx.inspectId && game.units[ctx.inspectId]?.alive) {
      const u = game.units[ctx.inspectId];
      Object.keys(reachable(game, u)).forEach(k => items.push({ key: k, color: COLORS.enemyReach }));
    }
  }
  board.setHighlights(items);
}

// The current player's units that can still be activated this turn.
function readyUnits(exceptId = null) {
  if (game.phase !== 'battle') return [];
  return Object.values(game.units).filter(u => u.alive && u.placed && u.id !== exceptId && canActivate(game, u));
}

// Hovering an enemy the selected unit can attack: show the odds.
function attackPreview(unitId, ev) {
  const sel = ctx.selectedId && game.units[ctx.selectedId];
  if (!sel || !unitId || ctx.abilityKey || !isHuman() || game.phase !== 'battle') return false;
  const target = game.units[unitId];
  if (!unitOptions(game, sel).attackTargets.includes(unitId)) return false;
  const d = UNITS[sel.key], ranged = d.range > 1;
  const a = attackDice(game, sel, target, d.atk, { ranged });
  const df = defenseDice(game, sel, target, { ranged });
  const odds = damageOdds(a.dice, df.dice, has(target, 'stoneskin') ? 1 : 0);
  ui.showAttackTip({ label: 'Attack', touch: ev.pointerType !== 'mouse', target: UNITS[target.key].name, atk: a.dice, def: df.dice, mean: odds.mean,
    kill: odds.pKill(target.hp), hp: target.hp, mods: [...a.mods.map(([n, v]) => [`Atk: ${n}`, v]), ...df.mods.map(([n, v]) => [`Def: ${n}`, v])] }, ev.clientX, ev.clientY);
  return true;
}

// ---------- pointer input ----------

const canvas = view.renderer.domElement;
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let down = null;

function pickAt(ev) {
  const r = canvas.getBoundingClientRect();
  ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, view.camera);
  const pid = gallery.pick(ray);
  if (pid !== null) return { key: null, unitId: null, pid };
  const uid = units.pick(ray);
  if (uid && game.units[uid]) return { key: unitKey(game.units[uid]), unitId: uid };
  const k = board.pick(ray);
  return { key: k, unitId: k ? unitAt(game, k)?.id ?? null : null };
}

// Touch has no hover, so a tap first does what hovering does (hex info, unit card, attack odds, gallery
// card). Tapping an attackable enemy or a pool unit shows its odds/card first; tapping it again acts.
let touchArmed = null;
canvas.addEventListener('pointerdown', ev => { down = { x: ev.clientX, y: ev.clientY, button: ev.button, touch: ev.pointerType !== 'mouse' }; });
canvas.addEventListener('pointerup', ev => {
  if (!down || !game) return;
  const moved = Math.hypot(ev.clientX - down.x, ev.clientY - down.y);
  const { button, touch } = down;
  down = null;
  if (moved > (touch ? 12 : 6)) return;
  if (button === 2) { cancel(); return; }
  if (button !== 0) return;
  const { key: k, unitId, pid } = pickAt(ev);
  if (touch) {
    const preview = hoverAt(ev);
    const target = preview === 'attack' ? `u${unitId}` : preview === 'pool' ? `p${pid}` : null;
    if (target && touchArmed !== target) { touchArmed = target; return; }
    touchArmed = null;
    ui.hideTip();
  }
  if (pid !== undefined) {
    if (game.phase === 'draft' && draft.stage === 'picking' && isHuman() && !busy) act({ type: 'draft', player: currentPlayer(game), pid });
    return;
  }
  if (k) handleClick(k, unitId);
});
canvas.addEventListener('contextmenu', ev => ev.preventDefault());
canvas.addEventListener('pointermove', ev => {
  if (!game || ev.buttons || ev.pointerType === 'touch') return;
  hoverAt(ev);
});

// What hovering does: highlight the hex, show its info and the unit card, attack odds or the pool card.
// Returns 'attack' or 'pool' when it showed something a touch player should see before acting.
function hoverAt(ev) {
  const { key: k, unitId, pid } = pickAt(ev);
  const attack = attackPreview(unitId, ev);
  if (!attack) galleryHover(pid ?? null, ev);
  const shown = attack ? 'attack' : pid !== undefined && pid !== null ? 'pool' : null;
  if (k === ctx.hoverKey && unitId === ctx.hoverUnit) return shown;
  ctx.hoverKey = k;
  const unitChanged = unitId !== ctx.hoverUnit;
  ctx.hoverUnit = unitId;
  board.setHover(k);
  ui.renderHexInfo(game, k);
  if (unitChanged) { if (unitId) ctx.peek = null; renderCard(); }
  if (ctx.abilityKey || game.phase === 'corners') refreshHighlights();
  return shown;
}

canvas.addEventListener('pointerleave', () => galleryHover(null));

// Hovering a unit in the draft gallery shows its full card beside the pointer.
function galleryHover(pid, ev) {
  if (pid !== gallery.hovered) gallery.setHover(pid);
  if (pid === null) { ui.hideTip(); return; }
  const item = game.pool.find(p => p.pid === pid);
  const footer = game.phase === 'draft' && isHuman() ? (ev.pointerType === 'mouse' ? 'Click to draft' : 'Tap again to draft') : '';
  // place it just right of the gallery so it doesn't cover the other units
  const r = canvas.getBoundingClientRect();
  const edge = new THREE.Vector3(gallery.area.maxX, 0, gallery.slotTop(pid).z).project(view.camera);
  const x = Math.max(ev.clientX, r.left + (edge.x + 1) / 2 * r.width);
  ui.showTip(ui.unitCardHtml(game, { type: item.key, footer }), x, ev.clientY);
}

window.addEventListener('keydown', ev => {
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(ev.target.tagName)) return;
  if (ev.key === 'Escape') cancel();
  if (ev.key === 'Enter' && isHuman() && game.phase === 'battle' && !busy) act({ type: 'endTurn', player: currentPlayer(game) });
});

// ---------- draft screen ----------
// Entering the draft shows the map for DRAFT_PREVIEW seconds (with a countdown and a Skip button) so
// players can read the battlefield, then the pick screen opens. Each pick has a clock
// (settings.draftTimer seconds, 0 = none): when it runs out, the unit the player has selected is
// locked in, or the computer's choice if they haven't selected one they can afford.
const DRAFT_PREVIEW = 10;
const draft = { stage: null, ends: 0, portraits: null }; // stage: null | 'preview' | 'picking'
const draftScreen = new DraftScreen({
  lockIn: pid => { if (pid !== null && isHuman() && !busy) act({ type: 'draft', player: currentPlayer(game), pid }); },
  viewMap: on => { draftScreen.showMap(on); if (on) showGallery(true, 'board'); },
  cardHtml: key => ui.unitCardHtml(game, { type: key }),
});
const previewBar = document.createElement('div');
previewBar.id = 'draftPreview';
previewBar.className = 'panel hidden';
previewBar.innerHTML = '<span>Study the battlefield — the draft begins in</span><b id="dpCount">10</b><button class="primary" id="dpSkip">Start now</button>';
document.getElementById('hud').append(previewBar);
document.getElementById('dpSkip').onclick = () => openDraftScreen();

function startDraft() {
  draft.stage = 'preview';
  draft.ends = performance.now() + DRAFT_PREVIEW * 1000;
  showGallery(true, 'board'); // the map framed, the pool's table beside it
  previewBar.classList.remove('hidden');
  if (!draft.portraits) {
    draft.portraits = {};
    // stylized art (assets/portraits/<key>.png, listed in index.json) is used where it exists; only the
    // rest get a live 3D render. The web build lists { ext: 'webp', keys } instead of a plain key list.
    (async () => {
      const art = {};
      try {
        const index = await (await fetch('assets/portraits/index.json')).json();
        const ext = index.ext ?? 'png';
        for (const k of index.keys ?? index) if (DRAFTABLE.includes(k)) art[k] = `assets/portraits/${k}.${ext}`;
      } catch { /* no stylized portraits yet */ }
      const missing = DRAFTABLE.filter(k => !art[k]);
      const urls = { ...(missing.length ? await renderPortraits(view.renderer, missing, manifest) : {}), ...art };
      draft.portraits = urls;
      draftScreen.setPortraits(urls);
    })();
  }
}

function openDraftScreen() {
  if (draft.stage !== 'preview') return;
  draft.stage = 'picking';
  previewBar.classList.add('hidden');
  draftScreen.open();
  renderDraft();
  maybeAI();
}

// Show whose pick it is and restart the clock (after every pick).
function renderDraft() {
  if (draft.stage !== 'picking' || game.phase !== 'draft') return;
  draft.ends = performance.now() + draftSeconds() * 1000;
  draftScreen.render(game, { picker: currentPlayer(game), human: isHuman() });
}

function endDraft() {
  draft.stage = null;
  draftScreen.close();
  previewBar.classList.add('hidden');
}

function draftTick() {
  if (!draft.stage) return;
  const left = (draft.ends - performance.now()) / 1000;
  if (draft.stage === 'preview') {
    document.getElementById('dpCount').textContent = Math.max(0, Math.ceil(left));
    if (left <= 0) openDraftScreen();
    return;
  }
  if (!draftSeconds()) { draftScreen.tick(null); return; }
  draftScreen.tick(Math.max(0, left), draftSeconds());
  if (left > 0 || !isHuman() || busy) return;
  // out of time: take the selected unit if it can be bought, else let the computer choose
  draft.ends = Infinity;
  const p = currentPlayer(game);
  const item = game.pool.find(it => it.pid === draftScreen.selected);
  const ok = item && item.takenBy === null && UNITS[item.key].cost <= game.settings.points - game.players[p].spent;
  ui.toast('Time! Auto-pick.');
  act({ type: 'draft', player: p, pid: ok ? item.pid : aiAction(game).pid });
}

// ---------- online play (two browsers, through a public message relay: src/net/relay.js) ----------
// The host (Blue) picks the match settings and starts; the guest (Red) joins with the room code.
// Each side sends its own actions; the other side applies them through act(..., { remote }).
// Messages: hello (guest's version) · config (host's settings) · start · action · newGame · full

const NET_VERSION = 2; // bump when the rules or the message format change, so mismatched builds don't play
const online = { state: 'idle', role: null, code: null, me: null, config: null, joinCode: '', error: null, queue: [], warned: false };
const net = new RelayLink({
  onOpen() {
    online.state = 'connected';
    if (online.role === 'guest') net.send({ t: 'hello', v: NET_VERSION });
    ui.toast(online.role === 'host' ? 'Your friend joined!' : 'Connected!');
    refresh();
  },
  onMessage: onNetMessage,
  onClose() {
    const inGame = ctx.screen === 'game';
    resetOnline();
    if (inGame) { backToSetup(); ui.showNotice('Connection lost', 'Your friend left or the connection dropped. The game has ended.'); }
    else { ui.toast('Your friend disconnected.'); refresh(); }
  },
  onError(e) { console.warn('[online]', e.type ?? e.message); },
});
addEventListener('pagehide', () => { if (net.connected) net.close(); }); // tell the friend straight away

const onlineGame = () => settings.opponent === 'online' && net.connected;
const draftSeconds = () => matchConfig().draftTimer;
const stateHash = () => hashSeed(JSON.stringify(game));

function onNetMessage(msg) {
  switch (msg?.t) {
    case 'hello':
      if (msg.v !== NET_VERSION) { net.send({ t: 'error', text: 'Your game is a different version. Reload the page and try again.' }); setTimeout(() => leaveOnline(), 500); return; }
      sendConfig();
      return;
    case 'config':
      online.config = msg.config;
      if (ctx.screen === 'setup') preview();
      return;
    case 'start':
      if (ctx.screen === 'setup') start();
      return;
    case 'action':
      online.queue.push(msg);
      pumpRemote();
      return;
    case 'newGame':
      ui.toast('Your friend went back to the setup screen.');
      backToSetup();
      return;
    case 'full':
    case 'error':
      online.error = msg.text ?? 'That game already has two players.';
      leaveOnline(false);
      refresh();
      return;
  }
}

// The friend's actions, applied one at a time once nothing is animating.
function pumpRemote() {
  if (busy || !online.queue.length || ctx.screen !== 'game') return;
  const msg = online.queue.shift();
  act(msg.action, { remote: { hash: msg.hash } }).then(pumpRemote);
}

function sendConfig() {
  if (online.role === 'host' && net.connected) net.send({ t: 'config', config: matchConfig() });
}

function desync(why) {
  console.warn('[online] out of sync:', why);
  if (online.warned) return;
  online.warned = true;
  ui.showNotice('Out of sync', `The two games no longer match (${why}). Go back to the setup screen and start a new battle.`);
}

async function hostOnline() {
  if (online.state !== 'idle') return;
  Object.assign(online, { state: 'opening', role: 'host', me: 0, error: null });
  refresh();
  try {
    online.code = await net.host();
    online.state = 'waiting';
  } catch (e) {
    resetOnline(e.message || 'Could not open a room.');
  }
  refresh();
}

async function joinOnline() {
  const code = normalizeCode(online.joinCode);
  if (online.state !== 'idle' || code.length < 4) { online.error = 'Type the room code your friend sent you.'; refresh(); return; }
  Object.assign(online, { state: 'joining', role: 'guest', me: 1, code, error: null });
  refresh();
  try { await net.join(code); } catch (e) {
    net.close();
    resetOnline(e.message || 'Could not join.');
  }
  refresh();
}

function leaveOnline(clearError = true) {
  net.close();
  resetOnline(clearError ? null : online.error);
  if (ctx.screen === 'setup' && game) preview();
}

function resetOnline(error = null) {
  Object.assign(online, { state: 'idle', role: null, code: null, me: null, config: null, error, queue: [], warned: false });
}

function backToSetup() {
  clearTimeout(aiTimer);
  ctx.screen = 'setup';
  online.queue = [];
  online.warned = false;
  ui.closeModal();
  diceTray.hide();
  preview();
}

// ---------- settings ----------

function loadSettings() {
  let s;
  try { s = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; } catch { s = { ...DEFAULTS }; }
  // drop values saved by older versions
  if (!SYMMETRY[s.symmetry]) s.symmetry = DEFAULTS.symmetry;
  if (!MAP_SIZES[s.size]) s.size = DEFAULTS.size;
  if (!BIOMES[s.biome]) s.biome = DEFAULTS.biome;
  if (!DICE_MODES.includes(s.dice)) s.dice = DEFAULTS.dice;
  if (!THEMES[s.backdrop]) s.backdrop = DEFAULTS.backdrop;
  if (!POINT_OPTIONS.includes(s.points)) s.points = DEFAULTS.points;
  if (!TIMER_OPTIONS.includes(s.draftTimer)) s.draftTimer = DEFAULTS.draftTimer;
  if (!['pips', 'pill', 'plate', 'minimal'].includes(s.hpStyle)) s.hpStyle = DEFAULTS.hpStyle;
  if (!['auto', 'high', 'low'].includes(s.graphics)) s.graphics = DEFAULTS.graphics;
  if (![4, 5, 6, 7].includes(+s.teamSize)) s.teamSize = DEFAULTS.teamSize;
  return s;
}
function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* private mode: settings just won't persist */ }
}

// ---------- loop ----------

const clock = new THREE.Clock();
let lastFrame = performance.now();
function tick(render) {
  const dt = Math.min(clock.getDelta(), render ? 0.05 : 0.5);
  const t = clock.elapsedTime;
  updateFx(dt);
  draftTick();
  units.update(dt, t);
  gallery.update(dt);
  env.update(t, dt, view.camera);
  if (!render) return;
  lastFrame = performance.now();
  board.update(t);
  view.update(dt);
  view.renderer.render(view.scene, view.camera);
}
view.renderer.setAnimationLoop(() => tick(true));
// Browsers pause animation frames in hidden tabs; keep animations (and so the CPU's turns) moving anyway.
setInterval(() => { if (performance.now() - lastFrame > 250) tick(false); }, 100);

preview();
document.getElementById('loading').remove();

// Debug handle for the browser console: __hex.game is the live state.
window.__hex = { get game() { return game; }, board, units, gallery, view, act, online, get busy() { return busy; } };
