// Dice tray: 3D CSS combat dice that tumble onto the table and land on the faces the rules rolled.
// Attack dice show swords (a sword = a hit), defense dice show shields (a shield = a block); the
// other faces are blank. Which faces carry a symbol follows COMBAT.HIT / COMBAT.BLOCK in rules.js,
// so the odds on screen always match the rules.
// The rules decide every result first (seeded dice in core/); this only shows them.
//   const tray = new DiceTray(element);
//   await tray.roll({ atkRolls, defRolls, hit: 3, block: 5, ... }, { quick });
// Click the tray to skip ahead.

import { SWORD, SHIELD, BLANK } from './icons.js';

// cube rotation that brings face n to the front
const FACE = { 1: [0, 0], 2: [0, -90], 3: [0, 180], 4: [0, 90], 5: [-90, 0], 6: [90, 0] };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export const DICE_MODES = ['full', 'quick', 'off'];

export class DiceTray {
  constructor(el) {
    this.el = el;
    this.skip = null;
    el.addEventListener('click', () => this.skip?.());
  }

  // e: { atkRolls, defRolls, atkMods, defMods, hits, blocks, damage, label }
  // names: { attacker, defender } as HTML; rules: { hit, block } thresholds
  async roll(e, { names, rules, quick = false }) {
    if (document.hidden) return; // hidden tab: no tray (see fx.js tween)
    const t = quick ? 0.55 : 1.05;          // tumble time (s)
    const hold = quick ? 0.45 : 0.9;        // time to read the result
    this.el.innerHTML = `
      <div class="tray-title">${names.attacker} <span class="muted">${esc(e.label)} →</span> ${names.defender}</div>
      ${row('atk', 'Attack', e.atkRolls, e.atkMods, rules.hit)}
      ${row('def', 'Defense', e.defRolls, e.defMods, rules.block)}
      <div class="tray-result"></div>`;
    this.el.style.setProperty('--t', `${t}s`);
    this.el.classList.add('show');

    // start each die at a random wild spin, then (next frame) send it to its landing face
    const dice = [...this.el.querySelectorAll('.die3d')];
    dice.forEach(d => {
      d.style.transition = 'none';
      d.style.transform = `rotateX(${rand(-720, 720)}deg) rotateY(${rand(-720, 720)}deg) rotateZ(${rand(-180, 180)}deg)`;
    });
    void this.el.offsetWidth; // apply the start pose before turning transitions back on
    dice.forEach((d, i) => {
      const [x, y] = FACE[+d.dataset.v];
      const spinX = 360 * (2 + (i % 2)), spinY = 360 * (1 + ((i + 1) % 2));
      d.style.transition = '';
      d.style.transitionDelay = `${i * 0.04}s`;
      d.style.transform = `rotateX(${x + spinX}deg) rotateY(${y + spinY}deg) rotateZ(0deg)`;
    });

    const skipped = await this.wait(t + dice.length * 0.04);
    // light up successes, dim failures
    dice.forEach(d => d.classList.add(d.dataset.ok === '1' ? 'good' : 'bad'));
    const res = this.el.querySelector('.tray-result');
    res.innerHTML = `<b class="h">${e.hits} hit${e.hits === 1 ? '' : 's'}</b> − <b class="b">${e.blocks} block${e.blocks === 1 ? '' : 's'}</b> →
      <b class="${e.damage ? 'dmg' : 'none'}">${e.damage ? `${e.damage} damage` : 'no damage'}</b>`;
    if (!skipped) await this.wait(hold);
    this.el.classList.remove('show');
  }

  // resolves true if the player clicked to skip
  wait(sec) {
    return new Promise(resolve => {
      const timer = setTimeout(() => { this.skip = null; resolve(false); }, sec * 1000);
      this.skip = () => { clearTimeout(timer); this.skip = null; resolve(true); };
    });
  }

  hide() { this.el.classList.remove('show'); }
}

function row(kind, title, rolls, mods, need) {
  const modText = mods?.length ? mods.map(([l, v]) => `${esc(l)} ${v > 0 ? '+' : ''}${v}`).join(', ') : '';
  const dice = rolls.length ? rolls.map(v => die(kind, v, need)).join('') : '<span class="muted">no dice</span>';
  const symbol = kind === 'atk' ? `${SWORD} = hit` : `${SHIELD} = block`;
  return `<div class="tray-row ${kind}">
    <div class="tray-label"><b>${title}</b> <span class="muted">${rolls.length} dice</span>
      <div class="muted key">${symbol}</div>${modText ? `<div class="muted mods">${modText}</div>` : ''}</div>
    <div class="dice">${dice}</div></div>`;
}

// faces at or above `need` carry the symbol, the rest are blank
function die(kind, v, need) {
  const icon = kind === 'atk' ? SWORD : SHIELD;
  const faces = [1, 2, 3, 4, 5, 6].map(n => `<div class="face f${n} ${n >= need ? 'sym' : ''}">${n >= need ? icon : BLANK}</div>`).join('');
  return `<div class="dw"><div class="die3d ${kind}" data-v="${v}" data-ok="${v >= need ? 1 : 0}">${faces}</div></div>`;
}

const rand = (a, b) => Math.round(a + Math.random() * (b - a));
