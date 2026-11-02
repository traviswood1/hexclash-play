// Service worker for the web build (tools/build-web.mjs fills in VERSION and SHELL; never used by the dev server).
// - The app shell (html, css, code, three.js, icons) is cached per build for offline use; online it is always fetched fresh.
// - assets/ (models, textures, portraits) are cached as they load and served from the cache straight away,
//   refreshed in the background (stale-while-revalidate), so the game works offline after one visit
//   and big files aren't downloaded again on every deploy.
const VERSION = '2026-11-02T12:48:58.711Z';
const SHELL = ["./","icons/icon-192.png","icons/icon-512.png","icons/icon-maskable-512.png","index.html","manifest.webmanifest","src/core/abilities.js","src/core/ai.js","src/core/game.js","src/core/hex.js","src/core/mapgen.js","src/core/rng.js","src/core/rules.js","src/core/terrain.js","src/core/units.js","src/main.js","src/net/relay.js","src/posePicker.js","src/render/animator.js","src/render/attackFx.js","src/render/board.js","src/render/environment.js","src/render/flight.js","src/render/fx.js","src/render/gallery.js","src/render/loader.js","src/render/pedestal.js","src/render/portraits.js","src/render/skillFx.js","src/render/terrainTextures.js","src/render/unitsView.js","src/render/view.js","src/ui/dice.js","src/ui/draftScreen.js","src/ui/icons.js","src/ui/ui.js","styles.css","vendor/mqtt.esm.js","vendor/three/build/three.module.js","vendor/three/examples/jsm/controls/OrbitControls.js","vendor/three/examples/jsm/environments/RoomEnvironment.js","vendor/three/examples/jsm/libs/meshopt_decoder.module.js","vendor/three/examples/jsm/loaders/GLTFLoader.js","vendor/three/examples/jsm/utils/BufferGeometryUtils.js","vendor/three/examples/jsm/utils/SkeletonUtils.js"];
const SHELL_CACHE = `hexclash-shell-${VERSION}`;
const ASSET_CACHE = 'hexclash-assets';

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL_CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('hexclash-shell-') && k !== SHELL_CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.includes('/assets/') && url.pathname.endsWith('.json')) {
    // small data files (unit manifest, poses, portrait list) must match the code: network first
    e.respondWith(caches.open(ASSET_CACHE).then(cache => fetch(e.request)
      .then(res => { if (res.ok) cache.put(e.request, res.clone()); return res; })
      .catch(() => cache.match(e.request))));
    return;
  }
  if (url.pathname.includes('/assets/')) {
    e.respondWith(caches.open(ASSET_CACHE).then(async cache => {
      const hit = await cache.match(e.request);
      const fresh = fetch(e.request).then(res => { if (res.ok) cache.put(e.request, res.clone()); return res; });
      if (hit) { fresh.catch(() => {}); return hit; }
      return fresh;
    }));
    return;
  }
  // shell (page, code, three.js): network first, so a new deploy shows up on the next load; this build's
  // cached copy when offline
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
