/* ==========================================================================
   KEYWORDS — Palabras clave para clasificar cartas automáticamente.
   Se usan para hacer match entre el texto extraído por OCR y la categoría
   correcta del catálogo.
   ========================================================================== */

export const categoryKeywords = {
  // Mundial y Selecciones
  'wc2026-adrenalyn': ['adrenalyn', 'world cup', 'mundial 2026', 'fifa 2026', 'world cup 26'],
  'wc2026-stickers': ['stickers mundial', 'mundial stickers', 'fifa stickers', 'world cup stickers'],
  'prizm-fifa': ['prizm fifa', 'fifa prizm', 'prizm soccer', 'soccer prizm'],
  'obsidian-soccer': ['obsidian soccer', 'soccer obsidian'],
  'fifa-top-class': ['top class', 'fifa top class'],
  'tributo-espana': ['tributo españa', 'vamos campeones', 'españa campeon'],
  'espana-2026': ['españa 2026', 'carrefour españa', 'selección españa'],
  'aitana-bonmati': ['aitana', 'bonmatí', 'bonmati'],
  'womens-euro': ['women\'s euro', 'womens euro', 'euro femenino', 'euro women'],

  // Ligas
  'liga-este-26-27': ['laliga', 'la liga', 'liga este', 'ea sports', 'laliga ea sports'],
  'megacracks-26-27': ['megacracks', '25 aniversario', '25º aniversario'],
  'adrenalyn-laliga-26-27': ['adrenalyn laliga', 'laliga adrenalyn'],
  'liga-f-26-27': ['liga f', 'liga femenina'],
  'premier-flagship-26-27': ['premier league', 'premier', 'flagship premier'],
  'bundesliga-26-27': ['bundesliga'],
  'bundesliga-gold': ['bundesliga gold'],
  'chrome-mls-26': ['chrome mls', 'mls'],
  'real-madrid-club': ['real madrid', 'panini real madrid'],
  'barca-rm-cracks': ['barcelona', 'barça', 'barca real madrid'],

  // Champions
  'match-attax-ufa-26-27': ['match attax', 'ufa', 'uefa match attax'],
  'champions-stickers-26-27': ['champions league', 'champions stickers'],
  'ucc-oro-26-27': ['ucc gold', 'ucc oro'],
  'ucc-simple-26-27': ['ucc simplemente', 'ucc simple'],
  'collector-tins': ['collector tin', 'tin argentina', 'manutd'],

  // Baloncesto NBA
  'euroleague-club': ['euroleague', 'euroliga', 'euro league'],
  'prizm-nba': ['prizm nba', 'donruss', 'donruss nba', 'nba prizm', 'nba donruss'],
  'chrome-nba': ['chrome basketball', 'nba chrome', 'topps chrome nba'],
  'motif-nba': ['motif basketball', 'nba motif', 'motif nba'],

  // Béisbol MLB
  'baseball-s1s2': ['baseball series', 'series 1', 'series 2', 'baseball 2026'],
  'heritage-bb': ['heritage baseball', 'baseball heritage'],
  'pristine-bb': ['pristine baseball', 'baseball pristine'],

  // NFL y Combate
  'prizm-nfl': ['prizm nfl', 'score nfl', 'nfl prizm', 'nfl score'],
  'stadium-ufc': ['stadium club ufc', 'ufc stadium', 'ufc'],
  'universe-wwe': ['universe wwe', 'wwe', 'topps wwe'],

  // Motor
  'turbo-attax-f1': ['turbo attax', 'formula 1', 'f1', 'fórmula 1'],

  // Cómics y Cine
  'marvel-verse': ['marvel verse', 'hero attax', 'marvel hero'],
  'dc-heritage': ['dc comics', 'dc heritage', 'dc comics heritage'],
  'chrome-marvel': ['chrome marvel', 'marvel chrome', 'topps chrome marvel'],
  'vault-marvel': ['vault marvel', 'mint marvel', 'topps vault'],
  'starwars-galaxy': ['star wars', 'chrome galaxy', 'star wars galaxy'],

  // Nintendo
  'super-mario': ['super mario', 'mario', 'its-a me'],
  'kidi-line': ['bluey', 'adopt me', 'minecraft'],

  // Especial / Digital
  'berserk-master': ['berserk', 'berserk master'],
  'principito': ['principito', 'little prince'],
  'disney-pixar-hp': ['disney', 'pixar', 'harry potter', 'hp'],
  'digital-collections': ['panini digital', 'digital collections'],
  'topps-now': ['topps now'],
  'living-set': ['living set'],
};

/* Nombres comunes de jugadores por deporte/equipo para fuzzy match */
export const playerNames = [
  // Fútbol - LaLiga
  'vinicius', 'bellingham', 'mbappé', 'mbappe', 'rodrigo', 'valverde', 'modric',
  'pedri', 'gavi', 'yamal', 'lamine yamal', 'lewandowski', 'de jong', 'ter stegen',
  'ဉ拉', 'haaland', 'salah', 'kane', 'son', 'de bruyne', 'foden',
  // Fútbol - España
  'aitana bonmatí', 'aitana', 'bonmatí', 'alexia putellas', 'jenni Hermoso',
  // NBA
  'lebron', 'lebron james', 'curry', 'stephen curry', 'giannis', 'jokic',
  'luka doncic', 'doncic', 'tatum', 'ja morant', 'wembanyama',
  // NFL
  'mahomes', 'josh allen', 'lamar jackson', 'burrow', 'herbert',
  // MLB
  'ohtani', 'judge', 'acuña', 'acuna', 'betts', 'soto',
  // UFC
  'mcgregor', 'makhachev', 'adesanya', 'pereira', 'jones',
];

/* Nombres de equipos por deporte */
export const teamNames = [
  // Fútbol
  'real madrid', 'barcelona', 'barça', 'atlético', 'atletico', 'sevilla', 'valencia',
  'real sociedad', 'villarreal', 'athletic', 'betis', 'celta',
  'manchester city', 'manchester united', 'liverpool', 'chelsea', 'arsenal', 'tottenham',
  'bayern', 'dortmund', 'juventus', 'inter', 'milan', 'psg', 'paris saint-germain',
  'selección españa', 'spain', 'españa',
  // NBA
  'lakers', 'celtics', 'warriors', 'bucks', 'nuggets', 'mavericks', '76ers',
  'heat', 'knicks', 'nets', 'clippers', 'suns', 'grizzlies', 'spurs',
  // NFL
  'chiefs', 'bills', 'ravens', 'bengals', 'chargers', 'cowboys', '49ers', 'eagles',
  // MLB
  'yankees', 'dodgers', 'red sox', 'braves', 'astros', 'mets', 'padres',
];
