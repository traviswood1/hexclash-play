// The world around the board: a sky (stars, moon or sun, aurora or nebula), silhouettes on the
// horizon (mountains, hills or a forest), dark ground, a carved stone dais the board sits on (with a
// glowing rune ring and braziers) and drifting mist. All of it is decoration: nothing here is pickable.
//   const env = createEnvironment(scene, { sun, hemi, renderer });
//   env.setTheme('night'); env.fit(boardRadius); env.update(t, dt, camera) every frame
// Backdrops are data in THEMES below: add one by copying an entry.
// The board stands on a giant tree-stump table (assets/models/props/tree_table.glb, loaded by loadTable()
// before the scene is built); without it, on a two-tier stone dais.
// Braziers use assets/models/props/brazier.glb when it exists (fire sits on top of its bounding box);
// otherwise a simple stone pillar and iron bowl.
import * as THREE from 'three';
import { makeGLTFLoader } from './loader.js';
import { terrainTextures } from './terrainTextures.js';
import { hashSeed } from '../core/rng.js';

//   zenith/horizon  sky colours (fog uses the horizon colour, so distant ground melts into the sky)
//   band            extra glow along the horizon     glow/glowDir  haze around the moon or sun
//   orb             moon/sun colour (orbSize 0 = none)  stars/aurora/nebula  0..1+ strengths
//   ridges          horizon silhouettes: style peaks | hills | trees | none, 3 layers [base, top] near->far
//   key/hemi        light colours and strengths; exposure  tone-mapping exposure
export const THEMES = {
  night: {
    name: 'Night Dais', zenith: 0x03050b, horizon: 0x111527, band: 0x0d0d1a, glow: 0x2a2f52, glowDir: [-0.55, 0.42, -0.72],
    orb: 0xdfe6ff, orbSize: 26, stars: 1, aurora: 0, nebula: 0,
    ridges: { style: 'peaks', layers: [[0x07080f, 0x1e2540], [0x0a0c16, 0x283152], [0x0d1020, 0x323c62]] },
    ground: 0x161820, mist: 0x6a75a8, mistOpacity: 0.22, rune: 0x6fb4ff,
    key: 0xc8d4ff, keyI: 2.3, sky: 0x8fa4d8, gnd: 0x2a2230, hemiI: 0.45, exposure: 0.95,
  },
  twilight: {
    name: 'Twilight Highlands', zenith: 0x0b0d22, horizon: 0x4a2636, band: 0x3a1420, glow: 0xff7a3a, glowDir: [0.62, 0.06, -0.78],
    orb: 0xffb070, orbSize: 46, stars: 0.35, aurora: 0, nebula: 0,
    ridges: { style: 'hills', layers: [[0x120c18, 0x2a1a30], [0x1a1022, 0x3a2440], [0x24152e, 0x52345a]] },
    ground: 0x1c1418, mist: 0xc08aa0, mistOpacity: 0.26, rune: 0xffb070,
    key: 0xffc49a, keyI: 2.4, sky: 0xb08aa8, gnd: 0x2a1a20, hemiI: 0.5, exposure: 1.0,
  },
  volcano: {
    name: 'Volcanic Caldera', zenith: 0x070202, horizon: 0x3a0b05, band: 0x5a1406, glow: 0xff3a10, glowDir: [0.2, 0.02, -1],
    orb: 0, orbSize: 0, stars: 0, aurora: 0, nebula: 0,
    ridges: { style: 'peaks', layers: [[0x040101, 0x2a0804], [0x060202, 0x3e0c05], [0x0a0303, 0x5a1408]] },
    ground: 0x1a0e0a, mist: 0xff6a3a, mistOpacity: 0.14, rune: 0xff6a2a,
    key: 0xffb08a, keyI: 2.1, sky: 0xff8a6a, gnd: 0x2a0a05, hemiI: 0.45, exposure: 0.95,
  },
  frozen: {
    name: 'Frozen Peaks', zenith: 0x020814, horizon: 0x0f2a3a, band: 0x0a1e2a, glow: 0x2a5a7a, glowDir: [-0.4, 0.5, -0.75],
    orb: 0xcfe8ff, orbSize: 22, stars: 1, aurora: 2.2, nebula: 0,
    ridges: { style: 'peaks', layers: [[0x060c16, 0x4a6478], [0x08101e, 0x5e7a90], [0x0c1628, 0x7690a8]] },
    ground: 0x1a2430, mist: 0xbfe0ff, mistOpacity: 0.3, rune: 0x8fe8ff,
    key: 0xd0e8ff, keyI: 2.4, sky: 0xa0c8ff, gnd: 0x203040, hemiI: 0.55, exposure: 0.95,
  },
  grove: {
    name: 'Ancient Grove', zenith: 0x020604, horizon: 0x0f2418, band: 0x0a1a10, glow: 0x3a6a3a, glowDir: [0.3, 0.55, -0.75],
    orb: 0xd8ffd0, orbSize: 18, stars: 0.25, aurora: 0, nebula: 0,
    ridges: { style: 'trees', layers: [[0x030805, 0x0f2414], [0x050c08, 0x16301c], [0x081208, 0x1e3a22]] },
    ground: 0x10180f, mist: 0x8ac89a, mistOpacity: 0.28, rune: 0x8aff9a,
    key: 0xc8e8c0, keyI: 2.2, sky: 0x9ac8a0, gnd: 0x1a2410, hemiI: 0.45, exposure: 0.95,
  },
  void: {
    name: 'Astral Void', zenith: 0x05020f, horizon: 0x1a0a2e, band: 0x220c3a, glow: 0x6a3aa0, glowDir: [0.45, 0.5, -0.74],
    orb: 0xb08aff, orbSize: 70, stars: 1.6, aurora: 0, nebula: 1,
    ridges: { style: 'none', layers: [] },
    ground: null, mist: 0x8a6ad8, mistOpacity: 0, rune: 0xc08aff,
    key: 0xd8c8ff, keyI: 2.3, sky: 0xa08ad8, gnd: 0x1a0a2a, hemiI: 0.5, exposure: 1.0,
  },
};

