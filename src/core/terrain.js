// Terrain types. Game rules read only these numbers/flags; colors are for the renderer.
//   moveCost  movement points to enter (plus 1 per level climbed, for every walker)
//   def       defense dice modifier for a unit standing here
//   damage    damage dealt to a unit that enters (lava)
//   blocksSight  ranged attacks cannot pass THROUGH this hex (attacking into it is fine)

export const TERRAIN = {
  grass:  { name: 'Grass',  color: 0x6fa64a, side: 0x6b4f33, moveCost: 1, def: 0, desc: 'Open ground.' },
  forest: { name: 'Forest', color: 0x3d7a3a, side: 0x5a4430, moveCost: 2, def: 1, blocksSight: true,
            desc: 'Costs 2 to enter. +1 defense die. Blocks line of sight through it.' },
  sand:   { name: 'Sand',   color: 0xdcc47f, side: 0xa88d55, moveCost: 1, def: 0, desc: 'Open ground.' },
  rock:   { name: 'Rock',   color: 0x8e8b86, side: 0x5f5d5a, moveCost: 1, def: 0, desc: 'Solid high ground.' },
  snow:   { name: 'Snow',   color: 0xf2f4f6, side: 0x8d9aa3, moveCost: 2, def: 0, desc: 'Deep snow. Costs 2 to enter.' },
  water:  { name: 'Water',  color: 0x2f7fc4, side: 0x2c4a63, moveCost: 2, def: -1, liquid: true,
            desc: 'Costs 2 to enter. -1 defense die.' },
  ice:    { name: 'Ice',    color: 0x5aa8dc, side: 0x7fa7b8, moveCost: 1, def: -1, desc: 'Slippery footing: -1 defense die.' },
  lava:   { name: 'Lava',   color: 0xff5a1f, side: 0x3a2420, moveCost: 1, def: 0, damage: 2, liquid: true,
            desc: 'Deals 2 damage to a unit that enters it.' },
};
