# Kayci Sonoran — Design Documentation

A visual/UX system reference for the Kayci Cactus booking website.

- Public site: `public/index.html`
- Admin portal: `public/admin.html`

Open questions / next steps are at the bottom.

---

## 1. Brand & Positioning

**Theme:** Luxury Sonoran Desert wellness.

The public site reads as an upscale spa brand rooted in the Arizona southwest. Copy leans on
desert imagery (river stones, sage, botanicals) and location-specific service names
(Desert Stone Massage, Sonoran Deep Tissue, Monsoon Recovery, Palo Santo Energy Ritual).

Two distinct voices are deliberately used:

| Surface | Feel |
|---------|------|
| Public site | Calm, editorial, warm, square-edged "spa" aesthetic |
| Admin portal | Crisp, modern SaaS tool (rounded, navy, badge colors) |

---

## 2. Public Site Design System

Source of truth: the `:root` custom properties in `public/index.html`.

### 2.1 Color palette

| Token | Hex | Role |
|-------|-----|------|
| `--primary` | `#d4846a` | Terracotta — CTAs, accents, prices, focus rings |
| `--primary-dark` | `#b5644a` | Primary hover |
| `--secondary` | `#e8b4a0` | Hero headline emphasis |
| `--accent` | `#9a563a` | Tertiary accent (currently unused) |
| `--gold` | `#d4a574` | Stars, secondary hover accents, waitlist accents |
| `--sage` | `#7a926e` | Success / "done" state |
| `--text` | `#555555` | Body copy |
| `--text-dark` | `#2d2418` | Headings, dark-on-light text |
| `--bg` | `#fdf8f4` | Page background (warm off-white) |
| `--bg-warm` | `#f9efe8` | Alt section background (About) |
| `--bg-deep` | `#1a1410` | Footer / modal overlay |
| `--bg-card` | `#ffffff` | Cards |
| `--border` | `#e8ddd0` | Dividers, inputs |

The accent (`--primary` / `--primary-dark`) is user-overridable from the admin portal
(see §6), so the palette is meant to be skin-agnostic while the neutrals stay fixed.

### 2.2 Typography

| Usage | Family | Weights |
|-------|--------|---------|
| Headings, prices, labels | **Marcellus** (serif) | 400 (with 700 via faux-bold on buttons) |
| Body, nav, UI | **DM Sans** (sans) | 400 / 500 / 700 |

Loaded from Google Fonts. Headings use `clamp()` for fluid sizing (e.g. hero `clamp(2.5rem, 6vw, 4.5rem)`).

### 2.3 Shape & elevation

- **Radius: `0px`** everywhere on the public-facing components — deliberate squared corners.
  (Exception: `.dur-opt` duration chips use `border-radius: 10px`.)
- Warm brown-tinted shadows:
  - `--shadow: 0 2px 20px rgba(45,36,24,0.06)`
  - `--shadow-lg: 0 8px 40px rgba(45,36,24,0.12)`
- `--transition: 0.35s ease`; `--max-width: 1140px`.

### 2.4 Spacing & rhythm

- Sections: `6rem` vertical padding (drops to `4rem` on mobile).
- Standard gaps: `1rem` (buttons), `2rem` (grids), `2.5rem` (nav links), `4rem` (margins).
- Cards use `1.5rem`–`2rem` internal padding.

---

## 3. Layout Structure (public)

1. **Nav** — fixed, frosted glass (`rgba(253,248,244,0.95)` + `backdrop-filter: blur(20px)`).
   Logo "Kayci**.** Sonoran" with terracotta dot; right-aligned links + `Book Appointment` CTA.
   Gains `box-shadow` on scroll > 20px.
2. **Hero** — 100vh; dark desert gradient (`#2a1a10 → #5a3a28`) with a radial terracotta glow.
   Contains animated SVG cacti, tagline, headline, subtext, dual CTAs, and a 3-stat strip.
3. **Services** — heading + responsive card grid of services loaded from the API.
4. **About** — warm background; two-column (text vs. feature list with dot bullets).
5. **Reviews** — three testimonial cards.
6. **CTA banner** — terracotta gradient, white button.
7. **Footer** — deep brown; brand, nav links, de-emphasized Admin Portal link.

---

## 4. Hero Cactus Decorations

