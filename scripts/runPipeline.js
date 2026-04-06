/**
 * Generate → Audit → Regenerate pipeline for mnemonics.
 * Runs until audit finds no new failures or --max-passes is reached.
 *
 * Usage:
 *   node scripts/runPipeline.js --local
 *   node scripts/runPipeline.js --local --model gemma3:12b
 *   node scripts/runPipeline.js --local --level 5
 *   GEMINI_API_KEY=AIza... node scripts/runPipeline.js
 *   node scripts/runPipeline.js --local --max-passes 5
 *   node scripts/runPipeline.js --local --regen        (full regeneration)
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const FLAGGED_FILE = path.join(__dirname, './mnemonics_flagged.json');

const args = process.argv.slice(2);
const maxPassesArg = args.find(a => a.startsWith('--max-passes=')) ?? args[args.indexOf('--max-passes') + 1];
const MAX_PASSES = (maxPassesArg && !maxPassesArg.startsWith('--')) ? parseInt(maxPassesArg) : 10;

// Forward these args to sub-scripts (strip --max-passes and its value)
const maxPassesIdx = args.indexOf('--max-passes');
const FORWARD = args.filter((a, i) =>
  !a.startsWith('--max-passes') &&
  !(maxPassesIdx !== -1 && i === maxPassesIdx + 1)
);

function run(script, extraArgs = []) {
  const result = spawnSync(
    'node',
    [path.join(__dirname, script), ...FORWARD, ...extraArgs],
    { stdio: 'inherit', cwd: path.join(__dirname, '..') }
  );
  if (result.status !== 0) {
    console.error(`\n[pipeline] ${script} exited with code ${result.status}`);
    process.exit(result.status ?? 1);
  }
}

function flaggedCount() {
  if (!fs.existsSync(FLAGGED_FILE)) return 0;
  try {
    return Object.keys(JSON.parse(fs.readFileSync(FLAGGED_FILE))).length;
  } catch {
    return 0;
  }
}

async function main() {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  Mnemonic pipeline  (max ${MAX_PASSES} passes)`);
  console.log(`${'═'.repeat(60)}\n`);

  for (let pass = 1; pass <= MAX_PASSES; pass++) {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`  Pass ${pass} / ${MAX_PASSES}`);
    console.log(`${'─'.repeat(60)}\n`);

    // ── Step 1: generate (skips already-done entries) ──
    console.log('[pipeline] Step 1: generate\n');
    const generateArgs = pass === 1 ? [] : ['--regen-flagged'];
    run('buildMnemonics.js', generateArgs);

    // ── Step 2: audit → write flagged file ──
    console.log('\n[pipeline] Step 2: audit\n');
    run('auditMnemonics.js', ['--write']);

    const count = flaggedCount();
    console.log(`\n[pipeline] Pass ${pass} complete. Flagged: ${count}`);

    if (count === 0) {
      console.log('\n[pipeline] All mnemonics pass audit.');
      console.log('\n[pipeline] Step 3: merge into masterDataWithMnemonics.json\n');
      run('buildMasterDataWithMnemonics.js');
      console.log('\n[pipeline] Done!');
      return;
    }

    if (pass === MAX_PASSES) {
      console.log(`\n[pipeline] Reached max passes (${MAX_PASSES}). ${count} entries still flagged.`);
      console.log(`[pipeline] Flagged list: scripts/mnemonics_flagged.json`);
      return;
    }

    console.log(`[pipeline] Regenerating ${count} flagged entries in next pass...`);
  }
}

main().catch(e => { console.error('\n[pipeline] Fatal:', e.message); process.exit(1); });
