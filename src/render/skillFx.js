// Showpiece effects for the expensive units' signature skills (abilities.js, signature: true), in the
// spirit of anime finishing moves: charge-ups, beams, storms, auras. Each function plays its effect
// and resolves when the hit should land, so the dice and damage show on impact.
// Also the auras that stay on a unit while a status lasts (released, poisoned, barrier).
import * as THREE from 'three';
import { tween, wait, ease, glow, burst, zap, shake, fxScene, fxCamera } from './fx.js';

const add = (...o) => fxScene().add(...o);
// sprites share one geometry inside three.js, so only meshes give theirs back
const remove = o => { fxScene().remove(o); o.traverse?.(c => { if (!c.isSprite) c.geometry?.dispose(); c.material?.dispose(); }); };
const additive = (color, opacity = 1, side = THREE.FrontSide) => new THREE.MeshBasicMaterial({
  color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, side });
const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const rnd = (a, b) => a + Math.random() * (b - a);

// Specks of light rushing in to a point (charging up).
function gather(center, color, { count = 26, radius = 2.2, dur = 0.7 } = {}) {
  const parts = Array.from({ length: count }, () => {
    const s = glow(color, rnd(0.12, 0.3));
    const dir = v3(rnd(-1, 1), rnd(-0.4, 1), rnd(-1, 1)).normalize().multiplyScalar(radius * rnd(0.6, 1));
    s.userData = { dir, delay: rnd(0, 0.4) };
    add(s);
    return s;
  });
  return tween(dur, t => {
    for (const s of parts) {
      const k = Math.min(1, Math.max(0, (t - s.userData.delay) / (1 - s.userData.delay)));
      s.position.copy(center).addScaledVector(s.userData.dir, 1 - ease(k));
      s.material.opacity = Math.sin(Math.PI * Math.min(1, k * 1.2));
    }
  }).then(() => parts.forEach(remove));
}

// Debris and sparks flung out from a point.
function scatter(center, color, { count = 18, speed = 3, dur = 0.6, size = 0.18, gravity = 6 } = {}) {
  const parts = Array.from({ length: count }, () => {
    const s = glow(color, size * rnd(0.7, 1.4));
    s.userData.vel = v3(rnd(-1, 1), rnd(0.4, 1.4), rnd(-1, 1)).normalize().multiplyScalar(speed * rnd(0.5, 1));
    s.position.copy(center);
    add(s);
    return s;
  });
  let last = 0;
  return tween(dur, t => {
    const dt = (t - last) * dur; last = t;
    for (const s of parts) {
      s.userData.vel.y -= gravity * dt;
      s.position.addScaledVector(s.userData.vel, dt);
      s.material.opacity = 1 - t;
    }
  }).then(() => parts.forEach(remove));
}

// A cylinder of light from a to b (beams, pillars).
function cylinderBetween(a, b, radius, mat) {
  const len = a.distanceTo(b);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 1, 20, 1, true).translate(0, 0.5, 0).rotateX(Math.PI / 2), mat);
  m.position.copy(a);
  m.lookAt(b);
  m.scale.set(1, 1, len);
  return m;
}

// A pillar of energy erupting upward at pos.
function pillar(pos, color, { height = 6, radius = 0.7, dur = 0.9 } = {}) {
  const outer = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 1.3, height, 24, 1, true).translate(0, height / 2, 0), additive(color, 0, THREE.DoubleSide));
  const inner = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.4, radius * 0.6, height, 16, 1, true).translate(0, height / 2, 0), additive(0xffffff, 0, THREE.DoubleSide));
  outer.position.copy(pos); inner.position.copy(pos);
  add(outer, inner);
  return tween(dur, t => {
    const grow = Math.min(1, t * 4);
    outer.scale.set(1 + t * 0.3, grow, 1 + t * 0.3);
    inner.scale.set(1, grow, 1);
    outer.rotation.y += 0.2;
    outer.material.opacity = 0.55 * Math.sin(Math.PI * t);
    inner.material.opacity = 0.7 * Math.sin(Math.PI * t);
  }).then(() => { remove(outer); remove(inner); });
}

