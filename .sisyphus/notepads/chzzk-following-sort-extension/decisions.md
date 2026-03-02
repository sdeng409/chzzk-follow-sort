# Decisions

## 2026-02-23 - Following List Source

- Decision: DOM-only for MVP.
- Rationale: CHZZK Open API docs list User/Channel/Category/Live/Chat endpoints, but no documented endpoint for "my followings list". Sorting the already-rendered following list avoids needing tokens/secrets.
- Implication: Content script runs on the CHZZK following page(s), extracts visible items, and reorders DOM nodes.

## 2026-02-23 - MVP Sort Modes

MVP includes these sort modes (deterministic):

1. Name (A-Z)
2. Name (Z-A)
3. Live first (if the page exposes live badge/state); tie-breaker: viewer count desc if present
4. Viewer count (desc) (only when available; otherwise falls back to Live first ordering)
5. Follower count (desc) (only if available on the page; otherwise omitted or disabled)

Tie-breakers (in order):

- Primary criterion
- Secondary criterion (if applicable)
- Stable final tie-breaker: original DOM order
