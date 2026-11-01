// Basic attack visuals, by weapon: arrows and bolts that fly true, gun tracers with muzzle flashes,
// a railgun beam, missiles, lobbed bombs, spinning kunai and magic orbs for ranged attacks; slashes,
// heavy cleaves, spear thrusts, claw rakes and blunt smashes for melee.
//   const style = attackStyle(unitKey);
//   await fireRanged(style, from, to, color);   // resolves on impact
//   await meleeHit(style, attackerPos, targetPos, color);
// Signature skills have their own effects in skillFx.js.
import * as THREE from 'three';
import { tween, wait, ease, glow, burst, projectile, fxScene, fxCamera } from './fx.js';

// Which effect each unit's basic attack uses. Anything not listed: ranged = orb, melee = slash.
const STYLE = {
  archer: 'arrow', scout: 'arrow', bone_archer: 'arrow', spirit_archer: 'spiritArrow',
  crossbowman: 'bolt',
  dusk_gunslinger: 'pistols', halo_medic: 'pistols', jet_trooper: 'rifle', turret_tinker: 'rifle',
  rail_marksman: 'rail', siege_walker: 'missile', bombardier: 'bomb', kunai_adept: 'kunai',
  berserker: 'cleave', ghoul: 'claw', hollow_revenant: 'cleave',
  pikeman: 'thrust', valkyrie: 'thrust',
  war_beast: 'claw', griffin: 'claw', wyvern: 'claw', hydra: 'claw', troll: 'claw', chitin_charger: 'claw',
  star_leviathan: 'claw', void_stalker: 'claw', river_kappa: 'claw',
  golem: 'smash', sentinel: 'smash', oni_warbreaker: 'smash', mallet_mite: 'smash', dwarf: 'smash',
  toad_sage: 'smash', soldier: 'smash', cleric: 'smash', monk: 'smash', thunder_drummer: 'smash',
};
export const attackStyle = key => STYLE[key] ?? null;

const add = (...o) => fxScene().add(...o);
const remove = o => { fxScene().remove(o); o.traverse?.(c => { if (!c.isSprite) c.geometry?.dispose(); c.material?.dispose(); }); };
const additive = (color, opacity = 1) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false,
  blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

// Little sparks bursting out of an impact point.
function sparks(at, color, n = 10, speed = 2.6) {
  const parts = Array.from({ length: n }, () => {
    const s = glow(color, 0.12 + Math.random() * 0.1);
    s.position.copy(at);
    s.userData.v = v3(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.5 + Math.random() * 0.5));
    add(s);
    return s;
  });
  let last = 0;
  return tween(0.35, t => {
    const dt = (t - last) * 0.35; last = t;
    for (const s of parts) { s.position.addScaledVector(s.userData.v, dt); s.userData.v.y -= 6 * dt; s.material.opacity = 1 - t; }
  }).then(() => parts.forEach(remove));
}

// Fly an object from a to b (arc = peak height as a fraction of distance), pointing along its path.
async function fly(obj, a, b, { speed = 16, arc = 0, spin = 0, trail = null } = {}) {
  add(obj);
  const dist = a.distanceTo(b), dur = Math.max(0.12, dist / speed);
  const pos = t => v3().lerpVectors(a, b, t).add(v3(0, Math.sin(Math.PI * t) * arc * dist, 0));
  const dropped = [];
  let lastDrop = 0;
  await tween(dur, t => {
    const p = pos(t), ahead = pos(Math.min(1, t + 0.02));
    obj.position.copy(p);
    if (ahead.distanceToSquared(p) > 1e-8) obj.lookAt(ahead);
    if (spin) obj.rotateZ(spin * t * 40);
    if (trail && t - lastDrop > 0.06) {
      lastDrop = t;
      const s = glow(trail, 0.22);
      s.position.copy(p);
      add(s);
      dropped.push(s);
    }
    dropped.forEach(s => { s.material.opacity *= 0.88; });
  });
  remove(obj);
  dropped.forEach(remove);
}

