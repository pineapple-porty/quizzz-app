const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const express = require("express");
const { test } = require("node:test");
const { installAuthRoutes, SESSION_COOKIE } = require("../src/auth");
const { createApp } = require("../server");

const SESSION_SECRET = "test-session-secret-with-at-least-32-bytes";

function createFakePool() {
  const users = new Map();
  const sessions = new Map();
  let nextUserId = 1;

  return {
    users,
    sessions,
    async query(sql, parameters = []) {
      const statement = sql.replace(/\s+/g, " ").trim();
      if (statement.startsWith("INSERT INTO users")) {
        const [username, passwordHash] = parameters;
        if (users.has(username)) return { rows: [] };
        const user = {
          id: `user-${nextUserId++}`,
          username,
          role: "player",
          password_hash: passwordHash,
          display_name: "",
          bio: "",
          points: 0,
          streak_count: 0,
          best_streak: 0,
          created_at: new Date().toISOString(),
          is_suspended: false,
        };
        users.set(username, user);
        return { rows: [{ username }] };
      }

      if (statement.startsWith("SELECT id, username, password_hash")) {
        const user = users.get(parameters[0]);
        return { rows: user ? [user] : [] };
      }

      if (statement.startsWith("INSERT INTO sessions")) {
        const [token, userId] = parameters;
        sessions.set(token, {
          token,
          user_id: userId,
          expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000,
        });
        return { rows: [] };
      }

      if (statement.startsWith("SELECT s.token, u.id")) {
        const session = sessions.get(parameters[0]);
        if (!session || session.expires_at <= Date.now()) return { rows: [] };
        const user = [...users.values()].find((item) => item.id === session.user_id);
        return { rows: user ? [{ ...user, token: session.token }] : [] };
      }

      if (statement.startsWith("UPDATE sessions")) {
        const session = sessions.get(parameters[0]);
        if (!session || session.expires_at <= Date.now()) return { rows: [] };
        session.expires_at = Date.now() + 30 * 24 * 60 * 60 * 1000;
        return { rows: [{ token: session.token }] };
      }

      if (statement.startsWith("DELETE FROM sessions")) {
        sessions.delete(parameters[0]);
        return { rows: [] };
      }

      throw new Error(`Unexpected query in auth test: ${statement}`);
    },
  };
}

async function createHarness({ secureCookies = false, databaseConfigured = true } = {}) {
  const app = express();
  const pool = createFakePool();
  app.use(express.json());
  const auth = installAuthRoutes(app, {
    pool,
    databaseConfigured,
    sessionSecret: SESSION_SECRET,
    secureCookies,
  });
  app.get("/api/me", auth.authenticate, (request, response) => {
    response.json({ username: request.user.username, role: request.user.role });
  });
  app.get(
    "/api/teacher-check",
    auth.authenticate,
    auth.requireRole("teacher", "admin"),
    (_request, response) => response.json({ ok: true }),
  );

  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });

  return {
    pool,
    server,
    url: `http://127.0.0.1:${server.address().port}`,
  };
}

function cookieFrom(response) {
  return response.headers.get("set-cookie").split(";")[0];
}