// A flat shockwave ring racing outward along the ground.
function shockwave(pos, color, radius = 3, dur = 0.6, thick = 0.25) {
  const ring = new THREE.Mesh(new THREE.RingGeometry(1 - thick, 1, 48).rotateX(-Math.PI / 2), additive(color, 0.9, THREE.DoubleSide));
  ring.position.copy(pos).add(v3(0, 0.12, 0));
  add(ring);
  return tween(dur, t => { ring.scale.setScalar(0.2 + ease(t) * radius); ring.material.opacity = 0.9 * (1 - t); }).then(() => remove(ring));
}

// ---------- the skills ----------

// Star-Eater Beam: a star gathers in the maw, then a long beam tears down the line.
export async function starBeam(from, to, color = 0x9fd8ff) {
  const orb = glow(color, 0.2), core = glow(0xffffff, 0.1);
  orb.position.copy(from); core.position.copy(from);
  add(orb, core);
  const charging = gather(from, color, { count: 34, radius: 2.6, dur: 0.9 });
  await tween(0.9, t => { orb.scale.setScalar(0.2 + t * 1.6); core.scale.setScalar(0.1 + t * 0.8); });
  await charging;
  const end = to.clone();
  const outer = cylinderBetween(from, end, 0.42, additive(color, 0.85));
  const inner = cylinderBetween(from, end, 0.16, additive(0xffffff, 1));
  outer.scale.z = inner.scale.z = 0.01; // grows out of the maw
  add(outer, inner);
  const sparks = Array.from({ length: 10 }, (_, i) => { const s = glow(color, 0.9); s.position.lerpVectors(from, end, (i + 0.5) / 10); add(s); return s; });
  shake(0.35, 0.6);
  burst(end, color, 1.6);
  await tween(0.16, t => { outer.scale.z = inner.scale.z = from.distanceTo(end) * t; });
  tween(0.55, t => {
    const f = 1 - t;
    outer.scale.x = outer.scale.y = f * (1 + 0.15 * Math.sin(t * 60));
    inner.scale.x = inner.scale.y = f;
    orb.material.opacity = core.material.opacity = f;
    sparks.forEach(s => { s.material.opacity = f; });
  }).then(() => [orb, core, outer, inner, ...sparks].forEach(remove));
  await wait(0.1);
}

// Demon Gate Strike: a blood-red aura bursts out, the ground cracks, then a crushing blow.
export async function demonGate(self, target) {
  pillar(self, 0xff1a2a, { height: 4, radius: 0.6, dur: 0.9 });
  shockwave(self, 0x8a0010, 2.2, 0.7, 0.35);
  await gather(self.clone().add(v3(0, 0.8, 0)), 0xff3a3a, { count: 20, radius: 1.6, dur: 0.55 });
  shake(0.45, 0.5);
  burst(target, 0xff2a2a, 2.4);
  scatter(target, 0xff5a3a, { count: 24, speed: 4 });
  await wait(0.05);
}

// Gate Release: spiritual pressure erupts in a towering crimson-black pillar, blades of light spiral up.
export async function gateRelease(self) {
  shake(0.25, 0.8);
  shockwave(self, 0xff2a4a, 4, 0.9, 0.3);
  const petals = Array.from({ length: 30 }, (_, i) => {
    const s = glow(i % 3 ? 0xff3a5a : 0xffffff, rnd(0.15, 0.3));
    s.userData = { a: (i / 30) * Math.PI * 2, r: rnd(0.6, 1.2), h: rnd(0, 0.5) };
    add(s);
    return s;
  });
  tween(1.3, t => {
    for (const s of petals) {
      const u = s.userData, a = u.a + t * 9;
      s.position.copy(self).add(v3(Math.cos(a) * u.r * (1 + t), u.h + t * 5, Math.sin(a) * u.r * (1 + t)));
      s.material.opacity = Math.sin(Math.PI * t);
    }
  }).then(() => petals.forEach(remove));
  await pillar(self, 0xd0102a, { height: 9, radius: 0.9, dur: 1.2 });
}

