// Renderer, camera, lights and camera controls.
//
// Camera: free-roaming RTS style, but kept near the battlefield.
//   mouse   left-drag rotate, right-drag (or two fingers) pan, wheel/pinch zoom toward the cursor
//   keys    W A S D / arrows pan, Q / E rotate, R / F zoom
//   limits  see CAMERA below: tilt range, zoom range, and how far the view can wander off the board.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { PALETTE } from './environment.js';

const CAMERA = {
  minTilt: 0.15,      // radians from straight down (0 = top-down)
  maxTilt: 1.32,      // ~76°: low enough to see the backdrop's skyline, never below ~14° above the horizon
  minZoom: 5,         // closest distance to the look-at point
  zoomOut: 1.35,      // farthest distance, as a multiple of the "whole board" distance
  margin: 4,          // how far the look-at point may go past the edge of the play area
  panSpeed: 0.9,      // keyboard pan, in view-distances per second
  rotateSpeed: 1.8,   // keyboard rotate, radians per second
  zoomSpeed: 1.6,     // mouse wheel / pinch zoom (OrbitControls default is 1)
  keyZoomSpeed: 2.4,  // R / F zoom, fraction of the distance per second
};

export function createView(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PALETTE.horizon); // the sky dome (environment.js) covers this
  scene.fog = new THREE.Fog(PALETTE.horizon, 60, 140);
  // soft image-based lighting: gives water, ice and models believable reflections
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  const camera = new THREE.PerspectiveCamera(42, container.clientWidth / container.clientHeight, 0.1, 1400);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.1;
  controls.minPolarAngle = CAMERA.minTilt;
  controls.maxPolarAngle = CAMERA.maxTilt;
  controls.minDistance = CAMERA.minZoom;
  controls.maxDistance = 160;
  controls.screenSpacePanning = false; // pan slides along the ground
  controls.zoomToCursor = true;
  controls.zoomSpeed = CAMERA.zoomSpeed;

  // night lighting: cool moonlight as the key light (kept strong enough to read the board), dim sky fill
  const hemi = new THREE.HemisphereLight(0x8fa4d8, 0x2a2230, 0.45); // colours set per backdrop (environment.js)
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xc8d4ff, 2.3);
  sun.position.set(18, 34, 12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);


  // 'high': shadows, up to 2x pixel ratio. 'low' (phones): no shadows, 1x pixel ratio.
  function setQuality(level) {
    const low = level === 'low';
    renderer.setPixelRatio(low ? 1 : Math.min(window.devicePixelRatio, 2));
    if (renderer.shadowMap.enabled === low) {
      renderer.shadowMap.enabled = !low;
      scene.traverse(o => { for (const m of [o.material].flat()) if (m) m.needsUpdate = true; }); // recompile without/with shadows
    }
  }

  let home = null;
  let bounds = { minX: -20, maxX: 20, minZ: -20, maxZ: 20 };

  // Fit an area (centered on cx, cz) in view. The camera may roam over that area, or over
  // `roam` ({ minX, maxX, minZ, maxZ }) when given, e.g. to zoom in on part of a larger table.
  let pendingFrame = null; // a frame() asked for while the page had no size yet (loaded in a hidden tab)
  function frame(width, depth, cx = 0, cz = 0, roam = null) {
    if (!(container.clientWidth > 0 && container.clientHeight > 0)) { pendingFrame = [width, depth, cx, cz, roam]; return; }
    pendingFrame = null;
    const s = sun.shadow.camera;
    const area = roam ?? { minX: cx - width / 2, maxX: cx + width / 2, minZ: cz - depth / 2, maxZ: cz + depth / 2 };
    const scx = (area.minX + area.maxX) / 2, scz = (area.minZ + area.maxZ) / 2;
    const half = Math.max(area.maxX - area.minX, area.maxZ - area.minZ) / 2 + 4;
    Object.assign(s, { left: -half, right: half, top: half, bottom: -half, near: 1, far: 120 });
    s.updateProjectionMatrix();
    sun.position.set(scx + 18, 34, scz + 12);
    sun.target.position.set(scx, 0, scz);
    // on wide screens the side panels cover the edges, so leave room for them
    const v = THREE.MathUtils.degToRad(camera.fov / 2);
    const h = Math.atan(Math.tan(v) * camera.aspect);
    const usable = camera.aspect > 1.2 ? Math.max(0.6, 1 - 520 / container.clientWidth) : 0.9;
    const dist = Math.max(width / 2 / Math.tan(h) / usable, (depth / 2 / Math.tan(v)) * 1.3);
    // portrait phones: bottom sheets cover the lower screen, so aim a little lower to lift the board
    const tz = cz + (camera.aspect < 1 ? depth * 0.3 : 1);
    // wide screens: the right-hand panel is wider than anything on the left, so aim a little right of center
    const tx = cx + (camera.aspect > 1.2 ? 2 * dist * Math.tan(h) * (172 / container.clientWidth) : 0);
    home = { pos: new THREE.Vector3(tx, dist * 0.8, dist * 0.6 + tz), target: new THREE.Vector3(tx, 0, tz) };
    bounds = {
      minX: Math.min(area.minX, cx - width / 2) - CAMERA.margin, maxX: Math.max(tx, area.maxX, cx + width / 2) + CAMERA.margin,
      minZ: Math.min(area.minZ, cz - depth / 2) - CAMERA.margin, maxZ: Math.max(area.maxZ, cz + depth / 2) + CAMERA.margin + (tz - cz),
    };
    controls.maxDistance = dist * CAMERA.zoomOut;
    resetCamera();
  }

  function resetCamera() {
    if (!home) return;
    camera.position.copy(home.pos);
    controls.target.copy(home.target);
    controls.update();
  }

  // Keep the look-at point over the play area; the camera moves along so the view doesn't swing.
  function clampTarget() {
    const t = controls.target;
    const before = t.clone();
    t.x = THREE.MathUtils.clamp(t.x, bounds.minX, bounds.maxX);
    t.z = THREE.MathUtils.clamp(t.z, bounds.minZ, bounds.maxZ);
    t.y = THREE.MathUtils.clamp(t.y, -0.5, 3);
    camera.position.add(t.clone().sub(before));
  }

  const keys = new Set();
  const typing = e => ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName);
  window.addEventListener('keydown', e => { if (!typing(e)) keys.add(e.key.toLowerCase()); });
  window.addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
  window.addEventListener('blur', () => keys.clear());

  const fwd = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  function keyboard(dt) {
    if (!keys.size) return;
    const has = (...k) => k.some(x => keys.has(x));
    const offset = camera.position.clone().sub(controls.target);
    const dist = offset.length();
    fwd.copy(offset).negate().setY(0).normalize();
    right.crossVectors(fwd, up);
    const move = new THREE.Vector3();
    if (has('w', 'arrowup')) move.add(fwd);
    if (has('s', 'arrowdown')) move.sub(fwd);
    if (has('d', 'arrowright')) move.add(right);
    if (has('a', 'arrowleft')) move.sub(right);
    if (move.lengthSq()) {
      move.normalize().multiplyScalar(dist * CAMERA.panSpeed * dt);
      controls.target.add(move);
      camera.position.add(move);
    }
    const turn = (has('q') ? 1 : 0) - (has('e') ? 1 : 0);
    if (turn) {
      offset.applyAxisAngle(up, turn * CAMERA.rotateSpeed * dt);
      camera.position.copy(controls.target).add(offset);
    }
    const zoom = (has('f', '-') ? 1 : 0) - (has('r', '=', '+') ? 1 : 0);
    if (zoom) {
      const d = THREE.MathUtils.clamp(dist * (1 + zoom * CAMERA.keyZoomSpeed * dt), controls.minDistance, controls.maxDistance);
      camera.position.copy(controls.target).add(offset.setLength(d));
    }
  }

  function update(dt) {
    keyboard(dt);
    clampTarget();
    controls.update();
    // depth fog, like Battle Chess: the near edge of the board is clear, the far side starts to
    // dim, and the dais and land beyond fade into the backdrop colour. Follows the zoom.
    const d = camera.position.distanceTo(controls.target);
    scene.fog.near = d * 0.85;
    scene.fog.far = d * 2.6;
  }

  // follows the container (window resizes, phone rotation, a background tab getting its first real size)
  new ResizeObserver(() => {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    if (pendingFrame) frame(...pendingFrame);
  }).observe(container);

  return { renderer, scene, camera, controls, sun, hemi, frame, resetCamera, update, setQuality };
}

