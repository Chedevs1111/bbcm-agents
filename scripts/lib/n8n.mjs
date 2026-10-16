/**
 * Small builders for n8n workflow JSON, plus the shared nodes every agent uses.
 *
 * Node versions are pinned to what n8n-nodes-base 2.43.5 ships (read with
 * `node scripts/check-n8n.mjs --list …`); `npm run check:n8n` validates every node,
 * version and parameter against those real definitions.
 */

import { createHash } from 'node:crypto';

export const CLAUDE_MODEL = 'claude-sonnet-5-5';
export const ANTHROPIC_VERSION = '2023-06-01';
export const GRAPH_API_VERSION = 'v24.0'; // check the current Graph API version at install

/** Credentials are referenced by name only; the installer creates them in n8n. */
export const CRED = {
  google: 'BBCM Google',
  whatsapp: 'BBCM WhatsApp', // HTTP Header Auth: Authorization: Bearer <token>
  whatsappApp: 'BBCM WhatsApp App', // Meta app ID + secret, for the inbound trigger
  anthropic: 'BBCM Anthropic', // HTTP Header Auth: x-api-key: <key>
};

const base = (name, typeVersion) => ({ type: `n8n-nodes-base.${name}`, typeVersion });

export const T = {
  whatsAppTrigger: base('whatsAppTrigger', 1),
  httpRequest: base('httpRequest', 4.5),
  googleSheets: base('googleSheets', 4.7),
  googleCalendar: base('googleCalendar', 1.3),
  googleDrive: base('googleDrive', 3),
  code: base('code', 2),
  if: base('if', 2.3),
  switch: base('switch', 3.4),
  wait: base('wait', 1.1),
  scheduleTrigger: base('scheduleTrigger', 1.4),
  executeWorkflow: base('executeWorkflow', 1.4),
  executeWorkflowTrigger: base('executeWorkflowTrigger', 1.3),
  errorTrigger: base('errorTrigger', 1),
  respondToWebhook: base('respondToWebhook', 1.5),
  noOp: base('noOp', 1),
};

