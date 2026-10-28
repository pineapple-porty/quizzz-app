const assert = require("node:assert/strict");
const { createHash, randomUUID } = require("node:crypto");
const express = require("express");
const { test } = require("node:test");
const { installTeacherSignupRoutes, usernameBase, usernameWithSuffix } = require("../src/teacher-signups");
const {
  isVerifiedInstitutionEmail,
  parseDirectoryResults,
  searchSchoolDirectory,
} = require("../src/school-directory");
const { createTeacherCodeSender } = require("../src/teacher-email");

const SESSION_SECRET = "teacher-demo-test-secret-at-least-32-bytes";
const DIRECTORY_MATCH = {
  id: "1234567",
  type: "district",
  name: "Example Public School District",
  address: "1 Main Street, Example, WA 98000",
  source: "NCES",
};

test("generated usernames meet account limits and append numeric collision suffixes", () => {
  assert.equal(usernameBase("A"), "a__");
  assert.equal(usernameBase("Jo"), "jo_");
  assert.equal(usernameWithSuffix("sam_example", 2), "sam_example_2");
  assert.ok(usernameWithSuffix("abcdefghijklmnopqrstuvwxyz", 12).length <= 20);
});

test("SMTP sender requires configuration and rejects unaccepted recipients", async () => {
  const incomplete = createTeacherCodeSender({});
  assert.equal(incomplete, null);

  let sentMessage;
  const smtpSettings = {
    TEACHER_SMTP_HOST: "smtp.example.test",
    TEACHER_SMTP_PORT: "587",
    TEACHER_SMTP_SECURE: "false",
    TEACHER_SMTP_USERNAME: "smtp-user",
    TEACHER_SMTP_PASSWORD: "smtp-password",
    TEACHER_EMAIL_FROM: "Zachs Quiz <teacher@example.test>",
  };
  const sender = createTeacherCodeSender(smtpSettings, (configuration) => {
    assert.equal(configuration.requireTLS, true);
    assert.equal(configuration.auth.user, "smtp-user");
    return {
      async sendMail(message) {
        sentMessage = message;
        return { accepted: [message.to], rejected: [] };
      },
    };
  });
  await sender({
    to: "teacher@school.example",
    username: "teacher",
    code: "a-one-time-code",
    institutionName: "Example School",
  });
  assert.equal(sentMessage.to, "teacher@school.example");
  assert.match(sentMessage.text, /a-one-time-code/);

  const rejectedSender = createTeacherCodeSender(smtpSettings, () => ({
    async sendMail() {
      return { accepted: [], rejected: ["teacher@school.example"] };
    },
  }));
  await assert.rejects(
    rejectedSender({
      to: "teacher@school.example",
      username: "teacher",
      code: "a-one-time-code",
      institutionName: "Example School",
    }),
    /did not accept/,
  );
});

