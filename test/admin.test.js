const assert = require("node:assert/strict");
const express = require("express");
const { test } = require("node:test");
const { installAdminRoutes, parseCsv } = require("../src/admin");

const quizId = "11111111-1111-4111-8111-111111111111";
const playerId = "22222222-2222-4222-8222-222222222222";
const teacherId = "33333333-3333-4333-8333-333333333333";
const adminId = "66666666-6666-4666-8666-666666666666";
const questionId = "44444444-4444-4444-8444-444444444444";
const assignmentId = "55555555-5555-4555-8555-555555555555";

function createHarness() {
  const calls = [];
  const imported = [];
  const pool = {
    calls,
    imported,
    async query(sql, params = []) {
      const statement = sql.replace(/\s+/g, " ").trim();
      calls.push({ statement, params });
      if (statement.startsWith("SELECT id FROM quizzes WHERE id = $1")) return { rows: [{ id: quizId }] };
      if (statement.startsWith("SELECT id FROM quizzes WHERE id = $1 FOR UPDATE")) return { rows: [{ id: quizId }] };
      if (statement.startsWith("SELECT COALESCE(MAX(position)")) return { rows: [{ max_position: 2 }] };
      if (statement.startsWith("SELECT id, username FROM users")) return { rows: [{ id: playerId, username: "player_one" }] };
      if (statement.startsWith("SELECT id, username, role, (id = $1) AS is_self")) {
        return { rows: [
          { id: adminId, username: "admin_one", role: "admin", is_self: true },
          { id: teacherId, username: "teacher_one", role: "teacher", is_self: false },
          { id: playerId, username: "player_one", role: "player", is_self: false },
        ] };
      }
      if (statement.startsWith("SELECT a.id, a.quiz_id")) return { rows: [] };
      if (statement.startsWith("SELECT a.id, a.quiz_id, q.title AS quiz_title")) return { rows: [] };
      if (statement.startsWith("INSERT INTO quizzes")) return { rows: [{ id: quizId }] };
      if (statement.startsWith("UPDATE quizzes")) return { rows: [{ id: quizId }] };
      if (statement.startsWith("INSERT INTO questions")) return { rows: [{ id: questionId, position: 3 }] };
      if (statement.startsWith("UPDATE questions")) return { rows: [{ id: questionId }] };
      if (statement.startsWith("DELETE FROM questions")) return { rows: [{ id: questionId }] };
      if (statement.startsWith("INSERT INTO assignments")) return { rows: [{ id: assignmentId }] };
      if (statement.startsWith("DELETE FROM assignments")) return { rows: [{ id: assignmentId }] };
      if (statement.startsWith("DELETE FROM quizzes WHERE id = $1 RETURNING id")) return { rows: [{ id: quizId }] };
      if (statement.startsWith("SELECT q.id, q.title, q.description, q.difficulty")) return { rows: [] };
      if (statement.startsWith("SELECT RANK() OVER (ORDER BY COUNT(a.id)")) {
        return { rows: [{ rank: 1, username: "player_one", completed_attempts: 3, level: 2 }] };
      }
      if (statement.startsWith("SELECT RANK() OVER ( ORDER BY MAX(a.correct)")) {
        return { rows: [{ rank: 1, username: "player_one", highest_score: 8, total_questions: 10, completed_attempts: 3 }] };
      }
      throw new Error(`Unexpected SQL: ${statement}`);
    },
    async connect() {
      return {
        async query(sql, params = []) {
          const statement = sql.replace(/\s+/g, " ").trim();
          calls.push({ statement, params });
          if (["BEGIN", "COMMIT", "ROLLBACK"].includes(statement)) return { rows: [] };
          if (statement.startsWith("SELECT id FROM users WHERE id = $1 FOR UPDATE")) {
            return { rows: params[0] === playerId ? [{ id: playerId }] : [] };
          }
          if (statement.startsWith("DELETE FROM assignments WHERE player_id = $1 OR assigned_by = $1")) return { rows: [] };
          if (statement.startsWith("DELETE FROM users WHERE id = $1")) return { rows: [] };
          if (statement.startsWith("SELECT id FROM quizzes")) return { rows: [{ id: quizId }] };
          if (statement.startsWith("SELECT COALESCE(MAX(position)")) return { rows: [{ max_position: 2 }] };
          if (statement.startsWith("INSERT INTO questions")) {
            imported.push(params);
            return { rows: [] };
          }
          throw new Error(`Unexpected transaction SQL: ${statement}`);
        },
        release() {},
      };
    },
  };
  const app = express();
  app.use(express.json());
  const authenticate = (request, response, next) => {
    const role = request.get("x-test-role");
    if (!role) return response.status(401).json({ error: "Authentication required" });
    const ids = { player: playerId, teacher: teacherId, admin: adminId };
    request.user = { id: ids[role] || playerId, role };
    next();
  };
  const requireRole = (...roles) => (request, response, next) =>
    roles.includes(request.user.role) ? next() : response.status(403).json({ error: "Forbidden" });
  installAdminRoutes(app, { pool, authenticate, requireRole });
  const server = app.listen(0, "127.0.0.1");
  return new Promise((resolve) => {
    server.once("listening", () => resolve({
      pool,
      server,
      url: `http://127.0.0.1:${server.address().port}`,
    }));
  });
}

