// The draft gallery: every unit in the pool stands on a pedestal beside the board, as it will look
// in battle. Hover one to see its stats; click to draft it. Drafted units leave their pedestal,
// which turns the drafting player's color. Each piece has a nameplate floating just above its head.
// The plates live in the 3D scene, so a piece standing in front hides the plate behind it; the hovered
// piece lifts off the plinth (base and all) and its plate is drawn on top of everything.
import * as THREE from 'three';
import { UNITS } from '../core/units.js';
import { buildFigure, flightHover } from './unitsView.js';
import { makeFlight } from './flight.js';
import { makePedestal } from './pedestal.js';
import { makeTable, TABLE_MARGIN } from './environment.js';

const SCALE = 1.4;   // showcase size relative to the board
const SPACING = 2.5 * SCALE;
const NEUTRAL = '#9aa3b5';
const RIM = 0x6d7385;
const PLATE_W = 512, PLATE_H = 132; // nameplate canvas size (px); drawn at 1.7 x 0.44 world units
const LIFT = 0.3;                   // how high a hovered piece rises

export class DraftGallery {
  // view: { camera, canvas, layer } — layer is the HTML element the nameplates go in
  constructor(scene, manifest, view) {
    this.scene = scene;
    this.manifest = manifest;
    this.view = view;
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);
    this.slots = []; // { pid, key, root, figure, rim, label }
    this.hovered = null;
    this.area = null;
  }

  // Lay the pool out in columns to the left of the board. The grid stays roughly square as the
  // roster grows (14 units: 5 rows x 3 columns; 40: 8 x 5).
  build(pool, boardSize) {
    this.clear();
    const rows = Math.max(4, Math.ceil(Math.sqrt(pool.length * 1.3)));
    const cols = Math.ceil(pool.length / rows);
    this.rows = rows;
    const right = -boardSize.width / 2 - 1.5 * SCALE; // gap between gallery and board
    const top = -((rows - 1) * SPACING) / 2;
    pool.forEach((item, i) => {
      const col = Math.floor(i / rows), row = i % rows;
      const x = right - (cols - 1 - col) * SPACING * 1.1 - (row % 2) * 0.4;
      const z = top + row * SPACING;
      this.slots.push(this.makeSlot(item, x, z));
    });
    const xs = this.slots.map(s => s.root.position.x), zs = this.slots.map(s => s.root.position.z);
    const pad = 1.6 * SCALE;
    this.area = { minX: Math.min(...xs) - pad, maxX: Math.max(...xs) + pad, minZ: Math.min(...zs) - pad, maxZ: Math.max(...zs) + pad };
    // the pieces stand on their own stump table (a round top around the whole grid), pushed left
    // if needed so it clears the board's table; without the table model, on a dark stone plinth
    let a = this.area;
    const w = a.maxX - a.minX, d = a.maxZ - a.minZ;
    const radius = Math.hypot(w, d) / 2 - 0.6 * SCALE;
    const cx = (a.minX + a.maxX) / 2, cz = (a.minZ + a.maxZ) / 2;
    const table = makeTable(radius, -0.04);
    if (table) {
      const shift = Math.min(0, -(boardSize.width / 2 + TABLE_MARGIN) - 1.5 - radius - cx);
      for (const s of this.slots) s.root.position.x += shift;
      a = this.area = { ...a, minX: a.minX + shift, maxX: a.maxX + shift };
      table.position.x = cx + shift;
      table.position.z = cz;
      this.plinth = table;
      // the tabletop dips toward its rim: set each piece down on the wood beneath it
      for (const s of this.slots) {
        s.baseY = table.userData.surfaceAt(s.root.position.x - table.position.x, s.root.position.z - cz) + 0.04;
        s.root.position.y = s.baseY;
      }
    } else {
      this.plinth = new THREE.Mesh(new THREE.BoxGeometry(w, 3.2, d).translate(cx, -1.65, cz),
        new THREE.MeshStandardMaterial({ color: 0x24262e, roughness: 0.9, envMapIntensity: 0.15 }));
      this.plinth.receiveShadow = true;
    }
    this.group.add(this.plinth);
  }

  makeSlot(item, x, z) {
    const root = new THREE.Group();
    root.position.set(x, 0, z);
    root.scale.setScalar(SCALE);
    const { root: stone, rim } = makePedestal({ radius: 0.95, height: 0.12, rimColor: RIM });
    root.add(stone);

    const fig = buildFigure(item.key, NEUTRAL, this.manifest);
    const figure = new THREE.Group();
    figure.add(fig.object);
    const hover = flightHover(item.key, this.manifest.units[item.key]);
    const flight = hover ? makeFlight(fig.object, hover, item.pid) : null;
    if (flight) figure.add(flight.group);
    figure.rotation.y = 0.35; // turned a little toward the board and camera
    root.add(figure);

    const d = UNITS[item.key];
    const canvas = document.createElement('canvas');
    canvas.width = PLATE_W; canvas.height = PLATE_H;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    label.center.set(0.5, 0);                     // sits on its anchor point
    label.position.set(0, fig.height + hover + 0.25, 0);  // floating just above the figure's head
    label.scale.set(1.7, 1.7 * PLATE_H / PLATE_W, 1);
    root.add(label);
    const plate = { canvas, tex, name: d.name, role: d.role, accent: d.color, state: '' };
    drawPlate(plate, {});

    root.traverse(o => { o.castShadow = o.castShadow || o.isMesh; o.userData.pid = item.pid; });
    this.group.add(root);
    return { pid: item.pid, key: item.key, root, figure, rim, label, plate, height: fig.height + hover, flight };
  }

  clear() {
    for (const s of this.slots) { this.group.remove(s.root); s.plate.tex.dispose(); s.label.material.dispose(); }
    if (this.plinth) { this.group.remove(this.plinth); this.plinth.geometry?.dispose(); this.plinth = null; }
    this.slots = [];
    this.hovered = null;
  }

  show(on) { this.group.visible = on; }
  get visible() { return this.group.visible; }

  // Drafted units leave their pedestal, which takes the drafting player's color.
  sync(game) {
    for (const s of this.slots) {
      const item = game.pool.find(p => p.pid === s.pid);
      const owner = item.takenBy === null ? null : game.players[item.takenBy];
      s.figure.visible = !owner;
      s.taken = !!owner;
      s.rim.material.color.set(owner ? owner.color : RIM);
      s.rim.material.emissive.set(owner ? owner.color : 0x000000);
      s.rim.material.emissiveIntensity = owner ? 0.6 : 0;
      s.owner = owner ? owner.color : null;
    }
    this.setHover(this.hovered);
  }

  // Pool id under the pointer (available units only), or null.
  pick(raycaster) {
    if (!this.visible) return null;
    const hit = raycaster.intersectObjects(this.slots.filter(s => !s.taken).map(s => s.root), true)[0];
    return hit ? hit.object.userData.pid : null;
  }

  setHover(pid) {
    this.hovered = pid;
    for (const s of this.slots) {
      const on = !s.taken && s.pid === pid;
      if (!s.taken) {
        s.rim.material.emissive.set(on ? 0xe8bd57 : 0x000000);
        s.rim.material.emissiveIntensity = on ? 0.9 : 0;
      }
      drawPlate(s.plate, { hover: on, owner: s.owner });
      // the hovered plate ignores depth and draws last, so nothing in front can hide it
      s.label.material.depthTest = !on;
      s.label.renderOrder = on ? 999 : 0;
      s.label.scale.set(1.7 * (on ? 1.12 : 1), 1.7 * (on ? 1.12 : 1) * PLATE_H / PLATE_W, 1);
    }
  }

  // world position just above a slot's figure (for the tooltip)
  slotTop(pid) {
    const s = this.slots.find(x => x.pid === pid);
    return s ? s.root.position.clone().add(new THREE.Vector3(0, (s.height + 0.4) * SCALE, 0)) : null;
  }

  update(dt) {
    if (!this.visible) return;
    const t = performance.now() / 1000;
    for (const s of this.slots) {
      s.flight?.update(t);
      // the hovered piece rises off the plinth, base and all, like picking it up to look at it
      const lift = s.pid === this.hovered ? LIFT : 0;
      const y = (s.baseY ?? 0) + lift;
      s.root.position.y += (y - s.root.position.y) * Math.min(1, dt * 10);
    }
  }
}


