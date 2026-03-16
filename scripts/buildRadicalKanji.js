/**
 * Builds radicalKanji.json — maps radical names to their kanji character.
 * Run: node scripts/buildRadicalKanji.js
 */
const fs = require('fs');
const path = require('path');

const KANJI_JSON = path.join(__dirname, '../src/data/kanji.json');
const OUT_FILE = path.join(__dirname, 'radicalKanji.json');

const kanji = JSON.parse(fs.readFileSync(KANJI_JSON));

// Hand-curated overrides for cases where the auto-mapping picks the wrong kanji
// (e.g. Temple auto-maps to 院/Institution, but 寺 is the actual temple radical)
const OVERRIDES = {
  'Temple': '寺',
  'River': '川',
  'Leader': '長',  // 長 means both Long and Leader/Chief
  'Cross': '十',   // 十 means ten/cross shape
  'Head': '首',    // 首 = neck/head
  'Heaven': '天',  // 天 = heaven/sky
  'Energy': '力',  // remap to 力 (power/energy)
  'Go': '行',      // 行 = go/conduct
  'See': '見',     // 見 = see/look
  'Say': '言',     // 言 = say/word
  'Eat': '食',     // 食 = eat/food
  'Book': '本',    // 本 = book/origin
  'Origin': '元',  // 元 = beginning/origin (the actual component shape)
  'Window': null,  // 窓 is wrong — "Window" is a WK stroke component nickname
  'Gun': null,     // 弓 = bow, not gun — "Gun" is a WK stroke component nickname
  'Life': '生',    // 生 = life/birth
  'Writing': '文', // 文 = writing/text
  'Stop': '止',    // 止 = stop OK
  'Running': '走', // 走 = run
  'Treasure': '宝', // 宝 = treasure OK
  'Sword': '刀',   // 刀 = sword/knife
  'Long': '長',    // 長 = long/leader
  'Walk': '歩',    // 歩 = walk OK
  // Explicitly unmap radicals with no good standalone kanji
  'Leaf': null,    // stroke component only
  'Slide': null,   // no kanji for this shape
  'Net': null,     // 帳 (notebook) is wrong
  'Tent': null,    // 帳 (notebook) is wrong
  'Spear': null,   // 葉 (leaf) is wrong
  'Turkey': null,  // 土 (soil) is wrong
  'Ground': null,  // 地 is wrong — "Ground" is WK name for the 一 stroke component
};

const radicals = new Set();
kanji.forEach(k => k.radicals.forEach(r => radicals.add(r)));

const mapping = {};
for (const radical of radicals) {
  // Apply hand-curated overrides first (null = explicitly unmapped)
  if (radical in OVERRIDES) {
    if (OVERRIDES[radical]) mapping[radical] = OVERRIDES[radical];
    continue;
  }
  // First: exact match on first meaning (most reliable)
  const exactFirst = kanji.find(k => k.meanings[0].toLowerCase() === radical.toLowerCase());
  if (exactFirst) {
    mapping[radical] = exactFirst.character;
    continue;
  }
  // Second: exact match on any meaning
  const exactAny = kanji.find(k => k.meanings.some(m => m.toLowerCase() === radical.toLowerCase()));
  if (exactAny) {
    mapping[radical] = exactAny.character;
  }
  // Unmapped radicals are stroke-only components (no standalone kanji)
}

const unmapped = [...radicals].filter(r => !mapping[r]);
console.log(`Mapped: ${Object.keys(mapping).length} / ${radicals.size}`);
console.log(`Unmapped (stroke-only radicals): ${unmapped.length}`);
if (unmapped.length < 50) console.log(unmapped.sort().join(', '));

fs.writeFileSync(OUT_FILE, JSON.stringify(mapping, null, 2));
console.log(`Written to ${OUT_FILE}`);
