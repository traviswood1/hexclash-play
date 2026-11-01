// Unit types. The key doubles as the model key in assets/manifest.json, so dropping in
// assets/models/units/<key>.glb gives a unit its rigged model.
//   hp       health
//   move     movement points per turn (climbing costs are a board rule, see stepCost in rules.js)
//   atk/def  attack and defense dice (see COMBAT in rules.js)
//   range    1 = melee; more = ranged, needs line of sight
//   rating   rough strength, used by the computer when drafting
//   cost     draft points: 3 = simple and weak .. 8 = big stats and strong abilities.
//            Armies are bought with a points budget (settings.points in game.js).
//   color    accent color for the placeholder model and the UI
//   summon   true for minions raised in battle (never in the draft pool; see SUMMONS)

export const UNITS = {
  soldier: {
    name: 'Shieldbearer', role: 'Defender', hp: 9, move: 4, atk: 3, def: 4, range: 1, rating: 6, cost: 3,
    color: '#b8c4d6', abilities: ['shieldWall', 'brace'],
  },
  archer: {
    name: 'Longbow Ranger', role: 'Ranged', hp: 5, move: 4, atk: 3, def: 2, range: 4, rating: 7, cost: 4,
    color: '#7fb069', abilities: ['sharpshooter', 'volley'],
  },
  fire_mage: {
    name: 'Ember Mage', role: 'Caster', hp: 5, move: 4, atk: 3, def: 1, range: 3, rating: 8, cost: 3,
    color: '#ff7a3d', abilities: ['fireball', 'fireproof'],
  },
  ice_mage: {
    name: 'Frost Warden', role: 'Caster', hp: 6, move: 4, atk: 3, def: 2, range: 3, rating: 8, cost: 5,
    color: '#7fd4ff', abilities: ['frostBolt', 'flashFreeze', 'iceborn'],
  },
  assassin: {
    name: 'Shadowblade', role: 'Striker', hp: 6, move: 6, atk: 4, def: 2, range: 1, rating: 7, cost: 4,
    color: '#9a7bd1', abilities: ['flank', 'shadowstep'],
  },
  golem: {
    name: 'Stone Colossus', role: 'Bruiser', hp: 9, move: 3, atk: 4, def: 3, range: 1, rating: 8, cost: 8,
    color: '#a8957a', abilities: ['quake', 'stoneskin', 'titanFist'],
  },
  war_beast: {
    name: 'Ravager', role: 'Striker', hp: 8, move: 6, atk: 4, def: 3, range: 1, rating: 7, cost: 6,
    color: '#c46a4a', abilities: ['charge', 'frenzy'],
  },
  sorceress: {
    name: 'Storm Sorceress', role: 'Caster', hp: 5, move: 4, atk: 3, def: 2, range: 4, rating: 8, cost: 4,
    color: '#e3d35b', abilities: ['chainLightning', 'arcaneWard'],
  },
  warlord: {
    name: 'Warlord', role: 'Leader', hp: 8, move: 4, atk: 4, def: 3, range: 1, rating: 8, cost: 7,
    color: '#e0b44a', abilities: ['rally', 'warCry', 'conquerorsWill'],
  },
  cleric: {
    name: 'Dawn Cleric', role: 'Support', hp: 6, move: 4, atk: 2, def: 3, range: 1, rating: 6, cost: 5,
    color: '#fff1b8', abilities: ['heal', 'blessing'],
  },
  griffin: {
    name: 'Sky Griffin', role: 'Flyer', hp: 7, move: 4, atk: 4, def: 3, range: 1, rating: 7, cost: 4,
    color: '#d9a066', abilities: ['flight', 'dive'],
  },
  // ---------- placeholder roster: no models yet, they use generated figures ----------
  pikeman: {
    name: 'Pikeman', role: 'Defender', hp: 8, move: 4, atk: 3, def: 3, range: 2, rating: 6, cost: 5,
    color: '#a9b7c9', abilities: ['shieldWall', 'pierce'],
  },
  crossbowman: {
    name: 'Crossbowman', role: 'Ranged', hp: 6, move: 3, atk: 4, def: 2, range: 4, rating: 7, cost: 7,
    color: '#8d7a5b', abilities: ['pierce', 'sniperShot'],
  },
  berserker: {
    name: 'Berserker', role: 'Striker', hp: 8, move: 5, atk: 4, def: 1, range: 1, rating: 7, cost: 4,
    color: '#b5482f', abilities: ['frenzy', 'lifesteal'],
  },
  paladin: {
    name: 'Paladin', role: 'Defender', hp: 8, move: 4, atk: 3, def: 3, range: 1, rating: 7, cost: 8,
    color: '#e8e2c8', abilities: ['heal', 'shieldWall', 'sacredBarrier'],
  },
  necromancer: {
    name: 'Necromancer', role: 'Summoner', hp: 5, move: 4, atk: 3, def: 1, range: 3, rating: 7, cost: 5,
    color: '#6b4f8f', abilities: ['graveCurse', 'raiseDead'],
  },
  druid: {
    name: 'Grove Druid', role: 'Support', hp: 6, move: 4, atk: 2, def: 2, range: 3, rating: 6, cost: 6,
    color: '#5f9c4a', abilities: ['heal', 'rootSnare'],
  },
  scout: {
    name: 'Wind Scout', role: 'Skirmisher', hp: 5, move: 7, atk: 3, def: 2, range: 3, rating: 6, cost: 4,
    color: '#9fd1c4', abilities: ['leap', 'stealth'],
  },
  dwarf: {
    name: 'Ironbeard Dwarf', role: 'Defender', hp: 9, move: 3, atk: 3, def: 4, range: 1, rating: 7, cost: 5,
    color: '#a0663a', abilities: ['stoneskin', 'brace'],
  },
  wyvern: {
    name: 'Venom Wyvern', role: 'Flyer', hp: 8, move: 4, atk: 4, def: 2, range: 1, rating: 7, cost: 5,
    color: '#6f8f3a', abilities: ['flight', 'breath'],
  },
  bombardier: {
    name: 'Bombardier', role: 'Ranged', hp: 6, move: 3, atk: 2, def: 2, range: 3, rating: 6, cost: 3,
    color: '#c98a3a', abilities: ['firebomb', 'fireproof'],
  },
  monk: {
    name: 'Battle Monk', role: 'Striker', hp: 7, move: 5, atk: 3, def: 3, range: 1, rating: 7, cost: 3,
    color: '#d98b2b', abilities: ['leap', 'flank'],
  },
  hydra: {
    name: 'Swamp Hydra', role: 'Bruiser', hp: 10, move: 3, atk: 4, def: 2, range: 1, rating: 8, cost: 8,
    color: '#3f7f6a', abilities: ['regenerate', 'swimmer', 'venomTorrent'],
  },
  valkyrie: {
    name: 'Valkyrie', role: 'Flyer', hp: 7, move: 4, atk: 3, def: 3, range: 1, rating: 7, cost: 4,
    color: '#c7d3e8', abilities: ['flight', 'warCry', 'dawnSpear'],
  },
  shaman: {
    name: 'Storm Shaman', role: 'Caster', hp: 6, move: 4, atk: 2, def: 2, range: 4, rating: 7, cost: 4,
    color: '#4f8fbf', abilities: ['chainLightning', 'swimmer'],
  },
  sentinel: {
    name: 'Crystal Sentinel', role: 'Bruiser', hp: 10, move: 3, atk: 3, def: 4, range: 1, rating: 7, cost: 6,
    color: '#8fd3e8', abilities: ['arcaneWard', 'stoneskin'],
  },
  // ---------- expanded roster (docs/roster/characters.md): placeholders until Meshy models exist ----------
  kunai_adept: {
    name: 'Kunai Adept', role: 'Skirmisher', faction: 'shinobi', hp: 5, move: 6, atk: 3, def: 2, range: 3, rating: 7, cost: 3,
    color: '#b33a3a', abilities: ['kunaiFan', 'shadowstep'],
  },
  smoke_kunoichi: {
    name: 'Smoke-Veil Kunoichi', role: 'Assassin', faction: 'shinobi', hp: 5, move: 6, atk: 3, def: 2, range: 1, rating: 7, cost: 3,
    color: '#6a3d8f', abilities: ['stealth', 'shadowstep'],
  },
  toad_sage: {
    name: 'Bog Toad Sage', role: 'Bruiser', faction: 'shinobi', hp: 10, move: 3, atk: 3, def: 3, range: 1, rating: 8, cost: 3,
    color: '#c45a3a', abilities: ['leap', 'swimmer', 'quake'],
  },
  hollow_revenant: {
    name: 'Hollow-Masked Revenant', role: 'Berserker', faction: 'reapers', hp: 9, move: 5, atk: 4, def: 2, range: 1, rating: 7, cost: 7,
    color: '#5aa0e6', abilities: ['frenzy', 'lifesteal'],
  },
  spirit_archer: {
    name: 'Spirit Archer', role: 'Ranged', faction: 'reapers', hp: 5, move: 4, atk: 3, def: 2, range: 5, rating: 7, cost: 6,
    color: '#e8e8f0', abilities: ['pierce', 'spiritRain'],
  },
  ninth_captain: {
    name: 'Captain of the Ninth Gate', role: 'Commander', faction: 'reapers', hp: 9, move: 4, atk: 4, def: 3, range: 1, rating: 8, cost: 8,
    color: '#3a5a8f', abilities: ['spiritPressure', 'rally', 'gateRelease'],
  },
  siege_walker: {
    name: 'Siege Walker', role: 'Artillery', faction: 'vanguard', hp: 8, move: 3, atk: 3, def: 2, range: 4, rating: 7, cost: 6,
    color: '#d9b03a', abilities: ['missileBarrage', 'sharpshooter'],
  },
  jet_trooper: {
    name: 'Skyline Jet Trooper', role: 'Flyer', faction: 'vanguard', hp: 6, move: 4, atk: 3, def: 2, range: 3, rating: 7, cost: 4,
    color: '#c9a03a', abilities: ['flight', 'firebomb'],
  },
  halo_medic: {
    name: 'Halo Drone Medic', role: 'Support', faction: 'vanguard', hp: 5, move: 5, atk: 2, def: 2, range: 3, rating: 7, cost: 5,
    color: '#a8b0bc', abilities: ['heal', 'regenAura'],
  },
  rail_marksman: {
    name: 'Railgun Marksman', role: 'Sniper', faction: 'vanguard', hp: 5, move: 3, atk: 3, def: 1, range: 5, rating: 7, cost: 6,
    color: '#d9b03a', abilities: ['sniperShot', 'pierce', 'sharpshooter'],
  },
  void_stalker: {
    name: 'Void Stalker', role: 'Assassin', faction: 'void', hp: 6, move: 6, atk: 4, def: 2, range: 1, rating: 7, cost: 4,
    color: '#8a5ad1', abilities: ['stealth', 'flank', 'phaseShift', 'voidFlash'],
  },
  chitin_charger: {
    name: 'Chitin Charger', role: 'Striker', faction: 'void', hp: 9, move: 5, atk: 4, def: 2, range: 1, rating: 7, cost: 8,
    color: '#5fd08a', abilities: ['charge', 'stoneskin', 'carapaceRush'],
  },
  star_leviathan: {
    name: 'Star-Eater Leviathan', role: 'Behemoth', faction: 'void', hp: 11, move: 3, atk: 4, def: 2, range: 1, rating: 8, cost: 8,
    color: '#6b3fa0', abilities: ['quake', 'regenerate', 'starBeam'],
  },
  starcaller: {
    name: 'Starcaller', role: 'Caster', faction: 'academy', hp: 5, move: 4, atk: 3, def: 1, range: 4, rating: 8, cost: 6,
    color: '#3f6fd8', abilities: ['meteor', 'sharpshooter'],
  },
  runeblade: {
    name: 'Runeblade Knight', role: 'Duelist', faction: 'academy', hp: 8, move: 4, atk: 4, def: 3, range: 1, rating: 7, cost: 7,
    color: '#e8c45a', abilities: ['arcaneWard', 'lifesteal'],
  },
  gale_dancer: {
    name: 'Gale Dancer', role: 'Skirmisher', faction: 'academy', hp: 6, move: 6, atk: 3, def: 2, range: 1, rating: 7, cost: 3,
    color: '#5a8fe8', abilities: ['leap', 'breath'],
  },
  turret_tinker: {
    name: 'Turret Tinker', role: 'Builder', faction: 'thimble', hp: 6, move: 4, atk: 2, def: 2, range: 3, rating: 7, cost: 3,
    color: '#c9a24a', abilities: ['firebomb', 'sharpshooter'],
  },
  mallet_mite: {
    name: 'Mega-Mallet Mite', role: 'Bruiser', faction: 'thimble', hp: 8, move: 4, atk: 4, def: 3, range: 1, rating: 7, cost: 6,
    color: '#3fa59a', abilities: ['quake', 'charge'],
  },
  lantern_kitsune: {
    name: 'Lantern Kitsune', role: 'Trickster', faction: 'yokai', hp: 6, move: 5, atk: 3, def: 2, range: 3, rating: 7, cost: 4,
    color: '#d1503a', abilities: ['foxfire', 'shadowstep'],
  },
  tengu_windblade: {
    name: 'Tengu Windblade', role: 'Flyer', faction: 'yokai', hp: 7, move: 4, atk: 4, def: 2, range: 1, rating: 7, cost: 4,
    color: '#2f2f3a', abilities: ['flight', 'dive'],
  },
  oni_warbreaker: {
    name: 'Oni Warbreaker', role: 'Bruiser', faction: 'yokai', hp: 11, move: 4, atk: 5, def: 2, range: 1, rating: 8, cost: 8,
    color: '#e8a03a', abilities: ['frenzy', 'quake', 'demonGate'],
  },
  river_kappa: {
    name: 'River Kappa', role: 'Defender', faction: 'yokai', hp: 8, move: 4, atk: 3, def: 3, range: 1, rating: 7, cost: 3,
    color: '#5fae5a', abilities: ['swimmer', 'brace'],
  },
  thunder_drummer: {
    name: 'Thunder Drummer', role: 'Caster', faction: 'yokai', hp: 7, move: 4, atk: 3, def: 2, range: 4, rating: 8, cost: 7,
    color: '#e8d84a', abilities: ['chainLightning', 'warCry', 'thunderDrum'],
  },
  snow_wraith: {
    name: 'Snow Wraith', role: 'Controller', faction: 'yokai', hp: 5, move: 5, atk: 3, def: 2, range: 3, rating: 7, cost: 4,
    color: '#cfe8f4', abilities: ['flashFreeze', 'iceborn', 'stealth'],
  },
  neon_ronin: {
    name: 'Neon Ronin', role: 'Duelist', faction: 'neon', hp: 7, move: 5, atk: 4, def: 2, range: 1, rating: 8, cost: 5,
    color: '#e04fb0', abilities: ['deflect', 'leap'],
  },
  dusk_gunslinger: {
    name: 'Dusk Gunslinger', role: 'Ranged', faction: 'neon', hp: 6, move: 4, atk: 3, def: 2, range: 4, rating: 7, cost: 5,
    color: '#c98a3a', abilities: ['fanTheHammer', 'pierce'],
  },
  tempo_dj: {
    name: 'Tempo DJ', role: 'Support', faction: 'neon', hp: 6, move: 5, atk: 2, def: 2, range: 2, rating: 7, cost: 5,
    color: '#4fd8e0', abilities: ['heal', 'speedAura'],
  },
  troll: {
    name: 'Bog Troll', role: 'Bruiser', hp: 9, move: 4, atk: 4, def: 3, range: 1, rating: 7, cost: 8,
    color: '#6f9a5a', abilities: ['regenerate', 'swimmer'],
  },

  // ---------- minions: raised by the Necromancer's Raise Dead, crumble when it dies ----------
  skeleton: {
    name: 'Risen Skeleton', role: 'Minion', hp: 3, move: 4, atk: 2, def: 2, range: 1, rating: 3, summon: true,
    color: '#d8d2c0', abilities: ['flank'],
  },
  ghoul: {
    name: 'Grave Ghoul', role: 'Minion', hp: 4, move: 5, atk: 3, def: 1, range: 1, rating: 3, summon: true,
    color: '#7a8a5a', abilities: ['lifesteal'],
  },
  bone_archer: {
    name: 'Bone Archer', role: 'Minion', hp: 3, move: 3, atk: 2, def: 1, range: 4, rating: 3, summon: true,
    color: '#bfb8a6', abilities: ['pierce'],
  },
};

// Units players can draft (everything but minions).
export const DRAFTABLE = Object.keys(UNITS).filter(k => !UNITS[k].summon);
// What Raise Dead can bring back, by d6 roll: 1-2 skeleton, 3-4 ghoul, 5-6 bone archer.
export const SUMMONS = ['skeleton', 'skeleton', 'ghoul', 'ghoul', 'bone_archer', 'bone_archer'];
