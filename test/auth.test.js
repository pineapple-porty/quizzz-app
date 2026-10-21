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
  const quizzes = [{
    id: "11111111-1111-4111-8111-111111111111",
    title: "Sample quiz",
    description: "A short test quiz.",
    difficulty: "easy",
    created_at: new Date().toISOString(),
  }];
  const questions = [
    {
      id: "22222222-2222-4222-8222-222222222221",
      quiz_id: quizzes[0].id,
      position: 1,
      text: "Which answer is correct for question one?",
      options: ["Choice A", "Choice B", "Choice C", "Choice D"],
      correct_index: 2,
    },
    {
      id: "22222222-2222-4222-8222-222222222222",
      quiz_id: quizzes[0].id,
      position: 2,
      text: "Which answer is correct for question two?",
      options: ["Choice A", "Choice B", "Choice C", "Choice D"],
      correct_index: 1,
    },
    {
      id: "22222222-2222-4222-8222-222222222223",
      quiz_id: quizzes[0].id,
      position: 3,
      text: "Which answer is correct for question three?",
      options: ["Choice A", "Choice B", "Choice C", "Choice D"],
      correct_index: 3,
    },
  ];
  let nextUserId = 1;

  return {
    users,
    sessions,
    quizzes,
    questions,
    async query(sql, parameters = []) {
      const statement = sql.replace(/\s+/g, " ").trim();
      if (statement.startsWith("SELECT q.id, q.title, q.description, q.difficulty FROM quizzes")) {
        return {
          rows: quizzes
            .filter((quiz) => questions.some((question) => question.quiz_id === quiz.id))
            .map(({ id, title, description, difficulty }) => ({ id, title, description, difficulty })),
        };
      }

      if (statement.startsWith("SELECT q.id, q.title, q.description, q.difficulty, question.id AS question_id")) {
        const quiz = quizzes.find((item) => item.id === parameters[0]);
        if (!quiz) return { rows: [] };
        return {
          rows: questions
            .filter((question) => question.quiz_id === quiz.id)
            .sort((left, right) => left.position - right.position)
            .map((question) => ({
              id: quiz.id,
              title: quiz.title,
              description: quiz.description,
              difficulty: quiz.difficulty,
              question_id: question.id,
              position: question.position,
              question_text: question.text,
              options: question.options,
            })),
        };
      }

      if (statement.startsWith("SELECT id, position, text, options, correct_index FROM questions")) {
        return {
          rows: questions
            .filter((question) => question.quiz_id === parameters[0])
            .sort((left, right) => left.position - right.position)
            .map((question) => ({ ...question })),
        };
      }

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

async function createApplicationHarness(pool = createFakePool()) {
  const app = createApp({
    pool,
    databaseConfigured: true,
    sessionSecret: SESSION_SECRET,
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  return { pool, server, url: `http://127.0.0.1:${server.address().port}` };
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

test("quiz selection, protected play, grading, validation, and retry work", async (t) => {
  const harness = await createApplicationHarness();
  t.after(() => new Promise((resolve, reject) => {
    harness.server.close((error) => error ? reject(error) : resolve());
  }));

  const quizId = harness.pool.quizzes[0].id;
  const catalogResponse = await fetch(`${harness.url}/api/quizzes`);
  assert.equal(catalogResponse.status, 200);
  assert.deepEqual(await catalogResponse.json(), [{
    id: quizId,
    title: "Sample quiz",
    description: "A short test quiz.",
    difficulty: "easy",
  }]);

  const unauthorizedDetail = await fetch(`${harness.url}/api/quizzes/${quizId}`);
  assert.equal(unauthorizedDetail.status, 401);
  const unauthorizedSubmit = await fetch(`${harness.url}/api/quizzes/${quizId}/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ answers: [2, 1, 3] }),
  });
  assert.equal(unauthorizedSubmit.status, 401);

  const registration = await fetch(`${harness.url}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "quiz_player", password: "password123" }),
  });
  assert.equal(registration.status, 201);
  const login = await fetch(`${harness.url}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "quiz_player", password: "password123" }),
  });
  const cookie = cookieFrom(login);

  const detail = await fetch(`${harness.url}/api/quizzes/${quizId}`, {
    headers: { Cookie: cookie },
  });
  assert.equal(detail.status, 200);
  const quiz = await detail.json();
  assert.equal(quiz.questions.length, 3);
  for (const question of quiz.questions) {
    assert.equal(question.options.length, 4);
    assert.ok(question.options.every((option) => typeof option === "string"));
    assert.equal(Object.hasOwn(question, "correct_index"), false);
  }
  assert.equal(JSON.stringify(quiz).includes("correct_index"), false);

  const correctAndIncorrect = await fetch(`${harness.url}/api/quizzes/${quizId}/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ answers: [2, 0, 3], points: 999999 }),
  });
  assert.equal(correctAndIncorrect.status, 200);
  const mixedResult = await correctAndIncorrect.json();
  assert.equal(mixedResult.correct, 2);
  assert.equal(mixedResult.total, 3);
  assert.equal(mixedResult.percent, 66.67);
  assert.equal(mixedResult.beaten, true);
  assert.deepEqual(mixedResult.review.map((item) => item.your_answer), [2, 0, 3]);
  assert.deepEqual(mixedResult.review.map((item) => item.correct_index), [2, 1, 3]);
  assert.equal(Object.hasOwn(mixedResult, "points_awarded"), false);

  const retry = await fetch(`${harness.url}/api/quizzes/${quizId}/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ answers: [0, 0, 0] }),
  });
  assert.equal(retry.status, 200);
  const retryResult = await retry.json();
  assert.equal(retryResult.correct, 0);
  assert.equal(retryResult.total, 3);
  assert.equal(retryResult.percent, 0);
  assert.equal(retryResult.beaten, false);
  assert.equal(harness.pool.questions.length, 3);

  for (const answers of [
    [],
    [2, 1],
    [2, 1, 3, 0],
    [-1, 1, 3],
    [4, 1, 3],
    [1.5, 1, 3],
    ["2", 1, 3],
  ]) {
    const invalid = await fetch(`${harness.url}/api/quizzes/${quizId}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ answers }),
    });
    assert.equal(invalid.status, 400, `expected invalid answers to be rejected: ${JSON.stringify(answers)}`);
  }

  const malformedBody = await fetch(`${harness.url}/api/quizzes/${quizId}/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ answers: "2,1,3" }),
  });
  assert.equal(malformedBody.status, 400);

  const missingQuiz = await fetch(`${harness.url}/api/quizzes/33333333-3333-4333-8333-333333333333`, {
    headers: { Cookie: cookie },
  });
  assert.equal(missingQuiz.status, 404);
});
