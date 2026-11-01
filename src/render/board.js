// Draws the hex map: stacked columns, terrain caps, trees/rocks, and highlight overlays.
// Everything is instanced (a handful of draw calls for the whole map), which keeps phones happy.
import * as THREE from 'three';
import { TERRAIN } from '../core/terrain.js';
import { toPixel } from '../core/hex.js';
import { hashSeed } from '../core/rng.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { terrainTextures, photoTextures, worldUV } from './terrainTextures.js';

export const LEVEL = 0.4;   // world height of one elevation level
const BASE = 0.35;          // column height under level 0
const CAP = 0.14;           // terrain cap thickness
const BOTTOM = -1.5;        // columns start here, so the board looks like a solid slab
const LIQUID_DROP = 0.1;    // water/lava sit a bit below the rim

// flat (per-face) normals: the cliff texture is projected along each face, which needs a true face normal
const hexCol = new THREE.CylinderGeometry(1, 1, 1, 6).translate(0, 0.5, 0).toNonIndexed();
hexCol.computeVertexNormals();
// cap: slightly bevelled; its sloped band uses the cliff material (group 0), the top the terrain (group 1)
const hexCap = new THREE.CylinderGeometry(0.94, 1, CAP, 6).translate(0, CAP / 2, 0).toNonIndexed();
hexCap.computeVertexNormals();
const fillGeo = new THREE.CircleGeometry(0.88, 6, Math.PI / 6).rotateX(-Math.PI / 2);
const ringGeo = new THREE.RingGeometry(0.74, 0.9, 6, 1, Math.PI / 6).rotateX(-Math.PI / 2);
// faint dark line just inside each hex top's rim, so the grid reads even across same-terrain areas
const edgeGeo = new THREE.RingGeometry(0.885, 0.94, 6, 1, Math.PI / 6).rotateX(-Math.PI / 2);

// ---------- scenery shapes ----------
// Nudge every vertex by a hash of its position, so shared corners move together (no cracks).
function lumpy(geo, amount, seed) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const k = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    const f = 1 + ((hashSeed(k + seed) % 1000) / 1000 - 0.5) * 2 * amount;
    p.setXYZ(i, p.getX(i) * f, p.getY(i) * f, p.getZ(i) * f);
  }
  geo.computeVertexNormals();
  return geo;
}
// ---------- trees ----------
// Foliage carries a grey "light" vertex color (dark low down and underneath, bright on top), which
// fakes ambient occlusion; the instance color then supplies the green.
const nonIndexed = g => (g.index ? g.toNonIndexed() : g);