test("CSV parser reports malformed rows while preserving valid choices", () => {
  const result = parseCsv(
    "question,choice_a,choice_b,choice_c,choice_d,correct_letter\n" +
    '"Which, animal?","Koala","Panda","Sloth","Otter",A\n' +
    "Missing answer,A,B,,D,Z\n",
  );
  assert.equal(result.validRows.length, 1);
  assert.equal(result.validRows[0].text, "Which, animal?");
  assert.equal(result.validRows[0].correct_index, 0);
  assert.equal(result.invalidRows.length, 1);
  assert.equal(result.invalidRows[0].row, 3);
  assert.match(result.invalidRows[0].errors.join(" "), /four non-empty choices/);
  assert.match(result.invalidRows[0].errors.join(" "), /Correct letter/);
  assert.match(parseCsv('question,choice_a,choice_b,choice_c,choice_d,correct_letter\nBad"quote,A,B,C,D,A').error, /row 2.*quoting/);
  assert.match(parseCsv('question,choice_a,choice_b,choice_c,choice_d,correct_letter\n"Bad"suffix,A,B,C,D,A').error, /row 2.*quoting/);
  assert.match(parseCsv('question,choice_a,choice_b,choice_c,choice_d,correct_letter\n"Unclosed').error, /unclosed/);
  assert.equal(parseCsv('\uFEFF"question",choice_a,choice_b,choice_c,choice_d,correct_letter\nQuestion,A,B,C,D,A').validRows.length, 1);
});

test("teacher operations are protected and leaderboards are public", async (t) => {
  const harness = await createHarness();
  t.after(() => new Promise((resolve, reject) =>
    harness.server.close((error) => error ? reject(error) : resolve()),
  ));
  const overall = await fetch(`${harness.url}/api/leaderboard`);
  assert.equal(overall.status, 200);
  assert.equal((await overall.json())[0].completed_attempts, 3);
  const perQuiz = await fetch(`${harness.url}/api/quizzes/${quizId}/leaderboard`);
  assert.equal(perQuiz.status, 200);
  assert.equal((await perQuiz.json())[0].highest_score, 8);

  for (const [method, path] of [
    ["GET", "/api/admin/quizzes"], ["GET", "/api/admin/players"],
    ["GET", "/api/admin/users"],
    ["GET", "/api/admin/assignments"], ["POST", "/api/admin/quizzes"],
    ["DELETE", `/api/admin/quizzes/${quizId}`],
    ["DELETE", `/api/admin/users/${playerId}`],
    ["PUT", `/api/admin/quizzes/${quizId}`],
    ["POST", `/api/admin/quizzes/${quizId}/questions`],
    ["PUT", `/api/admin/questions/${questionId}`],
    ["DELETE", `/api/admin/questions/${questionId}`],
    ["POST", "/api/admin/assignments"], ["DELETE", `/api/admin/assignments/${assignmentId}`],
    ["POST", `/api/admin/quizzes/${quizId}/upload`],
    ["POST", `/api/admin/quizzes/${quizId}/import`],
  ]) {
    const blocked = await fetch(`${harness.url}${path}`, {
      method, headers: { "x-test-role": "player" },
    });
    assert.equal(blocked.status, 403, `${method} ${path}`);
    const anonymous = await fetch(`${harness.url}${path}`, { method });
    assert.equal(anonymous.status, 401, `${method} ${path} without login`);
  }
  const created = await fetch(`${harness.url}/api/admin/quizzes`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-test-role": "teacher" },
    body: JSON.stringify({ title: "New quiz", description: "", difficulty: "easy", base_points: 10 }),
  });
  assert.equal(created.status, 201);
  const adminAccess = await fetch(`${harness.url}/api/admin/quizzes`, {
    headers: { "x-test-role": "admin" },
  });
  assert.equal(adminAccess.status, 200, "admins inherit teacher tools");
});

