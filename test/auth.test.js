const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const express = require("express");
const { test } = require("node:test");
const { installAuthRoutes, SESSION_COOKIE } = require("../src/auth");
const { createApp } = require("../server");
const { levelForPoints, multiplierForStreak } = require("../src/scoring");

const SESSION_SECRET = "test-session-secret-with-at-least-32-bytes";

function createFakePool() {
  const users = new Map();
  const sessions = new Map();
  const quizzes = [{
    id: "11111111-1111-4111-8111-111111111111",
    title: "Sample quiz",
    description: "A short test quiz.",
    difficulty: "easy",
    base_points: 10,
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
  const attempts = [];
  let nextUserId = 1;
  let nextAttemptId = 1;

  const pool = {
    users,
    sessions,
    quizzes,
    questions,
    attempts,
    async query(sql, parameters = []) {
      const statement = sql.replace(/\s+/g, " ").trim();
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(statement)) return { rows: [] };
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

      if (statement.startsWith("SELECT difficulty, base_points FROM quizzes WHERE id = $1")) {
        const quiz = quizzes.find((item) => item.id === parameters[0]);
        return { rows: quiz ? [{ difficulty: quiz.difficulty, base_points: quiz.base_points }] : [] };
      }

      if (statement.startsWith("SELECT id, points, streak_count, best_streak, beaten_quizzes FROM users")) {
        const user = [...users.values()].find((item) => item.id === parameters[0]);
        return {
          rows: user ? [{
            id: user.id,
            points: user.points,
            streak_count: user.streak_count,
            best_streak: user.best_streak,
            beaten_quizzes: [...user.beaten_quizzes],
          }] : [],
        };
      }

      if (statement.startsWith("UPDATE users SET points =")) {
        const [points, streak, bestStreak, beatenQuizzes, userId] = parameters;
        const user = [...users.values()].find((item) => item.id === userId);
        if (user) {
          user.points = points;
          user.streak_count = streak;
          user.best_streak = bestStreak;
          user.beaten_quizzes = [...beatenQuizzes];
        }
        return { rows: [] };
      }

      if (statement.startsWith("INSERT INTO attempts")) {
        const [user_id, quiz_id, correct, total, beaten, points_awarded, multiplier_applied] = parameters;
        const attempt = {
          id: `attempt-${nextAttemptId++}`,
          user_id,
          quiz_id,
          correct,
          total,
          beaten,
          points_awarded,
          multiplier_applied,
          created_at: new Date(Date.now() + attempts.length).toISOString(),
        };
        attempts.push(attempt);
        return { rows: [{ id: attempt.id, created_at: attempt.created_at }] };
      }

      if (statement.startsWith("SELECT a.quiz_id, q.title AS quiz_title")) {
        const userAttempts = attempts
          .filter((attempt) => attempt.user_id === parameters[0])
          .sort((left, right) => right.created_at.localeCompare(left.created_at))
          .map((attempt) => {
            const quiz = quizzes.find((item) => item.id === attempt.quiz_id);
            return {
              quiz_id: attempt.quiz_id,
              quiz_title: quiz?.title,
              correct: attempt.correct,
              total: attempt.total,
              percent: Number(((attempt.correct * 100) / attempt.total).toFixed(2)),
              points_awarded: attempt.points_awarded,
              created_at: attempt.created_at,
            };
          });
        return { rows: userAttempts };
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
          beaten_quizzes: [],
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
  pool.connect = async () => ({
    query: (sql, parameters = []) => pool.query(sql, parameters),
    release: () => {},
  });
  return pool;
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

test("streak multipliers and levels follow the documented thresholds", () => {
  assert.equal(multiplierForStreak(0), 1);
  assert.equal(multiplierForStreak(1), 1);
  assert.equal(multiplierForStreak(2), 1.5);
  assert.equal(multiplierForStreak(3), 1.6);
  assert.equal(multiplierForStreak(10), 2.4);
  assert.equal(multiplierForStreak(36), 10);
  assert.equal(multiplierForStreak(100), 10);
  assert.equal(levelForPoints(0), 1);
  assert.equal(levelForPoints(49), 1);
  assert.equal(levelForPoints(50), 2);
  assert.equal(levelForPoints(200), 3);
  assert.equal(levelForPoints(50 * 99 ** 2), 100);
  assert.equal(levelForPoints(50 * 100 ** 2), 100);
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
  const unauthorizedHistory = await fetch(`${harness.url}/api/me/attempts`);
  assert.equal(unauthorizedHistory.status, 401);

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
  assert.equal(mixedResult.points_awarded, 5);
  assert.equal(mixedResult.multiplier_applied, 1);
  assert.equal(mixedResult.new_streak, 1);
  assert.equal(mixedResult.level, 1);
  assert.ok(mixedResult.attempt_id);
  assert.deepEqual(mixedResult.review.map((item) => item.your_answer), [2, 0, 3]);
  assert.deepEqual(mixedResult.review.map((item) => item.correct_index), [2, 1, 3]);
  assert.equal(harness.pool.attempts.length, 1);
  assert.equal(harness.pool.users.get("quiz_player").points, 5);

  const firstHistory = await fetch(`${harness.url}/api/me/attempts`, {
    headers: { Cookie: cookie },
  });
  assert.equal(firstHistory.status, 200);
  assert.equal((await firstHistory.json()).length, 1);

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
  assert.equal(retryResult.points_awarded, 0);
  assert.equal(retryResult.new_streak, 0);
  assert.notEqual(retryResult.attempt_id, mixedResult.attempt_id);
  assert.equal(harness.pool.attempts.length, 2);
  assert.equal(harness.pool.questions.length, 3);

  const beatenReplay = await fetch(`${harness.url}/api/quizzes/${quizId}/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ answers: [2, 1, 3] }),
  });
  assert.equal(beatenReplay.status, 200);
  const replayResult = await beatenReplay.json();
  assert.equal(replayResult.beaten, true);
  assert.equal(replayResult.points_awarded, 0);
  assert.equal(replayResult.new_streak, 1);
  assert.equal(harness.pool.users.get("quiz_player").points, 5);
  assert.equal(harness.pool.attempts.length, 3);

  const incomplete = await fetch(`${harness.url}/api/quizzes/${quizId}/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ answers: [2, 1] }),
  });
  assert.equal(incomplete.status, 400);
  assert.equal(harness.pool.attempts.length, 3);

  const logout = await fetch(`${harness.url}/api/auth/logout`, {
    method: "POST",
    headers: { Cookie: cookie },
  });
  assert.equal(logout.status, 200);
  const relogin = await fetch(`${harness.url}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "quiz_player", password: "password123" }),
  });
  const reloginCookie = cookieFrom(relogin);
  const persistedHistory = await fetch(`${harness.url}/api/me/attempts`, {
    headers: { Cookie: reloginCookie },
  });
  assert.equal(persistedHistory.status, 200);
  assert.equal((await persistedHistory.json()).length, 3);
  const persistedMe = await fetch(`${harness.url}/api/me`, {
    headers: { Cookie: reloginCookie },
  });
  assert.equal(persistedMe.status, 200);
  const playerProfile = await persistedMe.json();
  assert.equal(playerProfile.points, 5);
  assert.equal(playerProfile.level, 1);
  assert.equal(playerProfile.streak_count, 1);

  await fetch(`${harness.url}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "other_player", password: "password123" }),
  });
  const otherLogin = await fetch(`${harness.url}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "other_player", password: "password123" }),
  });
  const otherHistory = await fetch(`${harness.url}/api/me/attempts`, {
    headers: { Cookie: cookieFrom(otherLogin) },
  });
  assert.equal(otherHistory.status, 200);
  assert.deepEqual(await otherHistory.json(), []);

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
      headers: { "Content-Type": "application/json", Cookie: reloginCookie },
      body: JSON.stringify({ answers }),
    });
    assert.equal(invalid.status, 400, `expected invalid answers to be rejected: ${JSON.stringify(answers)}`);
  }

  const malformedBody = await fetch(`${harness.url}/api/quizzes/${quizId}/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: reloginCookie },
    body: JSON.stringify({ answers: "2,1,3" }),
  });
  assert.equal(malformedBody.status, 400);

  const missingQuiz = await fetch(`${harness.url}/api/quizzes/33333333-3333-4333-8333-333333333333`, {
    headers: { Cookie: reloginCookie },
  });
  assert.equal(missingQuiz.status, 404);
});