// Thunder God's Drumroll: a storm cloud gathers over the target, then lightning hammers down.
export async function thunderDrum(target, spots) {
  const top = target.clone().add(v3(0, 5, 0));
  const clouds = Array.from({ length: 9 }, () => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow(0, 1).material.map, color: 0x30364a, transparent: true, opacity: 0, depthWrite: false }));
    s.position.copy(top).add(v3(rnd(-1.6, 1.6), rnd(-0.3, 0.4), rnd(-1.6, 1.6)));
    s.scale.setScalar(rnd(1.8, 2.8));
    add(s);
    return s;
  });
  await tween(0.5, t => clouds.forEach(c => { c.material.opacity = 0.85 * t; }));
  const flash = glow(0xcfe6ff, 6);
  flash.position.copy(top);
  add(flash);
  for (let i = 0; i < 5; i++) {
    const p = (spots[i % spots.length] ?? target).clone().add(v3(rnd(-0.3, 0.3), 0.2, rnd(-0.3, 0.3)));
    zap(top.clone().add(v3(rnd(-1, 1), 0, rnd(-1, 1))), p, 0xdff0ff);
    zap(top.clone().add(v3(rnd(-1, 1), 0, rnd(-1, 1))), p, 0x9fc4ff);
    burst(p, 0xbfe0ff, 0.9);
    flash.material.opacity = 1;
    if (i === 1) shake(0.3, 0.4);
    await tween(0.09, t => { flash.material.opacity = 1 - t; });
  }
  tween(0.5, t => clouds.forEach(c => { c.material.opacity = 0.85 * (1 - t); })).then(() => { clouds.forEach(remove); remove(flash); });
}

// Venom Torrent: a stream of venom globs, then a bubbling toxic cloud on the target.
export async function venomTorrent(from, to) {
  const globs = [];
  for (let i = 0; i < 7; i++) {
    const g = glow(i % 2 ? 0x7dff4a : 0x2fbf3a, rnd(0.3, 0.5));
    add(g);
    globs.push(g);
  }
  await tween(0.5, t => globs.forEach((g, i) => {
    const k = Math.min(1, Math.max(0, t * 1.6 - i * 0.08));
    g.position.lerpVectors(from, to, k);
    g.position.y += Math.sin(Math.PI * k) * 0.8 + Math.sin(i * 3 + t * 20) * 0.08;
    g.material.opacity = k > 0 && k < 1 ? 1 : 0;
  }));
  globs.forEach(remove);
  burst(to, 0x5aff4a, 1.2);
  const cloud = Array.from({ length: 10 }, () => {
    const s = glow(0x4adf3a, rnd(0.5, 0.9));
    s.position.copy(to).add(v3(rnd(-0.5, 0.5), rnd(-0.2, 0.6), rnd(-0.5, 0.5)));
    add(s);
    return s;
  });
  tween(1.0, t => cloud.forEach(s => { s.position.y += 0.012; s.material.opacity = 0.7 * (1 - t); })).then(() => cloud.forEach(remove));
}

// Titan Fist: the ground splits under the target and a huge stone fist punches up out of it.
export async function titanFist(target) {
  const ground = target.clone().add(v3(0, -0.4, 0));
  shockwave(ground.clone().add(v3(0, 0.3, 0)), 0xc9a26b, 1.6, 0.4, 0.4);
  await wait(0.15);
  const stone = new THREE.MeshStandardMaterial({ color: 0x8a7a66, roughness: 0.95, flatShading: true });
  const fist = new THREE.Group();
  const palm = new THREE.Mesh(new THREE.DodecahedronGeometry(0.55, 0), stone);
  palm.scale.set(1, 1.25, 0.9);
  fist.add(palm);
  for (let i = 0; i < 4; i++) {
    const knuckle = new THREE.Mesh(new THREE.DodecahedronGeometry(0.2, 0), stone);
    knuckle.position.set(-0.36 + i * 0.24, 0.62, 0.22);
    fist.add(knuckle);
  }
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.55, 1.6, 7).translate(0, -1.2, 0), stone);
  fist.add(arm);
  fist.position.copy(ground).add(v3(0, -1.6, 0));
  fist.rotation.y = rnd(0, Math.PI);
  add(fist);
  shake(0.4, 0.45);
  scatter(ground.clone().add(v3(0, 0.4, 0)), 0xc9a26b, { count: 22, speed: 4.5, size: 0.22 });
  await tween(0.18, t => { fist.position.y = ground.y - 1.6 + ease(t) * 2.4; });
  burst(target, 0xe0c090, 1.4);
  wait(0.5).then(() => tween(0.4, t => { fist.position.y = ground.y + 0.8 - t * 2.6; })).then(() => remove(fist));
}

