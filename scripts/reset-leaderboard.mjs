// Explicit, one-time maintenance command. Never run automatically at startup.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: [path.join(root, '.env.local'), path.join(root, '.env')], quiet: true });
const url = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const table = process.env.SUPABASE_TABLE || process.env.VITE_SUPABASE_TABLE || 'ABBOTT_QUIZ';
if (!url || !key) throw new Error('Supabase is not configured.');

async function request(params, method = 'GET') {
  const response = await fetch(`${url}/rest/v1/${encodeURIComponent(table)}?${params}`, {
    method,
    signal: AbortSignal.timeout(15000),
    headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: 'return=representation' },
  });
  if (!response.ok) throw new Error(`Supabase ${method} failed (${response.status}). No permission changes were made.`);
  return response.json();
}

const rows = [];
for (let offset = 0; ; offset += 1000) {
  const page = await request(new URLSearchParams({ select: '*', order: 'id.asc', limit: '1000', offset: String(offset) }));
  if (!Array.isArray(page)) throw new Error('Invalid Supabase response.');
  rows.push(...page);
  if (page.length < 1000) break;
}
console.log(`Found ${rows.length} existing leaderboard entries in ${table}.`);
if (!process.argv.includes('--confirm-clear-current-leaderboard')) {
  console.log('Read-only preview. To back up and remove these rows, pass --confirm-clear-current-leaderboard.');
  process.exit(0);
}
if (!rows.length) process.exit(0);
for (const row of rows) {
  if (!/^[a-zA-Z0-9-]+$/.test(String(row.id))) throw new Error('Unexpected row ID; refusing to delete.');
}
const backupDirectory = path.join(root, '.leaderboard-backups');
await fs.mkdir(backupDirectory, { recursive: true, mode: 0o700 });
const backupFile = path.join(backupDirectory, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
await fs.writeFile(backupFile, JSON.stringify({ table, rows }, null, 2), { flag: 'wx', mode: 0o600 });
console.log(`Recovery backup saved to ${backupFile}`);
let deleted = 0;
for (let offset = 0; offset < rows.length; offset += 100) {
  const ids = rows.slice(offset, offset + 100).map((row) => row.id);
  const params = new URLSearchParams({ id: `in.(${ids.join(',')})` });
  const removed = await request(params, 'DELETE');
  deleted += removed.length;
  const remaining = await request(new URLSearchParams({ ...Object.fromEntries(params), select: 'id' }));
  if (remaining.length) throw new Error(`Deletion was not permitted for ${remaining.length} rows. Use a server-side key with delete access; backup retained.`);
}
console.log(`Removed ${deleted} backed-up entries. New rows created after the snapshot were not touched.`);
