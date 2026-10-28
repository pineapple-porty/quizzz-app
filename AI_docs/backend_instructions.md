# Backend Instructions

> **READING PROTOCOL — READ THIS FIRST**
> Read ONLY this file. Do NOT read any other file in `AI_docs/` unless explicitly told to.

---

## Part 1 — Backend Architecture

### Stack
* **Node.js 24 LTS** (CommonJS), **Express 5**, **PostgreSQL** via the `pg` library (pooled).
* Entry point: `server.js`. Database access: `src/db.js` (exports `pool`).
* Frontend: static files in `public/`, served by Express; all dynamic data comes from `/api/...`.
* `package.json` engines must require `>=24`; `package-lock.json` is committed.

### Server behavior (verified against the code)
* `app.disable("x-powered-by")`; JSON bodies parsed with a **1 MB limit**.
* Health checks: `GET /api/health` and `GET /api/health/database` (`SELECT 1`, `503` on failure).
* Unmatched routes → `404 { error: "Not found", path }`.
* Errors → JSON `{ error }`, `400` for bad bodies, `500` otherwise; **never leak stack traces or internals**.
* Graceful shutdown on SIGINT/SIGTERM (close server, then `pool.end()`).

### Database layer (`src/db.js`)
* `DATABASE_URL` set → real pool: max 10 connections, 30s idle timeout, 5s connect timeout.
* `DATABASE_URL` missing → **mock pool** returning empty rows. The app boots and serves empty data. **Never assume real data when the env var is absent.**
* Env: `PORT` (default 3000), `DATABASE_URL`, plus `SESSION_SECRET` (see auth). All secrets are Replit Secrets, set per environment.

### Standing backend rules (for anyone adding code)
1. All endpoints under `/api/...`. Static files only from `public/`.
2. All queries go through the single `pool` from `src/db.js` — no second pool, no raw clients.
3. **Parameterized queries only** (`$1, $2, ...`). Never concatenate user input into SQL.
4. Error responses keep the existing shape: `{ error: "..." }`, safe message, no internals.
5. Async handlers use `try/catch`; nothing throws to crash the process.
6. When a table is created, add it to the schema section below in the same change.
7. **Scoring, streaks, and levels are computed server-side only.** The client sends answers; the server decides everything else. Client-sent point values are always ignored.
8. **Role hierarchy:** `player`, `teacher`, and `admin` are distinct roles. Teachers manage quizzes, questions, CSV imports, and assignments. Admins inherit all teacher permissions and may delete any account except their own or delete quizzes. Players cannot perform teacher or admin operations.

---

## Part 2 — Database Schema (Postgres)

*All tables below are the approved target schema. Any change to a table must be approved by the user.*

### users
| Column | Type | Notes |
|---|---|---|
| id | `UUID PRIMARY KEY DEFAULT gen_random_uuid()` | |
| username | `TEXT UNIQUE NOT NULL` | 3–20 chars, letters/numbers/underscore; **usernames only, never email addresses** |
| role | `TEXT NOT NULL DEFAULT 'player' CHECK (role IN ('player','teacher','admin'))` | teachers get authoring and assignment tools; admins inherit them and have deletion rights |
| password_hash | `TEXT NOT NULL` | bcrypt (cost 12); plaintext never stored, logged, or returned |
| points | `INTEGER NOT NULL DEFAULT 0` | lifetime award total; level is derived from this |
| streak_count | `INTEGER NOT NULL DEFAULT 0` | consecutive beaten quizzes, at any difficulty |
| best_streak | `INTEGER NOT NULL DEFAULT 0` | record; display only |
| beaten_quizzes | `TEXT[] NOT NULL DEFAULT '{}'` | quiz ids already beaten (0-point replays) |
| created_at | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

### sessions
| Column | Type | Notes |
|---|---|---|
| token | `TEXT PRIMARY KEY` | random 256-bit, hashed before storing |
| user_id | `UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE` | |
| expires_at | `TIMESTAMPTZ NOT NULL` | 30-day **rolling**: extended on each visit |
| created_at | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