// Void Flash Step: a slash of violet light crosses the target as the stalker reappears behind it.
export async function voidSlash(target) {
  const mk = (rot) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.12), additive(0xc08aff, 1, THREE.DoubleSide));
    m.position.copy(target);
    m.quaternion.copy(fxCamera().quaternion); // face the camera, so the X always reads
    m.rotateZ(rot);
    add(m);
    return m;
  };
  const a = mk(0.7), b = mk(-0.7);
  burst(target, 0x9a5aff, 1.2);
  await tween(0.35, t => [a, b].forEach(m => { m.scale.set(0.3 + t * 1.2, 1 - t * 0.6, 1); m.material.opacity = 1 - t; }));
  remove(a); remove(b);
}

// Dawn Spear: a lance of light flies true and a pillar of dawn bursts where it lands.
export async function dawnSpear(from, to) {
  const spear = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.6, 8).rotateX(Math.PI / 2), additive(0xfff0b0));
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.5, 8).rotateX(Math.PI / 2).translate(0, 0, 1.0), additive(0xffffff));
  const halo = glow(0xffd76a, 1.2);
  spear.add(shaft, head, halo);
  spear.position.copy(from);
  spear.lookAt(to);
  add(spear);
  const trail = [];
  const dist = from.distanceTo(to);
  let lastDrop = 0;
  await tween(Math.max(0.2, dist / 18), t => {
    spear.position.lerpVectors(from, to, t);
    if (t - lastDrop > 0.08) {
      lastDrop = t;
      const s = glow(0xffe08a, 0.5);
      s.position.copy(spear.position);
      add(s);
      trail.push(s);
    }
    trail.forEach(s => { s.material.opacity *= 0.9; });
  });
  remove(spear);
  trail.forEach(s => tween(0.25, t => { s.material.opacity *= 1 - t; }).then(() => remove(s)));
  burst(to, 0xffd76a, 1.6);
  pillar(to.clone().add(v3(0, -0.5, 0)), 0xffd76a, { height: 5, radius: 0.5, dur: 0.7 });
}

// Conqueror's Will: a dark dome of will crashes outward, crackling with red lightning.
export async function conquerorsWill(self, radius = 2) {
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), additive(0x6a0a2a, 0.6, THREE.DoubleSide));
  dome.position.copy(self);
  add(dome);
  shake(0.3, 0.6);
  shockwave(self, 0xff2a4a, radius * 2 + 1, 0.6, 0.15);
  const reach = radius * 1.8 + 0.6;
  for (let i = 0; i < 6; i++) {
    const a = rnd(0, Math.PI * 2), r = rnd(0.8, reach);
    zap(self.clone().add(v3(0, 1, 0)), self.clone().add(v3(Math.cos(a) * r, rnd(0.2, 1.5), Math.sin(a) * r)), 0xff3a5a);
  }
  await tween(0.6, t => { dome.scale.setScalar(0.3 + ease(t) * reach); dome.material.opacity = 0.6 * (1 - t); });
  remove(dome);
}