function createFakePool() {
  const store = {
    codes: [],
    users: [{ id: "existing-player", username: "sam_example", role: "player" }],
    sessions: [],
  };

  const pool = {
    store,
    async connect() {
      return {
        async query(sql, parameters = []) {
          const statement = sql.replace(/\s+/g, " ").trim();
          if (["BEGIN", "COMMIT", "ROLLBACK"].includes(statement) ||
              statement.startsWith("SELECT pg_advisory_xact_lock")) {
            return { rows: [] };
          }
          if (statement.startsWith("SELECT EXISTS")) {
            const username = parameters[0];
            return {
              rows: [{
                taken: store.users.some((user) => user.username === username) ||
                  store.codes.some((invite) => invite.username === username),
              }],
            };
          }
          if (statement.startsWith("INSERT INTO teacher_signup_codes")) {
            const [username, codeHash] = parameters;
            store.codes.push({
              id: randomUUID(),
              username,
              code_hash: codeHash,
              available_at: statement.includes("available_at") ? null : new Date().toISOString(),
              consumed_at: null,
            });
            return { rows: [] };
          }
          if (statement.startsWith("SELECT id, username FROM teacher_signup_codes")) {
            const invite = store.codes.find((row) =>
              row.code_hash === parameters[0] && !row.consumed_at && row.available_at);
            return { rows: invite ? [{ id: invite.id, username: invite.username }] : [] };
          }
          if (statement.startsWith("INSERT INTO users")) {
            const [username, passwordHash] = parameters;
            if (store.users.some((user) => user.username === username)) return { rows: [] };
            const user = {
              id: randomUUID(),
              username,
              role: "teacher",
              password_hash: passwordHash,
            };
            store.users.push(user);
            return { rows: [{ id: user.id, username: user.username }] };
          }
          if (statement.startsWith("SELECT 1 FROM teacher_signup_codes")) {
            const [username, currentInviteId] = parameters;
            const invite = store.codes.find((row) => row.username === username && row.id !== currentInviteId);
            return { rows: invite ? [{ one: 1 }] : [] };
          }
          if (statement.startsWith("UPDATE teacher_signup_codes")) {
            const [username, id] = parameters;
            const invite = store.codes.find((row) => row.id === id);
            invite.username = username;
            invite.consumed_at = new Date().toISOString();
            return { rows: [] };
          }
          if (statement.startsWith("INSERT INTO sessions")) {
            store.sessions.push({ token: parameters[0], user_id: parameters[1] });
            return { rows: [] };
          }
          throw new Error(`Unexpected SQL in teacher signup test: ${statement}`);
        },
        release() {},
      };
    },
    async query(sql, parameters = []) {
      const statement = sql.replace(/\s+/g, " ").trim();
      if (statement.startsWith("UPDATE teacher_signup_codes SET available_at")) {
        const invite = store.codes.find((row) => row.code_hash === parameters[0] && !row.available_at);
        if (!invite) return { rowCount: 0, rows: [] };
        invite.available_at = new Date().toISOString();
        return { rowCount: 1, rows: [] };
      }
      if (statement.startsWith("DELETE FROM teacher_signup_codes")) {
        const index = store.codes.findIndex((row) => row.code_hash === parameters[0] && !row.available_at);
        if (index < 0) return { rowCount: 0, rows: [] };
        store.codes.splice(index, 1);
        return { rowCount: 1, rows: [] };
      }
      throw new Error(`Unexpected pool SQL in teacher signup test: ${statement}`);
    },
  };
  return pool;
}