Hand-built inline SVG (no image assets) with:
- Linear/radial gradients for depth (`#1a3a1e → #4d7a4d` greens).
- Ribs (vertical ridge lines), areoles (spine cluster dots), radiating spines.
- Flower buds / crowns in terracotta-orange gradients.

Cacti: large saguaros (left/right), a barrel cactus (far left), and a prickly pear (far right),
plus a subtle `sway` rotation keyframe (`transform-origin: bottom center`).

Appearance coordinates: `opacity` 0.25–0.7, positioned via absolute offsets; smaller cacti hide
on mobile; all animations disabled under `prefers-reduced-motion`.

---

## 5. Components & States

### Booking modal (3-step wizard)
- Step dots: `active` (terracotta) / `done` (sage) / idle (border).
- Step transitions use `fadeIn` (opacity + `translateX`).
- Duration picker chips: 60 / 90 / 120 min → `$120 / $160 / $200` (same tiers for all services).
- Time slots: 3-col grid; states = idle, hover (gold border), selected (solid terracotta),
  disabled (faded + strikethrough).
- Summary panel on warm background; success icon is a sage gradient circle with a check.

### Waitlist flow
Reached when a date is closed/full; separate form (name, email, phone, service, notes) with its
own gold-accented success state.

### Cards
- **Service card:** image (bg cover), name, description, `duration` + `from $price`,
  book button. Hover = lift (−6px) + image zoom + a terracotta top-line `scaleX` reveal.
- **Testimonial card:** gold stars, serif quote, gradient-initial avatar circle.

### Buttons (3 tiers)
- Primary (solid terracotta): hero CTA, nav CTA, modal "next/confirm".
- Ghost (transparent + white/terracotta border): hero secondary, "back".
- Dark (text-dark): service card "Book Online".

### Booking — Date & Time Selection (Step 2)
Google Calendar is the source of truth; the UI reflects live availability via
`/api/slots/{date}?serviceId&durationMin`.

**Date picker** — native `<input type="date">`, `2px solid var(--border)` w/ terracotta focus
ring. Defaults to tomorrow, `min` = today. A helper line under it explains that busy times are
hidden and closed days can join the waitlist.

**Time slots** — 3-column grid of `.time-slot` buttons. States:
- idle (`--bg` + `--border`)
- hover (gold border)
- selected (solid terracotta fill, white text)
- disabled (40% opacity + strikethrough)

**Empty-state messaging** (each replaces the grid and reveals the waitlist prompt):
- `closed` → "The studio is closed this day…"
- `openHours` present but none available → "All open slots for this date are booked."
- otherwise → "No open hours set for this date yet."

**Waitlist prompt** — gold-tinted panel (`rgba(212,165,116,…)` bg + border) with a
"Join Waitlist →" CTA that swaps in the waitlist form and pre-fills the selected service/date.

---

## 6. Dynamic Branding

`applySiteSettings()` in `index.html` fetches `/api/site-settings` and live-updates:
- `--primary` / `--primary-dark` (accent colors)
- Business name + page `<title>`
- Hero tag/title/subtitle, services heading/sub, about label/heading/text, CTA heading/text,
  footer line.

Headline convention: `"First line|Second line"` renders the second line wrapped in `<em>`
(highlighted color). About text: blank line = new paragraph. All user text is HTML-escaped.

Content + services live in DynamoDB, so edits apply instantly with no redeploy.

---

## 7. Responsive & Accessibility

- Single breakpoint `@media (max-width: 768px)`:
  - Nav links hidden; grids collapse to 1 column; time slots 2-col.
  - Padding reduces `6rem → 4rem`.
- `clamp()` fluid type, `overflow-x: hidden`, no horizontal scroll.
- `prefers-reduced-motion` quashes all animations/transitions.
- **Gaps to note:** the wizard has no `aria-current`/`role="dialog"`-level semantics, no focus
  trapping, and interactions rely on inline `onclick`. Icon emojis (`🪨🌿…`) lack text labels.

---

## 8. Admin Portal Design (contrasting system)

Separate token set + fonts to signal "tool, not customer page".

