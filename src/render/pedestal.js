// The hex stone every unit stands on, in the draft gallery and on the battlefield: a clean
// dark-grey rock hex with a bevelled top and a thin inset rim that shows the owner's color.
// Corners point along ±z, matching the board's hexes.
import * as THREE from 'three';
import { terrainTextures } from './terrainTextures.js';

export const BASE_TOP = 0.07; // figures stand at this height above the pedestal's origin (= base thickness)

const BEVEL = 0.025;
const TEX_SCALE = 0.45; // texture repeats per world unit

const corner = (i, r) => { const a = (i * Math.PI) / 3; return [Math.sin(a) * r, Math.cos(a) * r]; };

// Hex prism from y = BASE_TOP - height up to BASE_TOP, with a chamfered top edge.
// Built face by face so every face gets its own flat normal and an unstretched UV.
function prism(radius, height) {
  const pos = [], uv = [];
  const y0 = BASE_TOP - height, y1 = BASE_TOP - BEVEL, inner = radius - BEVEL;
  const quad = (a, b, c, d, ua, ub, uc, ud) => { pos.push(...a, ...b, ...c, ...a, ...c, ...d); uv.push(...ua, ...ub, ...uc, ...ua, ...uc, ...ud); };
  const side = 2 * radius * Math.sin(Math.PI / 6); // edge length
  for (let i = 0; i < 6; i++) {
    const [ax, az] = corner(i, radius), [bx, bz] = corner(i + 1, radius);
    const [cx, cz] = corner(i, inner), [dx, dz] = corner(i + 1, inner);
    const u0 = i * side, u1 = u0 + side;
    // wall (counter-clockwise seen from outside, so normals face out)
    quad([ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az], [u0, y0], [u1, y0], [u1, y1], [u0, y1]);
    // bevel
    quad([ax, y1, az], [bx, y1, bz], [dx, BASE_TOP, dz], [cx, BASE_TOP, cz], [u0, y1], [u1, y1], [u1, y1 + BEVEL * 1.4], [u0, y1 + BEVEL * 1.4]);
    // top
    pos.push(0, BASE_TOP, 0, cx, BASE_TOP, cz, dx, BASE_TOP, dz);
    uv.push(0, 0, cx, cz, dx, dz);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv.map(x => x * TEX_SCALE), 2));
  geo.computeVertexNormals();
  return geo;
}

const geoCache = new Map();
const getGeo = (key, make) => geoCache.get(key) ?? geoCache.set(key, make()).get(key);

let stoneMat = null;
function stoneMaterial() {
  if (stoneMat) return stoneMat;
  const t = terrainTextures().basalt;
  stoneMat = new THREE.MeshStandardMaterial({ map: t.map, bumpMap: t.bump, bumpScale: 0.6, roughness: 0.82, metalness: 0.05 });
  return stoneMat;
}

// Returns { root, rim }. rim.material is the pedestal's own, so its color/glow can be set per unit.
export function makePedestal({ radius = 0.7, height = BASE_TOP, rimColor = 0x6d7385 } = {}) {
  const root = new THREE.Group();
  const stone = new THREE.Mesh(getGeo(`p${radius}/${height}`, () => prism(radius, height)), stoneMaterial());
  const rimGeo = getGeo(`r${radius}`, () => new THREE.RingGeometry(radius - BEVEL - 0.07, radius - BEVEL - 0.03, 6, 1, Math.PI / 6)
    .rotateX(-Math.PI / 2).translate(0, BASE_TOP + 0.003, 0));
  const rim = new THREE.Mesh(rimGeo, new THREE.MeshStandardMaterial({ color: rimColor, emissive: 0x000000, roughness: 0.45, metalness: 0.2 }));
  stone.castShadow = stone.receiveShadow = rim.receiveShadow = true;
  root.add(stone, rim);
  return { root, rim };
}
