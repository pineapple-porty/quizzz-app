const assert = require("node:assert/strict");
const { randomBytes } = require("node:crypto");
const { after, before, test } = require("node:test");
const { app } = require("../server");
const { hasDatabaseConfig, pool } = require("../src/db");
const { initializeAuthSchema } = require("../src/auth");

const username = `q${randomBytes(9).toString("hex")}`;
const password = `Test-${randomBytes(18).toString("base64url")}`;
let server;
let baseUrl;

before(async () => {
  assert.ok(hasDatabaseConfig, "Set DATABASE_URL and start PostgreSQL before running tests.");
  assert.ok(process.env.SESSION_SECRET, "Set SESSION_SECRET before running tests.");
  await initializeAuthSchema();

  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (username && hasDatabaseConfig) {
    await pool.query("DELETE FROM users WHERE username = $1", [username]);
  }
  if (server) {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
  await pool.end();
});

test("registration, login, rolling sessions, and logout persist in PostgreSQL", async () => {
  const postJson = (path, body, cookie) =>
    fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: JSON.stringify(body),
    });

  const invalidRegistration = await postJson("/api/auth/register", {
    username: "ab",
    password: "short",
  });
  assert.equal(invalidRegistration.status, 400);

  const registration = await postJson("/api/auth/register", { username, password });
  assert.equal(registration.status, 201);
  assert.deepEqual(await registration.json(), { username });

  const { rows: userRows } = await pool.query(
    "SELECT password_hash FROM users WHERE username = $1",
    [username],
  );
  assert.match(userRows[0].password_hash, /^\$2[aby]\$12\$/);
  assert.notEqual(userRows[0].password_hash, password);

  const duplicateRegistration = await postJson("/api/auth/register", { username, password });
  assert.equal(duplicateRegistration.status, 409);

  const invalidLogin = await postJson("/api/auth/login", {
    username,
    password: `${password}wrong`,
  });
  assert.equal(invalidLogin.status, 401);

  const login = await postJson("/api/auth/login", { username, password });
  assert.equal(login.status, 200);
  assert.deepEqual(await login.json(), { username });
  const setCookie = login.headers.get("set-cookie");
  assert.ok(setCookie);
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Lax/i);
  assert.match(setCookie, /Max-Age=2592000/i);
  if (process.env.NODE_ENV === "production") assert.match(setCookie, /Secure/i);
  const cookie = setCookie.split(";", 1)[0];

  const account = await fetch(`${baseUrl}/api/me`, { headers: { Cookie: cookie } });
  assert.equal(account.status, 200);
  const accountData = await account.json();
  assert.deepEqual({
    username: accountData.username,
    role: accountData.role,
    points: accountData.points,
    level: accountData.level,
    streak_count: accountData.streak_count,
    best_streak: accountData.best_streak,
  }, {
    username,
    role: "player",
    points: 0,
    level: 1,
    streak_count: 0,
    best_streak: 0,
  });
  assert.ok(Number.isFinite(Date.parse(accountData.created_at)));
  assert.match(account.headers.get("set-cookie") ?? "", /Max-Age=2592000/i);

  const { rows: sessionRows } = await pool.query(
    "SELECT token, expires_at FROM sessions WHERE user_id = (SELECT id FROM users WHERE username = $1)",
    [username],
  );
  assert.equal(sessionRows.length, 1);
  assert.notEqual(sessionRows[0].token, cookie.slice("quizzz_session=".length));
  assert.ok(new Date(sessionRows[0].expires_at).getTime() > Date.now() + 29 * 24 * 60 * 60 * 1000);

  const logout = await postJson("/api/auth/logout", {}, cookie);
  assert.equal(logout.status, 200);
  assert.deepEqual(await logout.json(), { ok: true });
  assert.match(logout.headers.get("set-cookie"), /Max-Age=0/i);

  const accountAfterLogout = await fetch(`${baseUrl}/api/me`, { headers: { Cookie: cookie } });
  assert.equal(accountAfterLogout.status, 401);
});
