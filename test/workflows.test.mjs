import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { loadNodeDefinitions, typesUsed, validateWorkflow } from '../scripts/check-n8n.mjs';

const root = new URL('../', import.meta.url);

execFileSync(process.execPath, ['scripts/build-workflows.mjs'], { cwd: root });
const dir = new URL('../workflows/', import.meta.url);
const workflows = existsSync(dir)
  ? readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => ({
      file: f,
      wf: JSON.parse(readFileSync(new URL(f, dir), 'utf8')),
    }))
  : [];
const defs = loadNodeDefinitions([...typesUsed(workflows.map((w) => w.wf)), 'httpRequest']);

test('the validator catches unknown types, unsupported versions and invented parameters', () => {
  const problems = validateWorkflow(
    {
      name: 'Broken',
      nodes: [
        { name: 'A', type: 'n8n-nodes-base.doesNotExist', typeVersion: 1, parameters: {} },
        { name: 'B', type: 'n8n-nodes-base.httpRequest', typeVersion: 99, parameters: {} },
        { name: 'C', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.5, parameters: { url: 'x', bogus: 1 } },
      ],
    },
    defs,
  );
  assert.ok(problems.some((p) => p.includes('A') && p.includes('unknown node type')));
  assert.ok(problems.some((p) => p.includes('B') && p.includes('typeVersion 99')));
  assert.ok(problems.some((p) => p.includes('C') && p.includes('"bogus"')));
  assert.ok(!problems.some((p) => p.includes('"url"')), 'real parameters pass');
});

test('the loader finds node classes even when a module exports helpers first', () => {
  const triggerDefs = loadNodeDefinitions(['whatsAppTrigger']);
  assert.ok(triggerDefs.has('whatsAppTrigger'), 'WhatsAppTrigger module exports filterStatuses first');
});

test('the build produces a workflows directory', () => {
  assert.ok(existsSync(dir));
});

const byName = (name) => workflows.find((w) => w.wf.name === name)?.wf;
const incoming = (wf, target) =>
  Object.entries(wf.connections).flatMap(([from, { main }]) =>
    main.flatMap((branch) => (branch ?? []).filter((l) => l.node === target).map(() => from)),
  );
const outgoing = (wf, from) => (wf.connections[from]?.main ?? []).flat().map((l) => l.node);
const isWhatsAppSend = (n) =>
  n.type === 'n8n-nodes-base.httpRequest' && /graph\.facebook\.com.*\/messages$/.test(String(n.parameters.url));
const nodeCode = (wf, name) => wf.nodes.find((n) => n.name === name)?.parameters;

test('Reception asks the attorney for conflicts, advice and fee questions, and discloses the assistant', () => {
  const wf = byName('Reception');
  const needs = nodeCode(wf, 'Needs approval?').conditions.conditions[0].leftValue;
  for (const flag of ['conflict', 'wantsAdvice', 'asksFees']) assert.match(needs, new RegExp(flag));
  assert.match(JSON.stringify(wf), /digital assistant/);
});

test('Reception offers slots in Johannesburg time, at the times in Settings', () => {
  const plan = nodeCode(byName('Reception'), 'Plan reply').jsCode;
  assert.doesNotMatch(plan, /setHours/, 'the n8n server clock may be UTC');
  assert.match(plan, /settings\['Consultation slot rules'\]/);
});

test('Document reminders chase every 3 days and stop after 4', () => {
  const due = nodeCode(byName('Document reminders'), 'Due reminders').jsCode;
  assert.match(due, /\['Reminders sent'\] \|\| 0\) < 4/);
  assert.match(due, /daysSince >= 3/);
});

test('Client updates handles inbound messages only and never edits the diary', () => {
  const wf = byName('Client updates');
  assert.ok(!wf.nodes.some((n) => n.type === 'n8n-nodes-base.scheduleTrigger'));
});

test('sub-workflows run once per item, and approvals hand back who to send to', () => {
  for (const { wf } of workflows) {
    for (const n of wf.nodes.filter((x) => x.type === 'n8n-nodes-base.executeWorkflow')) {
      assert.equal(n.parameters.mode, 'each', `${wf.name} › ${n.name}`);
    }
  }
  const ret = nodeCode(byName('Request approval'), 'Return decision').jsCode;
  assert.match(ret, /\.\.\.\$\('Prepare approval'\)\.first\(\)\.json/);
});

