# Design Sheet — Quizzz App

> Working design spec for the quizzz-app project. This document is the source of truth for how the website is built and evolved. Update it as decisions change.

**Repo:** pineapple-porty/quizzz-app
**Branch:** `design`
**Status:** Draft v0.1

---

## 1. Overview

Quizzz App is a web-based quiz application. Users can take quizzes, answer multiple-choice questions, and see their results at the end.

**Stack (current repo):**
- Node.js + Express (`server.js`)
- Data layer in `src/db.js`
- Static frontend served from `public/`
- Deployed on Replit (see `.replit`, `replit.md`)

---

## 2. Goals

- Simple, fast, mobile-friendly quiz experience
- Clear question flow with instant feedback
- Score summary at the end
- Easy to add/edit quizzes

## 3. Non-goals (for now)

- User accounts / authentication
- Multiplayer or real-time play
- Leaderboards (candidate for later)

---

## 4. Pages & Routes

| Route | Page | Purpose |
|---|---|---|
| `/` | Home | Quiz list, app title, start a quiz |
| `/quiz/:id` | Quiz | Question flow, one question at a time |
| `/quiz/:id/results` | Results | Final score, review of answers |

### 4.1 Home
- List of available quizzes (title, description, question count, difficulty)
- Card-based layout, clickable to start

### 4.2 Quiz
- Shows one question at a time with 2–4 answer options
- Click an answer → highlight, then advance (or show "Next" button)
- Progress indicator ("Question 3 of 10") and/or progress bar
- Optional timer per question

### 4.3 Results
- Final score (e.g., 7/10) and percentage
- Pass/fail or grade band
- Review list: each question with the user's answer and the correct answer

---

## 5. Design System

### 5.1 Colors (suggested palette)
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

### 5.2 Typography
- Font: system stack or Google Font (candidate: **Inter**)
- Scale: 16px base; headings 28/22px; body 16px; captions 13px

### 5.3 Layout
- Max content width: 720px, centered
- Single-column, mobile-first
- Cards: 16px radius, 1px border `rgba(255,255,255,0.1)`, subtle shadow

### 5.4 Components
- **Button** — primary (accent), secondary (outline), disabled state
- **Option card** — answer choice; states: default, hover, selected, correct, wrong
- **Progress bar** — thin bar under header
- **Badge** — difficulty (easy/medium/hard)
- **Toast** — transient messages (optional)

### 5.5 Motion
- 150–250ms transitions; page/question fade or slide
- Respect `prefers-reduced-motion`

---

## 6. Data Model (draft)

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
      options: string[],
      correctIndex: number,
      explanation?: string
    }
  ]
}
```

**API (draft):**
- `GET /api/quizzes` — list quizzes
- `GET /api/quizzes/:id` — full quiz (answers omitted until submission, or trusted client for now)
- `POST /api/quizzes/:id/submit` — submit answers, receive score + correct answers

---

## 7. Accessibility

- Semantic HTML (`main`, `nav`, buttons for options)
- Keyboard navigable answers (arrow keys / number keys)
- Visible focus states
- Contrast ≥ 4.5:1 for text
- ARIA live region for score/feedback announcements

---

## 8. Responsiveness

- Mobile-first; works 320px → 1440px+
- Touch targets ≥ 44px
- Options stack vertically on mobile; may go 2-col grid ≥ 640px

---

## 9. Open Questions

- [ ] Dark theme only, or light/dark toggle?
- [ ] Instant feedback per question vs. results-only at the end?
- [ ] Timer: yes/no, and per-question or per-quiz?
- [ ] Should quizzes be stored in `src/db.js` (in-memory) or a real DB / JSON files?
- [ ] Shuffle question order per session?

---

## 10. Changelog

| Date | Change |
|---|---|
| 2026-10-07 | Initial draft created on `design` branch |
