// Random hex battlefield generator. Same seed + settings = same map, on every device.
// The board is one big hexagon; its six corner hexes are the possible start corners.
//
// How it works:
//   1. Every hex samples a few noise fields (height, wetness, heat, features). For symmetric maps
//      each field is averaged over the hex's rotated copies (2, 3 or 6 of them), so rotated hexes get
//      identical terrain and the matching corners are equally good.
//   2. Each field is equalized (turned into a 0..1 percentile) so biome thresholds read as
//      "fraction of the map", e.g. water: 0.2 = the lowest 20% of hexes are water.
//   3. Terrain is chosen from height/heat/wetness, the six corner start zones are made
//      walkable, and the map is smoothed/regenerated until every corner can reach every other.

import { hashSeed } from './rng.js';
import { key, toPixel, neighborKeys, DIRS } from './hex.js';

// radius = hexes from the center to a corner
export const MAP_SIZES = {
  small:  { name: 'Small',  radius: 6 },
  medium: { name: 'Medium', radius: 8 },
  large:  { name: 'Large',  radius: 10 },
};

//   water     fraction of the map that is low water (or ice when cold)
//   heat      shifts the heat field; cold < threshold gives snow/ice, lavaHeat > threshold allows lava
//   maxElev   tallest land level
//   land      what start zones are paved with
export const BIOMES = {
  temperate: { name: 'Temperate', water: 0.2,  heat: 0,     cold: -1,   lavaHeat: 9,    maxElev: 4, land: 'grass' },
  highlands: { name: 'Highlands', water: 0.1,  heat: 0,     cold: 0.12, lavaHeat: 9,    maxElev: 6, land: 'grass' },
  volcanic:  { name: 'Volcanic',  water: 0.06, heat: 0.25,  cold: -1,   lavaHeat: 0.5,  maxElev: 5, land: 'rock' },
  frozen:    { name: 'Frozen',    water: 0.2,  heat: -0.25, cold: 0.5,  lavaHeat: 9,    maxElev: 4, land: 'snow' },
  arid:      { name: 'Arid',      water: 0.05, heat: 0.35,  cold: -1,   lavaHeat: 1.2,  maxElev: 4, land: 'sand' },
  mixed:     { name: 'Mixed',     water: 0.15, heat: 0,     cold: 0.22, lavaHeat: 0.78, maxElev: 5, land: 'grass' },
};

// value = how many rotated copies of the map are identical
export const SYMMETRY = {
  three: { name: '3-way (alternate corners match)', fold: 3 },
  six:   { name: '6-way (all corners match)', fold: 6 },
  two:   { name: '2-way (opposite corners match)', fold: 2 },
  none:  { name: 'None (fully random)', fold: 1 },
};

// Corner i sits at DIRS[i] * radius, going around the board.
export const CORNERS = ['E', 'NE', 'NW', 'W', 'SW', 'SE'];
export const CORNER_NAMES = { E: 'East', NE: 'North-east', NW: 'North-west', W: 'West', SW: 'South-west', SE: 'South-east' };
export const oppositeCorner = c => CORNERS[(CORNERS.indexOf(c) + 3) % 6];

const LIQUID_OR_HAZARD = new Set(['water', 'lava', 'ice']);

export function generateMap({ seed, size = 'medium', biome = 'mixed', symmetry = 'three', zoneSize = 9 }) {
  let map;
  for (let attempt = 0; attempt < 25; attempt++) {
    map = buildMap({ seed: attempt ? `${seed}#${attempt}` : seed, size, biome, symmetry, zoneSize });
    for (let pass = 0; pass < 3 && !zonesConnected(map); pass++) smooth(map);
    if (zonesConnected(map)) break;
  }
  map.seed = String(seed);
  return map;
}

// 60° turn around the center, in exact integer coordinates
const rotate = ([q, r]) => [-r, q + r];

function makeNoise(seedInt) {
  const lattice = (ix, iy) => {
    let h = seedInt ^ Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
  const s = t => t * t * (3 - 2 * t);
  const value = (x, y) => {
    const ix = Math.floor(x), iy = Math.floor(y), fx = s(x - ix), fy = s(y - iy);
    const a = lattice(ix, iy), b = lattice(ix + 1, iy), c = lattice(ix, iy + 1), d = lattice(ix + 1, iy + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
  return (x, y, octaves) => {
    let sum = 0, amp = 1, freq = 1, norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * value(x * freq + i * 17.31, y * freq - i * 9.17);
      norm += amp; amp *= 0.5; freq *= 2;
    }
    return sum / norm;
  };
}

// Percentile of each value. Equal values get equal percentiles, which keeps symmetric maps symmetric.
function equalize(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return values.map(v => {
    let lo = 0, hi = sorted.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] < v) lo = mid + 1; else hi = mid; }
    return lo / (sorted.length - 1 || 1);
  });
}