### quizzes
| Column | Type | Notes |
|---|---|---|
| id | `UUID PRIMARY KEY DEFAULT gen_random_uuid()` | |
| title | `TEXT NOT NULL` | |
| description | `TEXT` | shown in quiz list |
| difficulty | `TEXT NOT NULL CHECK (difficulty IN ('noobie','easy','medium','hard','very_hard','impossible'))` | |
| base_points | `INTEGER NOT NULL` | within the difficulty chart range; set when the quiz is authored |
| created_at | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

### questions
| Column | Type | Notes |
|---|---|---|
| id | `UUID PRIMARY KEY DEFAULT gen_random_uuid()` | |
| quiz_id | `UUID NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE` | |
| position | `INTEGER NOT NULL` | question order within the quiz |
| text | `TEXT NOT NULL` | |
| options | `JSONB NOT NULL` | array of **exactly four** choice strings |
| correct_index | `INTEGER NOT NULL CHECK (correct_index BETWEEN 0 AND 3)` | exactly one correct answer |

*Quizzes and questions are created and edited by **teacher and admin accounts** through the question editor and CSV upload (see Part 4). Players cannot author content.*

### assignments
| Column | Type | Notes |
|---|---|---|
| id | `UUID PRIMARY KEY DEFAULT gen_random_uuid()` | |
| quiz_id | `UUID NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE` | the quiz being assigned |
| player_id | `UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE` | who it is assigned to |
| assigned_by | `UUID NOT NULL REFERENCES users(id)` | the teacher who assigned it |
| assigned_at | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| completed_at | `TIMESTAMPTZ` | set when the player beats the quiz; null until then |

*An **assignment** = a teacher assigning a quiz to a specific player. Teachers create and manage assignments; players see which quizzes are assigned to them and whether each is complete. Completing (beating) the assigned quiz marks it complete.*

### attempts
| Column | Type | Notes |
|---|---|---|
| id | `UUID PRIMARY KEY DEFAULT gen_random_uuid()` | |
| user_id | `UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE` | |
| quiz_id | `UUID NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE` | |
| correct | `INTEGER NOT NULL` | |
| total | `INTEGER NOT NULL` | question count |
| beaten | `BOOLEAN NOT NULL` | more than half correct |
| points_awarded | `INTEGER NOT NULL` | 0 for replays/losses; includes multiplier & division |
| multiplier_applied | `NUMERIC(4,1) NOT NULL DEFAULT 1.0` | audit trail |
| created_at | `TIMESTAMPTZ NOT NULL DEFAULT now()` | completion date/time |

*Every completed attempt, including retries, is saved as an `attempts` row. An attempt row is written **only at submit** — closing the page mid-quiz creates no row, so unfinished attempts never count as completions.*

---

## Part 3 — Scoring, Streak & Level System (authoritative)

### Difficulty chart & base points
*Guide for whoever authors quizzes. `base_points` must fall inside the row's range.*

| Difficulty | Description | Base points |
|---|---|---|
| Noobie | Everyone should know these | 2–3 |
| Easy | No challenge with a second of thought — pop culture, infamous events | 10–12 |
| Medium | Harder — more obscure events, topics, happenings | 13–18 |
| Hard | Unlikely to know unless you do a lot of reading | 19–25 |
| Very hard | Hardest of the hard | 25–35 |
| Impossible | Must be very educated | 36–50 |

### Winning and losing
* **Beaten (win):** more than half of the questions correct.
* **Lost:** half or more of the questions wrong. A loss resets `streak_count` to 0.

### Streak multiplier ladder
| Consecutive wins | Multiplier |
|---|---|
| 0–1 | ×1.0 (standard points, no multiplier) |
| 2 | ×1.5 (multiplier activates) |
| each additional win | +0.1 per win |
| from streak 10 | +0.2 per win; the increment grows +0.1 every 10 wins (streak 20 → +0.3, streak 30 → +0.4, …) |
| from streak 100 | +0.5 every 5 wins |
| **hard cap** | **×10.0 — the multiplier never exceeds this** |