test("registration, login, rolling sessions, role checks, and logout work", async (t) => {
  const harness = await createHarness();
  const testPassword = "🔐".repeat(20);
  t.after(() => new Promise((resolve, reject) => {
    harness.server.close((error) => error ? reject(error) : resolve());
  }));

  const invalidUsername = await fetch(`${harness.url}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "bad-name", password: "password123" }),
  });
  assert.equal(invalidUsername.status, 400);

  const shortPassword = await fetch(`${harness.url}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "valid_user", password: "short" }),
  });
  assert.equal(shortPassword.status, 400);

  const registration = await fetch(`${harness.url}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "valid_user", password: testPassword }),
  });
  assert.equal(registration.status, 201);
  assert.deepEqual(await registration.json(), { username: "valid_user" });

  const storedUser = harness.pool.users.get("valid_user");
  assert.notEqual(storedUser.password_hash, testPassword);
  assert.equal(bcrypt.getRounds(storedUser.password_hash), 12);

  const duplicate = await fetch(`${harness.url}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "valid_user", password: testPassword }),
  });
  assert.equal(duplicate.status, 409);

  const invalidLogin = await fetch(`${harness.url}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "valid_user", password: "incorrect password" }),
  });
  assert.equal(invalidLogin.status, 401);

  const unknownUserLogin = await fetch(`${harness.url}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "unknown_user", password: testPassword }),
  });
  assert.equal(unknownUserLogin.status, 401);

  const login = await fetch(`${harness.url}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "valid_user", password: testPassword }),
  });
  assert.equal(login.status, 200);
  assert.deepEqual(await login.json(), { username: "valid_user" });
  const cookie = cookieFrom(login);
  assert.match(login.headers.get("set-cookie"), /HttpOnly/);
  assert.match(login.headers.get("set-cookie"), /SameSite=Lax/);
  assert.doesNotMatch(login.headers.get("set-cookie"), /; Secure/);
  assert.equal(login.headers.get("set-cookie").split("=")[0], SESSION_COOKIE);
  const rawToken = cookie.slice(cookie.indexOf("=") + 1);
  const storedSessionToken = [...harness.pool.sessions.keys()][0];
  assert.notEqual(storedSessionToken, rawToken);
  assert.match(storedSessionToken, /^[a-f0-9]{64}$/);

  const storedSession = harness.pool.sessions.get(storedSessionToken);
  storedSession.expires_at = Date.now() + 1_000;
  const previousExpiry = storedSession.expires_at;
  const me = await fetch(`${harness.url}/api/me`, { headers: { Cookie: cookie } });
  assert.equal(me.status, 200);
  assert.deepEqual(await me.json(), { username: "valid_user", role: "player" });
  assert.match(me.headers.get("set-cookie"), /Max-Age=2592000/);
  assert.ok(storedSession.expires_at > previousExpiry);

  const noCookie = await fetch(`${harness.url}/api/me`);
  assert.equal(noCookie.status, 401);

  const denied = await fetch(`${harness.url}/api/teacher-check`, { headers: { Cookie: cookie } });
  assert.equal(denied.status, 403);

  storedUser.role = "teacher";
  const allowed = await fetch(`${harness.url}/api/teacher-check`, { headers: { Cookie: cookie } });
  assert.equal(allowed.status, 200);

  storedUser.role = "admin";
  const adminAllowed = await fetch(`${harness.url}/api/teacher-check`, { headers: { Cookie: cookie } });
  assert.equal(adminAllowed.status, 200);

  storedUser.is_suspended = true;
  const suspended = await fetch(`${harness.url}/api/me`, { headers: { Cookie: cookie } });
  assert.equal(suspended.status, 401);
  assert.equal(harness.pool.sessions.size, 0);

  const logout = await fetch(`${harness.url}/api/auth/logout`, {
    method: "POST",
    headers: { Cookie: cookie },
  });
  assert.equal(logout.status, 200);
  assert.deepEqual(await logout.json(), { ok: true });
  assert.match(logout.headers.get("set-cookie"), /Max-Age=0/);

  const afterLogout = await fetch(`${harness.url}/api/me`, { headers: { Cookie: cookie } });
  assert.equal(afterLogout.status, 401);
  assert.equal(afterLogout.headers.get("set-cookie"), null);
});

test("production cookies are Secure and unconfigured auth fails explicitly", async (t) => {
  const secureHarness = await createHarness({ secureCookies: true });
  t.after(() => new Promise((resolve, reject) => {
    secureHarness.server.close((error) => error ? reject(error) : resolve());
  }));

  await fetch(`${secureHarness.url}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "secure_user", password: "password123" }),
  });
  const login = await fetch(`${secureHarness.url}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "secure_user", password: "password123" }),
  });
  assert.match(login.headers.get("set-cookie"), /; Secure/);

  const unavailableHarness = await createHarness({ databaseConfigured: false });
  t.after(() => new Promise((resolve, reject) => {
    unavailableHarness.server.close((error) => error ? reject(error) : resolve());
  }));
  const unavailable = await fetch(`${unavailableHarness.url}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "offline_user", password: "password123" }),
  });
  assert.equal(unavailable.status, 503);
  assert.deepEqual(await unavailable.json(), { error: "Authentication is unavailable" });
});

test("application starts in mock mode and serves the landing page", async (t) => {
  const app = createApp({
    pool: createFakePool(),
    databaseConfigured: false,
    sessionSecret: SESSION_SECRET,
  });
  const server = app.listen(0, "127.0.0.1");
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const url = `http://127.0.0.1:${server.address().port}`;

  const health = await fetch(`${url}/api/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: "ok", service: "quiz-app" });

  const homepage = await fetch(url);
  assert.equal(homepage.status, 200);
  assert.match(await homepage.text(), /Keep your curiosity close/);

  const unauthenticated = await fetch(`${url}/api/me`);
  assert.equal(unauthenticated.status, 503);
});