test('Deadlines runs the tested deadline module byte for byte and always asks the attorney', () => {
  const wf = byName('Deadlines');
  const module = readFileSync(new URL('../src/deadlines.mjs', import.meta.url), 'utf8').replace(/^export /gm, '');
  assert.ok(nodeCode(wf, 'Compute deadline').jsCode.includes(module));
  assert.ok(!wf.nodes.some((n) => n.name === 'Auto-send on?'), 'no auto-send path for deadlines');
  const diary = JSON.stringify(wf.nodes.find((n) => n.name === 'Add to diary').parameters);
  for (const minutes of ['10080', '4320', '1440']) assert.match(diary, new RegExp(minutes));
});

test('Billing: time at 17:30 on weekdays, reminders at 7/14/30 days, and no money moves', () => {
  assert.equal(
    byName('Billing time').nodes.find((n) => n.type === 'n8n-nodes-base.scheduleTrigger').parameters.rule.interval[0].expression,
    '30 17 * * 1-5',
  );
  assert.match(nodeCode(byName('Billing reminders'), 'Overdue invoices').jsCode, /\[7, 14, 30\]/);
  for (const name of ['Billing time', 'Billing month end', 'Billing reminders']) {
    for (const n of byName(name).nodes.filter((x) => x.type === 'n8n-nodes-base.httpRequest')) {
      assert.match(String(n.parameters.url), /graph\.facebook\.com|api\.anthropic\.com/, `${name} › ${n.name}`);
    }
  }
});

test('Morning brief goes out at 07:30 on weekdays and flags clients not responding', () => {
  const wf = byName('Morning brief');
  assert.equal(wf.nodes.find((n) => n.type === 'n8n-nodes-base.scheduleTrigger').parameters.rule.interval[0].expression, '30 7 * * 1-5');
  assert.match(JSON.stringify(wf), /morning_brief/);
  assert.match(nodeCode(wf, 'Compose brief').jsCode, /not responding/);
});

test('an approval that expires is stamped and reappears in the next Morning brief (spec §5.4)', () => {
  const expire = byName('Request approval').nodes.find((n) => n.name === 'Mark expired');
  assert.match(expire.parameters.columns.value['Decided at'], /\$now/);
  const compose = nodeCode(byName('Morning brief'), 'Compose brief').jsCode;
  assert.match(compose, /'expired'/);
  assert.match(compose, /weekday === 1/, 'on Monday the brief looks back over the weekend');
});

test('no workflow deletes or moves a diary entry', () => {
  for (const { wf } of workflows) {
    for (const n of wf.nodes.filter((x) => x.type === 'n8n-nodes-base.googleCalendar')) {
      assert.ok(!['delete', 'update'].includes(n.parameters.operation), `${wf.name} › ${n.name}`);
    }
  }
});
test('building with BBCM_SHEET_ID points every Sheets node at the firm register', async () => {
  const { sheets } = await import('../scripts/lib/n8n.mjs');
  process.env.BBCM_SHEET_ID = '1AbCdEfGhIjK';
  try {
    assert.deepEqual(sheets('Read log', 'read', 'Log').parameters.documentId, { __rl: true, mode: 'id', value: '1AbCdEfGhIjK' });
  } finally {
    delete process.env.BBCM_SHEET_ID;
  }
  assert.equal(sheets('Read log', 'read', 'Log').parameters.documentId.mode, 'list', 'committed JSON stays firm-neutral');
});

const isLogAppend = (n) =>
  n.type === 'n8n-nodes-base.googleSheets' && n.parameters.operation === 'append' && n.parameters.sheetName?.value === 'Log';

test('exactly one workflow listens to WhatsApp: the Inbound router', () => {
  const listening = workflows.filter((w) => w.wf.nodes.some((n) => n.type === 'n8n-nodes-base.whatsAppTrigger'));
  assert.deepEqual(listening.map((w) => w.wf.name), ['Inbound router']);
});

test('Inbound router checks STOP before routing anywhere else', () => {
  const wf = byName('Inbound router');
  const classify = wf.nodes.find((n) => n.name === 'Classify message').parameters.jsCode;
  assert.ok(classify.indexOf("'optout'") < classify.indexOf("'approval'"), 'STOP is decided first');
});

