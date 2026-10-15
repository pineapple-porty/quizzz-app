const { createHash, createHmac, randomBytes } = require("node:crypto");
const express = require("express");
const bcrypt = require("bcryptjs");
const { hasDatabaseConfig, pool } = require("./db");

const router = express.Router();
const SESSION_COOKIE = "quizzz_session";
const SESSION_LIFETIME_SECONDS = 30 * 24 * 60 * 60;
const BCRYPT_COST = 12;
const DUMMY_PASSWORD_HASH = bcrypt.hashSync(passwordDigest("not-a-real-password"), BCRYPT_COST);

let authSchemaReady = false;

async function initializeAuthSchema() {
  if (!hasDatabaseConfig) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      username TEXT UNIQUE NOT NULL
        CHECK (username ~ '^[A-Za-z0-9_]{3,20}$'),
      role TEXT NOT NULL DEFAULT 'player'
        CHECK (role IN ('player', 'teacher')),
      password_hash TEXT NOT NULL,
      points INTEGER NOT NULL DEFAULT 0,
      streak_count INTEGER NOT NULL DEFAULT 0,
      best_streak INTEGER NOT NULL DEFAULT 0,
      beaten_quizzes TEXT[] NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  authSchemaReady = true;
}

function hashSessionToken(token) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return null;
  return createHmac("sha256", secret).update(token).digest("hex");
}

function getSessionToken(request) {
  const cookies = request.headers.cookie?.split(";") ?? [];
  const cookie = cookies.find((part) => part.trim().startsWith(`${SESSION_COOKIE}=`));
  return cookie ? cookie.trim().slice(SESSION_COOKIE.length + 1) : null;
}

function setSessionCookie(response, token, maxAge = SESSION_LIFETIME_SECONDS) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`,
  );
}

function clearSessionCookie(response) {
  setSessionCookie(response, "", 0);
}

function databaseUnavailable(response) {
  if (!hasDatabaseConfig) {
    response.status(503).json({ error: "Account services are unavailable without a database." });
    return true;
  }
  if (!authSchemaReady) {
    response.status(503).json({ error: "Account services are not ready. Please try again later." });
    return true;
  }
  return false;
}

function sessionUnavailable(response) {
  if (!process.env.SESSION_SECRET) {
    response.status(503).json({ error: "Account services are not configured." });
    return true;
  }
  return false;
}

function passwordDigest(password) {
  return createHash("sha256").update(password, "utf8").digest("hex");
}

function handleDatabaseError(error, response, message) {
  console.error(`${message}:`, error.message);
  response.status(500).json({ error: message });
}

router.use(async (request, response, next) => {
  const token = getSessionToken(request);
  if (!token || !hasDatabaseConfig || !authSchemaReady || !process.env.SESSION_SECRET) {
    next();
    return;
  }

  try {
    const tokenHash = hashSessionToken(token);
    const { rows } = await pool.query(
      `UPDATE sessions AS s
       SET expires_at = NOW() + INTERVAL '30 days'
       FROM users AS u
       WHERE s.token = $1
         AND s.user_id = u.id
         AND s.expires_at > NOW()
       RETURNING u.id, u.username, u.role, u.points, u.streak_count,
         u.best_streak, u.created_at`,
      [tokenHash],
    );

    if (rows[0]) {
      request.user = rows[0];
      setSessionCookie(response, token);
    }
    next();
  } catch (error) {
    handleDatabaseError(error, response, "Could not validate session");
  }
});

router.post("/auth/register", async (request, response) => {
  if (databaseUnavailable(response) || sessionUnavailable(response)) return;

  const { username, password } = request.body ?? {};
  if (typeof username !== "string" || !/^[A-Za-z0-9_]{3,20}$/.test(username)) {
    response.status(400).json({ error: "Username must be 3–20 letters, numbers, or underscores." });
    return;
  }
  if (typeof password !== "string" || password.length < 8) {
    response.status(400).json({ error: "Password must be at least 8 characters." });
    return;
  }

  try {
    const passwordHash = await bcrypt.hash(passwordDigest(password), BCRYPT_COST);
    const { rows } = await pool.query(
      "INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING username",
      [username, passwordHash],
    );
    response.status(201).json({ username: rows[0].username });
  } catch (error) {
    if (error.code === "23505") {
      response.status(409).json({ error: "That username is already taken." });
      return;
    }
    handleDatabaseError(error, response, "Could not create account");
  }
});

router.post("/auth/login", async (request, response) => {
  if (databaseUnavailable(response) || sessionUnavailable(response)) return;

  const { username, password } = request.body ?? {};
  if (
    typeof username !== "string" ||
    !/^[A-Za-z0-9_]{3,20}$/.test(username) ||
    typeof password !== "string" ||
    !password
  ) {
    response.status(400).json({ error: "Enter your username and password." });
    return;
  }

  try {
    const { rows } = await pool.query(
      "SELECT id, username, password_hash FROM users WHERE username = $1",
      [username],
    );
    const user = rows[0];
    const validPassword = await bcrypt.compare(
      passwordDigest(password),
      user?.password_hash ?? DUMMY_PASSWORD_HASH,
    );

    if (!user || !validPassword) {
      response.status(401).json({ error: "Username or password is incorrect." });
      return;
    }

    const token = randomBytes(32).toString("base64url");
    const tokenHash = hashSessionToken(token);
    await pool.query(
      `INSERT INTO sessions (token, user_id, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '30 days')`,
      [tokenHash, user.id],
    );
    setSessionCookie(response, token);
    response.json({ username: user.username });
  } catch (error) {
    handleDatabaseError(error, response, "Could not log in");
  }
});

router.post("/auth/logout", async (request, response) => {
  const token = getSessionToken(request);
  clearSessionCookie(response);

  if (token && hasDatabaseConfig) {
    if (databaseUnavailable(response) || sessionUnavailable(response)) return;

    try {
      await pool.query("DELETE FROM sessions WHERE token = $1", [hashSessionToken(token)]);
    } catch (error) {
      handleDatabaseError(error, response, "Could not log out");
      return;
    }
  }
  response.json({ ok: true });
});

router.get("/me", (request, response) => {
  if (databaseUnavailable(response)) return;
  if (!request.user) {
    response.status(401).json({ error: "Log in to continue." });
    return;
  }

  const level = Math.min(100, Math.floor(Math.sqrt(request.user.points / 50)) + 1);
  response.json({
    username: request.user.username,
    role: request.user.role,
    points: request.user.points,
    level,
    streak_count: request.user.streak_count,
    best_streak: request.user.best_streak,
    created_at: request.user.created_at,
  });
});

module.exports = { initializeAuthSchema, router };
