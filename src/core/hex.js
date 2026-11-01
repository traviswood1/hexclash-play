// Hex math. Axial coordinates (q, r), pointy-top hexes, rows run along +z.
// Reference: https://www.redblobgames.com/grids/hexagons/

export const SQRT3 = Math.sqrt(3);
export const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

export const key = (q, r) => `${q},${r}`;
export const parseKey = k => { const [q, r] = k.split(',').map(Number); return { q, r }; };

export function neighborKeys(k) {
  const { q, r } = parseKey(k);
  return DIRS.map(([dq, dr]) => key(q + dq, r + dr));
}

export function distance(a, b) {
  if (typeof a === 'string') a = parseKey(a);
  if (typeof b === 'string') b = parseKey(b);
  return (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2;
}

export function toPixel(q, r) {
  return { x: SQRT3 * (q + r / 2), z: 1.5 * r };
}

function cubeRound(x, z) {
  const y = -x - z;
  let rx = Math.round(x), ry = Math.round(y), rz = Math.round(z);
  const dx = Math.abs(rx - x), dy = Math.abs(ry - y), dz = Math.abs(rz - z);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy <= dz) rz = -rx - ry;
  return { q: rx, r: rz };
}

// Hexes on the straight line from a to b, both ends included.
export function line(a, b) {
  if (typeof a === 'string') a = parseKey(a);
  if (typeof b === 'string') b = parseKey(b);
  const n = distance(a, b);
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = n === 0 ? 0 : i / n;
    // tiny nudge so lines along hex edges pick a consistent side
    const h = cubeRound(a.q + (b.q - a.q) * t + 1e-6, a.r + (b.r - a.r) * t + 1e-6);
    out.push(key(h.q, h.r));
  }
  return out;
}

export function within(k, radius) {
  const { q, r } = parseKey(k);
  const out = [];
  for (let dq = -radius; dq <= radius; dq++) {
    for (let dr = Math.max(-radius, -dq - radius); dr <= Math.min(radius, -dq + radius); dr++) {
      out.push(key(q + dq, r + dr));
    }
  }
  return out;
}
