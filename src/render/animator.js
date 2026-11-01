import * as THREE from 'three';

const ONE_SHOT = new Set(['attack', 'hit', 'death']);

// Clip names are guessed from keywords so Meshy/Mixamo exports work without renaming.
// Override any guess in manifest.json: "clips": { "attack": "Armature|Sword_Slash" }
const KEYWORDS = {
  idle: ['idle', 'stand', 'breath'],
  move: ['move', 'walk', 'run', 'jog'],
  attack: ['attack', 'slash', 'punch', 'strike', 'cast', 'shoot', 'shot', 'swing', 'slam', 'smash', 'stab', 'spin'],
  hit: ['hit', 'react', 'hurt', 'damage'],
  death: ['death', 'die', 'dying', 'dead'],
};

// Missing clips are skipped.
export class UnitAnimator {
  constructor(object, clips, overrides = {}) {
    this.mixer = new THREE.AnimationMixer(object);
    this.actions = {};
    for (const [name, words] of Object.entries(KEYWORDS)) {
      const clip = overrides[name] ? clips.find(c => c.name === overrides[name])
        : clips.find(c => c.name.toLowerCase() === name) // else the earliest keyword wins, so Walking beats Running
          || words.map(w => clips.find(c => c.name.toLowerCase().includes(w))).find(Boolean);
      if (clip) this.actions[name] = this.mixer.clipAction(clip);
    }
    if (!this.actions.idle && clips.length === 1) this.actions.idle = this.mixer.clipAction(clips[0]);
    if (!this.actions.idle && this.actions.move) { // no idle clip: hold the walk's first frame instead of a T-pose
      const still = THREE.AnimationUtils.subclip(this.actions.move.getClip(), 'idle', 0, 1);
      this.actions.idle = this.mixer.clipAction(still);
    }
    this.current = null;
    this.play('idle');
  }

  // Resolves when a one-shot clip finishes (or another clip replaces it), so game code can `await anim.play('attack')`.
  play(name) {
    const next = this.actions[name];
    if (!next) return Promise.resolve();
    if (this.pending) { // a one-shot still running is being replaced: settle it now so it can't snap back to idle later
      const { done, resolve } = this.pending;
      this.pending = null; this.mixer.removeEventListener('finished', done); resolve();
    }
    const oneShot = ONE_SHOT.has(name);
    next.setLoop(oneShot ? THREE.LoopOnce : THREE.LoopRepeat, oneShot ? 1 : Infinity);
    next.clampWhenFinished = oneShot;
    if (this.current && this.current !== next) this.current.fadeOut(0.2);
    next.reset().fadeIn(0.2).play();
    this.current = next;
    if (!oneShot) return Promise.resolve();
    return new Promise(resolve => {
      const done = e => {
        if (e.action !== next) return;
        this.mixer.removeEventListener('finished', done);
        this.pending = null;
        if (name !== 'death') this.play('idle');
        resolve();
      };
      this.pending = { done, resolve };
      this.mixer.addEventListener('finished', done);
    });
  }

  // Blend back to idle early if `name` is still playing (for clips with a long wind-down).
  endEarly(name) { if (this.current === this.actions[name]) this.play('idle'); }

  duration(name) { return this.actions[name]?.getClip().duration ?? 0; }

  update(dt) { this.mixer.update(dt); }
}