function uuidFrom(text) {
  const h = createHash('sha1').update(text).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

export function node(name, t, parameters, credentials) {
  const n = { id: uuidFrom(name), name, type: t.type, typeVersion: t.typeVersion, position: [0, 0], parameters };
  if (credentials) n.credentials = credentials;
  return n;
}

/**
 * links: [from, to, outputIndex = 0][] → n8n `connections`.
 */
export function connections(links) {
  const out = {};
  for (const [from, to, index = 0] of links) {
    out[from] ??= { main: [] };
    while (out[from].main.length <= index) out[from].main.push([]);
    out[from].main[index].push({ node: to, type: 'main', index: 0 });
  }
  return out;
}

/** Lays nodes out left-to-right by depth so the imported canvas is readable. */
function layout(nodes, conns) {
  const depth = new Map(nodes.map((n) => [n.name, 0]));
  for (let pass = 0; pass < nodes.length; pass += 1) {
    for (const [from, { main }] of Object.entries(conns)) {
      for (const branch of main) {
        for (const { node: to } of branch) depth.set(to, Math.max(depth.get(to), depth.get(from) + 1));
      }
    }
  }
  const rows = new Map();
  for (const n of nodes) {
    const d = depth.get(n.name);
    const row = rows.get(d) ?? 0;
    rows.set(d, row + 1);
    n.position = [d * 260, row * 180];
  }
}

export function workflow(name, nodes, links) {
  const conns = connections(links);
  layout(nodes, conns);
  return {
    name,
    nodes,
    connections: conns,
    active: false,
    settings: { executionOrder: 'v1', timezone: 'Africa/Johannesburg' },
  };
}

// ---- Shared nodes -------------------------------------------------------------------

/** Build with BBCM_SHEET_ID=<the firm's Sheet ID> and every Sheets node points at it. */
const register = (tab) => ({
  documentId: process.env.BBCM_SHEET_ID
    ? { __rl: true, mode: 'id', value: process.env.BBCM_SHEET_ID }
    : { __rl: true, mode: 'list', value: '', cachedResultName: 'BBCM Register' },
  sheetName: { __rl: true, mode: 'name', value: tab },
});

/**
 * Google Sheets on the firm's register. `fields` maps column → n8n expression;
 * `matchOn` names the column an update finds its row by.
 */
export function sheets(name, operation, tab, fields = {}, matchOn) {
  const parameters = { authentication: 'oAuth2', resource: 'sheet', operation, ...register(tab) };
  if (operation === 'append' || operation === 'update') {
    parameters.columns = {
      mappingMode: 'defineBelow',
      value: fields,
      matchingColumns: matchOn ? [matchOn] : [],
      schema: [],
    };
  }
  parameters.options = {};
  const n = node(name, T.googleSheets, parameters, { googleSheetsOAuth2Api: { name: CRED.google } });
  return operation === 'read' ? readOnce(n) : n;
}

/**
 * n8n runs a node once per incoming item, so a read placed after another read would
 * repeat for every row (and multiply every message after it). An empty tab would
 * output nothing and stop the branch. Reads therefore run once and always continue.
 */
export function readOnce(n) {
  n.executeOnce = true;
  n.alwaysOutputData = true;
  return n;
}

export const readSettings = () => sheets('Read settings', 'read', 'Settings');

/** An n8n expression fragment reading one Settings value. */
export const setting = (key) => `$('Read settings').all().find(i => i.json.Key === '${key}')?.json.Value`;

/** Appends one Log row. */
export function log(name, agent, action, detailExpr, matterExpr = "''") {
  return sheets(name, 'append', 'Log', {
    Timestamp: '={{ $now.toISO() }}',
    Agent: agent,
    MatterID: `={{ ${matterExpr} }}`,
    Action: action,
    Detail: `={{ ${detailExpr} }}`,
  });
}

/** Calls Claude through the Anthropic Messages API; the reply is $json.content[0].text. */
export function claude(name, system, userExpr) {
  const body =
    `={{ JSON.stringify({ model: '${CLAUDE_MODEL}', max_tokens: 1024, ` +
    `system: ${JSON.stringify(system)}, messages: [{ role: 'user', content: String(${userExpr}) }] }) }}`;
  return node(
    name,
    T.httpRequest,
    {
      method: 'POST',
      url: 'https://api.anthropic.com/v1/messages',
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendHeaders: true,
      headerParameters: { parameters: [{ name: 'anthropic-version', value: ANTHROPIC_VERSION }] },
      sendBody: true,
      specifyBody: 'json',
      jsonBody: body,
      options: {},
    },
    { httpHeaderAuth: { name: CRED.anthropic } },
  );
}

function whatsapp(name, bodyExpr) {
  return node(
    name,
    T.httpRequest,
    {
      method: 'POST',
      url: `=https://graph.facebook.com/${GRAPH_API_VERSION}/{{ ${setting('WhatsApp phone number ID')} }}/messages`,
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendBody: true,
      specifyBody: 'json',
      jsonBody: `={{ JSON.stringify(${bodyExpr}) }}`,
      options: {},
    },
    { httpHeaderAuth: { name: CRED.whatsapp } },
  );
}

/**
 * Sends an approved message template. `paramsExpr` evaluates to the body variables in
 * order; `buttonPayloadsExpr`, when given, to one quick-reply payload per button.
 */
export function waTemplate(name, template, toExpr, paramsExpr, buttonPayloadsExpr) {
  const buttons = buttonPayloadsExpr
    ? `, ...(${buttonPayloadsExpr}).map((p, i) => ({ type: 'button', sub_type: 'quick_reply', index: String(i), parameters: [{ type: 'payload', payload: p }] }))`
    : '';
  return whatsapp(
    name,
    `{ messaging_product: 'whatsapp', to: ${toExpr}, type: 'template', template: { name: '${template}', ` +
      `language: { code: 'en' }, components: [{ type: 'body', parameters: (${paramsExpr}).map(t => ({ type: 'text', text: String(t).replace(/\\s+/g, ' ') })) }${buttons}] } }`,
  );
}

/** Sends free text — only valid inside WhatsApp's 24-hour reply window. */
export function waText(name, toExpr, textExpr) {
  return whatsapp(name, `{ messaging_product: 'whatsapp', to: ${toExpr}, type: 'text', text: { body: String(${textExpr}) } }`);
}

/** A yes/no gate. `expr` is an n8n expression fragment that evaluates to a boolean. */
export function gate(name, expr) {
  return node(name, T.if, {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
      conditions: [
        {
          id: uuidFrom(`${name}-condition`),
          leftValue: `={{ ${expr} }}`,
          rightValue: '',
          operator: { type: 'boolean', operation: 'true', singleValue: true },
        },
      ],
      combinator: 'and',
    },
    options: {},
  });
}

export function code(name, jsCode) {
  return node(name, T.code, { mode: 'runOnceForAllItems', language: 'javaScript', jsCode });
}

export function schedule(name, cron) {
  return node(name, T.scheduleTrigger, { rule: { interval: [{ field: 'cronExpression', expression: cron }] } });
}

export function subWorkflowTrigger(name = 'When called') {
  return node(name, T.executeWorkflowTrigger, { inputSource: 'passthrough' });
}

/** Calls another workflow by name; the installer re-links it after import. */
export function callWorkflow(name, target) {
  // mode 'each': one run per item, so several matters due at once each get their own approval.
  return node(name, T.executeWorkflow, {
    source: 'database',
    workflowId: { __rl: true, mode: 'list', value: '', cachedResultName: target },
    mode: 'each',
    options: { waitForSubWorkflow: true },
  });
}