async function withServer(t, options) {
  const app = express();
  app.use(express.json());
  installTeacherSignupRoutes(app, options);
  const server = app.listen(0);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once("listening", resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

test("NCES parser matches names case-insensitively and keeps the official ID", () => {
  const html = `
    <div class='resultRow'>
      <div><a href="district_detail.asp?Search=1&amp;InstName=Example&amp;ID2=1234567">Example Public School District</a>
      <br><span>1 Main Street,&nbsp;Example,&nbsp;WA&nbsp;98000</span></div>
    </div>`;
  assert.deepEqual(
    parseDirectoryResults(html, "district", "EXAMPLE"),
    [DIRECTORY_MATCH],
  );
});

test("NCES lookup queries both public school and district directories", async () => {
  const requested = [];
  const fetchImpl = async (url) => {
    requested.push(new URL(url));
    const type = new URL(url).pathname.includes("districtsearch") ? "district" : "school";
    const html = type === "district"
      ? `<a href="district_detail.asp?InstName=Example&amp;ID2=1234567">Example Public School District</a>`
      : `<a href="school_detail.asp?InstName=Example&amp;ID=123456789012">Example Public School</a>`;
    return { ok: true, text: async () => html };
  };
  const matches = await searchSchoolDirectory("Example", fetchImpl);
  assert.equal(requested.length, 2);
  assert.ok(requested.every((url) => url.searchParams.get("InstName") === "Example"));
  assert.deepEqual(matches.map(({ type, id }) => `${type}:${id}`).sort(), [
    "district:1234567",
    "school:123456789012",
  ]);
});

test("institution email verification requires an exact configured domain", () => {
  const allowlist = JSON.stringify({
    "district:1234567": ["district.example.edu", "mail.district.example"],
  });
  assert.equal(isVerifiedInstitutionEmail(
    "teacher@district.example.edu",
    "district",
    "1234567",
    allowlist,
  ), true);
  assert.equal(isVerifiedInstitutionEmail(
    "teacher@sub.district.example.edu",
    "district",
    "1234567",
    allowlist,
  ), false);
  assert.equal(isVerifiedInstitutionEmail(
    "teacher@district.example.edu",
    "school",
    "123456789012",
    allowlist,
  ), false);
  assert.equal(isVerifiedInstitutionEmail(
    "teacher@district.example.edu.attacker.test",
    "district",
    "1234567",
    allowlist,
  ), false);
});

test("demo application issues a one-use code and creates a teacher account", async (t) => {
  const pool = createFakePool();
  const baseUrl = await withServer(t, {
    pool,
    databaseConfigured: true,
    sessionSecret: SESSION_SECRET,
    secureCookies: false,
    demoMode: true,
    searchDirectory: async () => [DIRECTORY_MATCH],
  });

  const application = await fetch(`${baseUrl}/api/teacher-applications`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Sam Example",
      email: "sam@example.edu",
      institution_type: "district",
      institution_id: DIRECTORY_MATCH.id,
      institution_name: DIRECTORY_MATCH.name,
    }),
  });
  assert.equal(application.status, 201);
  const invite = await application.json();
  assert.equal(invite.username, "sam_example_2");
  assert.equal(invite.mode, "demo");
  assert.match(invite.demo_code, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(pool.store.codes.length, 1);
  assert.equal(pool.store.codes[0].code_hash, createHash("sha256").update(invite.demo_code).digest("hex"));
  assert.ok(!Object.values(pool.store.codes[0]).includes(invite.demo_code));

  const registration = await fetch(`${baseUrl}/api/auth/register-teacher`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: invite.demo_code, password: "password-for-test" }),
  });
  assert.equal(registration.status, 201);
  assert.match(registration.headers.get("set-cookie"), /HttpOnly/);
  assert.deepEqual(await registration.json(), { username: "sam_example_2", role: "teacher" });
  assert.equal(pool.store.codes[0].consumed_at !== null, true);
  assert.equal(pool.store.users.filter((user) => user.role === "teacher").length, 1);
  assert.equal(pool.store.sessions.length, 1);

  const replay = await fetch(`${baseUrl}/api/auth/register-teacher`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: invite.demo_code, password: "another-password" }),
  });
  assert.equal(replay.status, 400);
  assert.equal(pool.store.users.filter((user) => user.role === "teacher").length, 1);
  assert.equal(pool.store.sessions.length, 1);
});

