// Parses every game module as an ES module (no execution): node tools/check-syntax.mjs
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const dir = new URL('../js/game/', import.meta.url).pathname;
let bad = 0;
for (const f of readdirSync(dir).filter((n) => n.endsWith('.js'))) {
  try {
    new vm.SourceTextModule(readFileSync(join(dir, f), 'utf8'), { identifier: f });
  } catch (e) {
    bad++;
    console.log(`${f}: ${e.message}`);
  }
}
console.log(bad ? `${bad} file(s) with syntax errors` : 'all game modules parse');
process.exit(bad ? 1 : 0);