// kept for other modules (view.js) that read the default colours
export const PALETTE = { horizon: THEMES.night.horizon, stone: 0x3a3d48, fire: 0xff8a3a };

const GROUND_Y = -3.2;    // the dark land around the dais
const DAIS_TOP = -1.5;    // the board's columns start here (BOTTOM in board.js)

// ---------- the stump table ----------
// The model's round top is measured on load, so another table model can be dropped in.
const TABLE = { url: 'assets/models/props/tree_table.glb', model: null, top: 0, bottom: 0, radius: 1, profile: [] };
const PROFILE_BANDS = 40; // tabletop height sampled in rings from the centre out (the top dips toward the rim)
export const TABLE_MARGIN = 1.8; // tabletop showing past the board's corners
let groundLevel = GROUND_Y;      // where the table's roots meet the land (set by fit)

export async function loadTable() {
  try {
    const m = (await makeGLTFLoader().loadAsync(TABLE.url)).scene;
    const box = new THREE.Box3().setFromObject(m);
    const radius = Math.min(box.max.x - box.min.x, box.max.z - box.min.z) / 2;
    const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
    const profile = new Array(PROFILE_BANDS + 1).fill(-Infinity);
    m.updateMatrixWorld(true);
    const v = new THREE.Vector3();
    m.traverse(o => {
      if (!o.isMesh) return;
      const pos = o.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
        const b = Math.min(PROFILE_BANDS, Math.floor((Math.hypot(v.x - cx, v.z - cz) / radius) * PROFILE_BANDS));
        profile[b] = Math.max(profile[b], v.y);
      }
    });
    // the top is sparse near the middle (few vertices on a flat disc), so a ring there may only catch
    // the trunk inside: carry the height inward, the wood is never lower toward the centre
    for (let b = PROFILE_BANDS - 1; b >= 0; b--) profile[b] = Math.max(profile[b], profile[b + 1]);
    Object.assign(TABLE, { model: m, top: box.max.y, bottom: box.min.y, radius, profile });
  } catch { /* no table model: the stone dais is used instead */ }
}

