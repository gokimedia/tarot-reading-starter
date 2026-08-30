import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const EXPECTED_LITERAL_EVENT_COUNT = 36;
const EXPECTED_TECHNICAL_METADATA_KEY_COUNT = 29;
const REQUIRED_EVENTS = Object.freeze([
  'tarot_funnel_viewed',
  'first_interaction',
  'free_result_requested',
  'free_result_resolved',
  'free_result_viewed',
  'offer_viewed',
  'package_selected',
  'checkout_started',
]);
const REQUIRED_METADATA_KEYS = Object.freeze([
  'analytics_schema',
  'flow_id',
  'locale',
  'device',
  'traffic_type',
  'tool_type',
  'funnel_step',
]);
const FORBIDDEN_METADATA_KEYS = Object.freeze([
  'question',
  'answer',
  'email',
  'name',
  'reading_id',
  'session_id',
  'attempt_id',
]);

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : '';
}

function fail(message) {
  throw new Error(`FREE_TAROT_V2_FUNNEL_CONTRACT_${message}`);
}

function quotedVariable(source, variableName) {
  const match = new RegExp(`\\bvar\\s+${variableName}\\s*=\\s*'([^']+)'\\s*;`).exec(source);
  if (!match) fail(`${variableName}_MISSING`);
  return match[1];
}

function quotedArray(source, variableName) {
  const match = new RegExp(`\\bvar\\s+${variableName}\\s*=\\s*\\[([^\\]]+)\\]\\s*;`).exec(source);
  if (!match) fail(`${variableName}_MISSING`);
  const values = [...match[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1]);
  if (!values.length || values.length !== new Set(values).size) fail(`${variableName}_INVALID`);
  return values;
}

function functionBody(source, functionName) {
  const marker = new RegExp(`\\bfunction\\s+${functionName}\\s*\\([^)]*\\)\\s*\\{`).exec(source);
  if (!marker) fail(`${functionName}_MISSING`);
  const start = marker.index + marker[0].length;
  let depth = 1;
  let quote = '';
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = start; index < source.length; index += 1) {
    const current = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (current === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (current === '*' && next === '/') {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (current === '\\') escaped = true;
      else if (current === quote) quote = '';
      continue;
    }
    if (current === '/' && next === '/') {
      lineComment = true;
      index += 1;
      continue;
    }
    if (current === '/' && next === '*') {
      blockComment = true;
      index += 1;
      continue;
    }
    if (current === "'" || current === '"' || current === '`') {
      quote = current;
      continue;
    }
    if (current === '{') depth += 1;
    else if (current === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index);
    }
  }
  fail(`${functionName}_UNTERMINATED`);
}

function objectLiteralBody(source, markerPattern, failureName) {
  const marker = markerPattern.exec(source);
  if (!marker) fail(`${failureName}_MISSING`);
  const start = source.indexOf('{', marker.index);
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    else if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start + 1, index);
    }
  }
  fail(`${failureName}_UNTERMINATED`);
}

