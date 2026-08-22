// One-shot schema setup: `npm run db:migrate`. Needs DATABASE_URL (or
// POSTGRES_URL) in the environment -- run `vercel env pull .env.local`
// first after attaching a Neon/Postgres store to the project, or set it
// manually for local dev against a Neon branch.
//
// Unlike `next dev`/`build`/`start`, this script runs standalone via tsx,
// outside Next's runtime -- Next auto-loads .env.local for its own
// commands, but nothing does that for a plain script, so we load it here.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { neon } from "@neondatabase/serverless";

const envLocalPath = path.join(__dirname, "..", ".env.local");
if (existsSync(envLocalPath)) {
  process.loadEnvFile(envLocalPath);
}

async function main() {
  const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL (or POSTGRES_URL) is not set.");
  }
  const sql = neon(connectionString);

  const schemaPath = path.join(__dirname, "schema.sql");
  const schema = readFileSync(schemaPath, "utf-8");

  // The Neon driver's sql tag doesn't run multi-statement scripts, so
  // strip comment lines first, then split on ";" and run each statement
  // individually. Stripping comments *before* splitting matters: a
  // statement preceded by a comment on the previous line (no semicolon
  // between them) would otherwise land in the same chunk as that
  // comment, and a naive "does this chunk start with --" filter would
  // discard the real statement along with it. Fine for this schema (no
  // functions or dollar-quoted bodies containing ";").
  const withoutComments = schema
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  const statements = withoutComments
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const statement of statements) {
    await sql.query(statement);
    console.log("ran:", statement.split("\n")[0]!.slice(0, 60));
  }
  console.log("migration complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
