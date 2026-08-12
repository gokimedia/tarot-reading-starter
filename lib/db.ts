import postgres, { type Sql } from 'postgres';

declare global {
  // eslint-disable-next-line no-var
  var __deckauraSql: Sql | undefined;
}
function databaseUrl() {
  const value = process.env.POSTGRES_URL || process.env.DATABASE_URL;
  if (!value) {
    throw new Error('POSTGRES_URL is not configured. Connect the Supabase resource to this Vercel project.');
  }
  return value;
}

export function db() {
  if (!globalThis.__deckauraSql) {
    globalThis.__deckauraSql = postgres(databaseUrl(), {
      max: 1,
      prepare: false,
      connect_timeout: 10,
      idle_timeout: 20,
      max_lifetime: 60 * 10,
      onnotice: () => undefined,
    });
  }
  return globalThis.__deckauraSql;
}
