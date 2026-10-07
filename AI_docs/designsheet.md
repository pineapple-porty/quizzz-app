# Design Sheet — Quizzz App

> **READ ME FIRST — READING PROTOCOL (for AI agents and humans)**
> You are reading this file to help build the quizzz-app website.
> This document is split into chapters. **Read ONLY the chapter you have been told to read.**
> Do NOT read any other chapter unless explicitly instructed to. If your task seems to require
> another chapter, stop and ask which one to read instead.
> Chapters are self-contained unless a "Dependencies" line at the top of the chapter says otherwise.
> Locate your chapter in the table of contents below (line numbers refer to this exact revision).

**Repo:** pineapple-porty/quizzz-app · **Branch:** `design` · **Status:** Draft v0.3

**How to work from this file (AI agents):**
1. Confirm which chapter(s) you are assigned; do not read ahead.
2. Line numbers in the TOC are exact for this revision. If the file has been edited since the last commit, locate chapters by their `## Chapter N — Title` heading instead.
3. When you finish work based on a chapter, report what you implemented and which chapter you followed.
4. If a spec detail is missing or ambiguous, ask — do not guess and do not read other chapters to infer it.

---

## Table of Contents

1. Chapter 1 — Overview — starts at line 26
2. Chapter 2 — Goals & Non-Goals — starts at line 40
3. Chapter 3 — Pages & Routes — starts at line 56
4. Chapter 4 — Design System — starts at line 82
5. Chapter 5 — Data Model & API — starts at line 126
6. Chapter 6 — Accessibility — starts at line 152
7. Chapter 7 — Responsiveness — starts at line 162
8. Chapter 8 — Open Questions — starts at line 170
9. Chapter 9 — Changelog — starts at line 179

## Chapter 1 — Overview

*Self-contained: no dependencies on other chapters.*

Quizzz App is a web-based quiz application. Users can take quizzes, answer multiple-choice questions, and see their results at the end.

**Stack (current repo):**
- Node.js + Express (`server.js`)
- Data layer in `src/db.js`
- Static frontend served from `public/`
- Deployed on Replit (see `.replit`, `replit.md`)

**What this document is:** the authoritative spec for how this site is designed and built. It is organized into numbered chapters so a reader (human or AI agent) can read exactly one chapter without needing the rest.

---

## Chapter 2 — Goals & Non-Goals

*Self-contained: no dependencies on other chapters.*

**Goals:**
- Simple, fast, mobile-friendly quiz experience
- Clear question flow with instant feedback
- Score summary at the end
- Easy to add/edit quizzes

**Non-goals (for now):**
- User accounts / authentication
- Multiplayer or real-time play
- Leaderboards (candidate for later)

**Definition of done for the project:** a user can open the home page, pick a quiz, answer every question, and see a final score screen that is correct and readable on mobile.

---

## Chapter 3 — Pages & Routes

*Dependencies: visual styles come from Chapter 4 (Design System); screen widths from Chapter 7 (Responsiveness).*

| Route | Page | Purpose |
|---|---|---|
| `/` | Home | Quiz list, app title, start a quiz |
| `/quiz/:id` | Quiz | Question flow, one question at a time |
| `/quiz/:id/results` | Results | Final score, review of answers |

**3.1 Home**
- List of available quizzes (title, description, question count, difficulty)
- Card-based layout, clickable to start

**3.2 Quiz**
- Shows one question at a time with 2–4 answer options
- Click an answer → highlight, then advance (or show "Next" button)
- Progress indicator ("Question 3 of 10") and/or progress bar
- Optional timer per question

**3.3 Results**
- Final score (e.g., 7/10) and percentage
- Pass/fail or grade band
- Review list: each question with the user's answer and the correct answer

Data for these screens is provided by the API in Chapter 5 (Data Model & API).

---

## Chapter 4 — Design System

*Dependencies: used by every page in Chapter 3 (Pages & Routes).*

**4.1 Colors (suggested palette)**

| Token | Value | Usage |
|---|---|---|
| `--bg` | `#0f172a` | Page background (dark theme) |
| `--surface` | `#1e293b` | Cards, question panel |
| `--accent` | `#6366f1` | Buttons, highlights, active option |
| `--accent-hover` | `#4f46e5` | Button hover state |
| `--success` | `#22c55e` | Correct answer |
| `--error` | `#ef4444` | Wrong answer |
| `--text` | `#f1f5f9` | Primary text |
| `--muted` | `#94a3b8` | Secondary text |

**4.2 Typography**
- Font: system stack or Google Font (candidate: **Inter**)
- Scale: 16px base; headings 28/22px; body 16px; captions 13px

**4.3 Layout**
- Max content width: 720px, centered
- Single-column, mobile-first
- Cards: 16px radius, 1px border `rgba(255,255,255,0.1)`, subtle shadow

**4.4 Components**
- **Button** — primary (accent), secondary (outline), disabled state
- **Option card** — answer choice; states: default, hover, selected, correct, wrong
- **Progress bar** — thin bar under header
- **Badge** — difficulty (easy/medium/hard)
- **Toast** — transient messages (optional)

**4.5 Motion**
- 150–250ms transitions; page/question fade or slide
- Respect `prefers-reduced-motion`

---

## Chapter 5 — Data Model & API

*Dependencies: consumed by the pages in Chapter 3 (Pages & Routes).*

```js
quiz = {
  id: string,
  title: string,
  description: string,
  difficulty: "easy" | "medium" | "hard",
  questions: [
    {
      id: string,
      text: string,
      options: string[],   // 2–4 entries
      correctIndex: number,
      explanation?: string
    }
  ]
}
```

**API (draft):**
- `GET /api/quizzes` — list quizzes (no questions)
- `GET /api/quizzes/:id` — full quiz
- `POST /api/quizzes/:id/submit` — submit answers, receive score + correct answers

**Storage:** currently in-memory via `src/db.js`. Final choice pending (see Chapter 8, Open Questions).

---

## Chapter 6 — Accessibility

*Dependencies: applies to components defined in Chapter 4 (Design System) and pages in Chapter 3.*

- Semantic HTML (`main`, `nav`, buttons for options)
- Keyboard navigable answers (arrow keys / number keys)
- Visible focus states
- Contrast ≥ 4.5:1 for text
- ARIA live region for score/feedback announcements

---

## Chapter 7 — Responsiveness

*Dependencies: applies to the layout rules in Chapter 4 (Design System).*

- Mobile-first; works 320px → 1440px+
- Touch targets ≥ 44px
- Options stack vertically on mobile; may go 2-col grid ≥ 640px

---

## Chapter 8 — Open Questions

*Self-contained: decisions made here update other chapters via the Changelog (Chapter 9).*

- [ ] Dark theme only, or light/dark toggle?
- [ ] Instant feedback per question vs. results-only at the end?
- [ ] Timer: yes/no, and per-question or per-quiz?
- [ ] Should quizzes be stored in `src/db.js` (in-memory) or a real DB / JSON files?
- [ ] Shuffle question order per session?

---

## Chapter 9 — Changelog

*Self-contained: log every change to this document here.*

| Date | Change |
|---|---|
| 2026-10-07 | Moved to `AI_docs/`; now indexed from `AGENTS.md` |
| 2026-10-07 | Optimized for AI readers: chapter self-containment notes, explicit cross-references, AI work protocol |
| 2026-10-07 | Restructured: TOC with line numbers + reading protocol notice |
| 2026-10-07 | Initial draft created on `design` branch |