### Final point formula
```
awarded = base_points × multiplier          // multiplier = 1.0 when streak < 2
if difficulty is noobie or easy: awarded = awarded / 2   (rounded down)
if quiz already in user's beaten_quizzes: awarded = 0
if quiz was lost: awarded = 0 (but retrying a lost quiz for points is allowed)
```
* **Noobie/Easy quizzes still extend the streak** — they earn half points but count as wins.
* **Replay rule (anti-farm):** a beaten quiz can be replayed freely, but earns **0 points** on every replay. A lost quiz can be retried for full value.
* Every award writes an `attempts` row with the multiplier used (audit trail).

### Level formula
* Level is **derived from `points`** — never stored separately.
* `level = floor(sqrt(points / 50)) + 1`, capped at level 100.
* Thresholds: L1 = 0 · L2 = 50 · L3 = 200 · L4 = 450 · L5 = 800 · L6 = 1250 · … · L10 = 4050.
* The UI may show "points to next level" = `50 × level² − points`.

### Extra features (declared)
* The two additional functional features beyond the shared requirements are:
  **(1) the streak multiplier system, (2) the level system.**
* **Build timing:** streak points and level calculation are implemented together with attempt saving (Phase 3 of the development plan); the quiz-play flow (Phase 2) shows raw score and percentage only.

### Launch content
* **Five quizzes ship at launch, each with at least 10 questions** (exactly four choices per question, exactly one correct).
* Teachers author these through the question editor / CSV upload before launch.

---

## Part 4 — Feature Behaviors

### Accounts & login
* Register: username + password. Password rules: 8+ chars, any characters. bcrypt cost 12.
* Login creates a `sessions` row; cookie is `httpOnly`, `SameSite=Lax`, secure in production.
* **Session lifetime: 30-day rolling** — extended on every authenticated request. Logout deletes the session row and clears the cookie.
* **Login is required to play a quiz.** Logged-out visitors can browse the quiz list and view leaderboards, but must register/log in to start a quiz. Rationale: every completed attempt must be saved with a user — anonymous play cannot satisfy that rule.

### Roles & permissions
| Action | Player | Teacher | Admin |
|---|---|---|---|
| Play quizzes, earn points/streaks/levels | ✅ | ✅ (scores still count) | ✅ (scores still count) |
| View leaderboards and own attempt history | ✅ | ✅ | ✅ |
| See quizzes assigned to them / manage assignments | see own | create/manage | create/manage |
| Question editor: add/edit questions, choices, correct answers, quiz assignments | ❌ | ✅ | ✅ |
| CSV upload with preview & validation | ❌ | ✅ | ✅ |
| Delete accounts except the acting admin | ❌ | ❌ | ✅ |
| Delete quizzes | ❌ | ❌ | ✅ |

* The server checks `role` on every teacher/admin endpoint — the client never decides.
* Deleting a user removes that user's sessions, attempts, and assignments.
* Deleting a quiz removes its questions, attempts, and assignments. The UI must warn that these records are permanently deleted.
* The first admin account is provisioned manually by a trusted operator; normal registration must never accept a client-supplied role.

### Quiz data & user info (all from the server)
* Quiz content is fetched from the API — never hardcoded in the frontend.
* `correct_index` is **never sent to the client** during play; grading is server-side only.

### Results screen
* After submit, the player sees: **score (correct/total), percentage correct, points awarded, multiplier applied, current streak, and level** — then a question-by-question review (their answer vs. correct). Buttons: "Retry" and "Back to quizzes."

### Leaderboards (usernames only, never emails)
* `GET /api/leaderboard` — **overall**: all users ranked by **total completed attempts** (desc); ties share the same rank. Shows username, completed attempts, level.
* `GET /api/quizzes/:id/leaderboard` — **per quiz**: each user's **highest score** and **number of completed attempts**, ranked by highest score (desc); ties broken by earlier first completion, then fewer attempts.
* Both leaderboards are public — visible while logged out.

