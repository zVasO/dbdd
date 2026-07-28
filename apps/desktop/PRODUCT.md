# Product

## Register

product

## Users

Full-stack developers using PurrQL as their daily-driver database IDE. They live in the app for long sessions: writing and running SQL, browsing schemas, editing rows inline, managing multiple simultaneous connections (MySQL, PostgreSQL, SQLite). Context: a desktop (Tauri) app open all day next to their editor; they are keyboard-comfortable and speed-sensitive. Secondary flows include ER diagrams, visual query building, dashboards, migrations, and data import/export.

## Product Purpose

PurrQL is a native-performance database IDE built with Rust (Tauri) and React. It exists because most database tools are either bloated Electron apps or bare-bones CLIs; PurrQL sits in the sweet spot — tiny footprint, elegant UI, multi-database, secure by design (OS keyring, AES-GCM, SSH tunneling). Success looks like: queries and schema exploration feel instant, large result sets stream smoothly, and users trust it with production credentials.

## Brand Personality

Fast, warm, precise. Native-speed confidence carried by the warm terracotta-and-cream identity already in the tokens (Outfit + Geist Mono, terracotta primary). Friendly cat-brand touch without being cute — personality lives in small moments (naming, empty states), never in the way of the workflow. Voice: direct, technically fluent, calm under error conditions.

## Anti-references

- **Bloated Electron-app feel**: heavy chrome, sluggish interactions, oversized spacing that wastes data density.
- **Generic SaaS admin dashboard**: identical card grids, hero metrics, gradient accents; PurrQL screens are working surfaces, not marketing.
- **Sterile enterprise austerity** (raw DataGrip energy): dense to the point of joyless; PurrQL keeps warmth in its neutrals and type.
- **Mascot-driven cuteness**: the cat is a wink, not a theme; no illustrations interrupting data workflows.

## Design Principles

1. **Data is the interface** — grids, schemas, and results get the space and contrast; chrome recedes.
2. **Instant or honest** — interactions feel native-fast; when work takes time (streaming, migrations), show truthful progress, never fake spinners.
3. **Density with breathing room** — pro-tool information density, but rhythm and hierarchy keep it scannable over 8-hour sessions.
4. **Trustworthy with production data** — destructive and uncommitted-change states are unmistakable; safety affordances are first-class UI.
5. **Warmth in the details** — the terracotta/cream identity and small touches of voice differentiate without ever costing workflow speed.

## Accessibility & Inclusion

WCAG 2.1 AA: body text ≥4.5:1 contrast in both themes, visible focus indicators, full keyboard navigation of core flows (connect, query, grid editing), `prefers-reduced-motion` respected. Dark and light themes both first-class (system-scheduled switching is already supported).