// Sacred Barrier: a golden bubble flashes into being around the ally (the lasting bubble is an aura).
export async function sacredBarrier(target) {
  const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), additive(0xffd76a, 0.8));
  shell.material.wireframe = true;
  shell.position.copy(target);
  add(shell);
  burst(target.clone().add(v3(0, -0.4, 0)), 0xffd76a, 1.2);
  await tween(0.45, t => { shell.scale.setScalar(0.3 + ease(t) * 1.1); shell.material.opacity = 0.8 * (1 - t * 0.7); shell.rotation.y += 0.08; });
  remove(shell);
}

// Raise Dead: a sickly green ring cracks open, bone shards fly and a ghostly pillar rises.
export async function raiseDead(pos) {
  // a pool of grave-light that lingers while the minion climbs out
  const pool = glow(0x3adf6a, 2.6);
  pool.position.copy(pos).add(v3(0, 0.15, 0));
  add(pool);
  tween(1.6, t => { pool.material.opacity = Math.min(1, t * 5) * (1 - t) * 0.9; pool.scale.setScalar(2.6 + t); }).then(() => remove(pool));
  shockwave(pos, 0x5aff8a, 1.8, 0.9, 0.35);
  scatter(pos.clone().add(v3(0, 0.2, 0)), 0xe8e2d0, { count: 20, speed: 2.5, size: 0.16, dur: 0.9 });
  gather(pos.clone().add(v3(0, 0.6, 0)), 0x7dffa0, { count: 18, radius: 1.4, dur: 1.0 });
  await pillar(pos, 0x3adf6a, { height: 3.2, radius: 0.5, dur: 1.1 });
}

// ---------- auras: stay on a unit while a status lasts ----------
// makeAura(kind, height) -> Object3D with userData.update(t)
export function makeAura(kind, height) {
  const g = new THREE.Group();
  if (kind === 'released') {
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.7, height * 1.4, 20, 1, true).translate(0, height * 0.7, 0), additive(0xff1a3a, 0.25, THREE.DoubleSide));
    const base = glow(0xff2a4a, 1.6);
    base.position.y = 0.2;
    g.add(col, base);
    g.userData.update = t => {
      col.material.opacity = 0.18 + 0.1 * Math.sin(t * 9) + 0.05 * Math.sin(t * 23);
      col.rotation.y = t * 2;
      col.scale.set(1 + 0.06 * Math.sin(t * 7), 1 + 0.05 * Math.sin(t * 5), 1 + 0.06 * Math.sin(t * 7));
      base.material.opacity = 0.6 + 0.2 * Math.sin(t * 6);
    };
  } else if (kind === 'poison') {
    const bubbles = Array.from({ length: 6 }, (_, i) => { const s = glow(0x6aff4a, 0.22); s.userData.p = i / 6; g.add(s); return s; });
    g.userData.update = t => bubbles.forEach((s, i) => {
      const f = (t * 0.5 + s.userData.p) % 1, a = i * 2.1 + t;
      s.position.set(Math.cos(a) * 0.35, 0.3 + f * height, Math.sin(a) * 0.35);
      s.material.opacity = Math.sin(Math.PI * f) * 0.8;
    });
  } else if (kind === 'shield') {
    const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), additive(0xffd76a, 0.28));
    shell.material.wireframe = true;
    const fill = new THREE.Mesh(new THREE.SphereGeometry(0.97, 24, 16), additive(0xffc84a, 0.07));
    shell.scale.setScalar(Math.max(0.8, height * 0.62));
    fill.scale.copy(shell.scale);
    shell.position.y = fill.position.y = height * 0.5;
    g.add(shell, fill);
    g.userData.update = t => { shell.rotation.y = t * 0.6; shell.material.opacity = 0.22 + 0.08 * Math.sin(t * 3); };
  } else if (kind === 'cowed') {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.04, 6, 20).rotateX(Math.PI / 2), additive(0xa04aff, 0.7));
    ring.position.y = height + 0.15;
    g.add(ring);
    g.userData.update = t => { ring.rotation.y = t * 3; ring.position.y = height + 0.15 + 0.05 * Math.sin(t * 4); };
  }
  return g;
}
export const AURA_KINDS = ['released', 'poison', 'shield', 'cowed'];
