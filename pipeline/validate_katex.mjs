import fs from 'node:fs';
import katex from '../web/node_modules/katex/dist/katex.mjs';

const file = process.argv[2];
if (!file) { console.error('usage: node validate_katex.mjs <jsonl>'); process.exit(2); }
const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
let checked = 0;
const errors = [];
for (const line of lines) {
  const row = JSON.parse(line);
  const items = [['stem', row.stem_latex], ['answer', row.answer_latex], ...(row.parts || []).map((p) => [`part ${p.label}`, p.prompt_latex]), ...(row.options || []).map((o) => [`option ${o.label}`, o.latex])];
  for (const [name, text] of items) {
    if (!text) continue;
    for (const segment of String(text).match(/\$[^$]+\$/g) || []) {
      checked += 1;
      try { katex.renderToString(segment.slice(1, -1), { displayMode: false, throwOnError: true, strict: false }); }
      catch (error) { errors.push(`${row.year} ${row.seq_label} ${name}: ${error.message}`); }
    }
  }
}
console.log(JSON.stringify({ file, checked, errors }, null, 2));
if (errors.length) process.exit(1);
