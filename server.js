const path = require("node:path");
const express = require("express");
const { pool, databaseConfigured } = require("./src/db");
const { installAuthRoutes } = require("./src/auth");

function createApp(options = {}) {
  const dbPool = options.pool || pool;
  const hasDatabase = options.databaseConfigured ?? databaseConfigured;
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/health", (_request, response) => {
    response.json({
      status: "ok",
      service: "quiz-app",
    });
  });

  app.get("/api/health/database", async (_request, response) => {
    try {
      await dbPool.query("SELECT 1");
      response.json({
        status: "ok",
        database: "connected",
      });
    } catch (error) {
      console.error("PostgreSQL health check failed:", error.message);
      response.status(503).json({
        status: "error",
        database: "unavailable",
      });
    }
  });

  const auth = installAuthRoutes(app, {
    pool: dbPool,
    databaseConfigured: hasDatabase,
    sessionSecret: options.sessionSecret ?? process.env.SESSION_SECRET,
    secureCookies: options.secureCookies ?? process.env.NODE_ENV === "production",
  });

  app.get("/api/me", auth.authenticate, (request, response) => {
    const user = request.user;
    response.json({
      username: user.username,
      role: user.role,
      display_name: user.display_name,
      bio: user.bio,
      points: user.points,
      level: 1,
      streak_count: user.streak_count,
      best_streak: user.best_streak,
      created_at: user.created_at,
    });
  });

  app.use(express.static(path.join(__dirname, "public")));

  app.use((request, response) => {
    response.status(404).json({
      error: "Not found",
      path: request.path,
    });
  });

  app.use((error, _request, response, _next) => {
    console.error("Request failed:", error.message);
    response.status(error.status === 400 ? 400 : 500).json({
      error: error.status === 400 ? "Invalid request body" : "Internal server error",
    });
  });

  return app;
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  const app = createApp();
  const server = app.listen(port, "0.0.0.0", () => {
    console.log(`Quiz app server listening on 0.0.0.0:${port}`);
  });

  function shutdown(signal) {
    console.log(`${signal} received; closing server`);
    server.close(async () => {
      await pool.end();
      process.exit(0);
    });
  }

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

module.exports = { createApp };
