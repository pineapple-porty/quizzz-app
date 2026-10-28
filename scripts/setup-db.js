const fs = require("node:fs/promises");
const path = require("node:path");
const { pool, databaseConfigured } = require("../src/db");

async function setupDatabase() {
  if (!databaseConfigured) {
    throw new Error("Set DATABASE_URL to a non-production database before running schema setup");
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("Schema setup is blocked when NODE_ENV is production");
  }
  if (process.env.DATABASE_TARGET !== "qa") {
    throw new Error("Set DATABASE_TARGET=qa before running schema setup");
  }

  const schema = await fs.readFile(path.join(__dirname, "../src/schema.sql"), "utf8");
  await pool.query(schema);
  console.log("Application tables are ready.");
}

setupDatabase()
  .catch((error) => {
    console.error("Database setup failed:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
