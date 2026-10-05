const { Pool } = require("pg");

// pg reads DATABASE_URL or the standard PG* environment variables.
const pool = new Pool({
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

module.exports = { pool };
