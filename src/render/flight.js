// Flying miniatures: the figure rides a clear flight post above its base, and four things sell that
// it's airborne, not just raised:
//   - it hovers, rising and falling gently with a slight sway (the post stretches to follow)
//   - a soft shadow on the base shrinks and fades as it rises
//   - rings of downdraft ripple out across the base under it, as if from its wingbeats
//   - soft cloud puffs drift around the post and swirl in the downdraft, softening the rest
//   const fx = makeFlight(figureObject, hover, seed); parent.add(fx.group); fx.update(t) every frame
import * as THREE from 'three';
import { BASE_TOP } from './pedestal.js';

const BOB = 0.07;       // how far it rises and falls
const RINGS = 3;
const PUFFS = 9;
let shadowTex = null, puffTex = null;

export function makeFlight(object, hover, seed = 0) {
  const group = new THREE.Group();
  const restY = object.position.y + hover;
  object.position.y = restY;

  const postMat = new THREE.MeshStandardMaterial({ color: 0xcfe8ff, transparent: true, opacity: 0.35, roughness: 0.1, metalness: 0.1, depthWrite: false });
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 1, 10).translate(0, 0.5, 0), postMat);
  post.position.y = BASE_TOP;
  group.add(post);

  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.5, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false, color: 0x000000 }));
  shadow.position.y = BASE_TOP + 0.005;
  group.add(shadow);

  const ringMat = () => new THREE.MeshBasicMaterial({ color: 0xdff2ff, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending });
  const ringGeo = new THREE.RingGeometry(0.42, 0.47, 40).rotateX(-Math.PI / 2);
  const rings = [];
  for (let i = 0; i < RINGS; i++) {
    const r = new THREE.Mesh(ringGeo, ringMat());
    r.position.y = BASE_TOP + 0.01 + i * 0.002;
    r.renderOrder = 2;
    group.add(r);
    rings.push(r);
  }

  // cloud puffs: a low ring hugging the base plus a few under the figure, each slowly orbiting the post
  const puffs = [];
  for (let i = 0; i < PUFFS; i++) {
    const p = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTexture(), color: 0xeaf4ff, transparent: true, depthWrite: false }));
    const high = i >= PUFFS - 2; // the last two sit just under the figure
    p.userData = {
      a: (i / PUFFS) * Math.PI * 2 + seed, r: high ? 0.18 : 0.32 + 0.12 * ((i * 37) % 5) / 5,
      y: high ? hover * 0.7 : 0.08 + 0.06 * (i % 3), size: high ? 0.5 : 0.48 + 0.1 * (i % 3), spin: 0.25 + 0.1 * (i % 3),
    };
    p.renderOrder = 3;
    group.add(p);
    puffs.push(p);
  }

  const phase = seed * 1.7;
  function update(t) {
    // hover: a slow rise and fall with a small wobble, like holding position with wingbeats
    const s = Math.sin(t * 2.2 + phase);
    const bob = BOB * s + 0.015 * Math.sin(t * 7.5 + phase);
    object.position.y = restY + bob;
    object.rotation.z = 0.035 * Math.sin(t * 1.6 + phase);
    object.rotation.x = 0.025 * Math.cos(t * 1.9 + phase);
    post.scale.y = Math.max(0.01, restY + bob - BASE_TOP);
    // shadow: tighter and darker when low, wider and fainter when high
    const k = (s + 1) / 2;
    shadow.scale.setScalar(0.85 + 0.25 * k);
    shadow.material.opacity = 0.55 - 0.2 * k;
    // downdraft: rings spread out from under it and fade, one after another, quicker on the downbeat
    rings.forEach((r, i) => {
      const f = ((t * 0.9 + phase + i / RINGS) % 1 + 1) % 1;
      r.scale.setScalar(0.35 + f * 1.55);
      r.material.opacity = 0.22 * Math.sin(f * Math.PI) * (1 - f * 0.4);
    });
    // clouds: orbit slowly, breathe in size, and puff outward a little on each downbeat
    puffs.forEach((p, i) => {
      const u = p.userData, a = u.a + t * u.spin, push = 1 + 0.12 * (1 - k);
      p.position.set(Math.cos(a) * u.r * push, BASE_TOP + u.y + 0.03 * Math.sin(t * 1.3 + i), Math.sin(a) * u.r * push);
      p.scale.setScalar(u.size * (0.9 + 0.15 * Math.sin(t * 0.8 + i * 1.9)));
      p.material.rotation = a * 0.5;
      p.material.opacity = 0.6 + 0.12 * Math.sin(t * 0.9 + i * 2.3);
    });
  }
  update(0);
  return { group, update };
}

function shadowTexture() {
  if (shadowTex) return shadowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.6)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  shadowTex = new THREE.CanvasTexture(c);
  return shadowTex;
}

// A soft, lumpy cloud puff: several overlapping blurred blobs
function puffTexture() {
  if (puffTex) return puffTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const blobs = [[64, 70, 40], [44, 62, 28], [86, 60, 30], [60, 48, 26], [78, 80, 24], [48, 82, 22]];
  for (const [x, y, r] of blobs) {
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.55)');
    grad.addColorStop(0.6, 'rgba(255,255,255,0.25)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
  }
  puffTex = new THREE.CanvasTexture(c);
  puffTex.colorSpace = THREE.SRGBColorSpace;
  return puffTex;
}