function shade(geo, y0, y1, { under = 0.25, min = 0.45 } = {}) {
  const p = geo.attributes.position, n = geo.attributes.normal;
  const c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const h = Math.min(1, Math.max(0, (p.getY(i) - y0) / (y1 - y0)));
    const v = Math.min(1, min + (1 - min) * h - (n.getY(i) < 0 ? under * -n.getY(i) : 0) + 0.15 * Math.max(0, n.getY(i)));
    c.set([v, v, v], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return geo;
}

// Pine: stacked, slightly drooping tiers with ragged rims, each turned a little.
function makePine(seed, tiers) {
  const parts = [];
  let y = 0.28, r = 0.36;
  for (let i = 0; i < tiers; i++) {
    const h = 0.36 - i * 0.03;
    const cone = nonIndexed(new THREE.ConeGeometry(r, h, 10, 2));
    const p = cone.attributes.position;
    for (let v = 0; v < p.count; v++) {
      const vy = p.getY(v);
      if (vy < -h / 2 + 0.01) { // rim: ragged edge, alternate boughs droop
        const ang = Math.atan2(p.getZ(v), p.getX(v));
        const f = 1 + 0.18 * Math.sin(ang * 5 + i * 1.7 + seed) + 0.08 * Math.sin(ang * 11 + seed * 3);
        p.setXYZ(v, p.getX(v) * f, vy - 0.05 * (0.5 + 0.5 * Math.sin(ang * 5 + i + seed)), p.getZ(v) * f);
      }
    }
    cone.rotateY(i * 0.7 + seed).translate(0, y + h / 2, 0);
    parts.push(cone);
    y += h * 0.55;
    r *= 0.74;
  }
  const geo = mergeGeometries(parts);
  geo.computeVertexNormals();
  return shade(geo, 0.25, y + 0.2, { under: 0.35, min: 0.4 });
}

// Broadleaf: a cluster of soft blobs forming one canopy.
function makeLeafy(seed) {
  const blobs = [[0, 0.72, 0, 0.27], [0.17, 0.62, 0.06, 0.2], [-0.15, 0.64, -0.08, 0.21], [0.03, 0.62, -0.18, 0.19], [-0.05, 0.88, 0.04, 0.18]];
  const parts = blobs.map(([x, y, z, r], i) => {
    const b = lumpy(new THREE.IcosahedronGeometry(r, 2), 0.14, `leafy${seed}-${i}`);
    return b.rotateY(seed + i).translate(x * (1 + 0.15 * Math.sin(seed + i)), y, z);
  });
  const geo = mergeGeometries(parts.map(nonIndexed));
  geo.computeVertexNormals();
  return shade(geo, 0.42, 1.05, { under: 0.45, min: 0.5 });
}

// Trunks: tapered, and the broadleaf one forks into two branches.
function makeTrunk(leafy) {
  const parts = [new THREE.CylinderGeometry(0.035, 0.065, leafy ? 0.6 : 0.5, 6).translate(0, leafy ? 0.3 : 0.25, 0)];
  if (leafy) {
    parts.push(new THREE.CylinderGeometry(0.018, 0.03, 0.3, 5).translate(0, 0.15, 0).rotateZ(0.6).translate(0.02, 0.45, 0));
    parts.push(new THREE.CylinderGeometry(0.016, 0.028, 0.28, 5).translate(0, 0.14, 0).rotateZ(-0.55).rotateY(1.2).translate(-0.01, 0.42, 0));
  }
  return mergeGeometries(parts.map(nonIndexed));
}

const pineGeos = [makePine(0.3, 4), makePine(1.9, 5)];
const leafyGeos = [makeLeafy(0.7), makeLeafy(2.6)];
const pineTrunkGeo = makeTrunk(false);
const leafyTrunkGeo = makeTrunk(true);
const rockGeos = [0, 1, 2].map(i => lumpy(new THREE.DodecahedronGeometry(0.22, 0), 0.3, `rock${i}`));
// ice crystal: a leaning, stretched octahedron poking out of the ice
const shardGeo = new THREE.OctahedronGeometry(0.1, 0).scale(1, 2.6, 0.8).rotateZ(0.25).translate(0, 0.16, 0);
const bushGeo = lumpy(new THREE.IcosahedronGeometry(0.16, 1), 0.25, 'bush').translate(0, 0.1, 0);
const tuftGeo = mergeGeometries([0, 1, 2, 3, 4].map(i => new THREE.ConeGeometry(0.018, 0.2, 3)
  .translate(0, 0.1, 0).rotateZ((i - 2) * 0.22).rotateY(i * 1.3).translate(Math.cos(i * 1.3) * 0.03, 0, Math.sin(i * 1.3) * 0.03)));

// ---------- materials (built once, shared by every rebuild) ----------
const TOP_SCALE = 0.3;   // texture repeats per world unit on hex tops
const SIDE_SCALE = 0.35; // ... and on cliff faces
const PHOTO_SCALE = 0.22; // photo textures cover more ground per repeat
let mats = null;

// Gentle wind: bends instanced foliage more the higher the vertex, each tree on its own phase.
function sway(material, time, amount) {
  material.onBeforeCompile = sh => {
    sh.uniforms.uWind = time;
    sh.vertexShader = 'uniform float uWind;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vec2 treePos = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
        float bend = max(0.0, position.y - 0.3) * ${amount.toFixed(3)};
        float phase = uWind * 1.3 + treePos.x * 0.7 + treePos.y * 0.9;
        transformed.x += sin(phase) * bend;
        transformed.z += cos(phase * 0.8) * bend * 0.6;
      #endif`);
  };
  material.customProgramCacheKey = () => `sway-${amount}`;
  return material;
}

function materials() {
  if (mats) return mats;
  const tx = terrainTextures();
  const shared = m => { m.userData.shared = true; return m; };
  const flow = { value: new THREE.Vector2() };   // water ripples
  const ooze = { value: new THREE.Vector2() };   // lava creep
  const wind = { value: 0 };                      // tree sway clock
  const top = (t, opts = {}, uv = {}) => shared(worldUV(new THREE.MeshStandardMaterial({
    map: tx[t].map, bumpMap: tx[t].bump, bumpScale: 1.5, roughness: 0.92, envMapIntensity: 0.35, ...opts,
  }), TOP_SCALE, uv));
  // photo-textured (Poly Haven) surfaces: colour + normal + roughness maps
  const ph = photoTextures();
  const photo = (t, scale, opts = {}, uv = {}) => shared(worldUV(new THREE.MeshStandardMaterial({
    map: ph[t].map, normalMap: ph[t].normal, roughnessMap: ph[t].rough, roughness: 1, envMapIntensity: 0.35, ...opts,
  }), scale, uv));
  mats = {
    flow, ooze, wind,
    side: photo('cliff', SIDE_SCALE, { normalScale: new THREE.Vector2(1.2, 1.2) }, { side: true }),
    caps: {
      grass: photo('grass', PHOTO_SCALE, { color: 0xa6d86a }), // the photo is dry and brown; tint it green
      forest: photo('grass', PHOTO_SCALE, { color: 0x8fc25c }), // grass ground, a shade deeper; the trees mark it as forest
      sand: photo('sand', PHOTO_SCALE),
      rock: photo('rock', PHOTO_SCALE, { color: 0xc4c6ca, normalScale: new THREE.Vector2(1.5, 1.5) }),
      snow: photo('snow', PHOTO_SCALE, { envMapIntensity: 0.25 }),
      ice: top('ice', { roughness: 0.05, metalness: 0.1, bumpScale: 0.4, envMapIntensity: 1.3 }),
      water: top('water', { bumpMap: null, normalMap: tx.water.normal, normalScale: new THREE.Vector2(0.7, 0.7),
        roughness: 0.08, metalness: 0.05, transparent: true, opacity: 0.86, envMapIntensity: 1.2 }, { offset: flow }),
      lava: top('lava', { emissiveMap: tx.lava.glow, emissive: 0xffffff, emissiveIntensity: 1.6, roughness: 0.8, bumpScale: 2 }, { offset: ooze }),
    },
    trunk: shared(new THREE.MeshStandardMaterial({ color: 0x5a4030, roughness: 1 })),
    foliage: shared(new THREE.MeshStandardMaterial({ roughness: 0.85, flatShading: true })),
    pineLeaves: shared(sway(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true }), wind, 0.035)),
    broadLeaves: shared(sway(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }), wind, 0.05)),
    stone: shared(new THREE.MeshStandardMaterial({ map: tx.rock.map, roughness: 0.9, flatShading: true })),
    crystal: shared(new THREE.MeshStandardMaterial({ color: 0x9fdcff, emissive: 0x2a7fb8, emissiveIntensity: 0.35,
      roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.85, envMapIntensity: 2, flatShading: true })),
    grassBits: shared(new THREE.MeshStandardMaterial({ roughness: 0.9 })),
    edge: shared(new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -1 })),
  };
  return mats;
}

