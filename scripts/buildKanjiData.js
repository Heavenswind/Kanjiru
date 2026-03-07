const fs = require('fs');
const path = require('path');

const source = require('./kanji-source.json');
const output = [];

for (const [character, data] of Object.entries(source)) {
  if (data.jlpt_new === null || data.jlpt_new === undefined) continue;
  if (!data.meanings || data.meanings.length === 0) continue;
  if ((!data.readings_on || data.readings_on.length === 0) &&
      (!data.readings_kun || data.readings_kun.length === 0)) continue;

  output.push({
    id: character,
    character,
    // jlpt_new: 5=N5 (easiest/fewest), 1=N1 (hardest/most)
    // We store as jlptLevel: 5=N5 ... 1=N1 (matches JLPT naming)
    jlptLevel: data.jlpt_new,
    strokes: data.strokes ?? 0,
    meanings: data.meanings,
    readings_on: data.readings_on ?? [],
    readings_kun: data.readings_kun ?? [],
    radicals: data.wk_radicals ?? [],
  });
}

// Sort: N5 first (jlptLevel=5), then N4, N3, N2, N1
output.sort((a, b) => b.jlptLevel - a.jlptLevel);

const outPath = path.join(__dirname, '../src/data/kanji.json');
fs.writeFileSync(outPath, JSON.stringify(output));

const byLevel = {};
for (const k of output) {
  byLevel[k.jlptLevel] = (byLevel[k.jlptLevel] || 0) + 1;
}

console.log(`Written ${output.length} kanji to src/data/kanji.json`);
console.log('By JLPT level:');
for (const [level, count] of Object.entries(byLevel).sort().reverse()) {
  console.log(`  N${level}: ${count} kanji`);
}
