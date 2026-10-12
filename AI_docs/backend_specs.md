# Backend Specs

> **READING PROTOCOL — READ THIS FIRST**
> Read ONLY this file. Do NOT read any other file in `AI_docs/` unless explicitly told to.

---

## Part 1 — Backend Architecture

### Stack
* **Node.js ≥ 22** (CommonJS), **Express 5**, **PostgreSQL** via the `pg` library (pooled).
* Entry point: `server.js`. Database access: `src/db.js` (exports `pool`).
* Frontend: static files in `public/`, served by Express; all dynamic data comes from `/api/...`.

### Server behavior (verified against the code)
* `app.disable("x-powered-by")`; JSON bodies parsed with a **1 MB limit**.
* Health checks: `GET /api/health` and `GET /api/health/database` (`SELECT 1`, `503` on failure).
* Unmatched routes → `404 { error: "Not found", path }`.
* Errors → JSON `{ error }`, `400` for bad bodies, `500` otherwise; **never leak stack traces or internals**.
* Graceful shutdown on SIGINT/SIGTERM (close server, then `pool.end()`).

### Database layer (`src/db.js`)
* `DATABASE_URL` set → real pool: max 10 connections, 30s idle timeout, 5s connect timeout.
* `DATABASE_URL` missing → **mock pool** returning empty rows. The app boots and serves empty data. **Never assume real data when the env var is absent.**
* Env: `PORT` (default 3000), `DATABASE_URL`, plus `SESSION_SECRET` (see auth).

### Standing backend rules (for anyone adding code)
1. All endpoints under `/api/...`. Static files only from `public/`.
2. All queries go through the single `pool` from `src/db.js` — no second pool, no raw clients.
3. **Parameterized queries only** (`$1, $2, ...`). Never concatenate user input into SQL.
4. Error responses keep the existing shape: `{ error: "..." }`, safe message, no internals.
5. Async handlers use `try/catch`; nothing throws to crash the process.
6. When a table is created, add it to the schema section below in the same change.
7. **Scoring, streaks, and levels are computed server-side only.** The client sends answers; the server decides everything else. Client-sent point values are always ignored.

---

## Part 2 — Database Schema (Postgres)

*All tables below are the approved target schema. Any change to a table must be approved by the user.*

### users
| Column | Type | Notes |
|---|---|---|
| id | `UUID PRIMARY KEY DEFAULT gen_random_uuid()` | |
| username | `TEXT UNIQUE NOT NULL` | 3–20 chars, letters/numbers/underscore |
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
| base_points | `INTEGER NOT NULL` | within the difficulty chart range; set when the quiz JSON is authored |
| questions | `JSONB NOT NULL` | array of `{ text, options: string[2..4], correct_index }` |
| created_at | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

*Quizzes are **site-authored only** (developers create the JSON). User-created quizzes are a possible future feature — not built, not specced.*

### attempts
| Column | Type | Notes |
|---|---|---|
| id | `UUID PRIMARY KEY DEFAULT gen_random_uuid()` | |
| user_id | `UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE` | |
| quiz_id | `UUID NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE` | |
| correct | `INTEGER NOT NULL` | |
| total | `INTEGER NOT NULL` | |
| beaten | `BOOLEAN NOT NULL` | more than half correct |
| points_awarded | `INTEGER NOT NULL` | 0 for replays/losses; includes multiplier & division |
| multiplier_applied | `NUMERIC(4,1) NOT NULL DEFAULT 1.0` | audit trail |
| created_at | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

---

## Part 3 — Scoring, Streak & Level System (authoritative)

### Difficulty chart & base points
*Guide for whoever authors quiz JSON. `base_points` must fall inside the row's range.*

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
* Each level costs progressively more; the UI may show "points to next level" = `50 × level² − points`.

---

## Part 4 — Feature Behaviors

### Accounts & login
* Register: username + password. Password rules: 8+ chars, any characters. bcrypt cost 12.
* Login creates a `sessions` row; cookie is `httpOnly`, `SameSite=Lax`, secure in production.
* **Session lifetime: 30-day rolling** — extended on every authenticated request. Logout deletes the session row and clears the cookie.
* Browsing and playing works logged-out; nothing is saved.

### Quiz data & user info (all from the server)
* Quiz content is fetched from the API — never hardcoded in the frontend.
* `correct_index` is **never sent to the client** during play; grading is server-side only.

### Endpoints (target API)
* `POST /api/auth/register` → `{ username }` or `409` if taken
* `POST /api/auth/login` → `{ username }` + session cookie, or `401`
* `POST /api/auth/logout` → `{ ok: true }`
* `GET /api/me` → `{ username, points, level, streak_count, best_streak, created_at }` or `401`
* `GET /api/quizzes` → list: `{ id, title, description, difficulty }` (no questions)
* `GET /api/quizzes/:id` → full quiz with questions/options, **no `correct_index`**
* `POST /api/quizzes/:id/submit` → body `{ answers: number[] }` → `{ correct, total, beaten, points_awarded, multiplier_applied, new_streak, level, review: [{ question, your_answer, correct_index }] }` (auth required)

---

## Part 5 — Development workflow for this backend
1. Follow `AI_docs/git_instructions.md` (never commit to `main` without explicit permission; branch per feature).
2. Schema changes: propose here first; build only after user approval.
3. Every new endpoint gets the standard error shape and `try/catch` handler.
4. Mock-pool mode must keep the app bootable at all times.