test('Request approval stores the resume link and expires after 24 hours', () => {
  const wf = byName('Request approval');
  const wait = wf.nodes.find((n) => n.type === 'n8n-nodes-base.wait');
  assert.equal(wait.parameters.resume, 'webhook');
  assert.equal(wait.parameters.resumeAmount, 24);
  assert.equal(wait.parameters.resumeUnit, 'hours');
  const record = wf.nodes.find((n) => n.name === 'Record approval');
  assert.match(record.parameters.columns.value['Resume URL'], /\$execution\.resumeUrl/);
  assert.equal(record.parameters.columns.value.Status, 'pending');
});

test('Approval replies opens a 30-minute edit window; Edit timeouts sweeps every 10 minutes', () => {
  const replies = JSON.stringify(byName('Approval replies'));
  assert.match(replies, /plus\(30, 'minutes'\)/);
  const sweep = byName('Edit timeouts');
  const trigger = sweep.nodes.find((n) => n.type === 'n8n-nodes-base.scheduleTrigger');
  assert.equal(trigger.parameters.rule.interval[0].expression, '*/10 * * * *');
});

test('Error alert starts from n8n error trigger and uses the system_alert template', () => {
  const wf = byName('Error alert');
  assert.ok(wf.nodes.some((n) => n.type === 'n8n-nodes-base.errorTrigger'));
  assert.match(JSON.stringify(wf), /system_alert/);
});

for (const { file, wf } of workflows) {
  test(`${file}: every read step runs once and always passes a result`, () => {
    const reads = wf.nodes.filter(
      (n) =>
        (n.type === 'n8n-nodes-base.googleSheets' && n.parameters.operation === 'read') ||
        (n.type === 'n8n-nodes-base.googleCalendar' && n.parameters.operation === 'getAll'),
    );
    for (const n of reads) {
      assert.equal(n.executeOnce, true, `${n.name} must not re-run once per incoming row`);
      assert.equal(n.alwaysOutputData, true, `${n.name} must continue when the tab is empty`);
    }
  });

  test(`${file}: every message to a client passes an approval or auto-send gate`, () => {
    for (const n of wf.nodes.filter((x) => x.name.startsWith('Send to client'))) {
      assert.deepEqual(
        incoming(wf, n.name).map((from) => ['Approved?', 'Auto-send on?'].includes(from)),
        [true],
        `${n.name} is reached only from a gate`,
      );
    }
  });

  test(`${file}: every WhatsApp message is logged`, () => {
    for (const n of wf.nodes.filter(isWhatsAppSend)) {
      const next = outgoing(wf, n.name).map((name) => wf.nodes.find((x) => x.name === name));
      assert.ok(next.some(isLogAppend), `${n.name} is followed by a Log append`);
    }
  });

  test(`${file}: Code nodes add dates with Luxon objects, not n8n's expression-only plus(n, unit)`, () => {
    // In a Code node $now is plain Luxon: plus(7, 'days') adds 7 milliseconds.
    for (const n of wf.nodes.filter((x) => x.type === 'n8n-nodes-base.code')) {
      assert.doesNotMatch(n.parameters.jsCode, /\.(plus|minus)\(\s*\d/, `${n.name}`);
    }
  });

  test(`${file}: the firm name drops a trailing full stop ("Inc." would read "Inc.." in every greeting)`, () => {
    for (const n of wf.nodes.filter((x) => x.type === 'n8n-nodes-base.code')) {
      const reads = n.parameters.jsCode.match(/settings\['Firm name'\][^\n]*/g) ?? [];
      for (const line of reads) assert.match(line, /\.replace\(\/\\\.\$\/, ''\)/, `${n.name}`);
    }
  });

  test(`${file} is structurally sound and carries no secrets`, () => {
    const names = wf.nodes.map((n) => n.name);
    assert.equal(new Set(names).size, names.length, 'unique node names');
    for (const [from, outputs] of Object.entries(wf.connections)) {
      assert.ok(names.includes(from), `connection source ${from} exists`);
      for (const branch of outputs.main) {
        for (const link of branch ?? []) assert.ok(names.includes(link.node), `target ${link.node} exists`);
      }
    }
    for (const n of wf.nodes) {
      for (const cred of Object.values(n.credentials ?? {})) assert.equal(cred.id, undefined, `${n.name} credential has no id`);
    }
    assert.equal(wf.settings.timezone, 'Africa/Johannesburg');
    const text = JSON.stringify(wf);
    assert.doesNotMatch(text, /sk-ant-|EAA[A-Za-z0-9]{10}|\+27\d{9}/);
  });

  test(`${file} uses only real n8n nodes, versions and parameters`, () => {
    assert.deepEqual(validateWorkflow(wf, defs), []);
  });
}
