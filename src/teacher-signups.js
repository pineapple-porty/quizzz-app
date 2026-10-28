const { createHash, randomBytes } = require("node:crypto");
const bcrypt = require("bcryptjs");
const {
  digestToken,
  isValidSessionSecret,
  preparePassword,
  writeSessionCookie,
} = require("./auth");
const { isVerifiedInstitutionEmail, searchSchoolDirectory } = require("./school-directory");

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function usernameBase(name) {
  const normalized = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase()
    .slice(0, 20)
    .replace(/_+$/g, "");
  if (normalized.length >= 3) return normalized;
  if (normalized.length === 1) return `${normalized}__`;
  if (normalized.length === 2) return `${normalized}_`;
  return `${normalized || "teacher"}_`.slice(0, 20);
}

function usernameWithSuffix(base, suffixNumber) {
  if (suffixNumber === 1) return base;
  const suffix = `_${suffixNumber}`;
  return `${base.slice(0, 20 - suffix.length).replace(/_+$/g, "")}${suffix}`;
}

function validApplication(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  if (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 120) return false;
  if (typeof body.email !== "string" || body.email.length > 254 || !EMAIL_PATTERN.test(body.email.trim())) return false;
  if (typeof body.institution_type !== "string" || !["school", "district"].includes(body.institution_type)) return false;
  const idPattern = body.institution_type === "school" ? /^\d{12}$/ : /^\d{7}$/;
  if (typeof body.institution_id !== "string" || !idPattern.test(body.institution_id)) return false;
  return typeof body.institution_name === "string" && body.institution_name.trim().length > 0 &&
    body.institution_name.trim().length <= 200;
}

function createCodeHash(code) {
  return createHash("sha256").update(code, "utf8").digest("hex");
}

