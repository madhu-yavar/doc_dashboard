/**
 * Migration runner: Add interim/final values to segment_status_enum.
 *
 * Run with: node server/db/migrations/run_add_transcript_segment_status_values.cjs
 */

const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

async function runMigration() {
  const client = new Client({
    host: process.env.PGHOST || "localhost",
    port: parseInt(process.env.PGPORT || "5432", 10),
    database: process.env.PGDATABASE || "doctor_dashboard",
    user: process.env.PGUSER || "postgres",
    password: process.env.PGPASSWORD || "postgres",
  });

  try {
    console.log("Connecting to PostgreSQL...");
    await client.connect();
    console.log("✓ Connected");

    const migrationPath = path.join(__dirname, "add_transcript_segment_status_values.sql");
    const migrationSQL = fs.readFileSync(migrationPath, "utf8");

    console.log("Adding transcript segment status enum values...");
    const result = await client.query(migrationSQL);
    console.log("✓ Migration completed successfully");

    const results = Array.isArray(result) ? result : [result];
    const rows = results[results.length - 1]?.rows || [];
    if (rows.length > 0) {
      console.log("\nsegment_status_enum values:");
      for (const row of rows) {
        console.log(`  - ${row.enumlabel}`);
      }
    }
  } catch (error) {
    console.error("✗ Migration failed:", error.message);
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => undefined);
    console.log("\nConnection closed.");
  }
}

runMigration();
