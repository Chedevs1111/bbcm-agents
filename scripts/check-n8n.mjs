/**
 * Validates generated workflows against the real n8n node definitions
 * (n8n-nodes-base, pinned to the version current n8n ships), so a typo in a node
 * type, an unsupported typeVersion or an invented parameter fails here rather than
 * at a firm's installation.
 *
 *   node scripts/check-n8n.mjs                 validate workflows/*.json
 *   node scripts/check-n8n.mjs --list a b c    print the latest version of each node
 */

import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const PREFIX = 'n8n-nodes-base.';

/**
 * name → Map(version → Set(top-level parameter names)), for the named node types only.
 * A node's file is named after its type (httpRequest → HttpRequest.node.js), so only
 * matching files are loaded — loading all ~450 nodes takes minutes.
 */
export function loadNodeDefinitions(names) {
  const pkgPath = require.resolve('n8n-nodes-base/package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const base = dirname(pkgPath);
  const wanted = new Set(names.map((n) => n.toLowerCase()));
  const defs = new Map();

  for (const rel of pkg.n8n.nodes) {
    const file = rel.split('/').pop().replace(/\.node\.js$/, '').toLowerCase();
    if (!wanted.has(file)) continue;
    let instance;
    try {
      const mod = require(join(base, rel));
      // Prefer the export named after the file: some modules export helpers first
      // (WhatsAppTrigger exports filterStatuses before the node class).
      const [, NodeClass] =
        Object.entries(mod).find(([key]) => key.toLowerCase() === file) ??
        Object.entries(mod).find(([, value]) => typeof value === 'function' && value.prototype);
      instance = new NodeClass();
    } catch {
      continue; // a node we do not use failed to load; validation reports it only if used
    }
    const name = instance.description.name;
    const versions = defs.get(name) ?? new Map();
    const add = (description) => {
      const props = new Set(description.properties.map((p) => p.name));
      for (const v of [description.version].flat()) versions.set(Number(v), props);
    };
    if (instance.nodeVersions) {
      for (const sub of Object.values(instance.nodeVersions)) add(sub.description);
    } else {
      add(instance.description);
    }
    defs.set(name, versions);
  }
  return defs;
}

/** Every problem in one workflow, as human-readable strings. Empty means valid. */
export function validateWorkflow(workflow, defs) {
  const problems = [];
  for (const node of workflow.nodes) {
    const where = `${workflow.name} › ${node.name}`;
    if (!node.type.startsWith(PREFIX) || !defs.has(node.type.slice(PREFIX.length))) {
      problems.push(`${where}: unknown node type ${node.type}`);
      continue;
    }
    const props = defs.get(node.type.slice(PREFIX.length)).get(Number(node.typeVersion));
    if (!props) {
      problems.push(`${where}: unsupported typeVersion ${node.typeVersion} for ${node.type}`);
      continue;
    }
    for (const key of Object.keys(node.parameters ?? {})) {
      if (!props.has(key)) problems.push(`${where}: unknown parameter "${key}" for ${node.type} v${node.typeVersion}`);
    }
  }
  return problems;
}

/** The node type names (without the package prefix) used by a set of workflows. */
export function typesUsed(workflows) {
  return [...new Set(workflows.flatMap((wf) => wf.nodes.map((n) => n.type.replace(PREFIX, ''))))];
}

function main(argv) {
  if (argv[0] === '--list') {
    const defs = loadNodeDefinitions(argv.slice(1));
    for (const name of argv.slice(1)) {
      const versions = defs.get(name);
      console.log(versions ? `${name} ${Math.max(...versions.keys())}` : `${name} NOT FOUND`);
    }
    return 0;
  }

  const dir = new URL('../workflows/', import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  const workflows = files.map((f) => JSON.parse(readFileSync(new URL(f, dir), 'utf8')));
  const defs = loadNodeDefinitions(typesUsed(workflows));
  const problems = workflows.flatMap((wf) => validateWorkflow(wf, defs));
  for (const p of problems) console.error(p);
  console.log(`${files.length} workflows checked against n8n-nodes-base — ${problems.length} problems`);
  return problems.length === 0 ? 0 : 1;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.exitCode = main(process.argv.slice(2));
}