function installTeacherSignupRoutes(app, {
  pool,
  databaseConfigured,
  sessionSecret,
  secureCookies,
  demoMode,
  searchDirectory = searchSchoolDirectory,
  sendTeacherCode,
  emailDomainAllowlist = process.env.TEACHER_EMAIL_DOMAIN_ALLOWLIST,
}) {
  app.get("/api/teacher-applications/search", async (request, response) => {
    const query = typeof request.query.q === "string" ? request.query.q.trim() : "";
    if (query.length < 2) return response.json([]);
    if (query.length > 100) return response.status(400).json({ error: "Search text is too long" });
    try {
      const results = await searchDirectory(query);
      response.set("Cache-Control", "public, max-age=300");
      response.json(results);
    } catch (error) {
      console.error("NCES lookup failed:", error.message);
      response.status(502).json({ error: "The U.S. school directory is temporarily unavailable. Try again shortly." });
    }
  });

  app.post("/api/teacher-applications", async (request, response) => {
    if (!databaseConfigured || !isValidSessionSecret(sessionSecret)) {
      return response.status(503).json({ error: "Teacher applications are unavailable right now." });
    }
    if (!demoMode && typeof sendTeacherCode !== "function") {
      return response.status(503).json({ error: "Teacher applications are unavailable until email delivery is configured." });
    }
    if (!validApplication(request.body)) {
      return response.status(400).json({ error: "Enter your name, email, and choose a listed U.S. school or district." });
    }

    const { institution_type: type, institution_id: id, institution_name: name } = request.body;
    try {
      const matches = await searchDirectory(name);
      if (!matches.some((match) => match.type === type && match.id === id &&
          match.name.toLocaleLowerCase("en-US") === name.trim().toLocaleLowerCase("en-US"))) {
        return response.status(400).json({ error: "Choose a school or district from the official directory results." });
      }
      if (!demoMode && !isVerifiedInstitutionEmail(request.body.email.trim(), type, id, emailDomainAllowlist)) {
        return response.status(400).json({ error: "Use a verified school or district email address for the selected institution." });
      }

      const client = await pool.connect();
      const code = randomBytes(32).toString("base64url");
      const codeHash = createCodeHash(code);
      const base = usernameBase(request.body.name.trim());
      let username;
      try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", [base]);
        for (let suffix = 1; suffix <= 1000; suffix += 1) {
          const candidate = usernameWithSuffix(base, suffix);
          const exists = await client.query(
            `SELECT EXISTS(SELECT 1 FROM users WHERE username = $1)
                    OR EXISTS(SELECT 1 FROM teacher_signup_codes WHERE username = $1) AS taken`,
            [candidate],
          );
          if (!exists.rows[0].taken) {
            username = candidate;
            break;
          }
        }
        if (!username) throw new Error("Unable to reserve a unique teacher username");
        if (demoMode) {
          await client.query(
            "INSERT INTO teacher_signup_codes (username, code_hash) VALUES ($1, $2)",
            [username, codeHash],
          );
        } else {
          await client.query(
            "INSERT INTO teacher_signup_codes (username, code_hash, available_at) VALUES ($1, $2, NULL)",
            [username, codeHash],
          );
        }
        await client.query("COMMIT");
      } catch (error) {
        try { await client.query("ROLLBACK"); } catch {}
        throw error;
      } finally {
        client.release();
      }

      if (demoMode) {
        return response.status(201).json({
          username,
          demo_code: code,
          mode: "demo",
          message: "This demo code is displayed only once and is valid until used.",
        });
      }

      try {
        await sendTeacherCode({
          to: request.body.email.trim(),
          username,
          code,
          institutionName: name.trim(),
        });
        const activation = await pool.query(
          "UPDATE teacher_signup_codes SET available_at = now() WHERE code_hash = $1 AND available_at IS NULL",
          [codeHash],
        );
        if (activation.rowCount !== 1) throw new Error("Unable to activate delivered teacher code");
        return response.status(201).json({
          username,
          mode: "email",
          message: "Check your school email for your one-time teacher code.",
        });
      } catch (error) {
        try {
          await pool.query(
            "DELETE FROM teacher_signup_codes WHERE code_hash = $1 AND available_at IS NULL",
            [codeHash],
          );
        } catch (cleanupError) {
          console.error("Unable to remove an inactive teacher signup code");
        }
        throw error;
      }
    } catch (error) {
      console.error("Teacher application failed", error.code || error.name || "unknown error");
      response.status(503).json({ error: "Unable to send your teacher code right now. Your application was not completed; try again later." });
    }
  });

  app.post("/api/auth/register-teacher", async (request, response) => {
    if (!databaseConfigured || !isValidSessionSecret(sessionSecret)) {
      return response.status(503).json({ error: "Teacher signup is unavailable right now." });
    }
    const { code, password } = request.body || {};
    if (typeof code !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(code) ||
        typeof password !== "string" || [...password].length < 8) {
      return response.status(400).json({ error: "Enter a valid teacher code and a password of at least 8 characters." });
    }

    try {
      const passwordHash = await bcrypt.hash(preparePassword(password), 12);
      const client = await pool.connect();
      const token = randomBytes(32).toString("base64url");
      try {
        await client.query("BEGIN");
        const inviteResult = await client.query(
          `SELECT id, username FROM teacher_signup_codes
           WHERE code_hash = $1 AND consumed_at IS NULL AND available_at IS NOT NULL
           FOR UPDATE`,
          [createCodeHash(code)],
        );
        const invite = inviteResult.rows[0];
        if (!invite) {
          await client.query("ROLLBACK");
          return response.status(400).json({ error: "This teacher code is invalid or has already been used." });
        }

        let username = invite.username;
        let user;
        for (let suffix = 1; suffix <= 1000; suffix += 1) {
          const candidate = suffix === 1 ? username : usernameWithSuffix(usernameBase(username), suffix);
          const inserted = await client.query(
            `INSERT INTO users (username, role, password_hash)
             VALUES ($1, 'teacher', $2)
             ON CONFLICT (username) DO NOTHING
             RETURNING id, username`,
            [candidate, passwordHash],
          );
          if (inserted.rows[0]) {
            user = inserted.rows[0];
            username = user.username;
            break;
          }
          const reserved = await client.query(
            `SELECT 1 FROM teacher_signup_codes
             WHERE username = $1 AND id <> $2`,
            [candidate, invite.id],
          );
          if (reserved.rows.length) continue;
        }
        if (!user) throw new Error("Unable to create a unique teacher username");
        await client.query(
          "UPDATE teacher_signup_codes SET username = $1, consumed_at = now() WHERE id = $2",
          [username, invite.id],
        );
        await client.query(
          `INSERT INTO sessions (token, user_id, expires_at)
           VALUES ($1, $2, now() + interval '30 days')`,
          [digestToken(token, sessionSecret), user.id],
        );
        await client.query("COMMIT");
        writeSessionCookie(response, token, secureCookies);
        response.status(201).json({ username, role: "teacher" });
      } catch (error) {
        try { await client.query("ROLLBACK"); } catch {}
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error("Teacher account creation failed:", error.message);
      response.status(500).json({ error: "Unable to create a teacher account right now." });
    }
  });
}

module.exports = {
  installTeacherSignupRoutes,
  usernameBase,
  usernameWithSuffix,
  validApplication,
};
