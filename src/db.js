const { Pool } = require("pg");

const hasDatabaseConfig = Boolean(
  process.env.DATABASE_URL ||
    process.env.PGHOST ||
    process.env.PGUSER ||
    process.env.PGDATABASE ||
    process.env.PGPASSWORD ||
    process.env.PGPORT,
);

function buildPool() {
  if (!hasDatabaseConfig) {
    console.warn("Database not connected — using mock");
    return {
      query: async () => ({ rows: [] }),
      connect: async () => ({
        query: async () => ({ rows: [] }),
        release: () => {},
      }),
      end: async () => {},
    };
  }

  const config = process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL }
    : {
        host: process.env.PGHOST || "localhost",
        port: Number(process.env.PGPORT) || 5432,
        user: process.env.PGUSER,
        password: process.env.PGPASSWORD,
        database: process.env.PGDATABASE || process.env.PGUSER || "postgres",
      };

  return new Pool({
    ...config,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
}

const pool = buildPool();

module.exports = { hasDatabaseConfig, pool };