// A stump table with its top (radius `radius`) at `topY`, roots reaching down to the land.
// Null when the model isn't there. table.userData.surfaceAt(dx, dz) gives the height of the wood at an
// offset from the table's centre, so things set near the rim sit on it instead of floating.
export function makeTable(radius, topY) {
  if (!TABLE.model) return null;
  const m = TABLE.model.clone(true);
  const sy = (topY - groundLevel) / (TABLE.top - TABLE.bottom);
  m.scale.set(radius / TABLE.radius, sy, radius / TABLE.radius);
  m.position.y = topY - TABLE.top * sy;
  m.userData.surfaceAt = (dx, dz) => {
    const f = Math.min(1, Math.hypot(dx, dz) / radius) * PROFILE_BANDS, b = Math.floor(f);
    const h = TABLE.profile[b] + (TABLE.profile[Math.min(PROFILE_BANDS, b + 1)] - TABLE.profile[b]) * (f - b);
    return topY - (TABLE.top - h) * sy;
  };
  m.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = o.receiveShadow = true;
    o.material.envMapIntensity = 0.25;
  });
  return m;
}

const rand = (k, i) => (hashSeed(`${k}:${i}`) % 100000) / 100000;

const SKY_FRAG = `
  uniform vec3 zenith, horizon, band, glow, glowDir; uniform float aurora, nebula, time;
  varying vec3 vDir;
  float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
  float noise(vec3 p) {
    vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
  float fbm(vec3 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * noise(p); p *= 2.1; a *= 0.5; } return s; }
  void main() {
    vec3 d = normalize(vDir);
    float h = clamp(d.y, 0.0, 1.0);
    vec3 c = mix(horizon, zenith, smoothstep(0.0, 0.55, h));
    c += band * (1.0 - smoothstep(0.0, 0.2, h));
    float m = max(dot(d, normalize(glowDir)), 0.0);
    c += glow * (pow(m, 8.0) * 0.9 + pow(m, 64.0) * 1.5);
    if (aurora > 0.0) { // curtains of light low in the sky
      float ang = atan(d.z, d.x);
      float curtain = 0.5 + 0.5 * sin(ang * 5.0 + time * 0.15 + sin(h * 14.0 + time * 0.4 + ang * 2.0) * 1.4);
      float shape = smoothstep(0.06, 0.18, h) * (1.0 - smoothstep(0.3, 0.6, h));
      float flicker = fbm(vec3(ang * 3.0, h * 8.0 - time * 0.2, time * 0.05));
      c += aurora * shape * pow(curtain, 3.0) * flicker * mix(vec3(0.1, 1.0, 0.55), vec3(0.4, 0.3, 1.0), h * 1.6) * 0.9;
    }
    if (nebula > 0.0) { // drifting clouds of colour
      float n1 = fbm(d * 3.0 + vec3(time * 0.01, 0.0, 0.0));
      float n2 = fbm(d * 5.0 + vec3(4.0, time * 0.012, 2.0));
      c += nebula * (vec3(0.55, 0.15, 0.75) * pow(n1, 3.0) * 1.1 + vec3(0.1, 0.35, 0.7) * pow(n2, 4.0) * 1.0);
    }
    gl_FragColor = vec4(c, 1.0);
  }`;