function buildMap({ seed, size, biome, symmetry, zoneSize }) {
  const R = (MAP_SIZES[size] ?? MAP_SIZES.medium).radius;
  const B = BIOMES[biome] ?? BIOMES.mixed;
  const fold = (SYMMETRY[symmetry] ?? SYMMETRY.three).fold;
  const base = hashSeed(seed);
  const nHeight = makeNoise(base), nWet = makeNoise(base ^ 0x9e3779b9);
  const nHeat = makeNoise(base ^ 0x85ebca6b), nFeat = makeNoise(base ^ 0xc2b2ae35);

  const cells = [];
  for (let q = -R; q <= R; q++) {
    for (let r = Math.max(-R, -q - R); r <= Math.min(R, -q + R); r++) cells.push({ q, r, ...toPixel(q, r) });
  }
  // the rotated copies of a hex whose terrain must match it
  const copies = (q, r) => {
    const out = [];
    let h = [q, r];
    for (let i = 0; i < 6; i++) {
      if (i % (6 / fold) === 0) out.push(toPixel(h[0], h[1]));
      h = rotate(h);
    }
    return out;
  };
  // average a noise field over the copies; sorted first so every copy adds up to exactly the same number
  const sample = (noise, scale, ox, oz, octaves, pts) =>
    pts.map(p => noise(p.x * scale + ox, p.z * scale + oz, octaves)).sort((a, b) => a - b).reduce((a, b) => a + b, 0);
  const raw = { h: [], w: [], t: [], f: [] };
  for (const c of cells) {
    const pts = copies(c.q, c.r);
    // offsets keep the samples away from the lattice origin, which looks the same for every seed
    raw.h.push(sample(nHeight, 0.09, 31.7, 11.3, 4, pts));
    raw.w.push(sample(nWet, 0.13, 5.1, 71.9, 3, pts));
    raw.t.push(sample(nHeat, 0.06, 47.2, 3.3, 2, pts));
    raw.f.push(sample(nFeat, 0.3, 13.9, 29.4, 2, pts));
  }
  const H = equalize(raw.h), W = equalize(raw.w), T = equalize(raw.t), F = equalize(raw.f);

  cells.forEach((c, i) => {
    const heat = T[i] + B.heat;
    if (H[i] < B.water) {
      c.elev = 0;
      c.terrain = heat < B.cold ? 'ice' : 'water';
      return;
    }
    const land = (H[i] - B.water) / (1 - B.water);
    c.elev = 1 + Math.min(B.maxElev - 1, Math.floor(land * B.maxElev));
    if (heat > B.lavaHeat && F[i] > 0.74) c.terrain = 'lava';
    else if (heat < B.cold) c.terrain = F[i] > 0.8 ? 'ice' : 'snow';
    else if (c.elev >= B.maxElev && B.maxElev >= 4) c.terrain = 'rock';
    else if (W[i] > 0.7) c.terrain = 'forest';
    else if (W[i] < 0.28 && heat > 0.4) c.terrain = 'sand';
    else c.terrain = 'grass';
  });

  const map = { seed: String(seed), size, biome, symmetry, radius: R, maxElev: B.maxElev, cells: {}, keys: [], zones: {} };
  for (const c of cells) {
    const k = key(c.q, c.r);
    map.cells[k] = { q: c.q, r: c.r, elev: c.elev, terrain: c.terrain };
    map.keys.push(k);
  }

  // Start zones: the hexes nearest each corner hex, plus any tied with the last one, so every
  // corner gets the same shape (ties come in mirror pairs).
  CORNERS.forEach((corner, i) => {
    const a = toPixel(DIRS[i][0] * R, DIRS[i][1] * R);
    const ranked = cells.map(c => ({ k: key(c.q, c.r), d: Math.round(Math.hypot(c.x - a.x, c.z - a.z) * 1e4) }))
      .sort((x, y) => x.d - y.d);
    const cut = ranked[zoneSize - 1].d;
    map.zones[corner] = ranked.filter(e => e.d <= cut).map(e => e.k);
  });
  for (const corner of CORNERS) {
    const zone = map.zones[corner].map(k => map.cells[k]);
    const elevs = zone.map(c => c.elev).sort((a, b) => a - b);
    const median = Math.max(1, elevs[elevs.length >> 1]);
    for (const c of zone) {
      if (LIQUID_OR_HAZARD.has(c.terrain)) c.terrain = B.land;
      c.elev = Math.min(median + 1, Math.max(median - 1, c.elev, 1));
    }
  }
  return map;
}

// The weakest walker (climbs 1 level, drops up to 3) must be able to reach every other zone.
export function zonesConnected(map) {
  for (const from of CORNERS) {
    const seen = new Set(map.zones[from]);
    const queue = [...map.zones[from]];
    while (queue.length) {
      const k = queue.pop();
      const e = map.cells[k].elev;
      for (const n of neighborKeys(k)) {
        const c = map.cells[n];
        if (!c || seen.has(n)) continue;
        const d = c.elev - e;
        if (d > 1 || d < -3) continue;
        seen.add(n); queue.push(n);
      }
    }
    for (const to of CORNERS) if (!map.zones[to].some(k => seen.has(k))) return false;
  }
  return true;
}

// Pull steep land hexes toward their neighbors' average. Computed from a snapshot so the pass is
// order-independent (and so stays symmetric).
function smooth(map) {
  const before = Object.fromEntries(map.keys.map(k => [k, map.cells[k].elev]));
  const inZone = new Set(Object.values(map.zones).flat());
  for (const k of map.keys) {
    const c = map.cells[k];
    if (c.elev === 0 || inZone.has(k)) continue;
    const ns = neighborKeys(k).filter(n => map.cells[n]).map(n => before[n]);
    const avg = ns.reduce((a, b) => a + b, 0) / ns.length;
    c.elev = Math.max(1, Math.round((before[k] * 2 + avg) / 3));
  }
}