function arrowMesh(color = 0x8a6a45, glowColor = null) {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color, roughness: 0.7 });
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.7, 6).rotateX(Math.PI / 2), wood));
  g.add(new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.12, 6).rotateX(Math.PI / 2).translate(0, 0, 0.4),
    new THREE.MeshStandardMaterial({ color: 0xb8bcc4, metalness: 0.7, roughness: 0.3 })));
  for (const r of [0, Math.PI / 2]) {
    const fin = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.14), new THREE.MeshStandardMaterial({ color: 0xe8e2d0, side: THREE.DoubleSide }));
    fin.position.z = -0.3; fin.rotation.set(0, Math.PI / 2, r);
    g.add(fin);
  }
  if (glowColor) g.add(glow(glowColor, 0.5));
  return g;
}

function muzzle(at, color = 0xffd27a) {
  const f = glow(color, 0.7);
  f.position.copy(at);
  add(f);
  return tween(0.12, t => { f.material.opacity = 1 - t; f.scale.setScalar(0.7 + t * 0.5); }).then(() => remove(f));
}

// A fast tracer: a short bright streak racing to the target.
async function tracer(a, b, color = 0xffe7a0) {
  const len = 0.6;
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, len, 6).rotateX(Math.PI / 2), additive(color));
  const head = glow(0xffffff, 0.25);
  const g = new THREE.Group(); g.add(m, head);
  muzzle(a);
  await fly(g, a, b, { speed: 45 });
  sparks(b, color, 6, 2);
}

// ---------- ranged ----------
export async function fireRanged(style, from, to, color) {
  switch (style) {
    case 'arrow': await fly(arrowMesh(), from, to, { speed: 15, arc: 0.12 }); sparks(to, 0xd8c8a0, 6, 1.6); return;
    case 'spiritArrow': await fly(arrowMesh(0x9fd8ff, 0x9fd8ff), from, to, { speed: 17, arc: 0.08, trail: 0x9fd8ff }); burst(to, 0x9fd8ff, 0.7); return;
    case 'bolt': await fly(arrowMesh(0x5a4a3a), from, to, { speed: 24, arc: 0.03 }); sparks(to, 0xd8c8a0, 8, 2); return;
    case 'pistols': await tracer(from, to); await wait(0.08); await tracer(from.clone().add(v3(0.1, 0, 0)), to.clone().add(v3(0, 0.1, 0))); return;
    case 'rifle': for (let i = 0; i < 3; i++) { tracer(from, to.clone().add(v3((Math.random() - 0.5) * 0.2, (Math.random() - 0.5) * 0.2, 0))); await wait(0.07); } await wait(0.12); return;
    case 'rail': return railBeam(from, to);
    case 'missile': {
      const m = new THREE.Group();
      m.add(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.35, 8).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x8a8f99, metalness: 0.6 })));
      const flame = glow(0xff9a3a, 0.4); flame.position.z = -0.25; m.add(flame);
      await fly(m, from, to, { speed: 11, arc: 0.3, trail: 0xbfbfbf });
      burst(to, 0xff7a2a, 1.4); sparks(to, 0xffb05a, 14, 3);
      return;
    }
    case 'bomb': {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), new THREE.MeshStandardMaterial({ color: 0x2a2a30, roughness: 0.6 }));
      const fuse = glow(0xffc04a, 0.25); fuse.position.y = 0.12; b.add(fuse);
      await fly(b, from, to, { speed: 8, arc: 0.45, spin: 0.2 });
      burst(to, 0xff8a3a, 1.3); sparks(to, 0xffc04a, 14, 3);
      return;
    }
    case 'kunai': {
      const throwOne = async off => {
        const k = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.3, 4).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xc9ced8, metalness: 0.8, roughness: 0.25 }));
        await fly(k, from.clone().add(off), to.clone().add(off.multiplyScalar(0.3)), { speed: 20, arc: 0.05, spin: 1 });
        sparks(to, 0xdfe6ff, 4, 1.5);
      };
      throwOne(v3(0.12, 0.05, 0)); await wait(0.06); await throwOne(v3(-0.12, -0.05, 0));
      return;
    }
    default: await projectile(from, to, color, { size: 0.5, arc: 0.4 }); burst(to, color, 0.7); // magic orb
  }
}

