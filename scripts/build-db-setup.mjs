// Builds supabase/setup-all.sql: the reset script plus every migration, in order,
// so a fresh or half-applied database can be installed with a single paste.
// Run: npm run db:setup
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS = 'supabase/migrations';
const RESET = 'supabase/reset-dev.sql';
const BACKFILL = 'supabase/backfill-profiles.sql';
const OUT = 'supabase/setup-all.sql';

const migrations = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
if (migrations.length === 0) throw new Error(`No migrations found in ${MIGRATIONS}`);

const header = `-- ─────────────────────────────────────────────────────────────────────────────
-- ChatSpace — complete database setup. GENERATED FILE, DO NOT EDIT.
-- Regenerate with: npm run db:setup
--
-- DESTRUCTIVE: starts by dropping the \`public\` schema, so every ChatSpace row
-- (profiles, chats, messages, calls, reports) is deleted. Auth users and files in
-- storage survive. Use it on a development project only.
--
-- Paste this whole file into Supabase → SQL Editor and run it once. It is safe to
-- run again: it always starts from an empty schema, never from a partial install.
-- It ends by recreating profile rows for accounts that already existed.
-- ─────────────────────────────────────────────────────────────────────────────

`;

const parts = migrations.map((file) => {
  const sql = readFileSync(join(MIGRATIONS, file), 'utf8').trimEnd();
  return `\n\n-- ═════════════════════════════════════════════════════════════════════════════\n-- ${file}\n-- ═════════════════════════════════════════════════════════════════════════════\n\n${sql}\n`;
});

const backfill = `\n\n-- ═════════════════════════════════════════════════════════════════════════════\n-- backfill-profiles.sql\n-- ═════════════════════════════════════════════════════════════════════════════\n\n${readFileSync(BACKFILL, 'utf8').trimEnd()}\n`;

const out = header + readFileSync(RESET, 'utf8').trimEnd() + '\n' + parts.join('') + backfill;

const quotes = (out.match(/\$\$/g) ?? []).length;
if (quotes % 2 !== 0) throw new Error(`Unbalanced $$ dollar quotes (${quotes}) — a function body is malformed`);

writeFileSync(OUT, out);
console.log(`${OUT}: ${migrations.length} migrations, ${out.split('\n').length} lines, ${quotes} dollar quotes`);
