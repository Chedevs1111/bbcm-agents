/**
 * Builds every workflow in scripts/workflows/ into an import-ready workflows/*.json.
 * The JSON files are generated — edit the builders, then run `npm run build`.
 */

import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const sourceDir = new URL('./workflows/', import.meta.url);
const outDir = new URL('../workflows/', import.meta.url);

const kebab = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

mkdirSync(outDir, { recursive: true });
for (const stale of readdirSync(outDir).filter((f) => f.endsWith('.json'))) {
  rmSync(new URL(stale, outDir));
}

let builders = [];
try {
  builders = readdirSync(sourceDir).filter((f) => f.endsWith('.mjs')).sort();
} catch {
  // No builders yet.
}

for (const file of builders) {
  const { build } = await import(pathToFileURL(new URL(file, sourceDir).pathname).href);
  const workflow = build();
  writeFileSync(new URL(`${kebab(workflow.name)}.json`, outDir), `${JSON.stringify(workflow, null, 2)}\n`);
  console.log(`built ${workflow.name}`);
}
