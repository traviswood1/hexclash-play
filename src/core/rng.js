// Seeded random numbers (mulberry32). The game keeps the generator state as a plain integer
// inside the game state, so saves, replays and online play stay deterministic.

export function hashSeed(seed) {
  const s = String(seed);
  let h = 1779033703 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

// `holder` is any object with an integer `rng` field (the game state, or a private one).
export function nextRandom(holder) {
  let t = (holder.rng = (holder.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function createRng(seed) {
  const holder = { rng: hashSeed(seed) };
  const next = () => nextRandom(holder);
  return {
    next,
    int: n => Math.floor(next() * n),
    pick: arr => arr[Math.floor(next() * arr.length)],
    shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    },
  };
}

export function rollD6(holder) {
  return 1 + Math.floor(nextRandom(holder) * 6);
}

export function rollDie(holder, sides) {
  return 1 + Math.floor(nextRandom(holder) * sides);
}

export function randomSeed() {
  const words = ['ash', 'brine', 'cinder', 'dusk', 'ember', 'frost', 'gale', 'hollow', 'iron', 'jade', 'kite',
    'loam', 'moss', 'nettle', 'onyx', 'pyre', 'quartz', 'rime', 'slate', 'thorn', 'umber', 'vale', 'wisp', 'yew'];
  const w = () => words[Math.floor(Math.random() * words.length)];
  return `${w()}-${w()}-${Math.floor(Math.random() * 900 + 100)}`;
}
