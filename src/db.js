const { Pool } = require("pg");

let pool;
if (process.env.DATABASE_URL) {
  try {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
  } catch (err) {
    console.warn("DB not connected — mock active", err);
  }
}

if (!pool) {
  console.warn("Database not connected — using mock");
  pool = {
    query: async () => ({ rows: [] }),
    connect: async () => ({
      query: async () => ({ rows: [] }),
      release: () => {},
    }),
    end: async () => {},
  };
}

module.exports = { pool };
