// One-shot schema setup: `npm run db:migrate`. Needs DATABASE_URL (or
// POSTGRES_URL) in the environment -- run `vercel env pull .env.local`
// first after attaching a Neon/Postgres store to the project, or set it
// manually for local dev against a Neon branch.
import { readFileSync } from "node:fs";
import path from "node:path";
import { neon } from "@neondatabase/serverless";

async function main() {
  const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL (or POSTGRES_URL) is not set.");
  }
  const sql = neon(connectionString);

  const schemaPath = path.join(__dirname, "schema.sql");
  const schema = readFileSync(schemaPath, "utf-8");

  // The Neon driver's sql tag doesn't run multi-statement scripts, so
  // split on ";" and run each statement individually. Fine for this
  // schema (no functions or dollar-quoted bodies containing ";").
  const statements = schema
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith("--"));

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