### Attempt history
* `GET /api/me/attempts` → newest first: `{ quiz_id, quiz_title, correct, total, percent, points_awarded, created_at }`.
* A user can only ever see their own history.

### Assignments
* `GET /api/me/assignments` → quizzes assigned to the current player with completion status.
* `POST /api/admin/assignments` → teacher assigns a quiz to a player.
* `DELETE /api/admin/assignments/:id` → teacher removes an assignment.
* When a player beats a quiz, any open assignment for that quiz is marked `completed_at = now()`.

### Teacher question editor & CSV upload
* `POST /api/admin/quizzes` — teacher/admin creates quiz (title, description, difficulty, base_points)
* `PUT /api/admin/quizzes/:id` — edit quiz details
* `POST /api/admin/quizzes/:id/questions` — add question
* `PUT /api/admin/questions/:id` — edit question text, choices, correct answer
* `DELETE /api/admin/questions/:id` — remove question
* **CSV upload:** `POST /api/admin/quizzes/:id/upload` — teacher uploads a CSV using the standard template (columns: `question,choice_a,choice_b,choice_c,choice_d,correct_letter`). The server returns a **preview**: valid rows plus invalid rows with row numbers and reasons (missing column, not exactly four choices, bad correct letter). Nothing is saved until the teacher confirms; then `POST /api/admin/quizzes/:id/import` imports only the valid rows.
* `GET /api/admin/users` — admin lists usernames and roles for account management.
* `DELETE /api/admin/users/:id` — admin deletes any account except their own; linked sessions, attempts, and assignments are removed.
* `DELETE /api/admin/quizzes/:id` — admin deletes a quiz and its questions, attempts, and assignments.

### Endpoints (target API)
* `POST /api/auth/register` → `{ username }` or `409` if taken
* `POST /api/auth/login` → `{ username }` + session cookie, or `401`
* `POST /api/auth/logout` → `{ ok: true }`
* `GET /api/me` → `{ username, role, points, level, streak_count, best_streak, created_at }` or `401`
* `GET /api/me/attempts` → own attempt history (auth required)
* `GET /api/me/assignments` → own assignments (auth required)
* `GET /api/quizzes` → list: `{ id, title, description, difficulty }` (no questions)
* `GET /api/quizzes/:id` → full quiz with questions/options, **no `correct_index`**
* `POST /api/quizzes/:id/submit` → body `{ answers: number[] }` → `{ correct, total, percent, beaten, points_awarded, multiplier_applied, new_streak, level, review: [{ question, your_answer, correct_index }] }` (auth required)
* `GET /api/leaderboard` → overall leaderboard (public)
* `GET /api/quizzes/:id/leaderboard` → per-quiz leaderboard (public)
* Teacher/admin endpoints listed in the question editor and assignments sections (teacher or admin role required); deletion endpoints require admin

---

## Part 5 — Development workflow for this backend
1. Follow `AI_docs/git_instructions.md` (never commit to `main` without explicit permission; branch per feature).
2. Schema changes: propose here first; build only after user approval.
3. Every new endpoint gets the standard error shape and `try/catch` handler.
4. Mock-pool mode must keep the app bootable at all times.
5. Follow `AI_docs/agent_development.md` for the five-phase build order, QA workflow, and merge gates.

---

## Part 6 — Environments & deployment
* **QA environment:** the Replit development workspace, with its own Postgres database.
* **Production:** Replit Deployment, with a **separate production database**.
* `DATABASE_URL` and `SESSION_SECRET` are Replit Secrets, set separately per environment.
* The same stack runs in both environments; persistent data survives app restarts.
* `package-lock.json` is committed; Node 24 LTS is required everywhere.
* All required features must work in the deployed app, not just in QA.
