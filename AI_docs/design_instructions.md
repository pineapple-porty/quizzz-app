# Design Specs

> **READING PROTOCOL — READ THIS FIRST**
> Read ONLY this file. Do NOT read any other file in `AI_docs/` unless explicitly told to.

---

## 1. General Theme & Visual Direction

* **Style Reference:** Adobe.com marketing pages — bold, clean, modern, and playful.
* **Base Atmosphere:** Predominantly clean, light blue-ish white structure with sharp `#000000` elements and high contrast, punctuated by vivid artwork and deliberate accent colors.
* **Soft Points / Eye-Rest Areas:** Muted, desaturated zones placed between high-contrast sections to prevent visual fatigue. A soft point's background or ambient tint is dynamically derived from the dominant colors of the image or collection of images in that immediate section, creating a seamless visual transition where colors "meet in the middle."

---

## 2. Color System & Tokens

### Core Palette
| Role | Token Name | Hex / Value | Description |
| :--- | :--- | :--- | :--- |
| **Base Background** | `--color-bg-base` | `#F4F7FA` | Primary page background (blue-ish white). |
| **Hard Contrast / Text** | `--color-text-main` | `#000000` | Pure black for primary text, borders, and structural contrast. |
| **Surface White** | `--color-surface` | `#FFFFFF` | Clean white for elevated cards and inner containers. |

### Accent Palette
| Role | Token Name | Recommended Hex | Description |
| :--- | :--- | :--- | :--- |
| **Accent Dark Blue** | `--color-accent-blue` | `#0B2C6B` | Primary CTAs, key brand highlights, and focal elements. |
| **Accent Dark Red** | `--color-accent-red` | `#8B0000` | secondary CTAs, alert accents, and bold highlights. |
| **Accent Dark Green** | `--color-accent-green` | `#0A4D2E` | Success indicators, positive badges, and grounded accents. |

### Soft Point / Rest Area Rules
* **Tint Derivation:** Soft points utilize a low-saturation (10–20% opacity or desaturated tint) sampled from adjacent section media/artwork.
* **Boundary Rules:** No hard `#000000` borders inside soft point containers; soft points use gentle padding and low contrast to allow the eyes to rest.

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
* **Accent Buttons:** Dark blue (`#0B2C6B`), dark red (`#8B0000`), or dark green (`#0A4D2E`) background depending on context.
* **Hover States:** Crisp, instant state transitions with hard contrast or offset drop shadows.

### Cards & Content Containers
* **Standard Cards:** Clean surface white (`#FFFFFF`) background with a thin `#000000` border or high-contrast shadow.
* **Artwork Cards:** High-energy containers showcasing bright, vivid art assets against the neutral base background.
* **Soft Point Containers:** Borderless, desaturated background blocks derived from local image colors.

---

## 5. Responsiveness & Accessibility

* **Layout Strategy:** Mobile-first fluid grid. High-density design prioritizing screen space efficiency.
* **Contrast Thresholds:** All body text and primary interactive controls maintain strict WCAG AAA contrast against `--color-bg-base` (`#F4F7FA`) and `--color-surface` (`#FFFFFF`).
* **Motion:** Subtle, fast transitions (150ms–200ms ease). Respects `prefers-reduced-motion`.

---
