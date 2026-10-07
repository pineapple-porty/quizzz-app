# AGENTS.md — READ THIS FIRST

> ## ⚠️ MANDATORY READING PROTOCOL — APPLIES TO AI AGENTS AND HUMANS
>
> **You will NOT read more than you are told to read.**
>
> 1. This is the ONLY file you may read freely. Read it fully before editing anything in this repository.
> 2. All other documentation lives in the `AI_docs/` folder, listed in the index below.
> 3. **Do NOT open any file in `AI_docs/` unless you have been explicitly told to read that exact file.**
> 4. Do NOT read files "just to get context." If your task seems to require a file you were not assigned, **STOP and ask which file to read instead.**
> 5. Each doc in `AI_docs/` is an independent, self-contained file. If it depends on another doc, it says so explicitly inside the file.
> 6. When you finish, report which files you read.

---

## What this repository is

**Quizzz App** — a web-based quiz application. Node.js + Express backend (`server.js`), data layer in `src/db.js`, static frontend in `public/`, hosted on Replit.

## Documentation index — `AI_docs/`

The design spec is split into one file per topic. Most files are currently **stubs** (empty, awaiting content) — their purpose is listed so you know what a file will cover *before* you are told to read it.

| File | Title | Purpose |
|---|---|---
| `01-overview.md` | Chapter 1 — Overview | What the Quizzz App is, the current tech stack, and what these docs are for. |
| `02-goals-non-goals.md` | Chapter 2 — Goals & Non-Goals | What the project must achieve, what is explicitly out of scope, and the definition of done. |
| `03-pages-routes.md` | Chapter 3 — Pages & Routes | Every page of the site (Home, Quiz, Results), its URL route, and its required behavior. |
| `04-design-system.md` | Chapter 4 — Design System | Colors, typography, layout, UI components, and motion rules used across the whole site. |
| `05-data-model-api.md` | Chapter 5 — Data Model & API | The shape of quiz/question data and the backend endpoints that serve and score it. |
| `06-accessibility.md` | Chapter 6 — Accessibility | Keyboard navigation, focus states, contrast, and ARIA requirements the site must meet. |
| `07-responsiveness.md` | Chapter 7 — Responsiveness | Supported screen widths, mobile-first rules, touch targets, and breakpoints. |
| `08-open-questions.md` | Chapter 8 — Open Questions | Unresolved design decisions that are still pending. Answers here update other chapters. |
| `09-changelog.md` | Chapter 9 — Changelog | Log of every change made to any doc in AI_docs/, with dates. |

*(When new documents are added to `AI_docs/`, add a row here with a one-line description. Never edit this table without also keeping it accurate.)*

## Rules of engagement

- Read this file → get assigned a doc → read ONLY that doc → do the work → report what you read.
- Never guess a spec detail: ask.
- Spec changes go through the doc owner: update the relevant `AI_docs/` file and log it in `AI_docs/09-changelog.md`.
- Stub files: do not write content into a stub unless explicitly instructed.
