// Portrait pictures of each unit for the draft screen: a close-up of the 3D figure (idle pose) centred on its face
// (head bone; static creatures without a skeleton get their upper body), rendered onto a transparent square
// once per unit type, then reused as an <img> (data URL).
//   const urls = await renderPortraits(view.renderer, keys, manifest);  // { key: 'data:image/png;...' }
//   renderPortraits(renderer, keys, manifest, { size: 512 })            // bigger, e.g. reference art for AI restyling
// Uses the game's own renderer (drawing into an offscreen target) rather than a second WebGL context:
// browsers limit contexts per page and block pages that keep creating and dropping them.
import * as THREE from 'three';
import { buildFigure } from './unitsView.js';

const DEFAULT_SIZE = 192; // px, square
const SS = 2;           // supersampling: render at 2x and average down, for smooth edges
const EXPOSURE = 1.1;
const NEUTRAL = '#9aa3b5';

export async function renderPortraits(renderer, keys, manifest, { size: SIZE = DEFAULT_SIZE } = {}) {
  const N = SIZE * SS;
  const target = new THREE.WebGLRenderTarget(N, N, { type: THREE.FloatType });
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xdfe6ff, 0x30283a, 1.1));
  const key = new THREE.DirectionalLight(0xfff0dd, 2.6);
  key.position.set(2, 3, 4);
  const rim = new THREE.DirectionalLight(0x9fc4ff, 2.2);
  rim.position.set(-3, 2, -3);
  scene.add(key, rim);
  const camera = new THREE.PerspectiveCamera(28, 1, 0.05, 100);
  const pixels = new Float32Array(N * N * 4);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const g = canvas.getContext('2d');
  const img = g.createImageData(SIZE, SIZE);

  const out = {};
  for (const k of keys) {
    // the idle pose, not the board pose: an action pose often has an arm or weapon across the face
    const cfg = manifest.units[k] ?? {};
    const fig = buildFigure(k, NEUTRAL, { ...manifest, units: { ...manifest.units, [k]: { ...cfg, pose: { clip: 'idle', at: 0.3 } } } });
    const obj = fig.object;
    scene.add(obj);
    obj.updateMatrixWorld(true);
    // measure the body, not a staff or banner held above the head (rigged models: the skinned mesh)
    const box = new THREE.Box3(), skinned = [];
    obj.traverse(o => { if (o.isSkinnedMesh) skinned.push(o); });
    if (skinned.length) skinned.forEach(m => box.expandByObject(m, true));
    else box.setFromObject(obj, true);
    const h = box.max.y - box.min.y, w = Math.max(box.max.x - box.min.x, box.max.z - box.min.z);
    let head = null, front = null, top = null;
    obj.traverse(o => {
      if (!o.isBone) return;
      if (!top && /head_?(top_?)?end$/i.test(o.name)) top = o;  // head_end, mixamorigHeadTop_End
      if (!head && /head$/i.test(o.name)) head = o;          // Head, mixamorigHead (not head_end / headfront)
      if (!front && /headfront$/i.test(o.name)) front = o;    // Meshy rigs: a bone just in front of the face
    });
    // which way the face looks: from the head bone to its "headfront" bone, so a pose that twists the torso
    // still gets the camera in front of the face. Otherwise (static creatures) the model's own forward.
    const facing = head && front
      ? front.getWorldPosition(new THREE.Vector3()).sub(head.getWorldPosition(new THREE.Vector3()))
      : new THREE.Vector3(0, 0, 1).transformDirection(obj.matrixWorld);
    facing.y = 0;
    if (facing.lengthSq() < 1e-4) facing.set(0, 0, 1);
    facing.normalize();
    // close-up on the face: head and the top of the shoulders. No head bone (static creatures): the front of
    // the upper body, where their head usually is.
    const frame = head ? h * 0.38 : Math.max(h * 0.7, w * 0.6);
    // aim between the head bone (at the neck) and the top of the head, so small heads aren't cut off
    const aim = head && top ? head.getWorldPosition(new THREE.Vector3()).lerp(top.getWorldPosition(new THREE.Vector3()), 0.5)
      : head ? head.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, h * 0.03, 0))
      : box.getCenter(new THREE.Vector3()).setY(box.max.y - frame * 0.47).addScaledVector(facing, w * 0.2);
    const dist = (frame / 2) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    // a little off to one side and above, for a three-quarter view
    const side = facing.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.25);
    camera.position.copy(aim).addScaledVector(side, dist).add(new THREE.Vector3(0, frame * 0.12, 0));
    camera.lookAt(aim);

    const prevTarget = renderer.getRenderTarget(), prevAlpha = renderer.getClearAlpha();
    renderer.setRenderTarget(target);
    renderer.setClearAlpha(0);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.readRenderTargetPixels(target, 0, 0, N, N, pixels);
    renderer.setRenderTarget(prevTarget);
    renderer.setClearAlpha(prevAlpha);
    scene.remove(obj);
    // free what this figure put on the GPU (its own material copies and bone texture; geometry and
    // textures are shared with the loaded model and stay)
    obj.traverse(o => {
      if (o.isSkinnedMesh) o.skeleton.dispose();
      if (o.isMesh) [].concat(o.material).forEach(m => m.dispose());
    });

    toImage(pixels, N, img.data, SIZE);
    g.putImageData(img, 0, 0);
    out[k] = canvas.toDataURL('image/png');
    await new Promise(r => setTimeout(r)); // let the page breathe between figures
  }
  target.dispose();
  return out;
}

// Linear float pixels (bottom-up, SS x SS supersampled) -> tone-mapped sRGB bytes (top-down).
// An offscreen target gets neither tone mapping nor sRGB output from three.js, so it's done here,
// matching the ACES Filmic curve the game uses on screen.
function toImage(src, N, dst, SIZE) {
  const n = SS * SS;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      let r = 0, gg = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const i = (((N - 1 - (y * SS + sy)) * N) + x * SS + sx) * 4;
        r += src[i]; gg += src[i + 1]; b += src[i + 2]; a += src[i + 3];
      }
      a /= n;
      const o = (y * SIZE + x) * 4;
      if (a <= 0) { dst[o + 3] = 0; continue; }
      // un-premultiply the averaged edge pixels so edges don't go dark
      const [R, G, B] = aces(r / n / a, gg / n / a, b / n / a);
      dst[o] = srgb(R); dst[o + 1] = srgb(G); dst[o + 2] = srgb(B); dst[o + 3] = Math.round(Math.min(1, a) * 255);
    }
  }
}

function aces(r, g, b) {
  const e = EXPOSURE / 0.6;
  r *= e; g *= e; b *= e;
  const x = 0.59719 * r + 0.35458 * g + 0.04823 * b;
  const y = 0.07600 * r + 0.90834 * g + 0.01566 * b;
  const z = 0.02840 * r + 0.13383 * g + 0.83777 * b;
  const fit = v => (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.4329510) + 0.238081);
  const X = fit(x), Y = fit(y), Z = fit(z);
  return [1.60475 * X - 0.53108 * Y - 0.07367 * Z, -0.10208 * X + 1.10813 * Y - 0.00605 * Z, -0.00327 * X - 0.07276 * Y + 1.07602 * Z];
}

function srgb(v) {
  v = Math.min(1, Math.max(0, v));
  return Math.round((v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055) * 255);
}