| Token | Hex | Role |
|-------|-----|------|
| `--terracotta` | `#c95d3c` | Primary actions / active tab |
| `--terracotta-light` | `#e07856` | Primary hover |
| `--sage` | `#7a926e` | Confirm / success |
| `--gold` | `#d4a574` | Waiting state / brand |
| `--navy` | `#1a1f2e` | Header, login backdrop |
| `--danger` | `#d4594a` | Cancel / decline |
| `--warning` | `#d4a017` | Pending |
| `--success` | `#5d8a52` | Confirmed |

Fonts: **Outfit** (UI) + **Fraunces** (headings). Rounded `14px` radius (login card 20px).

### Views
- **Login** — centered card on navy gradient; password only (prototype: `saguaro2024`).
- **Appointments** — 4 stat cards, filter pills, appointment cards with status badges + action buttons.
- **Calendar** — Google Calendar connection status, Block Time, Full Day Off, upcoming events.
- **Waitlist** — stat cards, filters, cards with "Confirm & Assign Time" / "Decline".
- **Services** — add/edit/reorder/hide/delete services, image upload to S3.
- **Website** — edit all public copy + accent colors; save/reset/view-live.

### Calendar & Availability Management (Admin "Calendar" tab)

Google Calendar is the source of truth for hours and appointments, so the Calendar tab is a
read/control surface rather than a slot grid. It's composed of stacked `avail-section` cards.

**1. Google Calendar — connection status panel**
- Sand background (`#f6efe6`) pill at the top.
- Two visual states:
  - **Connected** — bold "Connected" + `(mode) · timezone`, a compact week-hours line
    (`Sun 12–4 · Mon 9–6 · …`), and buffer info ("Buffer 15 min after each session.").
  - **Not connected / error** — terracotta or muted message. An outdated-deployment state
    shows the API error inline and instructs uploading the latest `lambda.zip`.
- "Open Google Calendar" action button (terracotta, `avail-save-btn` style).

**2. Block Time**
- Purpose: create a busy event so a window can't be booked (lunch, early close, etc.).
- Form: Date + Start + End time inputs laid out on one row (`avail-date-row`), optional
  "Reason" text field, and a "Block on Google Calendar" save button.
- Inputs share the admin field style (2px border, 10px radius, terracotta focus).

**3. Mark Day Off** (visually elevated)
- Section topped with a `2px` terracotta rule and terracotta heading to distinguish it.
- Date input plus a live hours **preview** that auto-fills from working hours
  (`getWorkingHoursForDate`) — shows `09:00 – 18:00` in sage if open, or
  "Closed day — already off!" in muted text.
- "Mark Full Day Off" uses the terracotta accent and fires a `confirm()` before creating the
  all-day block.

**4. Upcoming on Google Calendar**
- `avail-date-card` rows: bold `date · time` on the left with service/name subtitle, and an
  "Open" link (styled as `avail-date-card-remove`, right-aligned) to `event.htmlLink`.

**Note — legacy manual availability:** `admin.html` still contains now-orphaned JS
(`saveAvailability`, `saveBulkAvailability`, `toggleSlot`, `loadExistingAvailability`, …) that
reference slot-grid DOM (`#avail-slots`, `#avail-bulk-slots`, `#avail-date`) no longer present
in the Calendar tab HTML. The Google-Calendar-driven flow *replaced* the old manual
per-date slot manager; those functions are dead code and safe to clean up.

Components: filter pills (`border-radius: 100px`), status badges (pastel bg + colored text),
toast notifications (bottom-right), confirm modal for waitlist assignment.

---

## 9. Notes & Recommendations

1. **Two design tokens, one brand** — public site uses `--primary/#d4846a` while admin uses
   `--terracotta/#c95d3c`. They're close but not identical; worth unifying if "one brand" matters.
2. **`--radius: 0px`** is a bold choice that works for the spa/editorial feel — keep it consistent;
   the admin's rounded cards and the duration chips are intentional exceptions.
3. **Accessibility pass** — add dialog ARIA, focus trap, and labeled icon buttons to the booking wizard.
4. **Accessibility/color** — gold-on-white text (`--gold` stars on white, gold text in waitlist)
   is low contrast for text; fine for decorative stars, but avoid for body copy.
5. **Motion** — cactus sway at 6–9s is tasteful but consider capping under a
   `prefers-reduced-motion` check (already present) and keeping duration long.