async function railBeam(a, b) {
  const len = a.distanceTo(b);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1, 8).translate(0, 0.5, 0).rotateX(Math.PI / 2), additive(0x7fe8ff));
  const core = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1, 6).translate(0, 0.5, 0).rotateX(Math.PI / 2), additive(0xffffff));
  for (const m of [beam, core]) { m.position.copy(a); m.lookAt(b); m.scale.z = len; add(m); }
  muzzle(a, 0x7fe8ff);
  burst(b, 0x7fe8ff, 0.8);
  sparks(b, 0x7fe8ff, 10, 2.5);
  await tween(0.3, t => { beam.material.opacity = 1 - t; core.material.opacity = 1 - t; beam.scale.x = beam.scale.y = 1 + t * 2; });
  remove(beam); remove(core);
}

// ---------- melee ----------
// A crescent sweeping across the target, facing the camera so it always reads. The arc's middle runs
// through the target's centre, and the arc slides along itself as it fades (the swing).
async function crescent(at, color, { width = 1.1, thick = 0.12, tilt = 0.5, dur = 0.22, arc = 1.6 } = {}) {
  const R = width * 0.5;
  const ring = new THREE.Mesh(new THREE.RingGeometry(R - thick, R, 32, 1, -arc / 2, arc), additive(color, 0.95));
  ring.position.x = -R; // arc midpoint (R, 0) lands on the group origin
  const g = new THREE.Group();
  g.add(ring);
  g.position.copy(at);
  g.quaternion.copy(fxCamera().quaternion);
  g.rotateZ(tilt);
  add(g);
  await tween(dur, t => { ring.rotation.z = (t - 0.5) * 0.9; ring.material.opacity = 0.95 * (1 - t * t); g.scale.setScalar(0.85 + t * 0.3); });
  remove(g);
}

export async function meleeHit(style, from, at, color) {
  at = at.clone().add(v3(0, -0.15, 0)); // mid-body rather than chest height
  const tint = new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.6).getHex();
  switch (style) {
    case 'cleave':
      crescent(at, 0xffffff, { width: 1.5, thick: 0.18, tilt: -0.9, dur: 0.28 });
      await crescent(at, tint, { width: 1.3, thick: 0.1, tilt: -0.9, dur: 0.3 });
      sparks(at, 0xffe0c0, 8, 2.2);
      return;
    case 'thrust': {
      const dir = at.clone().sub(from).setY(0).normalize();
      const start = at.clone().addScaledVector(dir, -0.7);
      const m = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.9, 8).rotateX(Math.PI / 2), additive(tint));
      add(m);
      await tween(0.14, t => { m.position.lerpVectors(start, at, ease(t)); m.lookAt(at.clone().addScaledVector(dir, 1)); m.material.opacity = 1 - t * 0.3; });
      remove(m);
      burst(at, tint, 0.6); sparks(at, 0xffffff, 6, 2);
      return;
    }
    case 'claw':
      for (let i = 0; i < 3; i++) {
        const off = fxCamera().getWorldDirection(v3()).cross(v3(0, 1, 0)).normalize().multiplyScalar((i - 1) * 0.13);
        crescent(at.clone().add(off), i === 1 ? 0xffffff : 0xffb0a0, { width: 1.1, thick: 0.08, tilt: -1.2, dur: 0.24, arc: 1.4 });
        await wait(0.04);
      }
      await wait(0.16);
      sparks(at, 0xff9a8a, 8, 2);
      return;
    case 'smash': {
      const ground = at.clone().add(v3(0, -0.45, 0));
      burst(ground, 0xe0c090, 1.1);
      const dust = Array.from({ length: 8 }, (_, i) => {
        const s = glow(0xc9b090, 0.35); const a = (i / 8) * Math.PI * 2;
        s.position.copy(ground).add(v3(Math.cos(a) * 0.2, 0.1, Math.sin(a) * 0.2)); s.userData.a = a; add(s); return s;
      });
      sparks(at, 0xffffff, 6, 1.8);
      await tween(0.4, t => dust.forEach(s => {
        s.position.set(ground.x + Math.cos(s.userData.a) * (0.2 + t * 0.9), ground.y + 0.1 + t * 0.3, ground.z + Math.sin(s.userData.a) * (0.2 + t * 0.9));
        s.material.opacity = 0.7 * (1 - t);
      }));
      dust.forEach(remove);
      return;
    }
    default: // slash
      crescent(at, 0xffffff, { width: 1.25, thick: 0.05, tilt: 0.6, dur: 0.2 });
      await crescent(at, tint, { width: 1.2, thick: 0.15, tilt: 0.6, dur: 0.24 });
      sparks(at, 0xffffff, 6, 2);
  }
}
