// 3D units: rigged GLB models when present (assets/manifest.json), simple placeholder figures otherwise.
// Units are board-game miniatures: every model is frozen in one action pose (see posedFigure) and
// never animates. Moving, attacking, getting hit and dying are done by moving the whole piece.
// Handles walking along a path, attacks, hits and deaths. Game rules never live here.
import * as THREE from 'three';
import { createUnitModel } from './loader.js';
import { UnitAnimator } from './animator.js';
import { UNITS } from '../core/units.js';
import { makeFlight } from './flight.js';
import { makeAura, AURA_KINDS } from './skillFx.js';
import { glow } from './fx.js';
import { tween, wait, ease, projectile } from './fx.js';
import { makePedestal, BASE_TOP } from './pedestal.js';

// Health bar: drawn at 2x on a canvas and shown at a fixed size on screen (sizeAttenuation off), so it
// stays crisp and readable at any zoom. BAR_SCREEN is its width as a fraction of the view height.
const BAR_W = 256, BAR_H = 44, BAR_SCREEN = 0.1;

// Readability on the board: figures are drawn FIGURE_SCALE times their manifest height, small ones are
// first brought up to MIN_FIGURE, and nothing ends up taller than MAX_FIGURE (big monsters stay on their hex).
// Each figure also gets a soft team-colored rim light (RIM_*) so it separates from busy or bright tiles.
const FIGURE_SCALE = 1.2, MIN_FIGURE = 1.2, MAX_FIGURE = 2.2;
const RIM_POWER = 3, RIM_STRENGTH = 0.7, RIM_DIMMED = 0.2;
const figureScale = h => Math.min(FIGURE_SCALE * Math.max(1, MIN_FIGURE / h), MAX_FIGURE / h);