// Nameplate: dark rounded plate with the unit's color stripe on top, name and role.
// Hovered: gold border and text. Drafted: dimmed, struck through, stripe in the owner's color.
function drawPlate(plate, { hover = false, owner = null }) {
  const state = `${hover}|${owner}`;
  if (plate.state === state) return;
  plate.state = state;
  const g = plate.canvas.getContext('2d');
  const W = PLATE_W, H = PLATE_H, r = 22;
  g.clearRect(0, 0, W, H);
  g.globalAlpha = owner ? 0.55 : 1;
  g.beginPath();
  g.roundRect(6, 10, W - 12, H - 20, r);
  g.fillStyle = hover ? 'rgba(40, 30, 10, 0.95)' : 'rgba(10, 12, 20, 0.88)';
  g.fill();
  g.lineWidth = hover ? 5 : 2;
  g.strokeStyle = hover ? '#e8bd57' : 'rgba(255,255,255,0.18)';
  g.stroke();
  g.save();
  g.clip();
  g.fillStyle = hover ? '#e8bd57' : owner ?? plate.accent;
  g.fillRect(6, 10, W - 12, 9);
  g.restore();
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  let size = 46;
  g.font = `700 ${size}px "Segoe UI", sans-serif`;
  while (g.measureText(plate.name).width > W - 50 && size > 26) g.font = `700 ${--size}px "Segoe UI", sans-serif`;
  g.fillStyle = hover ? '#ffd77a' : '#ebe8f2';
  g.fillText(plate.name, W / 2, 58);
  if (owner) { // strike through drafted units
    const tw = g.measureText(plate.name).width;
    g.fillRect(W / 2 - tw / 2, 58, tw, 4);
  }
  g.font = '500 28px "Segoe UI", sans-serif';
  g.fillStyle = '#9b98ad';
  g.fillText(plate.role, W / 2, 98);
  g.globalAlpha = 1;
  plate.tex.needsUpdate = true;
}
