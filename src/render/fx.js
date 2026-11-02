// Small effects: tweens, floating numbers, projectiles, bursts, lightning.
import * as THREE from 'three';

let scene, camera, renderer, floaterLayer;
const tweens = [];
const floaters = [];

export function initFx(s, cam, r, layer) {
  scene = s; camera = cam; renderer = r; floaterLayer = layer;
}

export const ease = t => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

// Calls fn(t) with t going 0..1 over `dur` seconds. Resolves when done.
// In a hidden tab the browser throttles timers to once a second or slower, so animations would crawl
// and an online friend's moves would pile up behind them: there, tweens finish at once.
export function tween(dur, fn) {
  if (document.hidden) { fn(1); return Promise.resolve(); }
  return new Promise(resolve => tweens.push({ t: 0, dur: Math.max(0.001, dur), fn, resolve }));
}
export const wait = sec => tween(sec, () => {});

// Debug slow motion for inspecting effects: fxSpeed.scale = 0.2 in the console (1 = normal).
export const fxSpeed = { scale: 1 };

export function updateFx(dt) {
  dt *= fxSpeed.scale;
  for (let i = tweens.length - 1; i >= 0; i--) {
    const tw = tweens[i];
    tw.t = Math.min(1, tw.t + dt / tw.dur);
    tw.fn(tw.t);
    if (tw.t >= 1) { tweens.splice(i, 1); tw.resolve(); }
  }
  const w = renderer.domElement.clientWidth, h = renderer.domElement.clientHeight;
  const v = new THREE.Vector3();
  for (let i = floaters.length - 1; i >= 0; i--) {
    const f = floaters[i];
    f.age += dt;
    if (f.age > 1.4) { f.el.remove(); floaters.splice(i, 1); continue; }
    v.copy(f.pos).project(camera);
    f.el.style.left = `${(v.x * 0.5 + 0.5) * w}px`;
    f.el.style.top = `${(-v.y * 0.5 + 0.5) * h}px`;
  }
}

// Text that rises from a world position, e.g. "-3" in red.
export function floatText(pos, text, color = '#fff', small = false) {
  if (!pos) return; // the unit has no figure on the board right now (e.g. just removed)
  const el = document.createElement('div');
  el.textContent = text;
  el.style.color = color;
  if (small) el.className = 'sm';
  floaterLayer.appendChild(el);
  floaters.push({ el, pos: pos.clone(), age: 0 });
}

const glowTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.3, 'rgba(255,255,255,0.6)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();

export function glow(color, size) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  s.scale.setScalar(size);
  return s;
}

// A glowing ball flying from a to b (arcing for arrows).
export async function projectile(from, to, color, { arc = 0.6, size = 0.5, speed = 14 } = {}) {
  const ball = glow(color, size);
  const core = glow(0xffffff, size * 0.4);
  ball.add(core);
  scene.add(ball);
  const dist = from.distanceTo(to);
  await tween(Math.max(0.18, dist / speed), t => {
    ball.position.lerpVectors(from, to, t);
    ball.position.y += Math.sin(Math.PI * t) * arc * dist * 0.15;
  });
  scene.remove(ball);
}

// Expanding ring + flash at a point.
export function burst(pos, color, radius = 1) {
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.7, 1, 40),
    new THREE.MeshBasicMaterial({ color, transparent: true, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.copy(pos).add(new THREE.Vector3(0, 0.1, 0));
  const flash = glow(color, radius * 2.2);
  flash.position.copy(pos).add(new THREE.Vector3(0, 0.6, 0));
  scene.add(ring, flash);
  return tween(0.5, t => {
    ring.scale.setScalar(0.2 + t * radius * 1.6);
    ring.material.opacity = 1 - t;
    flash.material.opacity = 1 - t;
  }).then(() => { scene.remove(ring, flash); ring.geometry.dispose(); });
}

// A column of light rising (heals, buffs).
export function rise(pos, color) {
  const col = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 2, 24, 1, true),
    new THREE.MeshBasicMaterial({ color, transparent: true, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
  col.position.copy(pos).add(new THREE.Vector3(0, 1, 0));
  scene.add(col);
  return tween(0.7, t => {
    col.material.opacity = Math.sin(Math.PI * t) * 0.6;
    col.scale.set(1 - t * 0.4, 0.5 + t, 1 - t * 0.4);
  }).then(() => { scene.remove(col); col.geometry.dispose(); });
}

// Jagged lightning between two points.
export function zap(a, b, color = 0xfff27a) {
  const pts = [];
  const n = 10;
  for (let i = 0; i <= n; i++) {
    const p = new THREE.Vector3().lerpVectors(a, b, i / n);
    if (i && i < n) p.add(new THREE.Vector3((Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.5));
    pts.push(p);
  }
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending }));
  scene.add(line);
  return tween(0.35, t => { line.material.opacity = t < 0.5 ? 1 : 2 * (1 - t); })
    .then(() => { scene.remove(line); line.geometry.dispose(); });
}

// For effects built elsewhere (skillFx.js): the scene and camera fx draws into.
export const fxScene = () => scene;
export const fxCamera = () => camera;

// Rattle the camera for a heavy impact. Moves it by a small offset each frame and takes the offset
// back, so orbit controls and panning carry on as normal.
export function shake(strength = 0.25, dur = 0.4) {
  const off = new THREE.Vector3();
  return tween(dur, t => {
    camera.position.sub(off);
    const k = strength * (1 - t);
    off.set((Math.random() - 0.5) * k, (Math.random() - 0.5) * k, (Math.random() - 0.5) * k);
    if (t >= 1) off.set(0, 0, 0);
    camera.position.add(off);
  });
}