// Adds a view-angle (fresnel) glow in the team color to every material of the figure.
// `strength` is a shared uniform so dimming a unit is one assignment. Materials are per-unit clones.
function addRimLight(object, team, strength) {
  object.traverse(o => {
    if (!o.isMesh) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (!m.isMeshStandardMaterial) continue;
      m.onBeforeCompile = sh => {
        sh.uniforms.rimColor = { value: team };
        sh.uniforms.rimStrength = strength;
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform vec3 rimColor;\nuniform float rimStrength;')
          .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
            float rimF = 1.0 - clamp(dot(normalize(vNormal), normalize(vViewPosition)), 0.0, 1.0);
            totalEmissiveRadiance += rimColor * pow(rimF, ${RIM_POWER.toFixed(1)}) * rimStrength;`);
      };
      m.customProgramCacheKey = () => 'unitRim';
      m.needsUpdate = true;
    }
  });
}

export class UnitsView {
  constructor(scene, board, manifest) {
    this.scene = scene;
    this.board = board;
    this.manifest = manifest;
    this.views = new Map(); // unit id -> view
    this.selected = null;
    this.barStyle = 'pips';
  }

  clear() {
    for (const v of this.views.values()) this.scene.remove(v.root);
    this.views.clear();
  }

  // Make the 3D units match the state: add newly placed ones, drop removed ones, snap idle ones into place.
  sync(state) {
    this.state = state;
    for (const u of Object.values(state.units)) {
      const v = this.views.get(u.id);
      const shown = u.placed && (u.alive || v?.dying);
      if (!shown) { if (v) { this.scene.remove(v.root); this.views.delete(u.id); } continue; }
      if (!v) this.views.set(u.id, this.create(u, state.players[u.owner].color));
      const view = this.views.get(u.id);
      if (!view.busy) {
        this.board.worldPos(`${u.q},${u.r}`, view.root.position);
        view.groundY = view.root.position.y;
        view.root.position.y += view.lift ?? 0;
      }
      if (!view.ghosting) this.drawBar(view, u);
      this.syncAuras(view, u);
      view.root.visible = true;
    }
  }

  create(unit, teamColor) {
    const cfg = this.manifest.units[unit.key] ?? {};
    const root = new THREE.Group();
    const team = new THREE.Color(teamColor);

    const { root: base, rim } = makePedestal({ rimColor: team });
    rim.material.emissive.set(team);
    rim.material.emissiveIntensity = 1;
    const sel = new THREE.Mesh(new THREE.RingGeometry(0.72, 0.86, 40).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false }));
    sel.position.y = 0.06;
    sel.visible = false;
    root.add(base, sel);

    const body = new THREE.Group(); // turns to face things
    root.add(body);
    const { object, height: baseHeight } = buildFigure(unit.key, teamColor, this.manifest);
    const s = figureScale(baseHeight);
    object.scale.multiplyScalar(s);
    object.updateMatrixWorld(true);
    object.position.y += BASE_TOP - new THREE.Box3().setFromObject(object).min.y; // feet back on the base
    const figureHeight = baseHeight * s;
    const rimStrength = { value: RIM_STRENGTH };
    addRimLight(object, team, rimStrength);
    body.add(object);
    // flyers ride a clear flight post, hovering, with a shadow and downdraft on the base (flight.js)
    const hover = flightHover(unit.key, cfg);
    const flight = hover ? makeFlight(object, hover, unit.id) : null;
    if (flight) body.add(flight.group);
    const height = figureHeight + hover;

    const canvas = document.createElement('canvas');
    canvas.width = BAR_W; canvas.height = BAR_H;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter; // no mipmaps: they blur thin lines
    tex.generateMipmaps = false;
    const bar = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, sizeAttenuation: false }));
    bar.center.set(0.5, 0);
    bar.scale.set(BAR_SCREEN, BAR_SCREEN * BAR_H / BAR_W, 1);
    bar.position.y = height + 0.3;
    bar.renderOrder = 10;
    root.add(bar);

    root.traverse(o => { o.userData.unitId = unit.id; });
    this.scene.add(root);
    // face the middle of the board
    const p = this.board.worldPos(`${unit.q},${unit.r}`);
    body.rotation.y = Math.atan2(-p.x, -p.z);
    const view = {
      id: unit.id, root, body, base, rim, sel, bar, canvas, tex, height, busy: false, dying: false, lastHp: null, team: teamColor,
      walkSpeed: cfg.walkSpeed ?? 3.2, flight, rimStrength,
    };
    return view;
  }

  // Health display in the chosen style (Settings > Health bar style): see BAR_STYLES below.
  // `ghost` (0..1 of max) is recently lost health, drawn pale while it drains away.
  drawBar(view, unit, ghost = 0) {
    const shield = unit.status?.shield ?? 0;
    const key = `${this.barStyle}/${unit.hp}/${unit.maxHp}/${shield}/${view.dim}/${ghost.toFixed(3)}`;
    if (view.lastHp === key) return;
    view.lastHp = key;
    view.hpShown = unit.hp;
    const g = view.canvas.getContext('2d');
    g.clearRect(0, 0, BAR_W, BAR_H);
    (BAR_STYLES[this.barStyle] ?? drawPill)(g, unit, view.team ?? '#ffffff', ghost);
    if (shield) drawBarrier(g, shield);
    const size = this.barStyle === 'pips' ? BAR_SCREEN * 1.2 : BAR_SCREEN; // pips need a little more room to read
    view.bar.scale.set(size, size * BAR_H / BAR_W, 1);
    view.tex.needsUpdate = true;
    view.bar.material.opacity = view.dim ? 0.5 : 1;
  }

  setBarStyle(style) {
    this.barStyle = style;
    for (const [id, v] of this.views) if (this.state?.units[id]) this.drawBar(v, this.state.units[id]);
  }

  // New health: damage leaves a white chip that drains down to the new value.
  setHp(id, hp, maxHp) {
    const v = this.views.get(id);
    if (!v) return;
    const before = v.hpShown ?? hp;
    if (hp >= before) { this.drawBar(v, { hp, maxHp }); return; }
    const from = before / maxHp, to = hp / maxHp;
    this.drawBar(v, { hp, maxHp }, from);
    v.ghosting = true;
    wait(0.25).then(() => tween(0.45, t => this.drawBar(v, { hp, maxHp }, from + (to - from) * ease(t))))
      .then(() => { v.ghosting = false; });
  }

  // Pointer picking: unit id under the ray, or null.
  pick(raycaster) {
    const objs = [...this.views.values()].filter(v => !v.dying).map(v => v.root);
    const hit = raycaster.intersectObjects(objs, true).find(h => !h.object.isSprite);
    return hit ? hit.object.userData.unitId : null;
  }

  // The selected piece is picked up: it rises off its hex, base and all.
  setSelected(id) {
    for (const v of this.views.values()) { v.sel.visible = v.id === id; v.lifted = v.id === id; }
  }

  // Units that already finished their turn are dimmed.
  setDimmed(ids) {
    for (const v of this.views.values()) {
      const dim = ids.includes(v.id);
      v.rim.material.emissiveIntensity = dim ? 0.08 : 1;
      v.rimStrength.value = dim ? RIM_DIMMED : RIM_STRENGTH;
      v.dim = dim;
    }
  }

  center(id) { const v = this.views.get(id); return v ? v.root.position.clone().add(new THREE.Vector3(0, v.height * 0.6, 0)) : null; }

  face(view, target) {
    const p = view.root.position;
    const goal = Math.atan2(target.x - p.x, target.z - p.z);
    const start = view.body.rotation.y;
    let d = goal - start;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    return tween(0.15, t => { view.body.rotation.y = start + d * ease(t); });
  }

  async move(id, path, fly) {
    const view = this.views.get(id);
    if (!view) return;
    view.busy = true;
    for (let i = 1; i < path.length; i++) {
      const a = view.root.position.clone();
      const b = this.board.worldPos(path[i]);
      this.face(view, b);
      const rise = b.y - a.y;
      const hop = fly ? 0.15 : Math.max(0, rise) * 0.8 + (Math.abs(rise) > 0.05 ? 0.25 : 0.06);
      await tween(Math.max(0.16, a.distanceTo(b) / view.walkSpeed), t => {
        view.root.position.lerpVectors(a, b, t);
        view.root.position.y += Math.sin(Math.PI * t) * hop;
        view.body.rotation.x = Math.sin(Math.PI * t) * 0.08; // a slight tilt, like a piece being hopped by hand
      });
    }
    view.body.rotation.x = 0;
    view.groundY = view.root.position.y; // new hex height, so the lift doesn't snap back to the old one
    view.lift = 0;
    view.busy = false;
  }

  // Auras for lasting statuses (Gate Release, poison, Sacred Barrier, cowed): added and removed to match.
  syncAuras(view, unit) {
    view.auras ??= {};
    for (const kind of AURA_KINDS) {
      const on = !!unit.status[kind] && unit.alive;
      if (on && !view.auras[kind]) { view.auras[kind] = makeAura(kind, view.height); view.root.add(view.auras[kind]); }
      if (!on && view.auras[kind]) { view.root.remove(view.auras[kind]); delete view.auras[kind]; }
    }
  }

  // A freshly raised minion claws up out of the ground.
  async rise(id) {
    const view = this.views.get(id);
    if (!view) return;
    view.busy = true;
    const y = view.root.position.y;
    await tween(1.0, t => {
      view.root.position.y = y - 0.9 * (1 - ease(t));
      view.root.scale.setScalar(0.4 + 0.6 * ease(t));
      view.body.rotation.z = 0.25 * Math.sin(t * 18) * (1 - t);
    });
    view.root.scale.setScalar(1);
    view.body.rotation.z = 0;
    view.busy = false;
  }

  // style: 'blink' (shrink away and grow back), 'dash' (charge along the ground leaving a streak),
  // 'flash' (vanish, afterimages, reappear: flash step)
  async teleport(id, toKey, style = 'blink') {
    const view = this.views.get(id);
    if (!view) return;
    if (style === 'dash') return this.dash(view, toKey);
    if (style === 'flash') return this.flashStep(view, toKey);
    view.busy = true;
    await tween(0.25, t => view.root.scale.setScalar(1 - t * 0.95));
    this.board.worldPos(toKey, view.root.position);
    view.groundY = view.root.position.y;
    view.lift = 0;
    await tween(0.25, t => view.root.scale.setScalar(0.05 + t * 0.95));
    view.busy = false;
  }

  async dash(view, toKey) {
    view.busy = true;
    const a = view.root.position.clone(), b = this.board.worldPos(toKey);
    await this.face(view, b);
    const trail = [];
    let dropped = 0;
    await tween(Math.max(0.22, a.distanceTo(b) / 16), t => {
      view.root.position.lerpVectors(a, b, ease(t));
      view.body.rotation.x = 0.25 * Math.sin(Math.PI * t); // head down, charging
      if (t - dropped > 0.07) {
        dropped = t;
        const s = glow(0xd8c8a0, 0.9);
        s.position.copy(view.root.position).add(new THREE.Vector3(0, 0.4, 0));
        this.scene.add(s);
        trail.push(s);
      }
    });
    view.body.rotation.x = 0;
    trail.forEach(s => tween(0.4, t => { s.material.opacity = 1 - t; s.scale.setScalar(0.9 + t); }).then(() => this.scene.remove(s)));
    view.groundY = view.root.position.y;
    view.lift = 0;
    view.busy = false;
  }

  async flashStep(view, toKey) {
    view.busy = true;
    const a = view.root.position.clone(), b = this.board.worldPos(toKey);
    // afterimages along the way: violet glows that fade
    for (let i = 0; i <= 3; i++) {
      const s = glow(0xa070ff, 1.3);
      s.position.lerpVectors(a, b, i / 3).add(new THREE.Vector3(0, view.height * 0.5, 0));
      this.scene.add(s);
      tween(0.5, t => { s.material.opacity = (1 - t) * (i ? 0.6 : 1); }).then(() => this.scene.remove(s));
    }
    await tween(0.08, t => view.root.scale.set(1 - t * 0.9, 1 + t * 0.5, 1 - t * 0.9));
    view.root.position.copy(b);
    await this.face(view, a.clone().lerp(b, 2)); // keep facing the way it moved
    await tween(0.1, t => view.root.scale.set(0.1 + t * 0.9, 1.5 - t * 0.5, 0.1 + t * 0.9));
    view.root.scale.setScalar(1);
    view.groundY = view.root.position.y;
    view.lift = 0;
    view.busy = false;
  }

  // Wind up, then resolve when the blow/spell is released (so damage can show on impact).
  // targetPos null = an attack around itself (no turning, no lunge).
  // fire(from, to): plays the shot instead of the default glowing projectile (attackFx.js)
  async strikeAt(id, targetPos, { ranged = false, color = 0xffffff, projectileStyle = null, fire = null } = {}) {
    const view = this.views.get(id);
    if (!view) return;
    if (targetPos) {
      await this.face(view, targetPos);
      // melee: lift and lunge at the target; ranged: rock back as the shot leaves
      const home = view.body.position.clone();
      const dir = targetPos.clone().sub(view.root.position).setY(0).normalize().multiplyScalar(ranged ? -0.12 : 0.45);
      await tween(0.18, t => {
        view.body.position.copy(home).addScaledVector(dir, ease(t));
        view.body.position.y = home.y + Math.sin(Math.PI * t) * (ranged ? 0.05 : 0.15);
        view.body.rotation.x = (ranged ? -0.12 : 0.18) * ease(t);
      });
      tween(0.24, t => {
        view.body.position.copy(home).addScaledVector(dir, 1 - ease(t));
        view.body.rotation.x = (ranged ? -0.12 : 0.18) * (1 - ease(t));
      });
    } else {
      // an attack around itself: a stomp
      const y = view.body.position.y;
      await tween(0.22, t => { view.body.position.y = y + Math.sin(Math.PI * t) * 0.3; });
    }
    if (ranged) {
      const from = this.center(id);
      if (fire) await fire(from, targetPos);
      else await projectile(from, targetPos, color, projectileStyle ?? {});
    }
  }

  hit(id) {
    const view = this.views.get(id);
    if (!view) return;
    const home = view.body.position.clone();
    tween(0.35, t => {
      const k = Math.sin(t * Math.PI * 7) * (1 - t);
      view.body.position.x = home.x + k * 0.07;
      view.body.rotation.z = k * 0.12;
    });
  }

  async die(id) {
    const view = this.views.get(id);
    if (!view) return;
    view.dying = true;
    view.busy = true;
    view.bar.visible = false;
    view.sel.visible = false;
    // topple over (pivoting on the base edge), bounce once, then lift off the table
    const tip = new THREE.Group();
    tip.position.z = -0.5;
    view.root.add(tip);
    view.base.position.z += 0.5; view.body.position.z += 0.5;
    tip.add(view.base, view.body);
    await tween(0.45, t => { tip.rotation.x = -(Math.PI / 2) * (t * t); });
    await tween(0.18, t => { tip.rotation.x = -Math.PI / 2 + Math.sin(Math.PI * t) * 0.12; });
    await wait(0.25);
    const y = view.root.position.y;
    await tween(0.4, t => {
      view.root.position.y = y + t * 0.6;
      view.root.scale.setScalar(1 - t * 0.9);
    });
    this.scene.remove(view.root);
    this.views.delete(id);
  }

  update(dt, t) {
    for (const v of this.views.values()) {
      v.sel.rotation.y += dt;
      v.flight?.update(t);
      for (const a of Object.values(v.auras ?? {})) a.userData.update(t);
      if (!v.busy && v.groundY !== undefined) {
        const target = v.lifted ? 0.22 : 0;
        v.lift = (v.lift ?? 0) + (target - (v.lift ?? 0)) * Math.min(1, dt * 10);
        v.root.position.y = v.groundY + v.lift;
      }
    }
  }
}

// How high a flyer rides above its base (0 for walkers). manifest "hover" overrides.
export const flightHover = (key, cfg = {}) => cfg.hover ?? (UNITS[key].abilities.includes('flight') ? 0.45 : 0);

// The unit's rigged model if it has one, else a placeholder figure. Stands on the pedestal top (BASE_TOP).
export function buildFigure(key, teamColor, manifest) {
  const cfg = manifest.units[key] ?? {};
  const model = createUnitModel(key, cfg, teamColor, { baseY: BASE_TOP });
  if (model) {
    posedFigure(model, cfg);
    return { object: model.object, height: (cfg.height ?? 1) * (cfg.scale ?? 1) };
  }
  const ph = buildPlaceholder(key, new THREE.Color(teamColor));
  return { object: ph.object, height: ph.height };
}

// Freeze a rigged model in one frame of one of its clips, like a sculpted miniature.
// manifest "pose": { "clip": "attack" | "idle" | "<exact clip name>", "at": 0..1 }
// Default: the attack clip at its impact point (the most dynamic moment), else the idle clip.
export function posedFigure(model, cfg) {
  if (model.clips.length) setPose(model, cfg);
  // a pose can lift, sink or shift the figure: put the feet back on the base and centre the feet on the hex.
  // The feet are where the body touches the base: its lowest vertices (the body mesh only, so a grounded
  // staff or a long tail tip doesn't pull it off-centre; static creatures use every mesh)
  model.object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model.object, true);
  if (!Number.isFinite(box.min.y)) return;
  const meshes = [];
  model.object.traverse(o => { if (o.isMesh) meshes.push(o); });
  const skinned = meshes.filter(m => m.isSkinnedMesh);
  const pts = [];
  for (const m of skinned.length ? skinned : meshes) {
    const n = m.geometry.attributes.position.count;
    for (let i = 0; i < n; i++) pts.push(m.localToWorld(m.getVertexPosition(i, new THREE.Vector3())));
  }
  // the body's own lowest point, not a weapon resting below the feet
  let low = Infinity, high = -Infinity;
  for (const p of pts) { low = Math.min(low, p.y); high = Math.max(high, p.y); }
  const feet = pts.filter(p => p.y <= low + 0.04 * (high - low));
  const center = feet.length ? feet.reduce((c, p) => c.add(p), new THREE.Vector3()).divideScalar(feet.length)
    : box.getCenter(new THREE.Vector3());
  model.object.position.x -= center.x;
  model.object.position.z -= center.z;
  model.object.position.y += BASE_TOP - box.min.y;
}

function setPose(model, cfg) {
  const pose = cfg.pose ?? {};
  const roles = new UnitAnimator(model.mixerRoot, model.clips, cfg.clips); // finds clips by role/keyword
  const clipName = pose.clip ?? (roles.actions.attack ? 'attack' : 'idle');
  const action = roles.actions[clipName] ?? roles.mixer.clipAction(model.clips.find(c => c.name === clipName) ?? model.clips[0]);
  roles.mixer.stopAllAction();
  const at = pose.at ?? (clipName === 'attack' ? cfg.impact ?? 0.5 : 0.3);
  action.reset().play();
  action.time = action.getClip().duration * at;
  roles.mixer.update(0); // apply that frame to the bones; the mixer is never updated again
  liftGaze(model.object);
}

// Archery and casting frames often have the head bowed over the hands; a miniature reads better looking out.
// If the face (head -> headfront bone) points more than 12 deg below level, turn the neck and head up (split
// between them) until it points 5 deg down.
function liftGaze(root) {
  let neck = null, head = null, front = null;
  root.traverse(o => {
    if (!o.isBone) return;
    if (!neck && /neck$/i.test(o.name)) neck = o;
    if (!head && /head$/i.test(o.name)) head = o;
    if (!front && /headfront$/i.test(o.name)) front = o;
  });
  if (!head || !front) return;
  const at = b => b.getWorldPosition(new THREE.Vector3());
  const facing = () => { root.updateMatrixWorld(true); return at(front).sub(at(head)).normalize(); };
  const pitchOf = dir => Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1));
  const want = THREE.MathUtils.degToRad(-5);
  if (pitchOf(facing()) > THREE.MathUtils.degToRad(-12)) return;
  const turnUp = (bone, share) => {
    const dir = facing();
    const axis = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0));
    if (axis.lengthSq() < 1e-6) return;
    const qWorld = new THREE.Quaternion().setFromAxisAngle(axis.normalize(), (want - pitchOf(dir)) * share);
    const parentQ = bone.parent.getWorldQuaternion(new THREE.Quaternion());
    bone.quaternion.premultiply(parentQ.clone().invert().multiply(qWorld).multiply(parentQ));
  };
  if (neck) turnUp(neck, 0.5);
  turnUp(head, 1);
  root.updateMatrixWorld(true);
}

// Distinct poses to offer for a rigged model (used by the pose picker page), most useful first.
// Each is { label, clip, at } and can be stored as that unit's "pose".
// Only attack frames: 2 wind-up, 2 ready, 2 strike (just before and at impact), wind-up first. Strike and idle
// frames tend to hide the face or bend the limbs; wind-up and ready read best as miniatures.
// (Same scheme as CharacterAssetsProject/tools/pose_templates.mjs.)
export function poseOptions(model, cfg, count = 6) {
  const roles = new UnitAnimator(model.mixerRoot, model.clips, cfg.clips);
  const real = action => (action && model.clips.includes(action.getClip()) ? action.getClip() : null); // skip made-up clips
  const attack = real(roles.actions.attack), idle = real(roles.actions.idle);
  const impact = cfg.impact ?? 0.5;
  const round = v => Math.round(v * 100) / 100;
  const opts = [];
  const add = (label, clip, at) => { // skip near-duplicates
    if (clip && !opts.some(o => o.clip === clip.name && Math.abs(o.at - at) < 0.015)) opts.push({ label, clip: clip.name, at: round(at) });
  };
  if (attack) {
    for (const [label, share] of [['Wind-up', 0.5], ['Ready', 0.15], ['Strike', 0.9], ['Wind-up 2', 0.7], ['Ready 2', 0.3], ['Strike 2', 1]]) {
      add(label, attack, Math.max(0.01, impact * share));
    }
  } else { // no attack clip: whatever else the model came with (skills, bows, speeches), then its idle
    for (const c of model.clips) if (!/walk|run|hit|react|death|dead|die|idle/i.test(c.name)) add(c.name.replace(/_/g, ' '), c, 0.4);
    add('Stance', idle, 0.3);
  }
  return opts.slice(0, count);
}

// ---------- placeholder figures (used until a .glb exists for the unit) ----------

function buildPlaceholder(key, team) {
  const accent = new THREE.Color(UNITS[key].color);
  const g = new THREE.Group();
  const mat = (c, extra = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.55, ...extra });
  const skin = mat(0xe3c29b), dark = mat(0x2a2633), metal = mat(0xc9ced8, { metalness: 0.6, roughness: 0.35 });
  const add = (geo, m, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, ry, rz);
    mesh.castShadow = true;
    g.add(mesh);
    return mesh;
  };
  const humanoid = (bodyColor, scale = 1) => {
    add(new THREE.CapsuleGeometry(0.22 * scale, 0.42 * scale, 4, 12), mat(bodyColor), 0, 0.5 * scale, 0);
    add(new THREE.SphereGeometry(0.16 * scale, 16, 12), skin, 0, 1.0 * scale, 0);
    add(new THREE.TorusGeometry(0.2 * scale, 0.05, 8, 20), mat(team), 0, 0.62 * scale, 0, Math.PI / 2); // team belt
  };
  const staff = orb => {
    add(new THREE.CylinderGeometry(0.025, 0.025, 1.1, 6), mat(0x6b4a2b), 0.32, 0.6, 0.05);
    add(new THREE.SphereGeometry(0.09, 12, 10), mat(orb, { emissive: orb, emissiveIntensity: 1.5 }), 0.32, 1.18, 0.05);
  };
  let height = 1.25;
  switch (key) {
    case 'soldier':
      humanoid(0x8c97a8);
      add(new THREE.CylinderGeometry(0.28, 0.28, 0.05, 20), mat(team, { metalness: 0.3 }), -0.2, 0.6, 0.2, Math.PI / 2, 0, 0.3);
      add(new THREE.SphereGeometry(0.17, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), metal, 0, 1.04, 0);
      break;
    case 'archer':
      humanoid(0x4f7a3f);
      add(new THREE.TorusGeometry(0.42, 0.025, 6, 20, Math.PI), mat(0x7a5532), 0.3, 0.7, 0.1, 0, Math.PI / 2, Math.PI / 2);
      add(new THREE.ConeGeometry(0.18, 0.25, 12), mat(0x3c5e30), 0, 1.15, 0);
      break;
    case 'fire_mage':
    case 'ice_mage':
    case 'sorceress':
      humanoid(accent.clone().multiplyScalar(0.7));
      add(new THREE.ConeGeometry(0.3, 0.55, 16), mat(accent.clone().multiplyScalar(0.55)), 0, 0.2, 0); // robe hem
      add(new THREE.ConeGeometry(0.18, 0.42, 14), mat(accent.clone().multiplyScalar(0.6)), 0, 1.27, 0);
      staff(accent);
      height = 1.45;
      break;
    case 'assassin':
      humanoid(0x2f2a3d);
      add(new THREE.ConeGeometry(0.2, 0.35, 12), dark, 0, 1.12, -0.02);
      add(new THREE.BoxGeometry(0.04, 0.04, 0.35), metal, 0.27, 0.55, 0.15);
      add(new THREE.BoxGeometry(0.04, 0.04, 0.35), metal, -0.27, 0.55, 0.15);
      break;
    case 'golem': {
      const stone = mat(0x8a7f70, { flatShading: true, roughness: 0.95 });
      add(new THREE.DodecahedronGeometry(0.42, 0), stone, 0, 0.75, 0);
      add(new THREE.DodecahedronGeometry(0.2, 0), stone, 0, 1.3, 0.05);
      add(new THREE.DodecahedronGeometry(0.2, 0), stone, 0.5, 0.75, 0.05);
      add(new THREE.DodecahedronGeometry(0.2, 0), stone, -0.5, 0.75, 0.05);
      add(new THREE.BoxGeometry(0.2, 0.4, 0.2), stone, 0.18, 0.2, 0);
      add(new THREE.BoxGeometry(0.2, 0.4, 0.2), stone, -0.18, 0.2, 0);
      add(new THREE.SphereGeometry(0.05, 8, 6), mat(0xffb347, { emissive: 0xff8a00, emissiveIntensity: 2 }), 0, 1.33, 0.22);
      add(new THREE.TorusGeometry(0.4, 0.05, 8, 20), mat(team), 0, 0.75, 0, Math.PI / 2);
      height = 1.55;
      break;
    }
    case 'war_beast':
    case 'griffin': {
      const fur = mat(key === 'griffin' ? 0xc99a5b : 0x7a4a36);
      add(new THREE.CapsuleGeometry(0.24, 0.55, 4, 12), fur, 0, 0.55, 0, Math.PI / 2);
      add(new THREE.SphereGeometry(0.2, 14, 10), key === 'griffin' ? mat(0xf3efe6) : fur, 0, 0.75, 0.48);
      for (const [x, z] of [[0.15, 0.25], [-0.15, 0.25], [0.15, -0.25], [-0.15, -0.25]]) {
        add(new THREE.CylinderGeometry(0.05, 0.05, 0.35, 6), fur, x, 0.2, z);
      }
      add(new THREE.TorusGeometry(0.25, 0.04, 8, 20), mat(team), 0, 0.55, 0.1);
      if (key === 'griffin') {
        add(new THREE.ConeGeometry(0.07, 0.2, 8), mat(0xe8b13a), 0, 0.72, 0.72, Math.PI / 2);
        add(new THREE.BoxGeometry(0.9, 0.04, 0.4), mat(0xb98d55), 0.55, 0.8, -0.05, 0, 0, 0.35);
        add(new THREE.BoxGeometry(0.9, 0.04, 0.4), mat(0xb98d55), -0.55, 0.8, -0.05, 0, 0, -0.35);
      } else {
        add(new THREE.ConeGeometry(0.05, 0.22, 8), mat(0xeeeeee), 0.1, 0.95, 0.5, -0.4);
        add(new THREE.ConeGeometry(0.05, 0.22, 8), mat(0xeeeeee), -0.1, 0.95, 0.5, -0.4);
      }
      height = 1.05;
      break;
    }
    case 'warlord':
      humanoid(0x6b2d2d, 1.08);
      add(new THREE.TorusGeometry(0.13, 0.035, 6, 12), mat(0xe8bd57, { metalness: 0.8, roughness: 0.3 }), 0, 1.2, 0, Math.PI / 2);
      add(new THREE.PlaneGeometry(0.5, 0.75), mat(team, { side: THREE.DoubleSide }), 0, 0.6, -0.22, 0.12);
      add(new THREE.BoxGeometry(0.05, 0.8, 0.05), metal, 0.3, 0.7, 0.1);
      height = 1.4;
      break;
    case 'cleric':
      humanoid(0xf1ead4);
      add(new THREE.ConeGeometry(0.3, 0.55, 16), mat(0xe9dfc3), 0, 0.2, 0);
      add(new THREE.TorusGeometry(0.16, 0.025, 8, 24), mat(0xffe08a, { emissive: 0xffd36b, emissiveIntensity: 1.5 }), 0, 1.3, 0, Math.PI / 2);
      staff(0xffe9a8);
      break;
    case 'troll':
      humanoid(0x5d7f4c, 1.25);
      add(new THREE.CapsuleGeometry(0.08, 0.6, 4, 8), mat(0x5d7f4c), 0.36, 0.55, 0.05, 0, 0, 0.2);
      add(new THREE.CapsuleGeometry(0.08, 0.6, 4, 8), mat(0x5d7f4c), -0.36, 0.55, 0.05, 0, 0, -0.2);
      height = 1.5;
      break;
    default:
      height = LOOKS[key] ? compose(LOOKS[key], { g, add, mat, humanoid, staff, accent, team, skin, dark, metal }) : (humanoid(accent), 1.25);
  }
  g.position.y = BASE_TOP;
  return { object: g, height };
}

// Placeholder looks for units without a model, mixed from a few parts:
//   body: human | robe | big | dwarf | beast | drake | flyer | serpent | crystal
//   head: list of helm | hood | wizard | horns | crown | halo | beard | cap
//   weapon: spear | crossbow | axe | sword | staff | bow | bomb | hammer
//   shield: true for a team-colored round shield
const LOOKS = {
  // expanded roster (docs/roster)
  kunai_adept:     { body: 'human', head: ['hood'], weapon: 'kunai' },
  smoke_kunoichi:  { body: 'human', head: ['hood'], weapon: 'sword', dark: true },
  turret_tinker:   { body: 'dwarf', head: ['helm'], weapon: 'hammer', backpack: 0xc9a24a },
  toad_sage:       { body: 'toad', head: ['strawhat'] },
  hollow_revenant: { body: 'human', head: ['mask'], weapon: 'sword', dark: true },
  spirit_archer:   { body: 'human', head: ['cap'], weapon: 'bow', bowGlow: 0x7fd4ff },
  ninth_captain:   { body: 'robe', head: [], weapon: 'sword', coat: 0xf2f2f2 },
  siege_walker:    { body: 'walker' },
  jet_trooper:     { body: 'jetpack', head: ['helm'], weapon: 'rifle' },
  halo_medic:      { body: 'human', head: ['halo'], weapon: 'pistols' },
  rail_marksman:   { body: 'human', head: ['hood'], weapon: 'rifle' },
  void_stalker:    { body: 'insect' },
  chitin_charger:  { body: 'beetle' },
  star_leviathan:  { body: 'monster' },
  starcaller:      { body: 'robe', head: ['wizard'], weapon: 'staff', orb: 0xffe08a },
  runeblade:       { body: 'human', head: ['helm'], weapon: 'sword', glow: 0x7fb4ff },
  gale_dancer:     { body: 'human', head: [], weapon: 'sword' },
  mallet_mite:     { body: 'dwarf', head: ['horns', 'beard'], weapon: 'hammer' },
  lantern_kitsune: { body: 'robe', head: ['ears'], weapon: 'staff', orb: 0x6fb4ff, tails: 3 },
  tengu_windblade: { body: 'flyer', head: ['beak'], weapon: 'sword', wingColor: 0x1e1e26 },
  oni_warbreaker:  { body: 'big', head: ['horns'], weapon: 'club', skin: 0xc0392b },
  river_kappa:     { body: 'dwarf', head: ['dish'], shell: true },
  thunder_drummer: { body: 'big', head: ['horns'], drums: true },
  snow_wraith:     { body: 'robe', head: ['hood'], ghost: true },
  neon_ronin:      { body: 'human', head: ['visor'], weapon: 'sword', glow: 0xff4fd8 },
  dusk_gunslinger: { body: 'human', head: ['hat'], weapon: 'pistols' },
  tempo_dj:        { body: 'human', head: ['headphones'], backpack: 0x4fd8e0 },
  // Necromancer minions (stand-ins until they get models)
  skeleton:        { body: 'human', head: ['helm'], weapon: 'sword', shield: true },
  ghoul:           { body: 'human', head: ['horns'], weapon: 'axe' },
  bone_archer:     { body: 'human', head: ['hood'], weapon: 'crossbow' },

  pikeman:     { body: 'human', head: ['helm'], weapon: 'spear', shield: true },
  crossbowman: { body: 'human', head: ['cap'], weapon: 'crossbow' },
  berserker:   { body: 'big', head: ['horns'], weapon: 'axe' },
  paladin:     { body: 'human', head: ['helm', 'halo'], weapon: 'sword', shield: true },
  necromancer: { body: 'robe', head: ['hood'], weapon: 'staff', orb: 0x7dff9a },
  druid:       { body: 'robe', head: ['horns'], weapon: 'staff', orb: 0x9cff6b },
  scout:       { body: 'human', head: ['hood'], weapon: 'bow' },
  dwarf:       { body: 'dwarf', head: ['helm', 'beard'], weapon: 'hammer', shield: true },
  wyvern:      { body: 'drake' },
  bombardier:  { body: 'human', head: ['cap'], weapon: 'bomb' },
  monk:        { body: 'human', head: [], weapon: 'staff', orb: null },
  hydra:       { body: 'serpent' },
  valkyrie:    { body: 'flyer', head: ['helm'], weapon: 'spear', shield: true },
  shaman:      { body: 'robe', head: ['horns'], weapon: 'staff', orb: 0x7fd4ff },
  sentinel:    { body: 'crystal' },
};

function compose(look, { g, add, mat, humanoid, staff, accent, team, skin, dark, metal }) {
  const wood = mat(0x6b4a2b);
  const shade = f => accent.clone().multiplyScalar(f);
  let s = 1, headY = 1.0, height = 1.25;
  const beastBody = (fur, belly) => {
    add(new THREE.CapsuleGeometry(0.24, 0.55, 4, 12), fur, 0, 0.55, 0, Math.PI / 2);
    add(new THREE.SphereGeometry(0.19, 14, 10), belly, 0, 0.78, 0.46);
    for (const [x, z] of [[0.15, 0.25], [-0.15, 0.25], [0.15, -0.25], [-0.15, -0.25]]) add(new THREE.CylinderGeometry(0.05, 0.05, 0.35, 6), fur, x, 0.2, z);
    add(new THREE.TorusGeometry(0.25, 0.04, 8, 20), mat(team), 0, 0.55, 0.1);
  };
  const wings = (color, y = 0.85) => {
    add(new THREE.BoxGeometry(0.85, 0.04, 0.38), mat(color), 0.5, y, -0.08, 0, 0, 0.4);
    add(new THREE.BoxGeometry(0.85, 0.04, 0.38), mat(color), -0.5, y, -0.08, 0, 0, -0.4);
  };

  switch (look.body) {
    case 'beast': beastBody(mat(shade(0.7)), mat(shade(0.9))); return 1.05;
    case 'drake':
      beastBody(mat(shade(0.75)), mat(shade(0.95)));
      wings(shade(0.55));
      add(new THREE.ConeGeometry(0.06, 0.4, 6), mat(shade(0.6)), 0, 0.55, -0.55, -Math.PI / 2); // tail
      return 1.1;
    case 'serpent': {
      const scales = mat(shade(0.8), { roughness: 0.4 });
      add(new THREE.SphereGeometry(0.42, 16, 12), scales, 0, 0.35, 0).scale.set(1, 0.7, 1.2);
      add(new THREE.TorusGeometry(0.4, 0.05, 8, 24), mat(team), 0, 0.3, 0, Math.PI / 2);
      [-0.22, 0, 0.22].forEach((x, i) => {
        add(new THREE.CylinderGeometry(0.07, 0.1, 0.7, 8), scales, x, 0.85, 0.2, 0.35, 0, -x * 1.5);
        add(new THREE.SphereGeometry(0.13, 12, 10), scales, x * 1.6, 1.2 + (i === 1 ? 0.1 : 0), 0.32).scale.set(1, 0.8, 1.4);
      });
      return 1.4;
    }
    case 'crystal': {
      const gem = mat(accent, { emissive: accent, emissiveIntensity: 0.4, roughness: 0.15, metalness: 0.2, flatShading: true });
      add(new THREE.OctahedronGeometry(0.38, 0), gem, 0, 0.75, 0).scale.set(1, 1.5, 1);
      add(new THREE.OctahedronGeometry(0.16, 0), gem, 0.42, 0.75, 0).scale.set(1, 1.6, 1);
      add(new THREE.OctahedronGeometry(0.16, 0), gem, -0.42, 0.75, 0).scale.set(1, 1.6, 1);
      add(new THREE.OctahedronGeometry(0.13, 0), gem, 0, 1.45, 0);
      add(new THREE.TorusGeometry(0.3, 0.05, 8, 20), mat(team), 0, 0.4, 0, Math.PI / 2);
      return 1.6;
    }
    case 'big': s = 1.2; humanoid(look.skin ?? shade(0.75), s); headY = 1.0 * s; height = 1.5; break;
    case 'toad': {
      const hide = mat(shade(0.85), { roughness: 0.7 });
      add(new THREE.SphereGeometry(0.45, 18, 14), hide, 0, 0.45, 0).scale.set(1.15, 0.8, 1);
      add(new THREE.SphereGeometry(0.11, 12, 10), mat(0xf2e27a), 0.2, 0.86, 0.3);
      add(new THREE.SphereGeometry(0.11, 12, 10), mat(0xf2e27a), -0.2, 0.86, 0.3);
      for (const x of [0.38, -0.38]) add(new THREE.SphereGeometry(0.16, 12, 10), hide, x, 0.15, 0.25).scale.set(1, 0.6, 1.4);
      add(new THREE.TorusGeometry(0.42, 0.05, 8, 24), mat(team), 0, 0.4, 0, Math.PI / 2);
      headY = 0.78; height = 1.2;
      break;
    }
    case 'walker': {
      const plate = mat(shade(0.8), { metalness: 0.5, roughness: 0.4 });
      add(new THREE.BoxGeometry(0.6, 0.32, 0.7), plate, 0, 0.75, 0);
      for (const [x, z] of [[0.38, 0.3], [-0.38, 0.3], [0.38, -0.3], [-0.38, -0.3]]) {
        add(new THREE.CylinderGeometry(0.04, 0.05, 0.75, 6), metal, x, 0.37, z, z * 0.6, 0, -x * 0.6);
      }
      add(new THREE.BoxGeometry(0.2, 0.25, 0.4), plate, 0.22, 1.02, -0.05);
      add(new THREE.BoxGeometry(0.2, 0.25, 0.4), plate, -0.22, 1.02, -0.05);
      add(new THREE.SphereGeometry(0.08, 12, 10), mat(0x7fe8ff, { emissive: 0x4fd8ff, emissiveIntensity: 2 }), 0, 0.78, 0.36);
      add(new THREE.BoxGeometry(0.62, 0.06, 0.72), mat(team), 0, 0.6, 0);
      return 1.25;
    }
    case 'jetpack':
      humanoid(shade(0.8));
      add(new THREE.BoxGeometry(0.34, 0.4, 0.18), metal, 0, 0.65, -0.24);
      add(new THREE.CylinderGeometry(0.06, 0.08, 0.2, 10), mat(0x444444), 0.1, 0.4, -0.26);
      add(new THREE.CylinderGeometry(0.06, 0.08, 0.2, 10), mat(0x444444), -0.1, 0.4, -0.26);
      add(new THREE.ConeGeometry(0.06, 0.2, 8), mat(0xffb347, { emissive: 0xff7a00, emissiveIntensity: 2 }), 0.1, 0.22, -0.26, Math.PI);
      add(new THREE.ConeGeometry(0.06, 0.2, 8), mat(0xffb347, { emissive: 0xff7a00, emissiveIntensity: 2 }), -0.1, 0.22, -0.26, Math.PI);
      break;
    case 'insect': {
      const chitin = mat(shade(0.75), { roughness: 0.35 });
      add(new THREE.CapsuleGeometry(0.13, 0.5, 4, 10), chitin, 0, 0.7, 0, 0.35);
      add(new THREE.SphereGeometry(0.13, 12, 10), chitin, 0, 1.12, 0.12).scale.set(1, 0.8, 1.3);
      add(new THREE.SphereGeometry(0.035, 8, 6), mat(0x8dff9a, { emissive: 0x5fd08a, emissiveIntensity: 2 }), 0.06, 1.15, 0.27);
      add(new THREE.SphereGeometry(0.035, 8, 6), mat(0x8dff9a, { emissive: 0x5fd08a, emissiveIntensity: 2 }), -0.06, 1.15, 0.27);
      for (const x of [0.18, -0.18]) {
        add(new THREE.CylinderGeometry(0.03, 0.03, 0.4, 6), chitin, x, 0.9, 0.15, -0.9, 0, 0);
        add(new THREE.ConeGeometry(0.04, 0.45, 6), chitin, x, 0.85, 0.42, 0.6, 0, 0); // scythe
        add(new THREE.CylinderGeometry(0.025, 0.02, 0.55, 6), chitin, x * 1.2, 0.25, 0, 0, 0, x * 1.2);
      }
      add(new THREE.TorusGeometry(0.15, 0.04, 8, 20), mat(team), 0, 0.6, 0, Math.PI / 2);
      return 1.3;
    }
    case 'beetle': {
      const shell = mat(shade(0.75), { roughness: 0.3, metalness: 0.2 });
      add(new THREE.SphereGeometry(0.42, 18, 12), shell, 0, 0.45, -0.05).scale.set(1, 0.7, 1.3);
      add(new THREE.SphereGeometry(0.2, 14, 10), shell, 0, 0.42, 0.48);
      add(new THREE.ConeGeometry(0.08, 0.45, 8), mat(0xe8e0c8), 0, 0.62, 0.66, 0.9);
      for (let i = 0; i < 3; i++) for (const x of [0.36, -0.36]) add(new THREE.CylinderGeometry(0.035, 0.03, 0.35, 6), shell, x, 0.18, -0.25 + i * 0.25, 0, 0, x * 1.2);
      add(new THREE.TorusGeometry(0.38, 0.045, 8, 24), mat(team), 0, 0.42, -0.05, Math.PI / 2);
      return 1.0;
    }
    case 'monster': {
      const hide = mat(shade(0.6), { roughness: 0.6 });
      s = 1.5; humanoid(shade(0.55), s);
      add(new THREE.SphereGeometry(0.3, 16, 12), hide, 0, 1.55, 0.05);
      for (const [x, y] of [[0.12, 1.65], [-0.12, 1.65], [0, 1.5], [0.18, 1.5], [-0.18, 1.5]]) {
        add(new THREE.SphereGeometry(0.045, 8, 6), mat(0xfff3a0, { emissive: 0xffd84a, emissiveIntensity: 2 }), x, y, 0.3);
      }
      for (let i = 0; i < 4; i++) add(new THREE.ConeGeometry(0.07, 0.35, 6), mat(0xb8a0ff, { emissive: 0x6b3fa0, emissiveIntensity: 0.6, flatShading: true }), 0, 1.25 - i * 0.18, -0.35, -0.6);
      add(new THREE.CapsuleGeometry(0.09, 0.7, 4, 8), hide, 0.55, 1.0, 0.1, 0, 0, 0.4);
      add(new THREE.CapsuleGeometry(0.09, 0.7, 4, 8), hide, -0.55, 1.0, 0.1, 0, 0, -0.4);
      return 1.95;
    }
    case 'dwarf':
      s = 0.85; humanoid(shade(0.8), s);
      add(new THREE.CapsuleGeometry(0.28 * s, 0.2, 4, 12), mat(shade(0.7)), 0, 0.45, 0); // stocky
      headY = 1.0 * s; height = 1.1; break;
    case 'robe':
      humanoid(shade(0.7));
      add(new THREE.ConeGeometry(0.3, 0.55, 16), mat(shade(0.5)), 0, 0.2, 0);
      break;
    case 'flyer':
      humanoid(shade(0.85));
      wings(look.wingColor ?? 0xf2f2f2, 0.75);
      break;
    default: humanoid(shade(0.85));
  }

  for (const h of look.head ?? []) {
    if (h === 'mask') add(new THREE.SphereGeometry(0.165 * s, 16, 12, -Math.PI / 2, Math.PI), mat(0xf4f0e6), 0, headY, 0.01);
    if (h === 'ears') {
      add(new THREE.ConeGeometry(0.06, 0.18, 6), mat(accent), 0.1, headY + 0.17, 0, 0, 0, -0.3);
      add(new THREE.ConeGeometry(0.06, 0.18, 6), mat(accent), -0.1, headY + 0.17, 0, 0, 0, 0.3);
    }
    if (h === 'beak') add(new THREE.ConeGeometry(0.06, 0.22, 8), mat(0xd9a03a), 0, headY - 0.02, 0.2, Math.PI / 2);
    if (h === 'dish') add(new THREE.CylinderGeometry(0.13, 0.1, 0.04, 16), mat(0x9fd8f4, { roughness: 0.1 }), 0, headY + 0.16, 0);
    if (h === 'hat') {
      add(new THREE.CylinderGeometry(0.3, 0.3, 0.03, 20), mat(0x5a3d26), 0, headY + 0.1, 0);
      add(new THREE.CylinderGeometry(0.13, 0.15, 0.16, 16), mat(0x5a3d26), 0, headY + 0.18, 0);
    }
    if (h === 'strawhat') add(new THREE.ConeGeometry(0.42, 0.18, 20), mat(0xd9c27e), 0, headY + 0.12, 0);
    if (h === 'visor') add(new THREE.BoxGeometry(0.3 * s, 0.06, 0.08), mat(0xff4fd8, { emissive: 0xff4fd8, emissiveIntensity: 1.5 }), 0, headY + 0.02, 0.13);
    if (h === 'headphones') {
      add(new THREE.TorusGeometry(0.18, 0.025, 6, 16, Math.PI), mat(0x222222), 0, headY + 0.02, 0, 0, Math.PI / 2, 0);
      add(new THREE.CylinderGeometry(0.07, 0.07, 0.05, 12), mat(0x4fd8e0, { emissive: 0x4fd8e0, emissiveIntensity: 0.8 }), 0.18, headY, 0, 0, 0, Math.PI / 2);
      add(new THREE.CylinderGeometry(0.07, 0.07, 0.05, 12), mat(0x4fd8e0, { emissive: 0x4fd8e0, emissiveIntensity: 0.8 }), -0.18, headY, 0, 0, 0, Math.PI / 2);
    }
    if (h === 'helm') add(new THREE.SphereGeometry(0.17 * s, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), metal, 0, headY + 0.04 * s, 0);
    if (h === 'cap') add(new THREE.CylinderGeometry(0.17 * s, 0.17 * s, 0.07, 16), mat(shade(0.5)), 0, headY + 0.1 * s, 0);
    if (h === 'hood') add(new THREE.ConeGeometry(0.2 * s, 0.36 * s, 12), dark, 0, headY + 0.12 * s, -0.02);
    if (h === 'wizard') add(new THREE.ConeGeometry(0.18, 0.42, 14), mat(shade(0.6)), 0, headY + 0.27, 0);
    if (h === 'horns') {
      add(new THREE.ConeGeometry(0.04 * s, 0.24 * s, 6), mat(0xe8dcc0), 0.12 * s, headY + 0.14 * s, 0, 0, 0, -0.6);
      add(new THREE.ConeGeometry(0.04 * s, 0.24 * s, 6), mat(0xe8dcc0), -0.12 * s, headY + 0.14 * s, 0, 0, 0, 0.6);
    }
    if (h === 'crown') add(new THREE.TorusGeometry(0.13, 0.035, 6, 12), mat(0xe8bd57, { metalness: 0.8, roughness: 0.3 }), 0, headY + 0.18, 0, Math.PI / 2);
    if (h === 'halo') add(new THREE.TorusGeometry(0.16, 0.022, 8, 24), mat(0xffe08a, { emissive: 0xffd36b, emissiveIntensity: 1.5 }), 0, headY + 0.3, 0, Math.PI / 2);
    if (h === 'beard') add(new THREE.ConeGeometry(0.12 * s, 0.3 * s, 10), mat(0x8a4b22), 0, headY - 0.17 * s, 0.1, Math.PI, 0, 0);
  }

  const hx = 0.3 * s, hy = 0.62 * s, hz = 0.08; // weapon hand
  switch (look.weapon) {
    case 'kunai':
      for (const x of [hx, -hx]) add(new THREE.ConeGeometry(0.03, 0.22, 4), metal, x, hy + 0.05, hz + 0.1, Math.PI / 2);
      add(new THREE.BoxGeometry(0.4, 0.04, 0.03), mat(0x5a3d26), 0, 0.82, 0.16, 0, 0, 0.7); // bandolier
      break;
    case 'rifle':
      add(new THREE.BoxGeometry(0.07, 0.09, 0.85), mat(0x3a3f4a, { metalness: 0.5 }), hx, hy + 0.05, 0.25);
      add(new THREE.CylinderGeometry(0.03, 0.03, 0.4, 8), mat(0x7fe8ff, { emissive: 0x4fd8ff, emissiveIntensity: 1.2 }), hx, hy + 0.05, 0.62, Math.PI / 2);
      break;
    case 'pistols':
      for (const x of [hx, -hx]) {
        add(new THREE.BoxGeometry(0.05, 0.07, 0.22), mat(0x3a3f4a, { metalness: 0.6 }), x, hy, hz + 0.12);
        add(new THREE.BoxGeometry(0.04, 0.1, 0.05), mat(0x5a3d26), x, hy - 0.06, hz + 0.04);
      }
      break;
    case 'club':
      add(new THREE.CylinderGeometry(0.06, 0.12, 0.9, 8), mat(0x3a3a3a, { metalness: 0.6 }), hx + 0.05, hy + 0.35, hz, 0, 0, -0.2);
      break;
    case 'spear':
      add(new THREE.CylinderGeometry(0.02, 0.02, 1.5, 6), wood, hx, 0.75, hz);
      add(new THREE.ConeGeometry(0.05, 0.18, 6), metal, hx, 1.58, hz);
      height = Math.max(height, 1.6);
      break;
    case 'crossbow':
      add(new THREE.BoxGeometry(0.07, 0.07, 0.5), wood, hx, hy, 0.2);
      add(new THREE.BoxGeometry(0.45, 0.03, 0.04), metal, hx, hy, 0.4);
      break;
    case 'axe':
      add(new THREE.CylinderGeometry(0.025, 0.025, 0.8, 6), wood, hx, hy + 0.15, hz);
      add(new THREE.BoxGeometry(0.05, 0.22, 0.18), metal, hx, hy + 0.48, hz + 0.08);
      add(new THREE.CylinderGeometry(0.025, 0.025, 0.8, 6), wood, -hx, hy + 0.15, hz);
      add(new THREE.BoxGeometry(0.05, 0.22, 0.18), metal, -hx, hy + 0.48, hz + 0.08);
      break;
    case 'hammer':
      add(new THREE.CylinderGeometry(0.025, 0.025, 0.7, 6), wood, hx, hy + 0.12, hz);
      add(new THREE.BoxGeometry(0.2, 0.14, 0.14), metal, hx, hy + 0.45, hz);
      break;
    case 'sword':
      add(new THREE.BoxGeometry(0.05, 0.62, 0.02), metal, hx, hy + 0.32, hz);
      add(new THREE.BoxGeometry(0.2, 0.03, 0.05), mat(0xe8bd57, { metalness: 0.7 }), hx, hy + 0.02, hz);
      break;
    case 'bow':
      add(new THREE.TorusGeometry(0.4, 0.022, 6, 20, Math.PI), wood, hx, 0.72, 0.1, 0, Math.PI / 2, Math.PI / 2);
      break;
    case 'bomb':
      add(new THREE.SphereGeometry(0.11, 12, 10), mat(0x222222, { metalness: 0.4 }), hx, hy, 0.15);
      add(new THREE.CylinderGeometry(0.01, 0.01, 0.1, 4), mat(0xffb347, { emissive: 0xff8a00, emissiveIntensity: 2 }), hx, hy + 0.14, 0.15);
      add(new THREE.SphereGeometry(0.1, 12, 10), mat(0x222222, { metalness: 0.4 }), -0.18, 0.42, 0.2); // spare on the belt
      break;
    case 'staff':
      if (look.orb === null) add(new THREE.CylinderGeometry(0.025, 0.025, 1.3, 6), wood, hx, 0.65, hz, 0, 0, 0.15);
      else staff(look.orb ?? accent);
      height = Math.max(height, 1.4);
      break;
    default: break;
  }
  if (look.glow) { // glowing blade overlay
    add(new THREE.BoxGeometry(0.03, 0.6, 0.03), mat(look.glow, { emissive: look.glow, emissiveIntensity: 2 }), hx, hy + 0.32, hz + 0.02);
  }
  if (look.bowGlow) add(new THREE.TorusGeometry(0.4, 0.015, 6, 20, Math.PI), mat(look.bowGlow, { emissive: look.bowGlow, emissiveIntensity: 2 }), hx, 0.72, 0.1, 0, Math.PI / 2, Math.PI / 2);
  if (look.coat) add(new THREE.CylinderGeometry(0.25, 0.32, 0.8, 16, 1, true), mat(look.coat, { side: THREE.DoubleSide }), 0, 0.5, 0);
  if (look.shell) add(new THREE.SphereGeometry(0.3, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x5f7f3a, { roughness: 0.5 }), 0, 0.5, -0.12, -Math.PI / 2);
  if (look.backpack) add(new THREE.BoxGeometry(0.32, 0.36, 0.18), mat(look.backpack, { emissive: look.backpack, emissiveIntensity: 0.5 }), 0, 0.65, -0.24);
  if (look.drums) {
    for (let i = 0; i < 5; i++) {
      const a = Math.PI * (0.15 + i * 0.175);
      add(new THREE.CylinderGeometry(0.11, 0.11, 0.09, 14), mat(0x8b2f2f), Math.cos(a) * 0.5, 0.95 + Math.sin(a) * 0.35, -0.3, Math.PI / 2);
    }
  }
  if (look.tails) {
    for (let i = 0; i < look.tails; i++) add(new THREE.CapsuleGeometry(0.06, 0.35, 4, 8), mat(0xf2e6d8), (i - (look.tails - 1) / 2) * 0.14, 0.4, -0.3, -0.9, 0, (i - 1) * 0.3);
  }
  if (look.ghost) g.traverse(o => { if (o.material) { o.material.transparent = true; o.material.opacity = 0.75; o.material.emissive?.set(0x9fd8f4); if (o.material.emissiveIntensity !== undefined) o.material.emissiveIntensity = 0.25; } });
  if (look.dark) g.traverse(o => { if (o.material && o.material !== skin) o.material.color?.multiplyScalar(0.45); });
  if (look.shield) add(new THREE.CylinderGeometry(0.24 * s, 0.24 * s, 0.05, 20), mat(team, { metalness: 0.3 }), -0.22 * s, 0.6 * s, 0.2, Math.PI / 2, 0, 0.3);
  return height;
}

// ---------- health bar styles (all draw into the BAR_W x BAR_H canvas) ----------
const hpColors = f => (f > 0.5 ? ['#7dffb0', '#2fbf6a'] : f > 0.25 ? ['#ffe08a', '#d9a02a'] : ['#ff8a7a', '#d93a3a']);
const hexPath = (g, cx, cy, r) => {
  g.beginPath();
  for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + (i * Math.PI) / 3; g[i ? 'lineTo' : 'moveTo'](cx + r * Math.cos(a), cy + r * Math.sin(a)); }
  g.closePath();
};

function drawPill(g, unit, team, ghost) {
  const W = BAR_W, H = BAR_H;
  g.clearRect(0, 0, W, H);
  const numW = 50, x0 = 4, y0 = 8, w = W - numW - x0 - 6, h = H - 16, r = h / 2;
  const pill = (x, y, ww, hh, rr) => { g.beginPath(); g.roundRect(x, y, ww, hh, rr); };
  // backing and border
  pill(x0, y0, w, h, r);
  g.fillStyle = 'rgba(6, 8, 14, 0.92)';
  g.fill();
  g.lineWidth = 3;
  g.strokeStyle = 'rgba(255, 255, 255, 0.28)';
  g.stroke();
  // fill
  const f = Math.max(0, unit.hp / unit.maxHp);
  const ix = x0 + 3, iy = y0 + 3, iw = w - 6, ih = h - 6;
  g.save();
  pill(ix, iy, iw, ih, ih / 2);
  g.clip();
  const [c1, c2] = f > 0.5 ? ['#7dffb0', '#2fbf6a'] : f > 0.25 ? ['#ffe08a', '#d9a02a'] : ['#ff8a7a', '#d93a3a'];
  if (ghost > f) { g.fillStyle = 'rgba(255, 245, 230, 0.9)'; g.fillRect(ix, iy, iw * ghost, ih); }
  const grad = g.createLinearGradient(0, iy, 0, iy + ih);
  grad.addColorStop(0, c1);
  grad.addColorStop(1, c2);
  g.fillStyle = grad;
  g.fillRect(ix, iy, iw * f, ih);
  g.fillStyle = 'rgba(255, 255, 255, 0.22)'; // glossy top edge
  g.fillRect(ix, iy, iw * f, ih * 0.35);
  // segment gaps, one per health point (skipped when there would be too many to read)
  if (unit.maxHp <= 16) {
    g.fillStyle = 'rgba(6, 8, 14, 0.85)';
    for (let i = 1; i < unit.maxHp; i++) g.fillRect(Math.round(ix + iw * i / unit.maxHp) - 1, iy, 2, ih);
  }
  g.restore();
  // team cap
  g.beginPath();
  g.arc(x0 + r, y0 + r, r - 1, Math.PI / 2, Math.PI * 1.5);
  g.closePath();
  g.fillStyle = team;
  g.fill();
  // number
  g.font = '700 30px "Segoe UI", sans-serif';
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.lineWidth = 6;
  g.strokeStyle = 'rgba(6, 8, 14, 0.9)';
  g.strokeText(String(unit.hp), W - numW + 2, H / 2 + 1);
  g.fillStyle = f > 0.5 ? '#eafff2' : f > 0.25 ? '#ffe9b0' : '#ffb0a8';
  g.fillText(String(unit.hp), W - numW + 2, H / 2 + 1);
}

// Hex pips: one little hexagon per health point, like wound markers on a miniature's card.
// Full = team colour with a bright core, lost = hollow, just lost = pale (draining).
function drawPips(g, unit, team, ghost) {
  const n = unit.maxHp, rows = n > 7 ? 2 : 1, perRow = Math.ceil(n / rows);
  const r = Math.min(11.5, (BAR_W - 8) / (perRow * 1.8)), step = r * 1.8; // same pip size for every unit
  const width = step * (perRow - 1);
  const lost = Math.round(ghost * n);
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / perRow), col = i % perRow;
    const cx = BAR_W / 2 - width / 2 + col * step + (row ? step / 2 : 0);
    const cy = rows === 1 ? BAR_H / 2 : 11.5 + row * 21;
    hexPath(g, cx, cy, r);
    g.fillStyle = 'rgba(6, 8, 14, 0.9)';
    g.fill();
    hexPath(g, cx, cy, r - 2.5);
    if (i < unit.hp) {
      const grad = g.createLinearGradient(0, cy - r, 0, cy + r);
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.35, team);
      grad.addColorStop(1, team);
      g.fillStyle = grad;
      g.fill();
    } else if (i < lost) {
      g.fillStyle = 'rgba(255, 240, 220, 0.85)';
      g.fill();
    } else {
      g.lineWidth = 2;
      g.strokeStyle = 'rgba(255, 255, 255, 0.25)';
      g.stroke();
    }
  }
}

// Shield plate: a team-coloured shield badge with the health number, and a slim segmented bar.
function drawPlate(g, unit, team, ghost) {
  const f = Math.max(0, unit.hp / unit.maxHp);
  // badge
  const bx = 6, by = 3, bw = 34, bh = BAR_H - 6;
  g.beginPath();
  g.moveTo(bx, by); g.lineTo(bx + bw, by); g.lineTo(bx + bw, by + bh * 0.6);
  g.quadraticCurveTo(bx + bw, by + bh * 0.9, bx + bw / 2, by + bh);
  g.quadraticCurveTo(bx, by + bh * 0.9, bx, by + bh * 0.6);
  g.closePath();
  g.fillStyle = team;
  g.fill();
  g.lineWidth = 3;
  g.strokeStyle = 'rgba(6, 8, 14, 0.9)';
  g.stroke();
  g.font = '800 24px "Segoe UI", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 5;
  g.strokeText(String(unit.hp), bx + bw / 2, by + bh * 0.45);
  g.fillStyle = '#ffffff';
  g.fillText(String(unit.hp), bx + bw / 2, by + bh * 0.45);
  // bar
  const x = bx + bw + 6, y = BAR_H / 2 - 7, w = BAR_W - x - 8, h = 14;
  g.fillStyle = 'rgba(6, 8, 14, 0.9)';
  g.beginPath(); g.roundRect(x, y, w, h, 3); g.fill();
  if (ghost > f) { g.fillStyle = 'rgba(255, 240, 220, 0.85)'; g.fillRect(x + 2, y + 2, (w - 4) * ghost, h - 4); }
  const [c1, c2] = hpColors(f);
  const grad = g.createLinearGradient(0, y, 0, y + h);
  grad.addColorStop(0, c1); grad.addColorStop(1, c2);
  g.fillStyle = grad;
  g.fillRect(x + 2, y + 2, (w - 4) * f, h - 4);
  if (unit.maxHp <= 16) {
    g.fillStyle = 'rgba(6, 8, 14, 0.9)';
    for (let i = 1; i < unit.maxHp; i++) g.fillRect(Math.round(x + 2 + (w - 4) * i / unit.maxHp) - 1, y + 2, 2, h - 4);
  }
}

// Minimal: a thin, borderless line in the team colour over a faint track, number tucked at the end.
function drawMinimal(g, unit, team, ghost) {
  const f = Math.max(0, unit.hp / unit.maxHp);
  const x = 8, y = BAR_H / 2 - 4, w = BAR_W - 60, h = 8;
  g.fillStyle = 'rgba(0, 0, 0, 0.55)';
  g.beginPath(); g.roundRect(x - 2, y - 2, w + 4, h + 4, 6); g.fill();
  g.fillStyle = 'rgba(255, 255, 255, 0.12)';
  g.beginPath(); g.roundRect(x, y, w, h, 4); g.fill();
  if (ghost > f) { g.fillStyle = 'rgba(255, 240, 220, 0.8)'; g.beginPath(); g.roundRect(x, y, w * ghost, h, 4); g.fill(); }
  g.fillStyle = team;
  g.beginPath(); g.roundRect(x, y, Math.max(h, w * f), h, 4); g.fill();
  g.font = '700 26px "Segoe UI", sans-serif';
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.lineWidth = 5;
  g.strokeStyle = 'rgba(0, 0, 0, 0.7)';
  g.strokeText(String(unit.hp), x + w + 10, BAR_H / 2 + 1);
  g.fillStyle = f > 0.25 ? '#ffffff' : '#ff9a8a';
  g.fillText(String(unit.hp), x + w + 10, BAR_H / 2 + 1);
}

export const BAR_STYLES = { pips: drawPips, pill: drawPill, plate: drawPlate, minimal: drawMinimal };

// A barrier (Sacred Barrier's shield) on top of any style: a pale-blue glow around the bar and a shield
// badge with the points it will soak up, over the right end.
function drawBarrier(g, amount) {
  g.save();
  g.lineWidth = 4;
  g.strokeStyle = 'rgba(140, 210, 255, 0.95)';
  g.shadowColor = 'rgba(140, 210, 255, 0.9)';
  g.shadowBlur = 8;
  g.beginPath(); g.roundRect(3, 3, BAR_W - 6, BAR_H - 6, 12); g.stroke();
  g.restore();
  const x = BAR_W - 40, y = 2, w = 36, h = BAR_H - 4;
  g.beginPath();
  g.moveTo(x, y); g.lineTo(x + w, y); g.lineTo(x + w, y + h * 0.55);
  g.quadraticCurveTo(x + w, y + h * 0.9, x + w / 2, y + h);
  g.quadraticCurveTo(x, y + h * 0.9, x, y + h * 0.55);
  g.closePath();
  g.fillStyle = '#5fb8ff';
  g.fill();
  g.lineWidth = 3;
  g.strokeStyle = 'rgba(6, 8, 14, 0.9)';
  g.stroke();
  g.font = '800 22px "Segoe UI", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#ffffff';
  g.fillText(String(amount), x + w / 2, y + h * 0.45);
}
