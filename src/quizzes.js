const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function hasValidOptions(options) {
  return Array.isArray(options) &&
    options.length === 4 &&
    options.every((option) => typeof option === "string" && option.trim().length > 0);
}

function logQuizError(action, error) {
  console.error(`${action} failed:`, error.message);
}

function installQuizRoutes(app, { pool, authenticate }) {
  app.get("/api/quizzes", async (_request, response) => {
    try {
      const result = await pool.query(
        `SELECT q.id, q.title, q.description, q.difficulty
         FROM quizzes q
         WHERE EXISTS (
           SELECT 1 FROM questions question WHERE question.quiz_id = q.id
         )
         ORDER BY q.created_at DESC, q.id`,
      );
      response.json(result.rows);
    } catch (error) {
      logQuizError("Quiz list request", error);
      response.status(500).json({ error: "Unable to load quizzes" });
    }
  });

  app.get("/api/quizzes/:id", authenticate, async (request, response) => {
    if (!UUID_PATTERN.test(request.params.id)) {
      response.status(404).json({ error: "Quiz not found" });
      return;
    }

    try {
      const result = await pool.query(
        `SELECT q.id, q.title, q.description, q.difficulty,
                question.id AS question_id, question.position,
                question.text AS question_text, question.options
         FROM quizzes q
         JOIN questions question ON question.quiz_id = q.id
         WHERE q.id = $1
         ORDER BY question.position, question.id`,
        [request.params.id],
      );
      if (result.rows.length === 0) {
        response.status(404).json({ error: "Quiz not found" });
        return;
      }

      const first = result.rows[0];
      const questions = result.rows.map((row) => {
        if (!hasValidOptions(row.options) || typeof row.question_text !== "string" || !row.question_text.trim()) {
          throw new Error(`Quiz ${request.params.id} contains an invalid question`);
        }
        return {
          id: row.question_id,
          position: row.position,
          text: row.question_text,
          options: row.options,
        };
      });

      response.json({
        id: first.id,
        title: first.title,
        description: first.description,
        difficulty: first.difficulty,
        questions,
      });
    } catch (error) {
      logQuizError("Quiz detail request", error);
      response.status(500).json({ error: "Unable to load quiz" });
    }
  });

  app.post("/api/quizzes/:id/submit", authenticate, async (request, response) => {
    if (!UUID_PATTERN.test(request.params.id)) {
      response.status(404).json({ error: "Quiz not found" });
      return;
    }
    if (!request.body || typeof request.body !== "object" || Array.isArray(request.body) ||
        !Array.isArray(request.body.answers) ||
        request.body.answers.some((answer) => !Number.isInteger(answer) || answer < 0 || answer > 3)) {
      response.status(400).json({ error: "Answers must be an array of choice indexes from 0 to 3" });
      return;
    }

    try {
      const result = await pool.query(
        `SELECT id, position, text, options, correct_index
         FROM questions
         WHERE quiz_id = $1
         ORDER BY position, id`,
        [request.params.id],
      );
      const questions = result.rows;
      if (questions.length === 0) {
        response.status(404).json({ error: "Quiz not found" });
        return;
      }
      if (request.body.answers.length !== questions.length) {
        response.status(400).json({ error: "Submit one answer for every question" });
        return;
      }
      if (questions.some((question) =>
        !hasValidOptions(question.options) ||
        typeof question.text !== "string" ||
        !Number.isInteger(question.correct_index) ||
        question.correct_index < 0 ||
        question.correct_index > 3
      )) {
        throw new Error(`Quiz ${request.params.id} contains an invalid question`);
      }

      const correct = questions.reduce(
        (count, question, index) => count + Number(request.body.answers[index] === question.correct_index),
        0,
      );
      const total = questions.length;
      const review = questions.map((question, index) => ({
        question: question.text,
        your_answer: request.body.answers[index],
        correct_index: question.correct_index,
      }));
      response.json({
        correct,
        total,
        percent: Number(((correct * 100) / total).toFixed(2)),
        beaten: correct > total / 2,
        review,
      });
    } catch (error) {
      logQuizError("Quiz submission", error);
      response.status(500).json({ error: "Unable to submit quiz" });
    }
  });
}

module.exports = { installQuizRoutes };