function literalEventNames(source) {
  const names = new Set();
  for (const match of source.matchAll(/\bpublishFunnelEvent\(\s*'([a-z][a-z0-9_]{2,63})'/g)) {
    names.add(match[1]);
  }

  const aliases = functionBody(source, 'legacyFunnelAliases');
  const directAliases = objectLiteralBody(aliases, /\bvar\s+direct\s*=\s*\{/, 'legacyFunnelAliases_direct');
  for (const match of directAliases.matchAll(/^\s*([a-z][a-z0-9_]*)\s*:/gm)) names.add(match[1]);

  const visibility = functionBody(source, 'scheduleVisibilityEvent');
  for (const match of visibility.matchAll(/\bname\s*===\s*'([a-z][a-z0-9_]*)'/g)) names.add(match[1]);

  const events = [...names].sort();
  if (events.length !== EXPECTED_LITERAL_EVENT_COUNT) fail('EVENT_COUNT_MISMATCH');
  if (REQUIRED_EVENTS.some((eventName) => !names.has(eventName))) fail('REQUIRED_EVENT_MISSING');
  return events;
}

function technicalMetadataKeys(source) {
  const body = functionBody(source, 'serverEventMetadata');
  const metadataObject = objectLiteralBody(body, /\bvar\s+metadata\s*=\s*\{/, 'serverEventMetadata_object');
  const keys = new Set([...metadataObject.matchAll(/^\s*([a-z][a-z0-9_]*)\s*:/gm)].map((match) => match[1]));

  for (const arrayMatch of body.matchAll(/\[((?:\s*'[^']+'\s*,?)+)\]\.forEach/g)) {
    for (const entry of arrayMatch[1].matchAll(/'([^']+)'/g)) keys.add(entry[1]);
  }
  for (const assignment of body.matchAll(/\bmetadata\.([a-z][a-z0-9_]*)\s*=/g)) keys.add(assignment[1]);

  const metadataKeys = [...keys].sort();
  if (metadataKeys.length !== EXPECTED_TECHNICAL_METADATA_KEY_COUNT) fail('METADATA_KEY_COUNT_MISMATCH');
  if (REQUIRED_METADATA_KEYS.some((key) => !keys.has(key))) fail('REQUIRED_METADATA_KEY_MISSING');
  if (FORBIDDEN_METADATA_KEYS.some((key) => keys.has(key))) fail('UNSAFE_METADATA_KEY_PRESENT');
  return metadataKeys;
}

function literal(value) {
  return JSON.stringify(value, null, 2);
}

function render(contract) {
  return `// Generated by scripts/generate-free-tarot-v2-funnel-contract.mjs. Do not hand-edit.\n` +
`// Source contract SHA-256: ${contract.sourceDigest}\n` +
`export const FREE_TAROT_V2_SOURCE_SHA256 = ${JSON.stringify(contract.sourceDigest)};\n` +
`export const FREE_TAROT_V2_PAGE = ${JSON.stringify(contract.page)};\n` +
`export const FREE_TAROT_V2_READING_MODE = ${JSON.stringify(contract.readingMode)};\n` +
`export const FREE_TAROT_V2_FUNNEL_VERSION = ${JSON.stringify(contract.funnelVersion)};\n` +
`export const FREE_TAROT_V2_ANALYTICS_SCHEMA = ${JSON.stringify(contract.analyticsSchema)};\n` +
`export const FREE_TAROT_V2_TOOL_TYPE = ${JSON.stringify(contract.toolType)};\n` +
`export const FREE_TAROT_V2_TIERS = Object.freeze(${literal(contract.tiers)});\n` +
`export const FREE_TAROT_V2_EVENT_NAMES = Object.freeze(${literal(contract.eventNames)});\n` +
`export const FREE_TAROT_V2_METADATA_KEYS = Object.freeze(${literal(contract.metadataKeys)});\n` +
`export const FREE_TAROT_V2_REQUIRED_METADATA_KEYS = Object.freeze(${literal(REQUIRED_METADATA_KEYS)});\n` +
`export function isFreeTarotV2EventName(value) {\n` +
`  return FREE_TAROT_V2_EVENT_NAMES.includes(String(value || '').trim());\n` +
`}\n`;
}

const sourcePath = resolve(argument('--source') || process.env.DECKAURA_FREE_TAROT_V2_SOURCE || '');
const outputPath = resolve(argument('--out') || 'lib/generated/free-tarot-v2-funnel-contract.mjs');
if (!argument('--source') && !process.env.DECKAURA_FREE_TAROT_V2_SOURCE) fail('SOURCE_PATH_REQUIRED');
const source = await readFile(sourcePath, 'utf8');
const publishServerEventBody = functionBody(source, 'publishServerEvent');
const serverEventMetadataBody = functionBody(source, 'serverEventMetadata');
const readingMode = /\breadingMode\s*:\s*'([^']+)'/.exec(publishServerEventBody)?.[1] || '';
const toolType = /\btool_type\s*:\s*'([^']+)'/.exec(serverEventMetadataBody)?.[1] || '';
if (!readingMode) fail('READING_MODE_MISSING');
if (!toolType) fail('TOOL_TYPE_MISSING');

const contract = {
  page: quotedVariable(source, 'PAGE'),
  readingMode,
  funnelVersion: quotedVariable(source, 'FUNNEL_VERSION'),
  analyticsSchema: quotedVariable(source, 'ANALYTICS_SCHEMA'),
  toolType,
  tiers: quotedArray(source, 'RAIL_TIERS'),
  eventNames: literalEventNames(source),
  metadataKeys: technicalMetadataKeys(source),
};
contract.sourceDigest = createHash('sha256').update(JSON.stringify(contract)).digest('hex');
const output = render(contract);

if (process.argv.includes('--check')) {
  const current = await readFile(outputPath, 'utf8').catch(() => '');
  if (current !== output) fail('DRIFT_DETECTED');
} else {
  await writeFile(outputPath, output, 'utf8');
}
