/* ==========================================================================
   COLECCIONES — Catálogo jerárquico de piezas de colección
   Secciones principales → Subcolecciones dentro de cada sección.
   Cada product lleva category = id de una subcolección (o de su sección).
   ========================================================================== */

export const collections = [
  {
    id: 'mundial',
    name: 'Mundial y Selecciones',
    logo: '🏆',
    code: 'MUN',
    color: '#22c55e',
    subs: [
      { id: 'wc2026-adrenalyn', name: 'Mundial 2026 Adrenalyn XL', code: 'AXW' },
      { id: 'wc2026-stickers', name: 'Mundial 2026 Stickers', code: 'WC6' },
      { id: 'prizm-fifa', name: 'Prizm FIFA Soccer 25-26', code: 'PRZ' },
      { id: 'obsidian-soccer', name: 'Obsidian Soccer 25-26', code: 'OBS' },
      { id: 'fifa-top-class', name: 'FIFA Top Class 2026', code: 'TOC' },
      { id: 'tributo-espana', name: 'Tributo España · ¡Vamos Campeones!', code: 'ESP' },
      { id: 'espana-2026', name: 'España 2026 (Carrefour · Selección)', code: 'E26' },
      { id: 'aitana-bonmati', name: 'Aitana Bonmatí Platinum', code: 'AIT' },
      { id: 'womens-euro', name: "Women's Euro 25/26", code: 'WEU' },
    ],
  },
  {
    id: 'tlg-futbol',
    name: 'Ligas',
    logo: '⚽',
    code: 'LGF',
    color: '#3b82f6',
    subs: [
      { id: 'liga-este-26-27', name: 'Liga Este / LaLiga EA Sports 26-27', code: 'LE7' },
      { id: 'megacracks-26-27', name: 'Megacracks LaLiga 26-27 · 25º Aniversario', code: 'MG7' },
      { id: 'adrenalyn-laliga-26-27', name: 'LaLiga Adrenalyn XL 26-27', code: 'AX7' },
      { id: 'liga-f-26-27', name: 'Liga F 2026-27', code: 'LF7' },
      { id: 'premier-flagship-26-27', name: 'Topps Flagship Premier League 26/27', code: 'EPL' },
      { id: 'bundesliga-26-27', name: 'Topps Bundesliga 26/27', code: 'BUN' },
      { id: 'bundesliga-gold', name: 'Topps Bundesliga Gold 2026', code: 'BGD' },
      { id: 'chrome-mls-26', name: 'Topps Chrome MLS 2026', code: 'MLS' },
      { id: 'real-madrid-club', name: 'Panini Real Madrid 25/26', code: 'RMA' },
      { id: 'barca-rm-cracks', name: 'Barcelona / Real Madrid Stickers', code: 'BAR' },
    ],
  },
  {
    id: 'champions',
    name: 'Champions',
    logo: '🌍',
    code: 'UFC',
    color: '#8b5cf6',
    subs: [
      { id: 'match-attax-ufa-26-27', name: 'Match Attax 26/27 (UEFA)', code: 'MT7' },
      { id: 'champions-stickers-26-27', name: 'Champions League Stickers 26/27', code: 'CL7' },
      { id: 'ucc-oro-26-27', name: 'UCC Gold 26/27', code: 'UC7' },
      { id: 'ucc-simple-26-27', name: 'UCC Simplemente 26/27', code: 'US7' },
      { id: 'collector-tins', name: 'Collector Tins (Argentina · ManUtd)', code: 'TIN' },
    ],
  },
  {
    id: 'baloncesto',
    name: 'Baloncesto · NBA',
    logo: '🏀',
    color: '#f97316',
    subs: [
      { id: 'euroleague-club', name: 'EuroLeague 25-26', code: 'ELC' },
      { id: 'prizm-nba', name: 'Donruss / Prizm NBA 25-26', code: 'NBA' },
      { id: 'chrome-nba', name: 'Chrome Basketball 25-26', code: 'CNB' },
      { id: 'motif-nba', name: 'Motif Basketball 25-26', code: 'MOB' },
    ],
  },
  {
    id: 'beisbol',
    name: 'Béisbol · MLB',
    logo: '⚾',
    color: '#06b6d4',
    subs: [
      { id: 'baseball-s1s2', name: 'Baseball Series 1/2 2026', code: 'BB1' },
      { id: 'heritage-bb', name: 'Heritage Baseball 2026', code: 'HHT' },
      { id: 'pristine-bb', name: 'Pristine Baseball 2026', code: 'PBB' },
    ],
  },
  {
    id: 'nfl-ufc',
    name: 'NFL y Combate',
    logo: '🏈',
    color: '#ef4444',
    subs: [
      { id: 'prizm-nfl', name: 'Score / Prizm NFL 25-26', code: 'NFL' },
      { id: 'stadium-ufc', name: 'Stadium Club UFC 2026', code: 'UFC' },
      { id: 'universe-wwe', name: 'Topps Universe WWE', code: 'WWE' },
    ],
  },
  {
    id: 'motor',
    name: 'Motor',
    logo: '🏎️',
    color: '#64748b',
    subs: [
      { id: 'turbo-attax-f1', name: 'Fórmula 1 Turbo Attax 2026', code: 'F1' },
    ],
  },
  {
    id: 'comics-cine',
    name: 'Cómics y Cine',
    logo: '🦸',
    color: '#ec4899',
    subs: [
      { id: 'marvel-verse', name: 'Marvel Verse / Hero Attax', code: 'MVA' },
      { id: 'dc-heritage', name: 'DC Comics Heritage', code: 'DCH' },
      { id: 'chrome-marvel', name: 'Topps Chrome Marvel 2026', code: 'TCM' },
      { id: 'vault-marvel', name: 'Topps Vault · Mint Marvel', code: 'VAM' },
      { id: 'starwars-galaxy', name: 'Star Wars Chrome Galaxy 2026', code: 'SWC' },
    ],
  },
  {
    id: 'nintendo',
    name: 'Nintendo',
    logo: '🎮',
    color: '#e11d48',
    subs: [
      { id: 'super-mario', name: 'Super Mario "It\u2019s-a me, Mario!"', code: 'SMM' },
      { id: 'kidi-line', name: 'Bluey · Adopt Me! · Minecraft', code: 'KID' },
    ],
  },
  {
    id: 'especial-digital',
    name: 'Especial / Digital',
    logo: '✨',
    color: '#d946ef',
    subs: [
      { id: 'berserk-master', name: 'Berserk Master Edition', code: 'BRS' },
      { id: 'principito', name: 'El Principito', code: 'PRN' },
      { id: 'disney-pixar-hp', name: 'Disney · Pixar · Harry Potter', code: 'DSN' },
      { id: 'digital-collections', name: 'Panini Digital Collections', code: 'DGT' },
      { id: 'topps-now', name: 'Topps NOW® ', code: 'NOW' },
      { id: 'living-set', name: 'Topps Living Set® ', code: 'LIV' },
    ],
  },
];
