const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIFFICULTY_POINTS = {
  noobie: [2, 3],
  easy: [10, 12],
  medium: [13, 18],
  hard: [19, 25],
  very_hard: [25, 35],
  impossible: [36, 50],
};
const CSV_COLUMNS = ["question", "choice_a", "choice_b", "choice_c", "choice_d", "correct_letter"];

function parseCsv(text) {
  if (typeof text !== "string" || !text.trim()) return { error: "CSV content is empty" };
  text = text.replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  let afterQuote = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
        afterQuote = true;
      } else {
        value += char;
      }
    } else if (char === '"' && value.length === 0) {
      if (afterQuote) return { error: `CSV row ${rows.length + 1} has an unexpected quote` };
      quoted = true;
    } else if (char === ",") {
      row.push(value);
      value = "";
      afterQuote = false;
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
      afterQuote = false;
    } else if (char === '"' || afterQuote) {
      return { error: `CSV row ${rows.length + 1} has malformed quoting` };
    } else {
      value += char;
    }
  }
  if (quoted) return { error: "CSV contains an unclosed quoted field" };
  if (row.length || value.length) {
    row.push(value);
    rows.push(row);
  }
  const header = (rows.shift() || []).map((cell) => cell.trim().toLowerCase());
  const missing = CSV_COLUMNS.filter((column) => !header.includes(column));
  const duplicate = header.find((column, index) => header.indexOf(column) !== index);
  if (missing.length || duplicate) {
    return { headerError: [...missing.map((column) => `Missing column: ${column}`), ...(duplicate ? [`Duplicate column: ${duplicate}`] : [])] };
  }
  const columnIndex = Object.fromEntries(CSV_COLUMNS.map((column) => [column, header.indexOf(column)]));
  const validRows = [];
  const invalidRows = [];
  rows.forEach((cells, index) => {
    if (cells.every((cell) => !cell.trim())) return;
    const rowNumber = index + 2;
    const question = (cells[columnIndex.question] || "").trim();
    const options = ["choice_a", "choice_b", "choice_c", "choice_d"].map((key) =>
      (cells[columnIndex[key]] || "").trim(),
    );
    const correctLetter = (cells[columnIndex.correct_letter] || "").trim().toUpperCase();
    const errors = [];
    if (!question) errors.push("Question is required");
    if (options.some((option) => !option)) errors.push("Exactly four non-empty choices are required");
    if (!/^[A-D]$/.test(correctLetter)) errors.push("Correct letter must be A, B, C, or D");
    if (cells.length !== header.length) errors.push("Row has the wrong number of columns");
    if (errors.length) invalidRows.push({ row: rowNumber, errors });
    else validRows.push({ row: rowNumber, text: question, options, correct_index: correctLetter.charCodeAt(0) - 65 });
  });
  return { validRows, invalidRows };
}

function validQuiz(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return "Quiz details are required";
  if (typeof input.title !== "string" || !input.title.trim() || input.title.length > 200) return "Title is required and must be at most 200 characters";
  if (typeof input.description !== "string" || input.description.length > 2000) return "Description must be text under 2000 characters";
  const range = Object.hasOwn(DIFFICULTY_POINTS, input.difficulty) ? DIFFICULTY_POINTS[input.difficulty] : null;
  if (!range || !Number.isInteger(input.base_points) || input.base_points < range[0] || input.base_points > range[1]) {
    return "Difficulty and base points do not match the scoring chart";
  }
  return null;
}

function validQuestion(input) {
  if (!input || typeof input.text !== "string" || !input.text.trim() ||
      !Array.isArray(input.options) || input.options.length !== 4 ||
      input.options.some((option) => typeof option !== "string" || !option.trim()) ||
      !Number.isInteger(input.correct_index) || input.correct_index < 0 || input.correct_index > 3) {
    return "Question needs text, four choices, and a correct choice";
  }
  return null;
}

