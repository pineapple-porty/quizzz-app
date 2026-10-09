# Design Specs

> **READING PROTOCOL — READ THIS FIRST**
> Read ONLY this file. Do NOT read any other file in `AI_docs/` unless explicitly told to.

---

## 1. General Theme & Visual Direction

* **Style Reference:** Adobe.com **marketing pages** — bold, clean, modern, playful.
* **Base Atmosphere:** Predominantly blue-ish white base (`#e6eefa`) with hard pure black (`#000000`) contrast, clean layout, strong typography. Vivid, bright artwork mixed in as deliberate contrast against the near-neutral structure.
* **Soft Points / Eye-Rest Areas:** Muted, calm areas where colors meet in the middle — but **each color keeps its own identity** (muted, not fully blended into gray). Rest areas keep the page from feeling aggressive.

---

## 2. Color System & Tokens

### Core Palette
| Role | Token Name | Hex / Value | Description |
| :--- | :--- | :--- | :--- |
| **Base Background** | `--color-bg-base` | `#e6eefa` | Primary page background (blue-ish white). |
| **Hard Contrast / Text** | `--color-text-main` | `#000000` | Pure black for primary text, borders, and structural contrast. |
| **Surface White** | `--color-surface` | `#FFFFFF` | Clean white for elevated cards and inner containers. |

### Accent Palette
| Role | Token Name | Base Hex | Description |
| :--- | :--- | :--- | :--- |
| **Accent Dark Blue** | `--color-accent-blue` | `#13489e` | Primary CTAs, key highlights, focal elements. |
| **Accent Dark Red** | `--color-accent-red` | `#9e1313` | Secondary CTAs, alert accents, bold highlights. |
| **Accent Dark Green** | `--color-accent-green` | `#159e13` | Success indicators, positive badges, grounded accents. |

### Adaptive Accent Rule

The three dark accents are **base values, not fixed ones**. They adapt to their surroundings:

* On/near **white or light areas** → the accent gets **brighter** (a lighter, more vivid variant of the base color).
* On/near **black** → the accent **stays the same, or brightens only slightly**.

**Procedure (for anyone implementing):**
1. When an accent is used in a new context, **ASK THE USER** what they want for this context.
2. **PROPOSE the brighter variant yourself** — present the specific hex you think the brighter version should be.
3. Once the user confirms a variant for that context, **NEVER ASK AGAIN** — the confirmed value is saved below and reused whenever that same context appears.

**Confirmed accent variants (append after user approval — never ask again for these):**

| Accent | Context | Confirmed Hex |
| :--- | :--- | :--- |
| *(none yet)* | | |

### Soft Point Rules

* **Character first:** a soft point's character is mainly based on **what the user has in mind**. Nearby image(s) are reference only — the user decides the feel.
* **Ask before choosing:** when designing a soft point, **ASK THE USER about its general feel** before picking colors. Do not guess from artwork alone.
* **Muted, not blended away:** soft points are muted, low-saturation colors that let the eye rest, but each color keeps its own identity (muted, not fully gray).
* **Boundary rules:** no hard `#000000` borders inside soft point containers; soft points use gentle padding and low contrast.

**Confirmed soft points (append after user approval — never ask again for these):**

| Location / Area | General Feel (user's words) | Confirmed Colors |
| :--- | :--- | :--- |
| *(none yet)* | | |

---

## 3. Typography

* **Font Family:** `DM Sans` (Google Font)
  * Single variable font loading for maximum performance and minimal payload size.
  * Compact geometric letterforms to maximize screen density and content visibility.
  * System Fallbacks: `system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`
* **Type Weights:**
  * **Regular (`400`):** Body text, descriptions, input fields.
  * **Medium / Semibold (`500`–`600`):** Subheadings, labels, table headers, secondary buttons.
  * **Bold (`700`):** Hero headlines, page titles, section headers.

---

## 4. Components & Layout Rules

### Buttons & Interactive Elements
* **Primary Buttons:** Pure black background (`#000000`), white text (`#FFFFFF`), bold weight, clean rectangular or subtle 4px rounded corners.
* **Accent Buttons:** Dark blue (`#13489e`), dark red (`#9e1313`), or dark green (`#159e13`) background depending on context — subject to the Adaptive Accent Rule above.
* **Hover States:** Crisp, instant state transitions with hard contrast or offset drop shadows.

### Cards & Content Containers
* **Standard Cards:** Clean surface white (`#FFFFFF`) background with a thin `#000000` border or high-contrast shadow.
* **Artwork Cards:** High-energy containers showcasing bright, vivid art assets against the neutral base background.
* **Soft Point Containers:** Borderless, muted background blocks whose colors follow the Soft Point Rules above.

---

## 5. Responsiveness & Accessibility

* **Layout Strategy:** Mobile-first fluid grid. High-density design prioritizing screen space efficiency.
* **Contrast Thresholds:** All body text and primary interactive controls maintain WCAG AA contrast (4.5:1) minimum against `#e6eefa` and `#FFFFFF`. (AAA 7:1 preferred where practical.)
* **Motion:** Subtle, fast transitions (150ms–200ms ease). Respects `prefers-reduced-motion`.