test("production emails a code to a verified domain and never returns it", async (t) => {
  const pool = createFakePool();
  let sent;
  let earlyRegistration;
  const baseUrl = await withServer(t, {
    pool,
    databaseConfigured: true,
    sessionSecret: SESSION_SECRET,
    secureCookies: false,
    demoMode: false,
    searchDirectory: async () => [DIRECTORY_MATCH],
    emailDomainAllowlist: { "district:1234567": ["example.edu"] },
    sendTeacherCode: async (message) => {
      sent = message;
      earlyRegistration = await fetch(`${baseUrl}/api/auth/register-teacher`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: message.code, password: "password-for-test" }),
      });
    },
  });
  const application = await fetch(`${baseUrl}/api/teacher-applications`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Sam Example",
      email: "sam@example.edu",
      institution_type: "district",
      institution_id: DIRECTORY_MATCH.id,
      institution_name: DIRECTORY_MATCH.name,
    }),
  });
  assert.equal(application.status, 201);
  const response = await application.json();
  assert.equal(response.mode, "email");
  assert.equal(response.username, "sam_example_2");
  assert.equal(Object.hasOwn(response, "demo_code"), false);
  assert.match(response.message, /school email/i);
  assert.equal(sent.to, "sam@example.edu");
  assert.equal(sent.institutionName, DIRECTORY_MATCH.name);
  assert.match(sent.code, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(pool.store.codes.length, 1);
  assert.equal(pool.store.codes[0].code_hash, createHash("sha256").update(sent.code).digest("hex"));
  assert.ok(pool.store.codes[0].available_at);
  assert.equal(earlyRegistration.status, 400);

  const registration = await fetch(`${baseUrl}/api/auth/register-teacher`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: sent.code, password: "password-for-test" }),
  });
  assert.equal(registration.status, 201);
  assert.equal(pool.store.codes[0].consumed_at !== null, true);
  const replay = await fetch(`${baseUrl}/api/auth/register-teacher`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: sent.code, password: "another-password" }),
  });
  assert.equal(replay.status, 400);
});

test("unverified domains and sender failures leave production applications incomplete", async (t) => {
  const pool = createFakePool();
  const unverifiedUrl = await withServer(t, {
    pool,
    databaseConfigured: true,
    sessionSecret: SESSION_SECRET,
    secureCookies: false,
    demoMode: false,
    sendTeacherCode: async () => assert.fail("must not send to an unverified domain"),
    emailDomainAllowlist: { "district:1234567": ["district.example.edu"] },
  });
  const unverified = await fetch(`${unverifiedUrl}/api/teacher-applications`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Sam Example",
      email: "sam@example.edu",
      institution_type: "district",
      institution_id: DIRECTORY_MATCH.id,
      institution_name: DIRECTORY_MATCH.name,
    }),
  });
  assert.equal(unverified.status, 400);
  assert.equal(pool.store.codes.length, 0);

  const failureUrl = await withServer(t, {
    pool,
    databaseConfigured: true,
    sessionSecret: SESSION_SECRET,
    secureCookies: false,
    demoMode: false,
    searchDirectory: async () => [DIRECTORY_MATCH],
    emailDomainAllowlist: { "district:1234567": ["example.edu"] },
    sendTeacherCode: async () => { throw new Error("mail service unavailable"); },
  });
  const failedDelivery = await fetch(`${failureUrl}/api/teacher-applications`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Sam Example",
      email: "sam@example.edu",
      institution_type: "district",
      institution_id: DIRECTORY_MATCH.id,
      institution_name: DIRECTORY_MATCH.name,
    }),
  });
  assert.equal(failedDelivery.status, 503);
  assert.equal(pool.store.codes.length, 0);

  const missingSenderUrl = await withServer(t, {
    pool,
    databaseConfigured: true,
    sessionSecret: SESSION_SECRET,
    secureCookies: false,
    demoMode: false,
  });
  const missingSender = await fetch(`${missingSenderUrl}/api/teacher-applications`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Sam Example",
      email: "sam@example.edu",
      institution_type: "district",
      institution_id: DIRECTORY_MATCH.id,
      institution_name: DIRECTORY_MATCH.name,
    }),
  });
  assert.equal(missingSender.status, 503);
  assert.equal(pool.store.codes.length, 0);

  const demoUrl = await withServer(t, {
    pool,
    databaseConfigured: true,
    sessionSecret: SESSION_SECRET,
    secureCookies: false,
    demoMode: true,
    searchDirectory: async () => [],
  });
  const invalid = await fetch(`${demoUrl}/api/teacher-applications`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Sam Example",
      email: "sam@example.edu",
      institution_type: "district",
      institution_id: DIRECTORY_MATCH.id,
      institution_name: DIRECTORY_MATCH.name,
    }),
  });
  assert.equal(invalid.status, 400);
  assert.equal(pool.store.codes.length, 0);
});
