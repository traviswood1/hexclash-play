// Full-screen unit draft, laid out like a MOBA champion select: each side's army down the left and
// right edges, the pool as a grid of portraits in the middle, the picked-over unit's card beside it,
// and a turn timer across the top. "View map" hides it to look at the battlefield (the clock keeps
// running); a small bar then shows whose turn it is and brings the screen back.
//   const ds = new DraftScreen({ lockIn(pid), viewMap(on), cardHtml(key) });
//   ds.open(); ds.render(game, { picker, human }); ds.tick(secondsLeft, total); ds.close();
//   ds.selected is the unit the picker has clicked (locked in by the button, a double-click or the timer).
//   Hovering a tile previews its card; leaving the tiles shows the selected unit again.
import { UNITS } from '../core/units.js';
import { playerUnits, pointsLeft } from '../core/game.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// Filter tabs over the pool
const FILTERS = {
  all: { name: 'All', test: () => true },
  melee: { name: 'Melee', test: d => d.range === 1 && !d.abilities.includes('flight') },
  ranged: { name: 'Ranged', test: d => d.range > 1 },
  flying: { name: 'Flying', test: d => d.abilities.includes('flight') },
  support: { name: 'Support', test: d => d.abilities.some(a => ['heal', 'rally', 'warCry', 'blessing', 'regenAura', 'speedAura', 'spiritPressure'].includes(a)) },
};

export class DraftScreen {
  constructor(handlers) {
    this.h = handlers;
    this.filter = 'all';
    this.search = '';
    this.portraits = {};
    this.selected = null;
    this.hover = null;
    this.el = document.createElement('div');
    this.el.id = 'draftScreen';
    this.el.className = 'hidden';
    this.mini = document.createElement('div');
    this.mini.id = 'draftMini';
    this.mini.className = 'panel hidden';
    $('hud').append(this.el, this.mini);

    this.el.addEventListener('click', e => {
      const tile = e.target.closest('[data-pid]');
      if (tile) { this.selected = +tile.dataset.pid; this.renderGrid(); return; }
      const f = e.target.closest('[data-filter]');
      if (f) {
        this.filter = f.dataset.filter;
        this.el.querySelectorAll('[data-filter]').forEach(b => b.classList.toggle('on', b === f));
        this.renderGrid();
        return;
      }
      if (e.target.closest('[data-lock]')) this.h.lockIn(this.selected);
      if (e.target.closest('[data-map]')) this.h.viewMap(true);
    });
    this.el.addEventListener('dblclick', e => {
      const tile = e.target.closest('[data-pid]');
      if (tile && this.s?.human) this.h.lockIn(+tile.dataset.pid);
    });
    this.el.addEventListener('mouseover', e => {
      const tile = e.target.closest('[data-pid]');
      const pid = tile ? +tile.dataset.pid : null;
      if (pid !== this.hover) { this.hover = pid; if (this.game) this.renderDetail(); }
    });
    this.el.addEventListener('input', e => {
      if (e.target.dataset.search === undefined) return;
      this.search = e.target.value.toLowerCase();
      this.renderGrid();
    });
    this.mini.addEventListener('click', e => { if (e.target.closest('[data-back]')) this.h.viewMap(false); });
  }

  setPortraits(urls) { this.portraits = urls; if (this.game) this.renderGrid(); }

  open() { this.el.classList.remove('hidden'); this.mini.classList.add('hidden'); }
  showMap(on) { this.el.classList.toggle('hidden', on); this.mini.classList.toggle('hidden', !on); }
  close() { this.el.classList.add('hidden'); this.mini.classList.add('hidden'); this.game = null; this.s = null; this.selected = null; this.hover = null; }

  // s: { picker, human }. A new picker starts with nothing selected.
  render(game, s) {
    if (this.s?.picker !== s.picker || game.pool.find(it => it.pid === this.selected)?.takenBy !== null) this.selected = null;
    this.game = game; this.s = s;
    const pl = game.players[s.picker];
    const total = game.settings.points;
    this.el.innerHTML = `
      <div class="ds-top">
        <div class="ds-turn" style="--pc:${pl.color}">
          <div class="ds-who">${s.human ? (game.players.some(p => p.ai) ? 'Your pick' : `${esc(pl.name)} — your pick`) : `${esc(pl.name)} is choosing…`}</div>
          <div class="ds-clock"><b id="dsTime">--</b><div class="ds-bar"><i id="dsBar"></i></div></div>
        </div>
        <button class="ds-mapbtn" data-map>View map</button>
      </div>
      <div class="ds-body">
        ${this.teamHtml(game, 0, s.picker)}
        <div class="ds-center">
          <div class="ds-filters">${Object.entries(FILTERS).map(([k, f]) =>
            `<button data-filter="${k}" class="${k === this.filter ? 'on' : ''}">${f.name}</button>`).join('')}
            <input data-search placeholder="Search" value="${esc(this.search)}"></div>
          <div class="ds-grid" id="dsGrid"></div>
          <div class="ds-detail" id="dsDetail"></div>
        </div>
        ${this.teamHtml(game, 1, s.picker)}
      </div>`;
    this.renderGrid();
    this.mini.style.setProperty('--pc', pl.color);
    this.mini.innerHTML = `<span class="dot" style="background:${pl.color}"></span><b>${esc(pl.name)}</b>
      <span class="muted">${s.human ? 'picking' : 'choosing…'}</span><b id="dsMiniTime" class="ds-minitime">--</b>
      <button class="primary" data-back>Back to draft</button>`;
  }

