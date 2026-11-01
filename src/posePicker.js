// Pose picker: every rigged unit in its candidate poses, side by side: its pose templates (★, from
// assets/pose-templates.json), topped up with poseOptions(). Picks are saved to assets/poses.json through the dev server (tools/serve.mjs)
// and the game loads them on start; a unit with no pick uses its first template. The search box filters units.
// One WebGL canvas lies over the page (clicks pass through it); each card's scene is drawn into that card's rectangle.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { loadManifest, preloadUnits, createUnitModel } from './render/loader.js';
import { posedFigure, poseOptions } from './render/unitsView.js';
import { makePedestal, BASE_TOP } from './render/pedestal.js';
import { UNITS } from './core/units.js';

const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.setClearColor(0x000000, 0);
const env = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;

const manifest = await loadManifest();
await preloadUnits(manifest);
const picks = {}; // unit key -> { clip, at }
const views = []; // { el, scene, camera }

const list = document.getElementById('list');
const save = document.getElementById('save');
const status = document.getElementById('status');
const search = document.getElementById('search');
const rows = []; // { row, text } for the search box
const same = (a, b) => !!(a && b && a.clip === b.clip && Math.abs(a.at - b.at) < 0.005);

for (const [key, unit] of Object.entries(UNITS)) {
  const cfg = manifest.units[key];
  const probe = cfg && createUnitModel(key, cfg, '#9aa3b5', { baseY: BASE_TOP });
  if (!probe || !probe.clips.length) continue; // placeholders have no rig, nothing to pose
  // the unit's templates (★), topped up to 6 with generated attack frames
  const templates = (manifest.poseTemplates?.[key] ?? []).filter(t => probe.clips.some(c => c.name === t.clip))
    .map(t => ({ ...t, tpl: true }));
  const extra = poseOptions(probe, cfg, 6).filter(o => !templates.some(t => t.clip === o.clip && Math.abs(t.at - o.at) < 0.015));
  const options = [...templates, ...extra].slice(0, Math.max(6, templates.length));
  const current = cfg.pose;
  const fromTemplate = !!cfg.poseFromTemplate; // the default, not a pick: don't save it unless clicked
  // keep the saved pick on screen even when it isn't one of the options
  if (current && !options.some(o => same(o, current))) options.unshift({ label: 'Your saved pick', clip: current.clip, at: current.at });
  if (current && !fromTemplate) picks[key] = { clip: current.clip, at: current.at };

  const row = document.createElement('section');
  row.className = 'unit';
  row.innerHTML = `<div class="info"><div class="name">${unit.name}</div><div class="role">${unit.role} · ${key}</div>
    <div class="picked"></div></div>`;
  list.appendChild(row);
  rows.push({ row, text: `${unit.name} ${unit.role} ${unit.faction ?? ''} ${key}`.toLowerCase() });
  const pickedLabel = row.querySelector('.picked');
  const cards = options.map((opt, i) => {
    const card = document.createElement('div');
    card.className = 'opt';
    card.innerHTML = `<span class="badge">${'ABCDEFGH'[i]}</span><div class="view"></div>
      <div class="cap"><b>${opt.tpl ? '<span class="tpl">★</span> ' : ''}${opt.label}</b><span>${opt.clip.replace(/_/g, ' ')} · ${Math.round(opt.at * 100)}%</span></div>`;
    row.appendChild(card);
    views.push({ el: card.querySelector('.view'), ...stage(key, cfg, opt) });
    card.onclick = () => {
      picks[key] = { clip: opt.clip, at: opt.at };
      mark();
      save.disabled = false;
      status.textContent = 'Unsaved changes';
    };
    return { card, opt };
  });
  const mark = () => {
    const shown = picks[key] ?? (fromTemplate ? current : null);
    let label = picks[key] ? 'Custom pose (from manifest)' : 'Default pose';
    cards.forEach(({ card, opt }, i) => {
      const on = same(shown, opt);
      card.classList.toggle('sel', on);
      if (on) label = `${picks[key] ? 'Picked' : 'Template default'}: ${'ABCDEFGH'[i]} · ${opt.label}`;
    });
    pickedLabel.textContent = label;
  };
  mark();
}

// One small scene per card: the posed figure on its pedestal, lit like the game.
function stage(key, cfg, opt) {
  const scene = new THREE.Scene();
  scene.environment = env;
  scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x4a3b2a, 0.8));
  const sun = new THREE.DirectionalLight(0xffe6c4, 2.6);
  sun.position.set(2, 4, 3);
  scene.add(sun);
  const model = createUnitModel(key, cfg, '#9aa3b5', { baseY: BASE_TOP });
  posedFigure(model, { ...cfg, pose: { clip: opt.clip, at: opt.at } });
  const figure = new THREE.Group();
  figure.add(model.object);
  figure.rotation.y = 0.45;
  scene.add(makePedestal().root, figure);
  const h = (cfg.height ?? 1) * (cfg.scale ?? 1);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  camera.position.set(0, h * 0.75, h * 2.6 + 1);
  camera.lookAt(0, h * 0.5, 0);
  return { scene, camera };
}

function render() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.floor(w * renderer.getPixelRatio()) || canvas.height !== Math.floor(h * renderer.getPixelRatio())) {
    renderer.setSize(w, h, false);
  }
  renderer.setScissorTest(false);
  renderer.clear();
  renderer.setScissorTest(true);
  const top = document.querySelector('header').getBoundingClientRect().bottom;
  for (const v of views) {
    const r = v.el.getBoundingClientRect();
    if (r.bottom < top || r.top > h || r.right < 0 || r.left > w) continue;
    // clip the top edge so cards scrolling under the sticky header aren't drawn over it
    const visTop = Math.max(r.top, top);
    if (r.bottom <= visTop) continue;
    v.camera.aspect = r.width / r.height;
    v.camera.updateProjectionMatrix();
    renderer.setViewport(r.left, h - r.bottom, r.width, r.height);
    renderer.setScissor(r.left, h - r.bottom, r.width, r.bottom - visTop);
    renderer.render(v.scene, v.camera);
  }
}
// static scenes: draw only when the page moves
let queued = false;
const requestRender = () => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; render(); }); } };
window.addEventListener('scroll', requestRender, { passive: true });
window.addEventListener('resize', requestRender);
requestRender();
setTimeout(render, 100); // also draw once even if animation frames are paused (hidden tab)

save.onclick = async () => {
  save.disabled = true;
  status.textContent = 'Saving…';
  try {
    const res = await fetch('/api/poses', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(picks) });
    if (!res.ok) throw new Error(await res.text());
    const { saved } = await res.json();
    status.textContent = `Saved ${saved} pose${saved === 1 ? '' : 's'}. Reload the game to see them.`;
  } catch (e) {
    status.textContent = `Save failed: ${e.message}`;
    save.disabled = false;
  }
};

// search: every word must appear in the unit's name, role, faction or key
const empty = Object.assign(document.createElement('div'), { id: 'empty', textContent: 'No units match.', hidden: true });
list.appendChild(empty);
search.oninput = () => {
  const words = search.value.toLowerCase().split(/\s+/).filter(Boolean);
  let n = 0;
  for (const { row, text } of rows) {
    const on = words.every(w => text.includes(w));
    row.classList.toggle('hidden', !on); n += on;
  }
  empty.hidden = n > 0;
  requestRender();
};

document.getElementById('loading').remove();
window.__picker = { picks, views, render };