test("only admins can delete accounts and quizzes, and self-deletion is blocked", async (t) => {
  const harness = await createHarness();
  t.after(() => new Promise((resolve, reject) =>
    harness.server.close((error) => error ? reject(error) : resolve()),
  ));
  async function request(role, method, path) {
    return fetch(harness.url + path, { method, headers: { "x-test-role": role } });
  }

  assert.equal((await request("admin", "GET", "/api/admin/users")).status, 200);
  assert.equal((await request("teacher", "GET", "/api/admin/users")).status, 403);
  assert.equal((await request("admin", "DELETE", `/api/admin/users/${adminId}`)).status, 400);
  assert.equal((await request("admin", "DELETE", "/api/admin/users/not-a-uuid")).status, 400);
  assert.equal((await request("teacher", "DELETE", `/api/admin/users/${playerId}`)).status, 403);
  assert.equal((await request("admin", "DELETE", `/api/admin/users/${playerId}`)).status, 200);
  assert.equal((await request("player", "DELETE", `/api/admin/users/${teacherId}`)).status, 403);
  assert.equal((await request("teacher", "DELETE", `/api/admin/quizzes/${quizId}`)).status, 403);
  assert.equal((await request("admin", "DELETE", `/api/admin/quizzes/${quizId}`)).status, 200);
  assert.equal((await request("admin", "DELETE", "/api/admin/quizzes/not-a-uuid")).status, 400);
  assert.ok(harness.pool.calls.some((call) =>
    call.statement === "DELETE FROM quizzes WHERE id = $1 RETURNING id" &&
    call.params[0] === quizId,
  ), "quiz deletion uses a parameterized query");
  assert.ok(harness.pool.calls.some((call) =>
    call.statement === "DELETE FROM assignments WHERE player_id = $1 OR assigned_by = $1" &&
    call.params[0] === playerId,
  ), "account deletion removes linked assignments");
});

test("teacher quiz, question, and assignment changes validate input and save", async (t) => {
  const harness = await createHarness();
  t.after(() => new Promise((resolve, reject) =>
    harness.server.close((error) => error ? reject(error) : resolve()),
  ));
  async function change(method, path, body) {
    return fetch(harness.url + path, {
      method,
      headers: { "Content-Type": "application/json", "x-test-role": "teacher" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  }
  assert.equal((await change("PUT", `/api/admin/quizzes/${quizId}`, {
    title: "Edited", description: "", difficulty: "easy", base_points: 10,
  })).status, 200);
  assert.equal((await change("POST", "/api/admin/quizzes", {
    title: "Invalid", description: "", difficulty: "toString", base_points: 10,
  })).status, 400);
  const question = { text: "Question", options: ["A", "B", "C", "D"], correct_index: 2 };
  assert.equal((await change("POST", `/api/admin/quizzes/${quizId}/questions`, question)).status, 201);
  assert.equal((await change("PUT", `/api/admin/questions/${questionId}`, question)).status, 200);
  assert.equal((await change("PUT", `/api/admin/questions/${questionId}`, { ...question, options: ["A"] })).status, 400);
  assert.equal((await change("DELETE", `/api/admin/questions/${questionId}`)).status, 200);
  assert.equal((await change("POST", "/api/admin/assignments", { quiz_id: quizId, player_id: playerId })).status, 201);
  assert.equal((await change("DELETE", `/api/admin/assignments/${assignmentId}`)).status, 200);
  assert.equal((await change("POST", "/api/admin/assignments", { quiz_id: "invalid", player_id: playerId })).status, 400);
});

test("CSV preview imports only valid rows after confirmation", async (t) => {
  const harness = await createHarness();
  t.after(() => new Promise((resolve, reject) =>
    harness.server.close((error) => error ? reject(error) : resolve()),
  ));
  const csv = "question,choice_a,choice_b,choice_c,choice_d,correct_letter\n" +
    "Valid,A,B,C,D,B\n" +
    "Invalid,A,,C,D,Z\n";
  const options = {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-test-role": "teacher" },
    body: JSON.stringify({ csv }),
  };
  const preview = await fetch(`${harness.url}/api/admin/quizzes/${quizId}/upload`, options);
  assert.equal(preview.status, 200);
  const previewBody = await preview.json();
  assert.equal(previewBody.valid_rows.length, 1);
  assert.equal(previewBody.invalid_rows[0].row, 3);
  assert.equal(harness.pool.imported.length, 0);

  const imported = await fetch(`${harness.url}/api/admin/quizzes/${quizId}/import`, options);
  assert.equal(imported.status, 201);
  const importBody = await imported.json();
  assert.equal(importBody.imported, 1);
  assert.equal(importBody.invalid_rows.length, 1);
  assert.equal(harness.pool.imported.length, 1);
  assert.equal(harness.pool.imported[0][4], 1);
});
