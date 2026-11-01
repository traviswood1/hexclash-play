// Procedural, seamlessly tiling terrain textures painted on canvases at startup (no image files).
// Each terrain gets a color map and a bump (height) map; lava also gets a glow map and water a
// normal map for ripples. Swap any of these for real photo textures later: keep the same keys.
import * as THREE from 'three';

const SIZE = 256;

// ---------- tileable value noise ----------
function makeNoise(seed) {
  const hash = (x, y) => {
    let h = seed ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const s = t => t * t * (3 - 2 * t);
  // period p keeps the noise seamless across the texture edge
  const value = (x, y, p) => {
    const ix = Math.floor(x), iy = Math.floor(y), fx = s(x - ix), fy = s(y - iy);
    const m = v => ((v % p) + p) % p;
    const a = hash(m(ix), m(iy)), b = hash(m(ix + 1), m(iy)), c = hash(m(ix), m(iy + 1)), d = hash(m(ix + 1), m(iy + 1));
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
  // u, v in 0..1; base = features across the texture
  return (u, v, base = 4, octaves = 4) => {
    let sum = 0, amp = 1, norm = 0, f = base;
    for (let i = 0; i < octaves; i++) {
      sum += amp * value(u * f, v * f, f);
      norm += amp; amp *= 0.5; f *= 2;
    }
    return sum / norm;
  };
}
// thin bright lines along noise "valleys" (cracks, veins)
const ridge = (n, width) => Math.max(0, 1 - Math.abs(n - 0.5) / width);

const clamp01 = v => Math.min(1, Math.max(0, v));
const mix = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);

// Paints a texture by calling fn(u, v) -> { c: [r,g,b] 0..255, h: 0..1, e?: [r,g,b] }.
function paint(fn) {
  const make = () => { const c = document.createElement('canvas'); c.width = c.height = SIZE; return c; };
  const color = make(), bump = make(), glow = make();
  const cd = color.getContext('2d').createImageData(SIZE, SIZE);
  const bd = bump.getContext('2d').createImageData(SIZE, SIZE);
  const gd = glow.getContext('2d').createImageData(SIZE, SIZE);
  let hasGlow = false;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const { c, h, e } = fn(x / SIZE, y / SIZE);
      const i = (y * SIZE + x) * 4;
      cd.data.set([c[0], c[1], c[2], 255], i);
      const hv = clamp01(h) * 255;
      bd.data.set([hv, hv, hv, 255], i);
      if (e) { hasGlow = true; gd.data.set([e[0], e[1], e[2], 255], i); } else gd.data.set([0, 0, 0, 255], i);
    }
  }
  color.getContext('2d').putImageData(cd, 0, 0);
  bump.getContext('2d').putImageData(bd, 0, 0);
  glow.getContext('2d').putImageData(gd, 0, 0);
  const tex = (canvas, srgb) => {
    const t = new THREE.CanvasTexture(canvas);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  return { map: tex(color, true), bump: tex(bump, false), glow: hasGlow ? tex(glow, true) : null, bumpCanvas: bump };
}

