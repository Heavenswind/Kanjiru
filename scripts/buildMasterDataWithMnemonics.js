/**
 * Builds src/data/masterDataWithMnemonics.json
 *
 * Reads masterData.json and mnemonics.json, merges mnemonic fields
 * into each kanji/vocab/radical entry by matching on character/word/name.
 *
 * For items without a mnemonic yet, the field is omitted.
 * Re-run buildMnemonics.js to generate missing ones, then re-run this.
 *
 * Usage:
 *   node scripts/buildMasterDataWithMnemonics.js
 */

const fs   = require('fs');
const path = require('path');

const MASTER_JSON   = path.join(__dirname, '../src/data/masterData.json');
const MNEMONIC_JSON = path.join(__dirname, '../src/data/mnemonics.json');
const OUT_FILE      = path.join(__dirname, '../src/data/masterDataWithMnemonics.json');

const masterData = JSON.parse(fs.readFileSync(MASTER_JSON));
const mnemonics  = JSON.parse(fs.readFileSync(MNEMONIC_JSON));

let withMnemonic = 0;
let withoutMnemonic = 0;

const result = masterData.map(item => {
  let key;
  if (item.type === 'kanji')   key = item.character;
  if (item.type === 'radical') key = item.name;
  if (item.type === 'vocab')   key = item.word;

  const m = key ? mnemonics[key] : null;

  if (m) {
    withMnemonic++;
    return {
      ...item,
      ...(m.mnemonic_meaning ? { mnemonic_meaning: m.mnemonic_meaning } : {}),
      ...(m.mnemonic_reading ? { mnemonic_reading: m.mnemonic_reading } : {}),
    };
  }

  withoutMnemonic++;
  return item;
});

fs.writeFileSync(OUT_FILE, JSON.stringify(result, null, 2));
console.log(`masterDataWithMnemonics.json written`);
console.log(`  With mnemonic   : ${withMnemonic}`);
console.log(`  Without mnemonic: ${withoutMnemonic}`);
console.log(`  Total           : ${result.length}`);