  teamHtml(game, p, picker) {
    const pl = game.players[p];
    const army = playerUnits(game, p);
    const left = pointsLeft(game, p), total = game.settings.points;
    const slots = [];
    for (let i = 0; i < game.settings.teamSize; i++) {
      const u = army[i];
      if (u) {
        const d = UNITS[u.key];
        slots.push(`<div class="ds-slot filled" style="--ac:${d.color}">${this.img(u.key)}
          <div><div class="nm">${esc(d.name)}</div><div class="muted">${esc(d.role)}</div></div><span class="cost">${d.cost}</span></div>`);
      } else {
        const next = p === picker && i === army.length;
        slots.push(`<div class="ds-slot ${next ? 'next' : ''}"><span class="muted">${next ? 'Picking…' : ''}</span></div>`);
      }
    }
    return `<div class="ds-team ${p === picker ? 'active' : ''}" style="--pc:${pl.color}">
      <div class="ds-tname"><span class="dot" style="background:${pl.color}"></span>${esc(pl.name)}${pl.ai ? ' (CPU)' : ''}</div>
      <div class="ds-points"><b>${left}</b> / ${total} points left<div class="ds-pbar"><i style="width:${(left / total) * 100}%"></i></div></div>
      ${slots.join('')}</div>`;
  }

  img(key) {
    const url = this.portraits[key];
    return url ? `<img src="${url}" alt="">` : `<span class="ph" style="background:${UNITS[key].color}">${esc(UNITS[key].name[0])}</span>`;
  }

  renderGrid() {
    const game = this.game, s = this.s;
    const grid = this.el.querySelector('#dsGrid');
    if (!grid || !game) return;
    const left = pointsLeft(game, s.picker);
    const f = FILTERS[this.filter];
    const items = game.pool.filter(it => {
      const d = UNITS[it.key];
      return f.test(d) && (!this.search || d.name.toLowerCase().includes(this.search) || d.role.toLowerCase().includes(this.search));
    }).sort((a, b) => UNITS[b.key].cost - UNITS[a.key].cost || UNITS[a.key].name.localeCompare(UNITS[b.key].name));
    grid.innerHTML = items.map(it => {
      const d = UNITS[it.key];
      const taken = it.takenBy !== null;
      const broke = !taken && d.cost > left;
      const cls = [taken ? 'taken' : '', broke ? 'broke' : '', it.pid === this.selected ? 'sel' : ''].join(' ');
      const owner = taken ? `style="--oc:${game.players[it.takenBy].color}"` : '';
      return `<div class="ds-tile ${cls}" data-pid="${it.pid}" ${owner} title="${esc(d.name)} · ${d.cost} points">
        ${this.img(it.key)}<span class="cost">${d.cost}</span><div class="nm">${esc(d.name)}</div></div>`;
    }).join('') || '<p class="muted">No units match.</p>';
    this.renderDetail();
  }

  renderDetail() {
    const game = this.game, s = this.s;
    const el = this.el.querySelector('#dsDetail');
    const item = game.pool.find(it => it.pid === (this.hover ?? this.selected));
    if (!item) {
      el.innerHTML = `<p class="muted">${s.human ? 'Hover a unit to see it here. Click to select it, then lock it in; double-click locks in straight away.' : 'Waiting for the other player…'}</p>`;
      return;
    }
    const d = UNITS[item.key];
    const taken = item.takenBy !== null, broke = d.cost > pointsLeft(game, s.picker);
    const why = taken ? 'Already drafted' : broke ? 'Not enough points' : '';
    el.innerHTML = `<div class="ds-big">${this.img(item.key)}<span class="cost">${d.cost} pts</span></div>
      <div class="ds-card">${this.h.cardHtml(item.key)}</div>
      ${s.human ? `<button class="primary big ds-lock" data-lock ${why ? 'disabled' : ''}>${why || `Lock in · ${d.cost} pts`}</button>` : ''}`;
  }

  // countdown: secondsLeft of total; null hides it (timer off)
  tick(secondsLeft, total) {
    const txt = secondsLeft === null ? '∞' : String(Math.ceil(secondsLeft));
    const t = $('dsTime'), b = $('dsBar'), m = $('dsMiniTime');
    if (t) { t.textContent = txt; t.classList.toggle('low', secondsLeft !== null && secondsLeft <= 5); }
    if (b) b.style.width = secondsLeft === null ? '100%' : `${Math.max(0, secondsLeft / total) * 100}%`;
    if (m) m.textContent = txt;
  }
}
