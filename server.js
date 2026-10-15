const path = require("node:path");
const express = require("express");
const { hasDatabaseConfig, pool } = require("./src/db");
const { initializeAuthSchema, router: authRouter } = require("./src/auth");

const app = express();
const port = Number(process.env.PORT) || 3000;

app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_request, response) => {
  response.json({
    status: "ok",
    service: "quiz-app",
  });
});

app.get("/api/health/database", async (_request, response) => {
  if (!hasDatabaseConfig) {
    response.status(503).json({
      status: "error",
      database: "unavailable",
    });
    return;
  }

  try {
    await pool.query("SELECT 1");
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

app.use("/api", authRouter);
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

async function startServer() {
  if (hasDatabaseConfig) {
    try {
      await initializeAuthSchema();
      console.log("Authentication schema is ready");
    } catch (error) {
      console.error("Authentication schema initialization failed:", error.message);
    }
  }

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

if (require.main === module) {
  startServer().catch((error) => {
    console.error("Could not start quiz app:", error.message);
    process.exitCode = 1;
  });
}

module.exports = { app };
