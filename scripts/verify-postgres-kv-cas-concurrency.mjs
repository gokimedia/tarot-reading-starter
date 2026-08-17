import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import postgres from 'postgres';

const databaseUrl = String(process.env.POSTGRES_CAS_TEST_URL || '').trim();
if (!databaseUrl) {
  throw new Error('POSTGRES_CAS_TEST_URL is required; use an isolated disposable PostgreSQL database');
}

const schema = `codex_cas_${process.pid}_${randomBytes(4).toString('hex')}`;
if (!/^[a-z0-9_]+$/.test(schema)) throw new Error('invalid test schema');
const table = `"${schema}".kv_store`;
const salt = 918273645;
const lockName = (key) => `deckaura.kv_store.cas:${key}`;
const clients = [postgres(databaseUrl, { max: 1 }), postgres(databaseUrl, { max: 1 }), postgres(databaseUrl, { max: 1 })];

class Conflict extends Error {}

async function cas(client, entries, afterLocks = null) {
  const normalized = entries.map((entry) => ({ ...entry, key: String(entry.key) }))
    .sort((left, right) => left.key.localeCompare(right.key));
  try {
    return await client.begin(async (tx) => {
      for (const entry of normalized) {
        await tx`select pg_advisory_xact_lock(hashtextextended(${lockName(entry.key)}, ${salt}))`;
      }
      if (afterLocks) await afterLocks(tx);
      for (const entry of normalized) {
        if (entry.value == null && entry.expectedValue == null) {
          const present = await tx.unsafe(
            `select key from ${table} where key = $1 and (expires_at is null or expires_at > clock_timestamp()) for update`,
            [entry.key],
          );
          if (present.length) throw new Conflict();
          continue;
        }
        const expiresAt = entry.expiresAt || null;
        if (entry.expectedValue == null) {
          const inserted = await tx.unsafe(
            `insert into ${table}(key,value,expires_at)
             select $1,$2,$3
              where ($3::timestamptz is null or $3::timestamptz > clock_timestamp())
             on conflict (key) do nothing returning key`,
            [entry.key, String(entry.value), expiresAt],
          );
          if (!inserted.length) throw new Conflict();
          continue;
        }
        const updated = await tx.unsafe(
          `update ${table}
              set value=$2, expires_at=$3, updated_at=clock_timestamp()
            where key=$1 and value=$4
              and (expires_at is null or expires_at > clock_timestamp())
              and ($3::timestamptz is null or $3::timestamptz > clock_timestamp())
          returning key`,
          [entry.key, String(entry.value), expiresAt, String(entry.expectedValue)],
        );
        if (!updated.length) throw new Conflict();
      }
      return true;
    });
  } catch (error) {
    if (error instanceof Conflict) return false;
    throw error;
  }
}

let releaseAbsent;
const absentRelease = new Promise((resolve) => { releaseAbsent = resolve; });
let absentLocked;
const absentReady = new Promise((resolve) => { absentLocked = resolve; });

try {
  await clients[0].unsafe(`create schema "${schema}"`);
  await clients[0].unsafe(`create table ${table}(
    key text primary key,
    value text not null,
    expires_at timestamptz,
    updated_at timestamptz not null default clock_timestamp()
  )`);

  const absence = cas(clients[0], [{ key: 'receipt', expectedValue: null, value: null }], async () => {
    absentLocked();
    await absentRelease;
  });
  await absentReady;
  let insertFinished = false;
  const insertion = cas(clients[1], [{ key: 'receipt', expectedValue: null, value: 'signed-receipt' }])
    .then((value) => { insertFinished = true; return value; });
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(insertFinished, false, 'same-key insert must wait behind an absent-key guard');
  releaseAbsent();
  assert.equal(await absence, true);
  assert.equal(await insertion, true);
  assert.equal((await clients[0].unsafe(`select value from ${table} where key='receipt'`))[0].value, 'signed-receipt');

  await clients[0].unsafe(`insert into ${table}(key,value) values ('a','A'),('b','B'),('x','X'),('y','Y')`);
  const reverseOrder = Promise.all([
    cas(clients[0], [
      { key: 'a', expectedValue: 'A', value: 'A' },
      { key: 'b', expectedValue: 'B', value: 'B' },
    ]),
    cas(clients[1], [
      { key: 'b', expectedValue: 'B', value: 'B' },
      { key: 'a', expectedValue: 'A', value: 'A' },
    ]),
  ]);
  const reverseResult = await Promise.race([
    reverseOrder,
    new Promise((_, reject) => setTimeout(() => reject(new Error('reverse-order CAS deadlocked')), 5_000)),
  ]);
  assert.deepEqual(reverseResult, [true, true]);

  let releaseDisjoint;
  const disjointRelease = new Promise((resolve) => { releaseDisjoint = resolve; });
  let xLocked;
  const xReady = new Promise((resolve) => { xLocked = resolve; });
  const xWrite = cas(clients[0], [{ key: 'x', expectedValue: 'X', value: 'X2' }], async () => {
    xLocked();
    await disjointRelease;
  });
  await xReady;
  const yWrite = cas(clients[1], [{ key: 'y', expectedValue: 'Y', value: 'Y2' }]);
  assert.equal(await yWrite, true, 'disjoint keys must not serialize behind each other');
  releaseDisjoint();
  assert.equal(await xWrite, true);

  const physicalExpiry = new Date(Date.now() + 5_000);
  const logicalExpiry = new Date(Date.now() + 250);
  await clients[0].unsafe(`insert into ${table}(key,value,expires_at) values ('expiring','source',$1)`, [physicalExpiry]);
  let expiryLocked;
  const expiryReady = new Promise((resolve) => { expiryLocked = resolve; });
  const blocker = clients[0].begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended(${lockName('expiring')}, ${salt}))`;
    expiryLocked();
    await tx`select pg_sleep(0.6)`;
  });
  await expiryReady;
  const expiredCas = cas(clients[1], [{
    key: 'expiring',
    expectedValue: 'source',
    value: 'source',
    expiresAt: logicalExpiry,
  }]);
  await blocker;
  assert.equal(await expiredCas, false, 'a proposed logical expiry crossing server time must fail closed');
  assert.equal((await clients[0].unsafe(`select value from ${table} where key='expiring'`))[0].value, 'source');

  process.stdout.write('Postgres KV CAS concurrency truth table: PASS\n');
} finally {
  await clients[0].unsafe(`drop schema if exists "${schema}" cascade`).catch(() => {});
  await Promise.all(clients.map((client) => client.end({ timeout: 1 }).catch(() => {})));
}