// Normal map from a height canvas (for water ripples).
function normalFromHeight(canvas, strength = 2) {
  const src = canvas.getContext('2d').getImageData(0, 0, SIZE, SIZE).data;
  const out = document.createElement('canvas');
  out.width = out.height = SIZE;
  const ctx = out.getContext('2d');
  const img = ctx.createImageData(SIZE, SIZE);
  const h = (x, y) => src[(((y + SIZE) % SIZE) * SIZE + ((x + SIZE) % SIZE)) * 4] / 255;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dx = (h(x + 1, y) - h(x - 1, y)) * strength, dy = (h(x, y + 1) - h(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      img.data.set([(-dx / len * 0.5 + 0.5) * 255, (-dy / len * 0.5 + 0.5) * 255, (1 / len * 0.5 + 0.5) * 255, 255], (y * SIZE + x) * 4);
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(out);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// ---------- the terrains ----------
const n1 = makeNoise(11), n2 = makeNoise(23), n3 = makeNoise(37), n4 = makeNoise(51);

const PAINTERS = {
  grass: (u, v) => {
    const base = n1(u, v, 3, 5), blades = n2(u, v, 48, 2), dirt = n3(u, v, 5, 3);
    let c = mix([62, 112, 40], [118, 160, 62], base);
    c = mix(c, [150, 182, 86], clamp01((blades - 0.6) * 3));        // light blade tips
    c = mix(c, [40, 80, 30], clamp01((0.38 - blades) * 3));          // dark blade shadows
    c = mix(c, [112, 92, 60], clamp01((dirt - 0.72) * 5) * 0.7);     // worn dirt patches
    return { c, h: base * 0.4 + blades * 0.6 };
  },
  forest: (u, v) => {
    const base = n1(u + 0.3, v, 4, 5), leaves = n2(u, v, 40, 2), moss = n3(u, v, 6, 3);
    let c = mix([44, 62, 30], [78, 96, 44], base);
    c = mix(c, [104, 76, 42], clamp01((leaves - 0.62) * 4));         // fallen leaves
    c = mix(c, [58, 92, 40], clamp01((moss - 0.6) * 3));             // moss
    return { c, h: base * 0.5 + leaves * 0.5 };
  },
  sand: (u, v) => {
    const warp = n1(u, v, 3, 3), grains = n2(u, v, 96, 1);
    const ripple = 0.5 + 0.5 * Math.sin((v * 10 + warp * 3) * Math.PI * 2);
    let c = mix([196, 168, 112], [228, 204, 150], warp * 0.6 + ripple * 0.4);
    c = c.map(x => x + (grains - 0.5) * 30);
    return { c, h: ripple * 0.7 + grains * 0.3 };
  },
  rock: (u, v) => {
    const base = n1(u, v, 4, 5), cracks = ridge(n2(u, v, 5, 4), 0.035), lichen = n3(u, v, 10, 3);
    let c = mix([92, 90, 86], [150, 146, 138], base);
    c = mix(c, [54, 52, 50], cracks);
    c = mix(c, [128, 136, 84], clamp01((lichen - 0.72) * 4) * 0.6);
    return { c, h: base * 0.8 - cracks * 0.5 + 0.2 };
  },
  // snow: soft matte white with wind-blown drifts and cool blue hollows. Kept a bit below pure white
  // so pale figures standing on it still read.
  snow: (u, v) => {
    const warp = n1(u, v, 3, 4), sparkle = n2(u, v, 120, 1), lumps = n3(u, v, 7, 3);
    const drift = 0.5 + 0.5 * Math.sin((u * 3 + v * 2 + warp * 2.2) * Math.PI * 2);
    let c = mix([176, 186, 202], [218, 222, 228], drift * 0.55 + lumps * 0.45);
    if (sparkle > 0.86) c = [236, 240, 246];
    return { c, h: drift * 0.6 + lumps * 0.4 };
  },
  // ice: deep clear blue with white fracture lines and a few trapped bubbles
  ice: (u, v) => {
    const base = n1(u, v, 3, 4), cracks = ridge(n2(u, v, 4, 4), 0.025), fine = ridge(n4(u, v, 9, 3), 0.015), bubbles = n3(u, v, 40, 1);
    let c = mix([28, 104, 168], [92, 172, 218], base);
    c = mix(c, [236, 248, 255], Math.max(cracks, fine * 0.6));
    if (bubbles > 0.84) c = mix(c, [200, 236, 252], 0.6);
    return { c, h: 0.5 + cracks * 0.4 + fine * 0.2 };
  },
  lava: (u, v) => {
    const crust = n1(u, v, 4, 5), veins = ridge(n2(u, v, 4, 4), 0.06), pools = n3(u, v, 3, 3);
    const hot = clamp01(veins + clamp01((pools - 0.68) * 4));
    const c = mix(mix([34, 26, 24], [70, 50, 40], crust), [255, 120, 30], hot);
    const e = mix([0, 0, 0], [255, 150, 40], hot).map(x => x * (0.6 + 0.4 * crust));
    return { c, h: crust * (1 - hot), e };
  },
  water: (u, v) => {
    const base = n1(u, v, 3, 4), waves = n2(u, v, 8, 3);
    const c = mix([24, 74, 120], [46, 120, 168], base * 0.6 + waves * 0.4);
    return { c, h: waves };
  },
  // unit bases: clean dark grey stone, faint mottling and a few hairline veins
  basalt: (u, v) => {
    const base = n1(u, v, 3, 4), veins = ridge(n2(u, v, 3, 4), 0.012), grain = n3(u, v, 80, 1);
    let c = mix([36, 38, 42], [56, 58, 63], base);
    c = mix(c, [80, 83, 89], veins * 0.5);
    c = c.map(x => x + (grain - 0.5) * 8);
    return { c, h: base * 0.5 + grain * 0.3 + veins * 0.2 };
  },
  // column sides: light earth strata, tinted per terrain by the instance color
  side: (u, v) => {
    const warp = n1(u, v, 4, 3), stones = n2(u, v, 14, 3), grain = n3(u, v, 64, 1);
    const band = 0.5 + 0.5 * Math.sin((v * 7 + warp * 1.5) * Math.PI * 2);
    let c = mix([168, 160, 150], [222, 214, 202], band * 0.6 + warp * 0.4);
    c = mix(c, [120, 116, 112], clamp01((stones - 0.7) * 4));
    c = c.map(x => x + (grain - 0.5) * 24);
    return { c, h: band * 0.4 + clamp01((stones - 0.7) * 4) * 0.6 };
  },
};

let cache = null;
export function terrainTextures() {
  if (cache) return cache;
  cache = {};
  for (const [k, fn] of Object.entries(PAINTERS)) cache[k] = paint(fn);
  cache.water.normal = normalFromHeight(cache.water.bumpCanvas, 3);
  return cache;
}

// Photo-based CC0 terrain sets from Poly Haven (assets/textures, see CREDITS.md): { map, normal, rough }.
// Loaded once; the textures fill in when the images arrive.
export const PHOTO_SETS = ['grass', 'forest', 'sand', 'rock', 'snow', 'cliff'];
// colour maps drained toward grey (0..1): the rock photo has green moss that reads like forest
const DESATURATE = { rock: 0.3 };
let photos = null;

function desaturate(t, amount) {
  const img = t.image, c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height), p = d.data;
  for (let i = 0; i < p.length; i += 4) {
    const y = 0.3 * p[i] + 0.59 * p[i + 1] + 0.11 * p[i + 2];
    for (let j = 0; j < 3; j++) p[i + j] += (y - p[i + j]) * amount;
  }
  g.putImageData(d, 0, 0);
  t.image = c;
  t.needsUpdate = true;
}

export function photoTextures() {
  if (photos) return photos;
  const loader = new THREE.TextureLoader();
  const load = (file, srgb, grey = 0) => {
    const t = loader.load(`assets/textures/${file}.jpg`, grey ? tex => desaturate(tex, grey) : undefined);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  photos = {};
  for (const k of PHOTO_SETS) photos[k] = { map: load(`${k}_diff`, true, DESATURATE[k]), normal: load(`${k}_nor`), rough: load(`${k}_rough`) };
  return photos;
}

// Makes a material sample its textures by world position instead of the mesh's own UVs, so the
// textures run seamlessly across neighbouring hexes. side: project onto the column walls instead
// of the ground plane. offset: a { value: Vector2 } uniform to scroll the texture (water, lava).
export function worldUV(material, scale, { side = false, offset = { value: new THREE.Vector2() } } = {}) {
  material.onBeforeCompile = sh => {
    sh.uniforms.uWorldScale = { value: scale };
    sh.uniforms.uUvOffset = offset;
    sh.vertexShader = 'uniform float uWorldScale;\nuniform vec2 uUvOffset;\n' + sh.vertexShader.replace('#include <uv_vertex>', `#include <uv_vertex>
      vec4 wpos = vec4(position, 1.0);
      mat3 nm = mat3(modelMatrix);
      #ifdef USE_INSTANCING
        wpos = instanceMatrix * wpos;
        nm = nm * mat3(instanceMatrix);
      #endif
      wpos = modelMatrix * wpos;
      ${side ? 'vec3 wn = normalize(nm * normal); vec2 wuv = vec2(dot(wpos.xz, vec2(-wn.z, wn.x)), wpos.y);' : 'vec2 wuv = wpos.xz;'}
      wuv = wuv * uWorldScale + uUvOffset;
      #ifdef USE_MAP
        vMapUv = wuv;
      #endif
      #ifdef USE_BUMPMAP
        vBumpMapUv = wuv;
      #endif
      #ifdef USE_EMISSIVEMAP
        vEmissiveMapUv = wuv;
      #endif
      #ifdef USE_NORMALMAP
        vNormalMapUv = wuv;
      #endif
      #ifdef USE_ROUGHNESSMAP
        vRoughnessMapUv = wuv;
      #endif`);
  };
  material.customProgramCacheKey = () => `worldUV-${side}`;
  return material;
}
