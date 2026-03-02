# Learnings

- 2026-02-23: Minimal MV3 scaffold works with an esbuild script that bundles `src/contentScript.ts` to `dist/contentScript.js` and explicitly copies `public/manifest.json` to `dist/manifest.json`.
- 2026-02-23: `content_scripts[].js` in `manifest.json` must exactly match the emitted filename (`contentScript.js`) for unpacked loading to succeed.
- 2026-02-23: For CHZZK SPA-like navigation, combining `MutationObserver` with `history.pushState`/`history.replaceState` hooks plus `popstate`/`hashchange` listeners gives reliable re-attach timing for content-script roots.
- 2026-02-23: A conservative `findFollowingListContainer()` heuristic works as a placeholder by requiring a follow-related route hint and a visible container with repeated direct children that contain links.
- 2026-02-23: Following-item extraction is most stable by mapping each `a[href]` to its top-level child under the detected list container, deduplicating those children, and then selecting a preferred channel/live anchor per child.
- 2026-02-23: Stable item keys can be derived defensively by preferring channel identifiers parsed from `/live/:id`, `/channel/:id`, or `channelId` query params, with fallback to normalized href and then index.
- 2026-02-23: DOM reordering should derive stable tie-breaker order from the container's direct-child positions (not extraction iteration order), then move existing child nodes via a single `DocumentFragment` append to preserve event handlers and avoid repeated writes.
- 2026-02-23: For SPA-safe in-page controls, mount UI under a stable extension root with explicit data-attributes and use `select.onchange` reassignment during re-attach so rerenders do not duplicate listeners or controls.
- 2026-02-23: Persisting sort mode in a content script is robust with a `chrome.storage.sync` -> `chrome.storage.local` -> in-memory fallback chain plus a one-time initial read guarded by a user-selection version check so late async reads never overwrite newer manual choices.
- 2026-02-23: Live watch-time capture stays lightweight by resolving a best-effort live `channelId` on route changes, accumulating elapsed time only while the tab is visible, and throttling `chrome.storage.local` writes to roughly one flush per 30 seconds with page-hide flush and in-memory fallback when storage APIs are unavailable.
- 2026-02-23: Recommended follow sorting can stay synchronous by ranking with an in-memory watch-stats snapshot, assigning score from `item.key` only when it resembles a channel id, and keeping unscored entries stable at the end via original-index tie-breaking.

2026-02-23: Fixed a bug where items with unresolvable channel IDs were assigned a watchScore of 0; they now return `undefined` to correctly categorize them as unscored, ensuring they follow scored items and maintain original DOM order.

- 2026-02-23: For flat ESLint in this repo, `typescript-eslint` type-aware presets should be scoped carefully; using non-type-aware `recommended` for baseline avoids parser-project errors on JS config files while still enforcing `no-explicit-any`/unused-vars in TS sources.
- 2026-02-23: Running `prettier . --write` formats repo metadata too (including `.sisyphus/*` and `dist/*`), so use `format:check` for verification and consider a `.prettierignore` if operational files must stay untouched.
