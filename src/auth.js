const { createHash, createHmac, randomBytes } = require("node:crypto");
const bcrypt = require("bcryptjs");

const SESSION_COOKIE = "quiz_session";
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,20}$/;
const AUTH_UNAVAILABLE = "Authentication is unavailable";

function validRequestBody(body) {
  return body !== null && typeof body === "object" && !Array.isArray(body);
}

function isValidSessionSecret(secret) {
  return typeof secret === "string" && Buffer.byteLength(secret, "utf8") >= 32;
}

function digestToken(token, secret) {
  return createHmac("sha256", secret).update(token).digest("hex");
}

function preparePassword(password) {
  // Keep arbitrary-length passwords intact despite bcrypt's 72-byte input limit.
  return createHash("sha256").update(password, "utf8").digest("hex");
}

function readCookie(request, name) {
  const cookieHeader = request.headers.cookie || "";
  for (const cookie of cookieHeader.split(";")) {
    const separator = cookie.indexOf("=");
    if (separator < 0 || cookie.slice(0, separator).trim() !== name) continue;
    return cookie.slice(separator + 1).trim();
  }
  return null;
}

function writeSessionCookie(response, token, secureCookies) {
  const secure = secureCookies ? "; Secure" : "";
  response.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SECONDS}${secure}`,
  );
}

function clearSessionCookie(response, secureCookies) {
  const secure = secureCookies ? "; Secure" : "";
  response.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`,
  );
}

function installAuthRoutes(app, {
  pool,
  databaseConfigured,
  sessionSecret,
  secureCookies = false,
}) {
  function authIsConfigured(response) {
    if (!databaseConfigured) {
      response.status(503).json({ error: AUTH_UNAVAILABLE });
      return false;
    }
    if (!isValidSessionSecret(sessionSecret)) {
      console.error("Authentication requires a SESSION_SECRET of at least 32 bytes");
      response.status(503).json({ error: AUTH_UNAVAILABLE });
      return false;
    }
    return true;
  }

  app.post("/api/auth/register", async (request, response) => {
    if (!authIsConfigured(response)) return;
    if (
      !validRequestBody(request.body) ||
      typeof request.body.username !== "string" ||
      !USERNAME_PATTERN.test(request.body.username) ||
      typeof request.body.password !== "string" ||
      [...request.body.password].length < 8
    ) {
      response.status(400).json({ error: "Username or password is invalid" });
      return;
    }

    try {
      const passwordHash = await bcrypt.hash(preparePassword(request.body.password), 12);
      const result = await pool.query(
        `INSERT INTO users (username, password_hash)
         VALUES ($1, $2)
         ON CONFLICT (username) DO NOTHING
         RETURNING username`,
        [request.body.username, passwordHash],
      );
      if (result.rows.length === 0) {
        response.status(409).json({ error: "Username is already taken" });
        return;
      }
      response.status(201).json({ username: result.rows[0].username });
    } catch (error) {
      console.error("Account registration failed:", error.message);
      response.status(500).json({ error: "Unable to create account" });
    }
  });

  app.post("/api/auth/login", async (request, response) => {
    if (!authIsConfigured(response)) return;
    if (
      !validRequestBody(request.body) ||
      typeof request.body.username !== "string" ||
      !USERNAME_PATTERN.test(request.body.username) ||
      typeof request.body.password !== "string"
    ) {
      response.status(400).json({ error: "Username or password is invalid" });
      return;
    }

    try {
      const result = await pool.query(
        `SELECT id, username, password_hash, is_suspended
         FROM users
         WHERE username = $1`,
        [request.body.username],
      );
      const user = result.rows[0];
      const passwordMatches = user
        ? await bcrypt.compare(preparePassword(request.body.password), user.password_hash)
        : false;
      if (!user || user.is_suspended || !passwordMatches) {
        response.status(401).json({ error: "Invalid username or password" });
        return;
      }

      const token = randomBytes(32).toString("base64url");
      await pool.query(
        `INSERT INTO sessions (token, user_id, expires_at)
         VALUES ($1, $2, now() + interval '30 days')`,
        [digestToken(token, sessionSecret), user.id],
      );
      writeSessionCookie(response, token, secureCookies);
      response.json({ username: user.username });
    } catch (error) {
      console.error("Login failed:", error.message);
      response.status(500).json({ error: "Unable to log in" });
    }
  });

  app.post("/api/auth/logout", async (request, response) => {
    if (!databaseConfigured) {
      response.status(503).json({ error: AUTH_UNAVAILABLE });
      return;
    }
    const token = readCookie(request, SESSION_COOKIE);
    if (!token) {
      clearSessionCookie(response, secureCookies);
      response.json({ ok: true });
      return;
    }
    if (!isValidSessionSecret(sessionSecret)) {
      console.error("Authentication requires a SESSION_SECRET of at least 32 bytes");
      response.status(503).json({ error: AUTH_UNAVAILABLE });
      return;
    }

    try {
      await pool.query("DELETE FROM sessions WHERE token = $1", [
        digestToken(token, sessionSecret),
      ]);
      clearSessionCookie(response, secureCookies);
      response.json({ ok: true });
    } catch (error) {
      console.error("Logout failed:", error.message);
      response.status(500).json({ error: "Unable to log out" });
    }
  });

  async function authenticate(request, response, next) {
    if (!authIsConfigured(response)) return;
    const token = readCookie(request, SESSION_COOKIE);
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
      response.status(401).json({ error: "Authentication required" });
      return;
    }

    try {
      const tokenHash = digestToken(token, sessionSecret);
      const result = await pool.query(
        `SELECT s.token, u.id, u.username, u.role, u.display_name, u.bio,
                u.points, u.streak_count, u.best_streak, u.created_at, u.is_suspended
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.token = $1 AND s.expires_at > now()`,
        [tokenHash],
      );
      const user = result.rows[0];
      if (!user || user.is_suspended) {
        await pool.query("DELETE FROM sessions WHERE token = $1", [tokenHash]);
        response.status(401).json({ error: "Authentication required" });
        return;
      }

      const refreshed = await pool.query(
        `UPDATE sessions
         SET expires_at = now() + interval '30 days'
         WHERE token = $1 AND expires_at > now()
         RETURNING token`,
        [tokenHash],
      );
      if (refreshed.rows.length === 0) {
        response.status(401).json({ error: "Authentication required" });
        return;
      }

      request.user = user;
      writeSessionCookie(response, token, secureCookies);
      next();
    } catch (error) {
      console.error("Session validation failed:", error.message);
      response.status(500).json({ error: "Unable to authenticate request" });
    }
  }

  function requireRole(...roles) {
    return (request, response, next) => {
      if (!request.user) {
        response.status(401).json({ error: "Authentication required" });
        return;
      }
      if (!roles.includes(request.user.role)) {
        response.status(403).json({ error: "Forbidden" });
        return;
      }
      next();
    };
  }

  return { authenticate, requireRole };
}

module.exports = {
  installAuthRoutes,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  digestToken,
  isValidSessionSecret,
  preparePassword,
  writeSessionCookie,
};