const tmp = new THREE.Object3D();
const col = new THREE.Color();

export class BoardView {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.map = null;
    this.pos = {};
    this.pickables = [];
  }

  // Board-space position of a hex center (map centered on the origin).
  xz(k) { return this.pos[k]; }

  surfaceY(k) {
    const c = this.map.cells[k];
    return BASE + c.elev * LEVEL + CAP - (TERRAIN[c.terrain].liquid ? LIQUID_DROP : 0);
  }

  // Where a unit stands on a hex.
  worldPos(k, out = new THREE.Vector3()) {
    const p = this.pos[k];
    return out.set(p.x, this.surfaceY(k), p.z);
  }

  build(map) {
    this.map = map;
    this.clear();
    const keys = map.keys;
    let cx = 0, cz = 0;
    for (const k of keys) { const p = toPixel(map.cells[k].q, map.cells[k].r); cx += p.x; cz += p.z; }
    cx /= keys.length; cz /= keys.length;
    this.pos = {};
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const k of keys) {
      const p = toPixel(map.cells[k].q, map.cells[k].r);
      const v = { x: p.x - cx, z: p.z - cz };
      this.pos[k] = v;
      minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x); minZ = Math.min(minZ, v.z); maxZ = Math.max(maxZ, v.z);
    }
    this.size = { width: maxX - minX + 2, depth: maxZ - minZ + 2 };

    // columns
    const M = materials();
    const cols = new THREE.InstancedMesh(hexCol, M.side, keys.length);
    cols.castShadow = cols.receiveShadow = true;
    keys.forEach((k, i) => {
      const c = map.cells[k], p = this.pos[k];
      const top = BASE + c.elev * LEVEL;
      tmp.position.set(p.x, BOTTOM, p.z);
      tmp.scale.set(1, top - BOTTOM, 1);
      tmp.updateMatrix();
      cols.setMatrixAt(i, tmp.matrix);
      cols.setColorAt(i, vary(col.setHex(TERRAIN[c.terrain].side).offsetHSL(0, 0, 0.12), k, 0.08));
    });
    this.addPickable(cols, keys);

    // caps, one instanced mesh per terrain so each can have its own material
    for (const t of Object.keys(TERRAIN)) {
      const ks = keys.filter(k => map.cells[k].terrain === t);
      if (!ks.length) continue;
      const caps = new THREE.InstancedMesh(hexCap, [M.side, M.caps[t], M.side], ks.length);
      caps.receiveShadow = true;
      caps.castShadow = !TERRAIN[t].liquid;
      ks.forEach((k, i) => {
        const p = this.pos[k];
        tmp.position.set(p.x, this.surfaceY(k) - CAP, p.z);
        tmp.scale.set(1, 1, 1);
        tmp.updateMatrix();
        caps.setMatrixAt(i, tmp.matrix);
        // the texture carries the color; instances only vary the brightness a little
        const h = (hashSeed(k) % 1000) / 1000;
        caps.setColorAt(i, col.setScalar(t === 'water' || t === 'lava' ? 1 : 0.88 + h * 0.12));
      });
      this.addPickable(caps, ks);
    }

    const edges = new THREE.InstancedMesh(edgeGeo, M.edge, keys.length);
    keys.forEach((k, i) => {
      const p = this.pos[k];
      tmp.position.set(p.x, this.surfaceY(k) + 0.004, p.z);
      tmp.updateMatrix();
      edges.setMatrixAt(i, tmp.matrix);
    });
    edges.renderOrder = 1;
    this.group.add(edges);

    this.buildDecor(map);

    // highlight overlays (filled hex + outline), refilled by setHighlights()
    const overlayMat = opacity => new THREE.MeshBasicMaterial({ transparent: true, opacity, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, side: THREE.DoubleSide });
    this.fill = new THREE.InstancedMesh(fillGeo, overlayMat(0.3), keys.length);
    this.ring = new THREE.InstancedMesh(ringGeo, overlayMat(0.9), keys.length);
    for (const m of [this.fill, this.ring]) { m.count = 0; m.renderOrder = 2; m.frustumCulled = false; this.group.add(m); }
    this.hover = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthWrite: false }));
    this.hover.renderOrder = 3;
    this.hover.visible = false;
    this.group.add(this.hover);
  }

  // Trees, rocks, bushes and grass. Placement comes from a hash of the hex, so a map always
  // looks the same. Scenery stays toward the hex rim so units in the middle stay visible.
  buildDecor(map) {
    const M = materials();
    const rnd = (k, i) => (hashSeed(`${k}:${i}`) % 10000) / 10000;
    const items = { pine0: [], pine1: [], leafy0: [], leafy1: [], pineTrunk: [], leafyTrunk: [], rock0: [], rock1: [], rock2: [], shard: [], bush: [], tuft: [] };
    const put = (list, k, i, { r0 = 0.42, r1 = 0.68, s0 = 0.8, s1 = 1.1, y = 0, color = null, squash = 1 } = {}) => {
      const p = this.pos[k];
      const a = rnd(k, i) * Math.PI * 2, r = r0 + rnd(k, i + 50) * (r1 - r0), sc = s0 + rnd(k, i + 90) * (s1 - s0);
      list.push({ x: p.x + Math.cos(a) * r, y: this.surfaceY(k) + y, z: p.z + Math.sin(a) * r, s: sc, squash, rot: rnd(k, i + 130) * 6.28, color });
      return list[list.length - 1];
    };
    const tint = (k, i, base) => new THREE.Color(base).offsetHSL((rnd(k, i + 7) - 0.5) * 0.04, 0, (rnd(k, i + 9) - 0.5) * 0.12);
    const rock = (k, i) => items[`rock${Math.floor(rnd(k, i + 400) * 3)}`];
    const tree = (k, i, pine, color, opts = {}) => {
      const variant = rnd(k, i + 500) < 0.5 ? 0 : 1;
      const d = put(items[`${pine ? 'pine' : 'leafy'}${variant}`], k, i, { color, ...opts });
      items[pine ? 'pineTrunk' : 'leafyTrunk'].push({ ...d, color: null });
    };
    for (const k of map.keys) {
      const t = map.cells[k].terrain;
      if (t === 'forest') {
        for (let i = 0; i < 4; i++) {
          const pine = rnd(k, i + 300) < 0.6;
          tree(k, i, pine, tint(k, i, pine ? 0x2a6236 : 0x4f8a36), { s0: 0.75, s1: 1.15 });
        }
        put(items.tuft, k, 20, { r0: 0.1, r1: 0.4, color: tint(k, 20, 0x3f6e2e) });
      } else if (t === 'grass') {
        const n = 2 + Math.floor(rnd(k, 1) * 4);
        for (let i = 0; i < n; i++) put(items.tuft, k, i, { r0: 0.2, r1: 0.75, s0: 0.8, s1: 1.4, color: tint(k, i, 0x6a9a3c) });
        if (rnd(k, 2) < 0.35) put(items.bush, k, 30, { color: tint(k, 30, 0x4f7f34) });
        if (rnd(k, 3) < 0.15) put(rock(k, 31), k, 31, { s0: 0.5, s1: 0.8, squash: 0.6, color: new THREE.Color(0x9a958c) });
      } else if (t === 'rock') {
        const n = 2 + Math.floor(rnd(k, 1) * 2);
        for (let i = 0; i < n; i++) put(rock(k, i), k, i, { s0: 0.7, s1: 1.4, squash: 0.75, color: new THREE.Color(0xb0aaa0) });
      } else if (t === 'snow') {
        if (rnd(k, 1) < 0.6) put(rock(k, 5), k, 5, { s0: 0.7, s1: 1.2, squash: 0.7, color: new THREE.Color(0xe8eef4) });
        if (rnd(k, 3) < 0.25) tree(k, 6, true, new THREE.Color(0xe4edf2), { s0: 0.7, s1: 1 });
      } else if (t === 'sand') {
        if (rnd(k, 1) < 0.4) put(rock(k, 5), k, 5, { s0: 0.35, s1: 0.6, squash: 0.6, color: new THREE.Color(0xc9a77a) });
        if (rnd(k, 3) < 0.3) put(items.tuft, k, 6, { color: new THREE.Color(0x9c8a4e), s0: 0.9, s1: 1.3 });
      } else if (t === 'ice') {
        const n = 1 + Math.floor(rnd(k, 1) * 3);
        for (let i = 0; i < n; i++) put(items.shard, k, i + 60, { s0: 0.6, s1: 1.3, y: -0.03 });
      }
    }
    const geos = { pine0: pineGeos[0], pine1: pineGeos[1], leafy0: leafyGeos[0], leafy1: leafyGeos[1], pineTrunk: pineTrunkGeo, leafyTrunk: leafyTrunkGeo,
      rock0: rockGeos[0], rock1: rockGeos[1], rock2: rockGeos[2], shard: shardGeo, bush: bushGeo, tuft: tuftGeo };
    const matFor = { pine0: M.pineLeaves, pine1: M.pineLeaves, leafy0: M.broadLeaves, leafy1: M.broadLeaves, pineTrunk: M.trunk, leafyTrunk: M.trunk,
      rock0: M.stone, rock1: M.stone, rock2: M.stone, shard: M.crystal, bush: M.foliage, tuft: M.grassBits };
    for (const [name, list] of Object.entries(items)) {
      if (!list.length) continue;
      const mesh = new THREE.InstancedMesh(geos[name], matFor[name], list.length);
      mesh.castShadow = name !== 'tuft';
      mesh.receiveShadow = true;
      list.forEach((d, i) => {
        tmp.position.set(d.x, d.y, d.z);
        tmp.rotation.set(0, d.rot, 0);
        tmp.scale.set(d.s, d.s * d.squash, d.s);
        tmp.updateMatrix();
        mesh.setMatrixAt(i, tmp.matrix);
        if (d.color) mesh.setColorAt(i, d.color);
      });
      if (name === 'tuft') { this.tufts = mesh; mesh.visible = this.detail !== 'low'; } // thousands of tiny cones: skipped on low graphics
      this.group.add(mesh);
    }
  }

  // 'high' | 'low' graphics (see view.setQuality)
  setDetail(level) {
    this.detail = level;
    if (this.tufts) this.tufts.visible = level !== 'low';
  }

  addPickable(mesh, keys) {
    mesh.userData.keys = keys;
    this.group.add(mesh);
    this.pickables.push(mesh);
  }

  clear() {
    for (const o of [...this.group.children]) {
      this.group.remove(o);
      if (o.isInstancedMesh) o.dispose();
      if (o.material && !o.material.userData?.shared) o.material.dispose?.();
    }
    this.pickables = [];
  }

  // Hex key under the pointer, or null.
  pick(raycaster) {
    const hit = raycaster.intersectObjects(this.pickables, false)[0];
    return hit ? hit.object.userData.keys[hit.instanceId] : null;
  }

  // items: [{ key, color, strong }]
  setHighlights(items) {
    let n = 0;
    for (const { key: k, color, strong } of items) {
      const p = this.pos[k];
      if (!p) continue;
      tmp.position.set(p.x, this.surfaceY(k) + 0.02, p.z);
      tmp.scale.setScalar(strong ? 1 : 0.94);
      tmp.rotation.set(0, 0, 0);
      tmp.updateMatrix();
      col.set(color);
      this.fill.setMatrixAt(n, tmp.matrix);
      this.ring.setMatrixAt(n, tmp.matrix);
      this.fill.setColorAt(n, col);
      this.ring.setColorAt(n, col);
      n++;
    }
    for (const m of [this.fill, this.ring]) {
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }

  setHover(k, color = 0xffffff) {
    if (!k || !this.pos[k]) { this.hover.visible = false; return; }
    const p = this.pos[k];
    this.hover.position.set(p.x, this.surfaceY(k) + 0.03, p.z);
    this.hover.material.color.set(color);
    this.hover.visible = true;
  }

  update(t) {
    const M = materials();
    M.caps.lava.emissiveIntensity = 1.4 + 0.4 * Math.sin(t * 1.6);
    M.ooze.value.set(t * 0.006, t * 0.004);
    M.flow.value.set(t * 0.03, t * 0.017);
    M.wind.value = t;
  }
}

// Small per-hex brightness variation so large areas don't look flat.
function vary(color, k, amount) {
  const h = (hashSeed(k) % 1000) / 1000 - 0.5;
  return color.offsetHSL(0, 0, h * amount);
}