function installAdminRoutes(app, { pool, authenticate, requireRole }) {
  const teacher = [authenticate, requireRole("teacher", "admin")];

  app.get("/api/admin/quizzes", ...teacher, async (_request, response) => {
    try {
      const result = await pool.query(
        `SELECT q.id, q.title, q.description, q.difficulty, q.base_points,
                COALESCE(
                  json_agg(json_build_object(
                    'id', question.id, 'position', question.position,
                    'text', question.text, 'options', question.options,
                    'correct_index', question.correct_index
                  ) ORDER BY question.position) FILTER (WHERE question.id IS NOT NULL),
                  '[]'::json
                ) AS questions
         FROM quizzes q
         LEFT JOIN questions question ON question.quiz_id = q.id
         GROUP BY q.id
         ORDER BY q.created_at DESC, q.id`,
      );
      response.json(result.rows);
    } catch (error) {
      console.error("Teacher quiz list failed:", error.message);
      response.status(500).json({ error: "Unable to load teacher quizzes" });
    }
  });

  app.get("/api/admin/players", ...teacher, async (_request, response) => {
    try {
      const result = await pool.query(
        "SELECT id, username FROM users WHERE role = 'player' ORDER BY username",
      );
      response.json(result.rows);
    } catch (error) {
      console.error("Player list failed:", error.message);
      response.status(500).json({ error: "Unable to load players" });
    }
  });

  app.get("/api/leaderboard", async (_request, response) => {
    try {
      const result = await pool.query(
        `SELECT RANK() OVER (ORDER BY COUNT(a.id) DESC) AS rank,
                u.username, COUNT(a.id)::integer AS completed_attempts,
                u.points, LEAST(100, FLOOR(SQRT(GREATEST(u.points, 0)::numeric / 50)) + 1)::integer AS level
         FROM users u
         LEFT JOIN attempts a ON a.user_id = u.id
         GROUP BY u.id
         ORDER BY rank, u.username`,
      );
      response.json(result.rows);
    } catch (error) {
      console.error("Overall leaderboard failed:", error.message);
      response.status(500).json({ error: "Unable to load leaderboard" });
    }
  });

  app.get("/api/quizzes/:id/leaderboard", async (request, response) => {
    if (!UUID_PATTERN.test(request.params.id)) return response.status(404).json({ error: "Quiz not found" });
    try {
      const result = await pool.query(
        `SELECT RANK() OVER (
                  ORDER BY MAX(a.correct) DESC, MIN(a.created_at) ASC, COUNT(*) ASC
                ) AS rank,
                u.username, MAX(a.correct)::integer AS highest_score,
                MAX(a.total)::integer AS total_questions, COUNT(*)::integer AS completed_attempts
         FROM attempts a
         JOIN users u ON u.id = a.user_id
         WHERE a.quiz_id = $1
         GROUP BY u.id
         ORDER BY rank, u.username`,
        [request.params.id],
      );
      response.json(result.rows);
    } catch (error) {
      console.error("Quiz leaderboard failed:", error.message);
      response.status(500).json({ error: "Unable to load quiz leaderboard" });
    }
  });

  app.post("/api/admin/quizzes", ...teacher, async (request, response) => {
    const error = validQuiz(request.body);
    if (error) return response.status(400).json({ error });
    try {
      const result = await pool.query(
        `INSERT INTO quizzes (title, description, difficulty, base_points)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [request.body.title.trim(), request.body.description.trim(), request.body.difficulty, request.body.base_points],
      );
      response.status(201).json({ id: result.rows[0].id });
    } catch (caught) {
      console.error("Quiz creation failed:", caught.message);
      response.status(500).json({ error: "Unable to create quiz" });
    }
  });

  app.put("/api/admin/quizzes/:id", ...teacher, async (request, response) => {
    if (!UUID_PATTERN.test(request.params.id)) return response.status(404).json({ error: "Quiz not found" });
    const error = validQuiz(request.body);
    if (error) return response.status(400).json({ error });
    try {
      const result = await pool.query(
        `UPDATE quizzes SET title = $1, description = $2, difficulty = $3, base_points = $4
         WHERE id = $5 RETURNING id`,
        [request.body.title.trim(), request.body.description.trim(), request.body.difficulty, request.body.base_points, request.params.id],
      );
      if (!result.rows.length) return response.status(404).json({ error: "Quiz not found" });
      response.json({ id: result.rows[0].id });
    } catch (caught) {
      console.error("Quiz update failed:", caught.message);
      response.status(500).json({ error: "Unable to update quiz" });
    }
  });

  app.post("/api/admin/quizzes/:id/questions", ...teacher, async (request, response) => {
    if (!UUID_PATTERN.test(request.params.id)) return response.status(404).json({ error: "Quiz not found" });
    const error = validQuestion(request.body);
    if (error) return response.status(400).json({ error });
    try {
      const quiz = await pool.query("SELECT id FROM quizzes WHERE id = $1", [request.params.id]);
      if (!quiz.rows.length) return response.status(404).json({ error: "Quiz not found" });
      const result = await pool.query(
        `INSERT INTO questions (quiz_id, position, text, options, correct_index)
         SELECT $1, COALESCE(MAX(position), 0) + 1, $2, $3::jsonb, $4
         FROM questions WHERE quiz_id = $1
         RETURNING id, position`,
        [request.params.id, request.body.text.trim(), JSON.stringify(request.body.options.map((option) => option.trim())), request.body.correct_index],
      );
      response.status(201).json(result.rows[0]);
    } catch (caught) {
      console.error("Question creation failed:", caught.message);
      response.status(500).json({ error: "Unable to add question" });
    }
  });

  app.put("/api/admin/questions/:id", ...teacher, async (request, response) => {
    if (!UUID_PATTERN.test(request.params.id)) return response.status(404).json({ error: "Question not found" });
    const error = validQuestion(request.body);
    if (error) return response.status(400).json({ error });
    try {
      const result = await pool.query(
        `UPDATE questions SET text = $1, options = $2::jsonb, correct_index = $3
         WHERE id = $4 RETURNING id`,
        [request.body.text.trim(), JSON.stringify(request.body.options.map((option) => option.trim())), request.body.correct_index, request.params.id],
      );
      if (!result.rows.length) return response.status(404).json({ error: "Question not found" });
      response.json({ id: result.rows[0].id });
    } catch (caught) {
      console.error("Question update failed:", caught.message);
      response.status(500).json({ error: "Unable to update question" });
    }
  });

  app.delete("/api/admin/questions/:id", ...teacher, async (request, response) => {
    if (!UUID_PATTERN.test(request.params.id)) return response.status(404).json({ error: "Question not found" });
    try {
      const result = await pool.query("DELETE FROM questions WHERE id = $1 RETURNING id", [request.params.id]);
      if (!result.rows.length) return response.status(404).json({ error: "Question not found" });
      response.json({ ok: true });
    } catch (caught) {
      console.error("Question deletion failed:", caught.message);
      response.status(500).json({ error: "Unable to delete question" });
    }
  });

  app.get("/api/admin/assignments", ...teacher, async (_request, response) => {
    try {
      const result = await pool.query(
        `SELECT a.id, a.quiz_id, q.title AS quiz_title, a.player_id,
                u.username, a.assigned_at, a.completed_at
         FROM assignments a
         JOIN quizzes q ON q.id = a.quiz_id
         JOIN users u ON u.id = a.player_id
         ORDER BY a.assigned_at DESC, a.id`,
      );
      response.json(result.rows);
    } catch (error) {
      console.error("Assignment list failed:", error.message);
      response.status(500).json({ error: "Unable to load assignments" });
    }
  });

  app.get("/api/me/assignments", authenticate, async (request, response) => {
    try {
      const result = await pool.query(
        `SELECT a.id, a.quiz_id, q.title AS quiz_title, q.description,
                a.assigned_at, a.completed_at
         FROM assignments a
         JOIN quizzes q ON q.id = a.quiz_id
         WHERE a.player_id = $1
         ORDER BY a.assigned_at DESC, a.id`,
        [request.user.id],
      );
      response.json(result.rows);
    } catch (error) {
      console.error("Player assignments failed:", error.message);
      response.status(500).json({ error: "Unable to load assignments" });
    }
  });

  app.post("/api/admin/assignments", ...teacher, async (request, response) => {
    const { quiz_id: quizId, player_id: playerId } = request.body || {};
    if (!UUID_PATTERN.test(quizId || "") || !UUID_PATTERN.test(playerId || "")) {
      return response.status(400).json({ error: "Choose a quiz and player" });
    }
    try {
      const result = await pool.query(
        `INSERT INTO assignments (quiz_id, player_id, assigned_by)
         SELECT $1, u.id, $3 FROM users u
         WHERE u.id = $2 AND u.role = 'player'
         AND EXISTS (SELECT 1 FROM quizzes q WHERE q.id = $1)
         RETURNING id`,
        [quizId, playerId, request.user.id],
      );
      if (!result.rows.length) return response.status(404).json({ error: "Quiz or player not found" });
      response.status(201).json({ id: result.rows[0].id });
    } catch (error) {
      console.error("Assignment creation failed:", error.message);
      response.status(500).json({ error: "Unable to assign quiz" });
    }
  });

  app.delete("/api/admin/assignments/:id", ...teacher, async (request, response) => {
    if (!UUID_PATTERN.test(request.params.id)) return response.status(404).json({ error: "Assignment not found" });
    try {
      const result = await pool.query("DELETE FROM assignments WHERE id = $1 RETURNING id", [request.params.id]);
      if (!result.rows.length) return response.status(404).json({ error: "Assignment not found" });
      response.json({ ok: true });
    } catch (error) {
      console.error("Assignment deletion failed:", error.message);
      response.status(500).json({ error: "Unable to remove assignment" });
    }
  });

  async function previewCsv(request, response) {
    if (!UUID_PATTERN.test(request.params.id)) return response.status(404).json({ error: "Quiz not found" });
    const parsed = parseCsv(request.body?.csv);
    if (parsed.error) return response.status(400).json({ error: parsed.error });
    if (parsed.headerError) {
      return response.json({ valid_rows: [], invalid_rows: [{ row: 1, errors: parsed.headerError }] });
    }
    const exists = await pool.query("SELECT id FROM quizzes WHERE id = $1", [request.params.id]);
    if (!exists.rows.length) return response.status(404).json({ error: "Quiz not found" });
    response.json({ valid_rows: parsed.validRows, invalid_rows: parsed.invalidRows });
  }

  app.post("/api/admin/quizzes/:id/upload", ...teacher, async (request, response) => {
    try {
      await previewCsv(request, response);
    } catch (error) {
      console.error("CSV preview failed:", error.message);
      if (!response.headersSent) response.status(500).json({ error: "Unable to preview CSV" });
    }
  });

  app.post("/api/admin/quizzes/:id/import", ...teacher, async (request, response) => {
    if (!UUID_PATTERN.test(request.params.id)) return response.status(404).json({ error: "Quiz not found" });
    const parsed = parseCsv(request.body?.csv);
    if (parsed.error) return response.status(400).json({ error: parsed.error });
    if (parsed.headerError) return response.status(400).json({ error: parsed.headerError.join("; ") });
    if (!parsed.validRows.length) return response.status(400).json({ error: "CSV has no valid question rows", invalid_rows: parsed.invalidRows });
    const client = await pool.connect();
    let committed = false;
    try {
      await client.query("BEGIN");
      const quiz = await client.query("SELECT id FROM quizzes WHERE id = $1 FOR UPDATE", [request.params.id]);
      if (!quiz.rows.length) {
        await client.query("ROLLBACK");
        return response.status(404).json({ error: "Quiz not found" });
      }
      const positionResult = await client.query(
        "SELECT COALESCE(MAX(position), 0) AS max_position FROM questions WHERE quiz_id = $1",
        [request.params.id],
      );
      let position = Number(positionResult.rows[0].max_position) || 0;
      for (const row of parsed.validRows) {
        position += 1;
        await client.query(
          `INSERT INTO questions (quiz_id, position, text, options, correct_index)
           VALUES ($1, $2, $3, $4::jsonb, $5)`,
          [request.params.id, position, row.text, JSON.stringify(row.options), row.correct_index],
        );
      }
      await client.query("COMMIT");
      committed = true;
      response.status(201).json({ imported: parsed.validRows.length, invalid_rows: parsed.invalidRows });
    } catch (error) {
      if (!committed) {
        try { await client.query("ROLLBACK"); } catch {}
      }
      console.error("CSV import failed:", error.message);
      response.status(500).json({ error: "Unable to import CSV" });
    } finally {
      client.release();
    }
  });
}

module.exports = { installAdminRoutes, parseCsv };
