# chzzk-following-sort-extension

Goal: Build a Manifest V3 browser extension that lets a user sort their CHZZK “following channels” list in multiple ways.

Non-goals (MVP):

- No server/backend; client-only.
- No account management inside the extension (use the existing CHZZK login session in the browser).
- No attempt to bypass CHZZK access controls.

Assumptions (adjust if wrong):

- The CHZZK Open API does not provide an endpoint for “my followings list”; the extension will primarily sort what is already rendered on the CHZZK website.
- Optional enrichment (live status/viewers/follower count) may be added only if it can be done via documented Open API or data already present in the page.

## Work Plan (Checklist)

- [ ] Decide source-of-truth for the following list (DOM-only vs documented Open API): document findings and pick the simplest compliant approach.
  - Verify: notes added to `.sisyphus/notepads/chzzk-following-sort-extension/decisions.md`.

- [ ] Define the sort modes for MVP (at least 5) and tie-breaker rules.
  - Suggested modes: `name asc/desc`, `followed date asc/desc` (if visible), `is live first`, `viewer count desc` (if available), `follower count desc` (if available).
  - Verify: documented in `.sisyphus/notepads/chzzk-following-sort-extension/decisions.md`.

- [ ] Scaffold the extension repo (MV3) with TypeScript build pipeline.
  - Include: `manifest.json`, content script entry, minimal build to `dist/`, and `npm` scripts.
  - Verify: `npm run build` outputs a loadable `dist/`.

- [ ] Implement content script bootstrapping: detect CHZZK following page(s) and safely attach without breaking the site.
  - Verify: load unpacked extension; page has no console errors.

- [ ] Implement DOM extraction for the list items: reliably map each channel card/row to a structured object.
  - Verify: extraction returns the same number of items as visible in the UI.

- [ ] Implement sort engine (pure function) + unit tests for all sort modes.
  - Verify: `npm test` passes; tests cover tie-breakers and stable ordering expectations.

- [ ] Implement DOM re-ordering: apply sorted order back to the page without losing click handlers/navigation.
  - Verify: clicking a channel still opens the same channel after sorting.

- [ ] Add a small in-page UI control (dropdown/buttons) to pick sort mode.
  - Verify: changing sort mode updates ordering immediately.

- [ ] Persist user preference per sort mode using `chrome.storage.sync` (fallback to `local`).
  - Verify: refresh page; last selected sort mode is restored.

- [ ] Optional: add data enrichment if available (live status/viewer count) via either page data or documented CHZZK Open API.
  - Verify: no unauthorized endpoints; rate limits respected; failures degrade gracefully.

- [ ] Add lint/format/typecheck scripts and baseline configs.
  - Verify: `npm run lint`, `npm run format`, `npm run typecheck` succeed.

- [ ] Manual QA on CHZZK: test on at least two accounts (or two different following lists), and on a long list.
  - Verify: sorting is correct, UI is unobtrusive, and performance is acceptable.

- [ ] Write a short developer README: how to build and load unpacked extension.
  - Verify: a fresh clone can follow instructions to load and see it work.

## Definition of Done

- Extension loads as MV3 and runs only on intended CHZZK pages.
- At least 5 sort modes work and are deterministic (documented tie-breakers).
- Sorting does not break navigation/click behavior.
- User’s selected sort mode persists across reloads.
- No console errors on target pages during normal use.
- `npm run build` and `npm test` pass.
