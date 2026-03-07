/**
 * Downloads KanjiVG SVGs from GitHub (cached in scripts/kanjivg/) and
 * extracts stroke path data into a single JSON file: src/data/strokes.json
 *
 * SVGs are cached locally so subsequent runs don't re-download.
 * The kanjivg/ folder is gitignored and not shipped with the app.
 *
 * Run: node scripts/buildStrokeData.js
 */

const fs = require('fs');
const https = require('https');
const path = require('path');

const KANJI_JSON = path.join(__dirname, '../src/data/kanji.json');
const OUT_FILE = path.join(__dirname, '../src/data/strokes.json');
const SVG_CACHE = path.join(__dirname, 'kanjivg');
const BASE_URL =
  'https://raw.githubusercontent.com/KanjiVG/kanjivg/master/kanji/';

if (!fs.existsSync(SVG_CACHE)) fs.mkdirSync(SVG_CACHE);

function fetchRemote(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, res => {
        if (res.statusCode === 404) {
          resolve(null);
          return;
        }
        let data = '';
        res.on('data', chunk => (data += chunk));
        res.on('end', () => resolve(data));
      })
      .on('error', reject);
  });
}

async function fetch(cp) {
  const local = path.join(SVG_CACHE, `${cp}.svg`);
  if (fs.existsSync(local)) {
    return fs.readFileSync(local, 'utf8');
  }
  const svg = await fetchRemote(`${BASE_URL}${cp}.svg`);
  if (svg) fs.writeFileSync(local, svg, 'utf8');
  return svg;
}

/**
 * Extract stroke <path d="..."> elements from KanjiVG SVG.
 * KanjiVG wraps strokes in <g id="kvg:StrokePaths_XXXXX"> groups,
 * which may contain nested <g> sub-groups for each radical component.
 * We find the opening of StrokePaths and collect all <path> elements after it.
 */
function extractStrokes(svg) {
  const paths = [];
  // Find the start of the StrokePaths group
  const groupStart = svg.search(/<g[^>]*id="kvg:StrokePaths[^"]*"/);
  if (groupStart === -1) return paths;
  // Extract everything from that point onward and grab all path d attributes
  const tail = svg.slice(groupStart);
  const pathRegex = /<path[^>]+d="([^"]+)"/g;
  let m;
  while ((m = pathRegex.exec(tail)) !== null) {
    paths.push(m[1]);
  }
  return paths;
}

async function main() {
  const kanji = JSON.parse(fs.readFileSync(KANJI_JSON));
  const result = {};
  let ok = 0;
  let missing = 0;

  for (let i = 0; i < kanji.length; i++) {
    const char = kanji[i].character;
    const cp = char.codePointAt(0).toString(16).padStart(5, '0');

    const svg = await fetch(cp);
    if (!svg) {
      missing++;
      if (missing <= 10) console.warn(`  Missing: ${char} (${cp})`);
      continue;
    }

    const strokes = extractStrokes(svg);
    if (strokes.length > 0) {
      result[char] = strokes;
      ok++;
    } else {
      missing++;
      console.warn(`  No strokes found: ${char} (${cp})`);
    }

    if ((i + 1) % 100 === 0) {
      process.stdout.write(`\r  Progress: ${i + 1}/${kanji.length} (${ok} ok, ${missing} missing)`);
    }
  }

  console.log(`\nDone: ${ok} kanji with strokes, ${missing} missing`);
  fs.writeFileSync(OUT_FILE, JSON.stringify(result));
  console.log(`Written to ${OUT_FILE}`);

  const sizeMB = (fs.statSync(OUT_FILE).size / 1024 / 1024).toFixed(2);
  console.log(`File size: ${sizeMB} MB`);
}

main().catch(console.error);
