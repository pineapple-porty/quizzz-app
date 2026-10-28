const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const { levelForPoints, multiplierForStreak, pointsForWin } = require("./scoring");

function hasValidOptions(options) {
  return Array.isArray(options) &&
    options.length === 4 &&
    options.every((option) => typeof option === "string" && option.trim().length > 0);
}

function logQuizError(action, error) {
  console.error(`${action} failed:`, error.message);
}

function installQuizRoutes(app, { pool, authenticate }) {
  app.get("/api/me/attempts", authenticate, async (request, response) => {
    try {
      const result = await pool.query(
        `SELECT a.quiz_id, q.title AS quiz_title, a.correct, a.total,
                ROUND((a.correct::numeric * 100) / a.total, 2) AS percent,
                a.points_awarded, a.created_at
         FROM attempts a
         JOIN quizzes q ON q.id = a.quiz_id
         WHERE a.user_id = $1
         ORDER BY a.created_at DESC, a.id DESC`,
        [request.user.id],
      );
      response.json(result.rows);
    } catch (error) {
      logQuizError("Attempt history request", error);
      response.status(500).json({ error: "Unable to load attempt history" });
    }
  });

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

      const quizResult = await pool.query(
        "SELECT difficulty, base_points FROM quizzes WHERE id = $1",
        [request.params.id],
      );
      const quiz = quizResult.rows[0];
      if (!quiz || !Number.isInteger(quiz.base_points) || quiz.base_points < 1) {
        response.status(404).json({ error: "Quiz not found" });
        return;
      }

      const correct = questions.reduce(
        (count, question, index) => count + Number(request.body.answers[index] === question.correct_index),
        0,
      );
      const total = questions.length;
      const beaten = correct > total / 2;
      const client = await pool.connect();
      let committed = false;
      let userState;
      let attempt;
      try {
        await client.query("BEGIN");
        const userResult = await client.query(
          `SELECT id, points, streak_count, best_streak, beaten_quizzes
           FROM users
           WHERE id = $1
           FOR UPDATE`,
          [request.user.id],
        );
        const user = userResult.rows[0];
        if (!user) {
          await client.query("ROLLBACK");
          response.status(401).json({ error: "Authentication required" });
          return;
        }

        const nextStreak = beaten ? user.streak_count + 1 : 0;
        const multiplier = beaten ? multiplierForStreak(nextStreak) : 1;
        const alreadyBeaten = Array.isArray(user.beaten_quizzes) &&
          user.beaten_quizzes.includes(request.params.id);
        const pointsAwarded = beaten
          ? pointsForWin({
            basePoints: quiz.base_points,
            difficulty: quiz.difficulty,
            multiplier,
            alreadyBeaten,
          })
          : 0;
        const nextPoints = user.points + pointsAwarded;
        const nextBestStreak = Math.max(user.best_streak, nextStreak);
        const beatenQuizzes = beaten && !alreadyBeaten
          ? [...(user.beaten_quizzes || []), request.params.id]
          : (user.beaten_quizzes || []);

        await client.query(
          `UPDATE users
           SET points = $1, streak_count = $2, best_streak = $3, beaten_quizzes = $4
           WHERE id = $5`,
          [nextPoints, nextStreak, nextBestStreak, beatenQuizzes, request.user.id],
        );
        if (beaten) {
          await client.query(
            `UPDATE assignments
             SET completed_at = now()
             WHERE player_id = $1 AND quiz_id = $2 AND completed_at IS NULL`,
            [request.user.id, request.params.id],
          );
        }
        const attemptResult = await client.query(
          `INSERT INTO attempts
             (user_id, quiz_id, correct, total, beaten, points_awarded, multiplier_applied)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id, created_at`,
          [request.user.id, request.params.id, correct, total, beaten, pointsAwarded, multiplier],
        );
        await client.query("COMMIT");
        committed = true;
        userState = {
          points: nextPoints,
          new_streak: nextStreak,
          best_streak: nextBestStreak,
          level: levelForPoints(nextPoints),
          points_awarded: pointsAwarded,
          multiplier_applied: multiplier,
        };
        attempt = attemptResult.rows[0];
      } catch (error) {
        if (!committed) {
          try {
            await client.query("ROLLBACK");
          } catch (rollbackError) {
            logQuizError("Quiz submission rollback", rollbackError);
          }
        }
        throw error;
      } finally {
        client.release();
      }

      const review = questions.map((question, index) => ({
        question: question.text,
        your_answer: request.body.answers[index],
        correct_index: question.correct_index,
      }));
      response.json({
        attempt_id: attempt.id,
        correct,
        total,
        percent: Number(((correct * 100) / total).toFixed(2)),
        beaten,
        ...userState,
        review,
      });
    } catch (error) {
      logQuizError("Quiz submission", error);
      response.status(500).json({ error: "Unable to submit quiz" });
    }
  });
}

module.exports = { installQuizRoutes };