export function createEnvironment(scene, { sun = null, hemi = null, renderer = null } = {}) {
  const root = new THREE.Group();
  scene.add(root);
  const stage = new THREE.Group();   // rebuilt by fit() to match the board size
  const skyline = new THREE.Group(); // rebuilt by setTheme()
  root.add(stage, skyline);
  const tx = terrainTextures();
  let theme = THEMES.night;

  // ---------- sky dome ----------
  const skyUniforms = {
    zenith: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, band: { value: new THREE.Color() },
    glow: { value: new THREE.Color() }, glowDir: { value: new THREE.Vector3() },
    aurora: { value: 0 }, nebula: { value: 0 }, time: { value: 0 },
  };
  const sky = new THREE.Mesh(new THREE.SphereGeometry(600, 48, 24), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false, uniforms: skyUniforms,
    vertexShader: `varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: SKY_FRAG,
  }));
  sky.renderOrder = -10;
  root.add(sky);

  // ---------- stars: twinkling points on the upper sky ----------
  const starCount = 1600;
  const sp = new Float32Array(starCount * 3), sa = new Float32Array(starCount * 2);
  for (let i = 0; i < starCount; i++) {
    const y = 0.08 + rand('sy', i) * 0.92, a = rand('sa', i) * Math.PI * 2, r = Math.sqrt(1 - y * y);
    sp.set([Math.cos(a) * r * 560, y * 560, Math.sin(a) * r * 560], i * 3);
    sa.set([0.3 + rand('sb', i) ** 3 * 1.4, rand('sp', i) * 6.28], i * 2);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  starGeo.setAttribute('star', new THREE.BufferAttribute(sa, 2));
  const starMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
    uniforms: { time: { value: 0 }, bright: { value: 1 } },
    vertexShader: `attribute vec2 star; uniform float time, bright; varying float vA;
      void main() { vA = bright * star.x * (0.65 + 0.35 * sin(time * (0.6 + star.y * 0.3) + star.y * 5.0));
        gl_PointSize = 1.2 + star.x * 1.4; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying float vA; void main() { float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard;
      gl_FragColor = vec4(vec3(0.85, 0.9, 1.0) * vA * (1.0 - d * 2.0), 1.0); }`,
  });
  const stars = new THREE.Points(starGeo, starMat);
  stars.renderOrder = -9;
  root.add(stars);

  // ---------- moon / sun / planet ----------
  const orb = new THREE.Sprite(new THREE.SpriteMaterial({ map: discTexture(), fog: false, depthWrite: false }));
  root.add(orb);

  // ---------- ground: dark, gently uneven rock that fades into the fog ----------
  const groundGeo = new THREE.PlaneGeometry(900, 900, 90, 90).rotateX(-Math.PI / 2);
  const gp = groundGeo.attributes.position;
  for (let i = 0; i < gp.count; i++) {
    const x = gp.getX(i), z = gp.getZ(i), d = Math.hypot(x, z);
    const bump = (Math.sin(x * 0.05) + Math.cos(z * 0.043) + Math.sin((x + z) * 0.021)) * 0.35;
    gp.setY(i, d < 40 ? 0 : bump * Math.min(1, (d - 40) / 60));
  }
  groundGeo.computeVertexNormals();
  const groundTex = tx.basalt.map.clone();
  groundTex.repeat.set(90, 90);
  groundTex.needsUpdate = true;
  const ground = new THREE.Mesh(groundGeo, new THREE.MeshStandardMaterial({ map: groundTex, roughness: 1, envMapIntensity: 0.1 }));
  ground.position.y = GROUND_Y;
  ground.receiveShadow = true;
  root.add(ground);

  // ---------- mist: a soft cloud ring hugging the ground around the dais ----------
  const mistMat = new THREE.MeshBasicMaterial({ map: cloudTexture(), transparent: true, depthWrite: false });
  const runeMat = new THREE.MeshBasicMaterial({ map: runeTexture(), transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending });
  let mist = null, flames = [], lights = [], sparks = [], stageRadius = null;
  let brazierModel = null; // set when assets/models/props/brazier.glb loads
  makeGLTFLoader().loadAsync('assets/models/props/brazier.glb').then(gltf => {
    brazierModel = gltf.scene;
    if (stageRadius !== null) fit(stageRadius); // rebuild with the model
  }).catch(() => { /* no brazier model yet: keep the built-in one */ });

  function setTheme(key) {
    theme = THEMES[key] ?? THEMES.night;
    const T = theme;
    skyUniforms.zenith.value.set(T.zenith);
    skyUniforms.horizon.value.set(T.horizon);
    skyUniforms.band.value.set(T.band);
    skyUniforms.glow.value.set(T.glow);
    skyUniforms.glowDir.value.set(...T.glowDir).normalize();
    skyUniforms.aurora.value = T.aurora;
    skyUniforms.nebula.value = T.nebula;
    stars.visible = T.stars > 0;
    starMat.uniforms.bright.value = T.stars;
    orb.visible = T.orbSize > 0;
    if (orb.visible) {
      orb.material.color.set(T.orb);
      orb.position.copy(skyUniforms.glowDir.value).multiplyScalar(540);
      orb.scale.setScalar(T.orbSize);
    }
    for (const o of [...skyline.children]) { skyline.remove(o); o.geometry.dispose(); }
    T.ridges.layers.forEach(([base, top], layer) => {
      const [radius, peak] = [[260, 34], [330, 52], [410, 70]][layer];
      const m = new THREE.Mesh(ridge(radius, peak, layer, base, top, T.ridges.style),
        new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, side: THREE.DoubleSide }));
      m.renderOrder = -8 + layer;
      skyline.add(m);
    });
    ground.visible = T.ground !== null;
    if (ground.visible) ground.material.color.set(T.ground);
    mistMat.color.set(T.mist);
    mistMat.opacity = T.mistOpacity;
    runeMat.color.set(T.rune);
    if (scene.fog) scene.fog.color.set(T.horizon);
    if (scene.background?.isColor) scene.background.set(T.horizon);
    if (sun) { sun.color.set(T.key); sun.intensity = T.keyI; }
    if (hemi) { hemi.color.set(T.sky); hemi.groundColor.set(T.gnd); hemi.intensity = T.hemiI; }
    if (renderer) renderer.toneMappingExposure = T.exposure;
  }

  function fit(boardRadius) {
    stageRadius = boardRadius;
    for (const o of [...stage.children]) stage.remove(o);
    flames = []; lights = []; sparks = [];
    const r = boardRadius + TABLE_MARGIN;
    const onTable = !!TABLE.model;
    // the table keeps the model's proportions, so a bigger board means a taller stump
    groundLevel = onTable ? DAIS_TOP - (TABLE.top - TABLE.bottom) * (r / TABLE.radius) : GROUND_Y;
    ground.position.y = groundLevel;
    skyline.position.y = groundLevel - GROUND_Y; // mountains keep their height above the land

    // two-tier hex dais (the board's outline is a flat-sided hexagon with a corner at +x)
    const stoneTex = tx.basalt.map.clone();
    stoneTex.repeat.set(6, 2);
    stoneTex.needsUpdate = true;
    const stone = new THREE.MeshStandardMaterial({ map: stoneTex, bumpMap: tx.basalt.bump, bumpScale: 1.5, color: PALETTE.stone, roughness: 0.9, envMapIntensity: 0.15 });
    const tier = (radius, y0, y1) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 1.03, y1 - y0, 6).rotateY(Math.PI / 2).translate(0, (y0 + y1) / 2, 0), stone);
      m.receiveShadow = m.castShadow = true;
      stage.add(m);
    };
    const table = onTable ? makeTable(r, DAIS_TOP) : null;
    if (table) {
      stage.add(table);
    } else {
      tier(r, GROUND_Y + 0.6, DAIS_TOP);
      tier(r + 2.2, GROUND_Y, GROUND_Y + 0.6);
      // glowing rune ring set into the dais rim
      const ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.55, r - 0.15, 6, 1).rotateX(-Math.PI / 2), runeMat);
      ring.position.y = DAIS_TOP + 0.01;
      stage.add(ring);
    }
    // braziers: on the tabletop beside the middle of each board edge (where there's the most room),
    // or on the dais's lower tier off each corner
    const H = 2.1; // brazier height
    const bowlMat = new THREE.MeshStandardMaterial({ color: 0x2a2420, roughness: 0.6, metalness: 0.5 });
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3 + (onTable ? Math.PI / 6 : 0);
      const d = onTable ? (boardRadius * 0.866 + r) / 2 : r + 1.1;
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      const y = table ? table.userData.surfaceAt(x, z) - 0.02 : GROUND_Y + 0.6; // feet pressed just into the wood
      let top = 1.92;     // height of the fire's base above the tier
      let bowlR = 0.42;   // inner radius of the bowl, for the charcoal pile
      if (brazierModel) {
        const m = brazierModel.clone(true);
        const box = new THREE.Box3().setFromObject(m);
        const s = H / Math.max(0.001, box.max.y - box.min.y);
        m.scale.setScalar(s);
        m.position.set(x - ((box.min.x + box.max.x) / 2) * s, y - box.min.y * s, z - ((box.min.z + box.max.z) / 2) * s);
        m.traverse(o => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
        stage.add(m);
        top = 0.925 * H;
        bowlR = Math.min(box.max.x - box.min.x, box.max.z - box.min.z) * s * 0.36; // inside the rim, clear of handles
      } else {
        const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.32, 1.6, 8).translate(0, 0.8, 0), stone);
        const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.25, 0.35, 12).translate(0, 1.75, 0), bowlMat);
        for (const m of [pillar, bowl]) { m.position.set(x, y, z); m.castShadow = true; stage.add(m); }
      }
      const coals = makeCoalPile(bowlR, i);
      coals.position.set(x, y + top - 0.12, z);
      stage.add(coals);
      // the fire rises from the top of the heaped coals, not from inside the pile
      const surface = y + top - 0.12 + bowlR * 0.33;
      const fire = makeFire(i, bowlR);
      fire.position.set(x, surface - 0.15, z); // base sunk a little into the coals
      stage.add(fire);
      const light = new THREE.PointLight(PALETTE.fire, 14, 16, 2);
      light.position.set(x, surface + 0.4, z);
      stage.add(light);
      const spark = makeSparks(x, surface - 0.1, z);
      stage.add(spark.points);
      flames.push(fire); lights.push(light); sparks.push(spark);
    }

    // mist ring just outside the dais
    mist = new THREE.Mesh(new THREE.RingGeometry(r + 2, r + 60, 64, 1).rotateX(-Math.PI / 2), mistMat);
    mist.position.y = groundLevel + 0.9;
    stage.add(mist);
  }

  function update(t, dt, camera) {
    starMat.uniforms.time.value = t;
    skyUniforms.time.value = t;
    runeMat.opacity = 0.55 + 0.3 * Math.sin(t * 1.3);
    fireUniforms.time.value = t;
    flames.forEach((f, i) => {
      // light flicker: a slow breath plus quick irregular jumps
      const k = 0.82 + 0.1 * Math.sin(t * 7.3 + i * 1.7) + 0.06 * Math.sin(t * 17.1 + i * 3.1) + 0.05 * Math.sin(t * 31.7 + i);
      lights[i].intensity = 13 * k;
      lights[i].position.x = f.position.x + Math.sin(t * 5.1 + i) * 0.06;
    });
    for (const sp of sparks) sp.update(t, dt);
    emberMat.emissiveIntensity = 1.0 + 0.35 * Math.sin(t * 2.3) + 0.15 * Math.sin(t * 7.1);
    if (mist) mist.rotation.y = t * 0.01;
  }

  setTheme('night');
  return { fit, update, setTheme, groundY: GROUND_Y, daisTop: DAIS_TOP };
}

// ---------- fire ----------
// A volumetric flame: a teardrop-shaped shell (wide at the base, licking to a point) whose surface
// sways and stretches, filled with 3D fire noise rising through it. Brightness comes from how directly
// you look through the shell, so it reads as a solid body of fire from the side AND from above.
// Two nested shells: a wide orange outer flame and a narrow white-hot core.
const fireUniforms = { time: { value: 0 } };
const FIRE_VERT = `
  uniform float time; uniform float seed; uniform float height;
  varying vec3 vPos; varying vec3 vNormal; varying vec3 vView;
  void main() {
    vec3 p = position;
    float h = clamp(p.y / height, 0.0, 1.0);
    // sway and stretch, stronger toward the tip
    p.x += (sin(time * 3.1 + seed + p.y * 4.0) * 0.07 + sin(time * 5.7 + seed * 2.0) * 0.03) * h;
    p.z += (cos(time * 2.6 + seed * 1.3 + p.y * 3.5) * 0.06 + cos(time * 6.3 + seed) * 0.025) * h;
    p.y *= 1.0 + (0.1 * sin(time * 7.3 + seed) + 0.06 * sin(time * 13.1 + seed * 3.0)) * h;
    vPos = position;
    vec4 wp = modelMatrix * vec4(p, 1.0);
    vView = normalize(cameraPosition - wp.xyz);
    vNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;
const FIRE_FRAG = `
  uniform float time; uniform float seed; uniform float height; uniform float intensity;
  varying vec3 vPos; varying vec3 vNormal; varying vec3 vView;
  float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
  float noise(vec3 p) {
    vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
  float fbm(vec3 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * noise(p); p *= 2.05; a *= 0.5; } return s; }
  void main() {
    float h = clamp(vPos.y / height, 0.0, 1.0);
    float n = fbm(vPos * vec3(5.0, 3.2, 5.0) + vec3(seed, -time * 2.8, seed * 0.5));
    float n2 = fbm(vPos * vec3(9.0, 6.0, 9.0) + vec3(seed * 2.0, -time * 4.5, 0.0));
    float facing = abs(dot(normalize(vNormal), normalize(vView)));   // 1 = looking straight through
    float body = pow(facing, 1.6);
    float tip = 1.0 - smoothstep(0.2 + n * 0.55, 0.85 + n2 * 0.15, h); // ragged, flickering top
    float licks = smoothstep(0.25, 0.75, n2 + (1.0 - h) * 0.45);      // gaps that rise through the flame
    float heat = body * tip * licks * (0.35 + 1.25 * n) * (1.15 - h * 0.55) * intensity;
    heat = clamp(heat, 0.0, 1.6);
    vec3 col = mix(vec3(0.5, 0.05, 0.0), vec3(1.0, 0.33, 0.03), smoothstep(0.05, 0.45, heat));
    col = mix(col, vec3(1.0, 0.72, 0.25), smoothstep(0.5, 0.9, heat));
    col = mix(col, vec3(1.0, 0.95, 0.8), smoothstep(0.95, 1.4, heat));
    gl_FragColor = vec4(col * heat, 1.0);
  }`;

// teardrop outline: rounded base, widest just above it, tapering to a point
function flameShell(radius, height, seed, intensity) {
  const pts = [];
  for (let k = 0; k <= 16; k++) {
    const t = k / 16, y = t * height;
    const r = radius * (t < 0.15 ? Math.sin((t / 0.15) * Math.PI / 2) : Math.pow(1 - (t - 0.15) / 0.85, 1.4));
    pts.push(new THREE.Vector2(Math.max(0.001, r), y));
  }
  const mat = new THREE.ShaderMaterial({
    uniforms: { time: fireUniforms.time, seed: { value: seed }, height: { value: height }, intensity: { value: intensity } },
    vertexShader: FIRE_VERT, fragmentShader: FIRE_FRAG,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const m = new THREE.Mesh(new THREE.LatheGeometry(pts, 20), mat);
  m.renderOrder = 5;
  return m;
}

// A brazier fire sitting on the coals. `radius` is the coal pile's radius.
function makeFire(i, radius = 0.42) {
  const g = new THREE.Group();
  g.add(flameShell(Math.min(0.55, radius * 1.05), 1.2, i * 1.37, 0.9));       // outer flame
  g.add(flameShell(Math.min(0.32, radius * 0.62), 0.8, i * 2.11 + 5.0, 1.5));  // white-hot core
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: discTexture(), color: 0xff6a20, transparent: true, opacity: 0.3,
    blending: THREE.AdditiveBlending, depthWrite: false }));
  glow.position.y = 0.3;
  glow.scale.set(2.0, 1.8, 1);
  g.add(glow);
  return g;
}

// Sparks thrown up by a brazier: quick, bright, short-lived, drifting as they rise.
function makeSparks(x, y, z) {
  const n = 24, pos = new Float32Array(n * 3), life = new Float32Array(n), vel = [];
  const reset = (i, t) => {
    pos.set([x + (Math.random() - 0.5) * 0.4, y + 0.2, z + (Math.random() - 0.5) * 0.4], i * 3);
    life[i] = 0.6 + Math.random() * 1.2;
    vel[i] = [(Math.random() - 0.5) * 0.5, 1.2 + Math.random() * 1.6, (Math.random() - 0.5) * 0.5];
  };
  for (let i = 0; i < n; i++) { reset(i); life[i] *= Math.random(); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const points = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffb05a, size: 0.07, transparent: true, opacity: 0.95,
    depthWrite: false, blending: THREE.AdditiveBlending }));
  return {
    points,
    update(t, dt) {
      for (let i = 0; i < n; i++) {
        life[i] -= dt;
        if (life[i] <= 0) { reset(i, t); continue; }
        const v = vel[i];
        v[0] += Math.sin(t * 3 + i) * dt * 0.6;
        pos[i * 3] += v[0] * dt; pos[i * 3 + 1] += v[1] * dt; pos[i * 3 + 2] += v[2] * dt;
      }
      geo.attributes.position.needsUpdate = true;
    },
  };
}

// A ring of horizon silhouettes: a strip of quads whose top edge follows layered noise.
// style: peaks (jagged mountains), hills (soft rolling), trees (spiky forest canopy)
function ridge(radius, peak, seed, baseColor, topColor, style = 'peaks') {
  const n = style === 'trees' ? 480 : 220, pos = [], col = [];
  const lo = new THREE.Color(baseColor), hi = new THREE.Color(topColor);
  const height = i => {
    const a = (i / n) * Math.PI * 2, k = i % n;
    if (style === 'hills') return peak * (0.42 + 0.22 * Math.sin(a * 2 + seed) + 0.12 * Math.sin(a * 5 + seed * 2) + 0.04 * rand(`h${seed}`, k));
    if (style === 'trees') return peak * (0.42 + 0.12 * Math.sin(a * 6 + seed) + (k % 2 ? 0.05 : 0.18 + 0.32 * rand(`t${seed}`, k) ** 2));
    return peak * (0.35 + 0.35 * Math.abs(Math.sin(a * 3 + seed)) + 0.2 * Math.abs(Math.sin(a * 11 + seed * 2)) + 0.1 * rand(`m${seed}`, k));
  };
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
    const h0 = height(i), h1 = height(i + 1);
    const p = (a, y) => [Math.cos(a) * radius, y, Math.sin(a) * radius];
    const b0 = p(a0, -60), b1 = p(a1, -60), t0 = p(a0, h0), t1 = p(a1, h1);
    pos.push(...b0, ...t0, ...t1, ...b0, ...t1, ...b1);
    for (const c of [lo, hi, hi, lo, hi, lo]) col.push(c.r, c.g, c.b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

function canvasTexture(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// soft round glow (moon, flames)
let disc = null;
function discTexture() {
  return disc ??= canvasTexture(128, (g, s) => {
    const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.75)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
  });
}

// puffy noise for mist
function cloudTexture() {
  const t = canvasTexture(256, (g, s) => {
    g.clearRect(0, 0, s, s);
    for (let i = 0; i < 70; i++) {
      const x = rand('cx', i) * s, y = rand('cy', i) * s, r = 20 + rand('cr', i) * 50;
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, 'rgba(255,255,255,0.35)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(4, 1);
  return t;
}

// a strip of glowing rune marks for the dais ring
function runeTexture() {
  const t = canvasTexture(256, (g, s) => {
    g.clearRect(0, 0, s, s);
    g.strokeStyle = 'rgba(255,255,255,0.95)';
    g.lineWidth = 6;
    g.lineCap = 'round';
    for (let i = 0; i < 8; i++) {
      const x = 16 + i * 30, y = s / 2;
      g.beginPath();
      const k = hashSeed(`rune${i}`);
      g.moveTo(x, y - 40);
      g.lineTo(x + ((k % 3) - 1) * 10, y + 40);
      if (k & 4) { g.moveTo(x - 10, y - 10); g.lineTo(x + 10, y + 10); }
      if (k & 8) { g.moveTo(x - 10, y + 15); g.lineTo(x + 12, y - 5); }
      g.stroke();
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(12, 1);
  return t;
}

// ---------- charcoal ----------
// A heaped pile of charcoal lumps filling a brazier bowl: mostly black, about a third glowing embers,
// over a hot orange bed that shows between the lumps.
const charcoalMat = new THREE.MeshStandardMaterial({ color: 0x0e0b09, roughness: 1, flatShading: true });
const emberMat = new THREE.MeshStandardMaterial({ color: 0x120804, emissive: 0xff3a0a, emissiveIntensity: 1.1, roughness: 0.95, flatShading: true });
const lumpGeo = new THREE.DodecahedronGeometry(1, 0);

function makeCoalPile(radius, seed) {
  const g = new THREE.Group();
  const bed = new THREE.Mesh(new THREE.CircleGeometry(radius, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({
    map: discTexture(), color: 0xff6a20, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
  bed.position.y = 0.02;
  bed.material.opacity = 0.7;
  g.add(bed);
  const count = Math.round(18 + radius * 60);
  for (let j = 0; j < count; j++) {
    const k = seed * 1000 + j;
    const d = Math.sqrt(rand('cd', k)) * radius * 0.9, a = rand('ca', k) * Math.PI * 2;
    const size = radius * (0.07 + rand('cs', k) * 0.07);
    const lump = new THREE.Mesh(lumpGeo, rand('ce', k) < 0.35 ? emberMat : charcoalMat);
    // heaped: lumps near the middle sit higher
    lump.position.set(Math.cos(a) * d, size * 0.6 + (1 - d / radius) * radius * 0.3, Math.sin(a) * d);
    lump.scale.set(size * (0.8 + rand('cx', k) * 0.5), size * (0.55 + rand('cy', k) * 0.4), size * (0.8 + rand('cz', k) * 0.5));
    lump.rotation.set(rand('r1', k) * 6, rand('r2', k) * 6, rand('r3', k) * 6);
    lump.castShadow = false;
    g.add(lump);
  }
  return g;
}
