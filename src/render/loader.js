import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

// Every model loader in the game: the web build (tools/build-web.mjs) meshopt-compresses the models.
export function makeGLTFLoader() { return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder); }
const gltfLoader = makeGLTFLoader();
const cache = {}; // unit key -> loaded glTF, or null when the unit uses its primitive builder
const fits = {};  // unit key -> { size, center, min } of the posed model, measured once

// Look applied to every model so assets from different sources match. Tweak here.
const GRIM = { desaturate: 0.08, darken: 0.95, minRoughness: 0.5, teamTint: 0 };

export async function loadManifest(url = 'assets/manifest.json') {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load ${url} (${res.status}). Are you running a local server?`);
  const manifest = await res.json();
  // pose templates (written by the character pipeline): a unit with no pose of its own uses its first one
  try {
    manifest.poseTemplates = await (await fetch(url.replace('manifest.json', 'pose-templates.json'))).json();
    for (const [key, list] of Object.entries(manifest.poseTemplates)) {
      const cfg = manifest.units[key];
      if (cfg && !cfg.pose && list[0]) { cfg.pose = { clip: list[0].clip, at: list[0].at }; cfg.poseFromTemplate = true; }
    }
  } catch { manifest.poseTemplates = {}; }
  // poses picked in pose-picker.html override the manifest's and the templates
  try {
    const poses = await (await fetch(url.replace('manifest.json', 'poses.json'))).json();
    for (const [key, pose] of Object.entries(poses)) {
      if (manifest.units[key]) { manifest.units[key].pose = pose; delete manifest.units[key].poseFromTemplate; }
    }
  } catch { /* no poses.json yet */ }
  return manifest;
}

// onProgress(done, total) is called as each model finishes (loaded or not).
export async function preloadUnits(manifest, onProgress = () => {}) {
  const entries = Object.entries(manifest.units);
  let done = 0;
  onProgress(0, entries.length);
  await Promise.all(entries.map(async ([key, cfg]) => {
    try {
      const gltf = cache[key] = await gltfLoader.loadAsync(cfg.model);
      // Measure with the skeleton applied: Meshy/Mixamo meshes are stored at a different size and
      // orientation than they render, so the raw mesh bounds give random sizes and offsets.
      gltf.scene.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(gltf.scene, true);
      fits[key] = { size: box.getSize(new THREE.Vector3()), center: box.getCenter(new THREE.Vector3()), min: box.min.clone() };
    } catch {
      cache[key] = null;
      console.info(`[assets] ${key}: no model at ${cfg.model}, using builder`);
    }
    onProgress(++done, entries.length);
  }));
}

// Returns { object, clips }, or null so the caller falls back to BUILDERS.
// Models are auto-fitted: feet on `baseY`, centered on the square, `height` tall (× scale),
// so Meshy exports work whatever units they were made in.
export function createUnitModel(key, cfg, teamColor, { baseY = 0 } = {}) {
  const gltf = cache[key];
  if (!gltf) return null;
  const model = SkeletonUtils.clone(gltf.scene); // plain clone() breaks skinned rigs
  const { size, center, min } = fits[key];
  model.position.set(-center.x, -min.y, -center.z); // feet on the base, centered on the square
  const object = new THREE.Group();
  object.add(model);
  object.scale.setScalar(((cfg.height ?? 1) / (size.y || 1)) * (cfg.scale ?? 1));
  object.rotation.y = cfg.rotationY ?? 0; // turns in place around the square center
  object.position.y = baseY;
  const team = new THREE.Color(teamColor);
  object.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = o.receiveShadow = true;
    o.material = Array.isArray(o.material) ? o.material.map(m => grimMaterial(m, team)) : grimMaterial(o.material, team);
  });
  return { object, mixerRoot: model, clips: gltf.animations };
}

// shortcut: tints the whole model toward the team color; tint only a named cloth material once real models arrive.
function grimMaterial(source, team) {
  const m = source.clone(); // shared materials would leak one side's tint onto the other
  if (m.transparent) { // Meshy often exports alphaMode BLEND: such a body hides nothing behind it, so rings etc. show through
    m.transparent = false; m.depthWrite = true; m.alphaTest = 0.5; // solid, but keeps cut-out edges
  }
  if (m.color) {
    const hsl = {};
    m.color.getHSL(hsl);
    m.color.setHSL(hsl.h, hsl.s * (1 - GRIM.desaturate), hsl.l * GRIM.darken);
    m.color.lerp(team, GRIM.teamTint);
  }
  if ('roughness' in m) m.roughness = Math.max(m.roughness, GRIM.minRoughness);
  return m;
}
