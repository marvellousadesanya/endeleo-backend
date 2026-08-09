// Plain-SQL migration runner.
//
// Deliberately runs .sql files rather than TypeScript migrations: the bond engine's
// rules already exist as ~2,100 lines of SQL (state-machine triggers, RLS, and the
// atomic allocate/trade/cancel procedures). Those files can be copied into
// src/database/migrations untouched and will run in filename order.
//
// Each migration runs inside a transaction and is recorded, so re-running is a no-op.
// A failed migration rolls back whole rather than leaving the schema half-applied.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "pg";
import "dotenv/config";

const MIGRATIONS_DIR = join(__dirname, "migrations");

async function ensureMigrationsTable(client: Client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name        TEXT PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function appliedMigrations(client: Client): Promise<Set<string>> {
  const { rows } = await client.query<{ name: string }>("SELECT name FROM schema_migrations");
  return new Set(rows.map((r) => r.name));
}

async function pendingMigrations(client: Client): Promise<string[]> {
  const applied = await appliedMigrations(client);
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
  return files.filter((f) => !applied.has(f));
}

async function up(client: Client) {
  const pending = await pendingMigrations(client);
  if (pending.length === 0) {
    console.log("Nothing to migrate.");
    return;
  }
  for (const name of pending) {
    const sql = await readFile(join(MIGRATIONS_DIR, name), "utf8");
    process.stdout.write(`Applying ${name} ... `);
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations(name) VALUES ($1)", [name]);
      await client.query("COMMIT");
      console.log("ok");
    } catch (err) {
      await client.query("ROLLBACK");
      console.log("FAILED");
      throw err;
    }
  }
  console.log(`Applied ${pending.length} migration(s).`);
}

async function status(client: Client) {
  const applied = await appliedMigrations(client);
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) console.log(`${applied.has(f) ? "[x]" : "[ ]"} ${f}`);
  if (files.length === 0) console.log("(no migration files)");
}

async function main() {
  const command = process.argv[2] ?? "up";
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");

  const client = new Client({ connectionString });
  await client.connect();
  try {
    await ensureMigrationsTable(client);
    if (command === "up") await up(client);
    else if (command === "status") await status(client);
    else throw new Error(`Unknown command: ${command} (expected "up" or "status")`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
