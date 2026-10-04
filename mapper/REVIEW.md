Implementation status — 8 September 2026

All 18 findings below have been addressed in the working tree. The original review is retained below as historical context; its line numbers describe the pre-fix code.

- Marker updates preserve omitted fields and retained trip positions. Marker writes are transactional, including batches with per-row outcomes. Backup and portable export use a shared marker field list.
- Session versions invalidate old cookies on password changes and resets. A database guard and guarded setup insert prevent multiple concurrent setups.
- A recorded transactional migration recovers legacy trips (including conflicting old/new IDs), retires old tables, and treats existing category junction tables as authoritative.
- Backup version 2 preserves coordinate-link preferences, validates data before restore, and restores person addresses and route waypoints. Restore refreshes all affected stores and clears filters, cached share links and route state.
- Portable export version 4 supports structured person names; older name-only imports remain supported. CSV and JSON preserve country/provenance and report relationship failures. Batches contain at most 100 markers; rate-limit waits can be cancelled by closing the import dialog.
- Map teardown cancels pending work, tooltips use text nodes, search discards stale responses, and marker saves own their asynchronous error state. Public sharing has retryable failures and reloads on token changes.
- Trip modes and order save together. Excluded stops are skipped when deriving editable segments; invalid final positions and endpoints are rejected atomically.
- Shared API, marker, date, settings, tile and color helpers reduce duplication. Group counts are precomputed, marker rendering skips unchanged objects, and the table is paginated at 100 rows.
- Public sharing uses an explicit response projection and documents that selected markers include their associated group/person names; person address references are excluded.
- Operational docs use port 3063, describe consistent SQLite backups and upgrade behavior, and provide a Windows-compatible reset command. Docker copies the new shared modules into both stages.
- Added ESLint, regression tests and a production HTTP smoke script. Updated affected dependencies, including Vite 7 and its Vue plugin; the Express query-parser override selects a patched release.

Validation: 23 regression tests pass; lint and the production build pass; the production HTTP smoke test verifies static assets, CSP, secure auth cookies, protected API access and JSON 404 responses. Root, API and client npm audits report no vulnerabilities. Tests use in-memory databases. No production database was opened or migrated, and nothing was deployed.

Limitations: browser discovery returned no connected browsers, so visual/mobile acceptance testing could not run. Leaflet is stubbed in component lifecycle tests; external geocoding/routing services and Docker itself have not been exercised. Legacy migrations were checked with synthetic fixtures rather than a historical production backup. The first real startup applies the migration and invalidates existing login cookies; sign in again afterward.

The Vite tooling upgrade was checked against the [official migration guidance](https://v7.vite.dev/guide/migration).

---

Senior developer review — 8 September 2026

The app builds successfully, but several normal editing and recovery flows can silently lose data. Fix persistence contracts, restore behavior, and session invalidation before undertaking a broader refactor.

This review covers the current working tree, including the existing edits in `api/index.js`, `client/vite.config.js`, `MarkerModal.vue`, and `useLocationPanel.js`. No application source was changed. The existing database and environment secrets were not read or modified.

Validation: `npm.cmd --prefix client run build` passed. A temporary Node harness reproduced 15 behaviors using the actual API routers against in-memory SQLite, actual Pinia stores/composables, Vue's renderer, and an extracted map cleanup callback. API requests used a temporary loopback server. Migration checks used synthetic legacy fixtures. This was a source and targeted runtime review, not a full browser, mobile, Docker, or external-service acceptance test. No test or lint scripts currently exist in the packages.

P1 means a high-priority data-integrity or access-control problem. P2 means a functional defect to address next. Items explicitly marked “source-verified�? were traced in code rather than exercised end-to-end.

**1. P1 — Ordinary marker edits erase unrelated data. Reproduced.**

Locations: [API update](api/routes/markers.js), lines 136–163; [marker modal](client/src/components/MarkerModal.vue), lines 411–434 and 599–645; [table editor](client/src/components/MarkerTableModal.vue), lines 295–315.

The API converts omitted scalar fields to null and replaces collection links using null positions when `collection_positions` is omitted. The modal does not submit country, planned date, rating, or external URL. The table does not submit country or collection positions.

Reproduction: create a marker with country, rating, planned date, external URL, and trip stop #1. Edit its label in the table: country and stop position disappear. Save it through the modal: planned date, rating, and external URL disappear too. Image-only saves use the same incomplete modal form and have the same problem.

Fix: define a consistent update contract. Prefer PATCH semantics that distinguish omitted fields from explicit null, preserve retained collection positions, and share one serialization layer between editors. Add regression checks proving that changing one field preserves every other field.

**2. P1 — Failed marker writes can still change the database. Reproduced.**

Location: [marker routes](api/routes/markers.js), lines 109–127 and 149–168.

Marker and relationship writes are separate autocommitted statements. An invalid/deleted category ID causes a foreign-key error after the marker has already been inserted or updated. Updates can also delete existing associations before replacement fails.

Reproduction: POST a valid coordinate with a nonexistent category ID. The response is 500, but the marker count increases. Retrying can create duplicates. Stale IDs after restore make this reachable through the UI too.

Fix: validate related IDs and wrap each complete marker mutation in a transaction. Return a useful 400/409 response for invalid associations and roll back all writes on failure.

**3. P1 — Password changes/resets do not revoke existing sessions. Reset behavior reproduced; password-change path source-verified.**

Locations: [auth middleware](api/middleware/auth.js), line 8; [password change](api/routes/auth.js), lines 81–83; [reset](api/index.js), lines 20–22.

Authorization only verifies the JWT signature and expiry. It does not check whether the user still exists or whether the session predates a password change. Deleting every user, as RESET_PASSWORD does, leaves an old signed cookie able to read markers. Password changes similarly leave previously issued seven-day tokens valid.

Fix: use revocable server-side sessions or a checked session generation/version. Reset and password change must invalidate old credentials. Checking user existence alone is insufficient if setup reuses the same user ID.

**4. P1 — Legacy trip migration leaves old trips invisible. Reproduced with a synthetic legacy database.**

Location: [database initialization](api/db.js), lines 28–45 and 93–95.

Initialization creates `collections` and `marker_collections` before trying to rename `trips` and `marker_trips` to those names. Both renames then fail because the destination tables exist. Startup continues with empty new tables, while old trip data remains stranded in the legacy tables.

Fix: introduce ordered, versioned migrations. Detect and migrate the old schema before creating conflicting tables. Validate against a real historical backup before deploying an upgrade. This finding only applies to databases that still have the legacy tables.

**5. P2 — Removed legacy categories return after a restart. Reproduced.**

Location: [category migration](api/db.js), lines 121–124; [marker updates](api/routes/markers.js), lines 153–156.

Every startup copies `markers.category_id` into `marker_categories`. Current edits only change the junction table and leave the legacy column intact. Removing a migrated category therefore works until the next restart, when it is inserted again.

Fix: perform the conversion once under a schema version, then retire or clear the legacy column. This applies to older markers with a populated `category_id`.

**6. P2 — Restore leaves most client data stale. Reproduced.**

Locations: [restore composable](client/src/composables/useImportExport.js), line 163; [restore API](api/routes/backup.js), lines 70–100.

Restore deletes and recreates categories, collections, and persons with remapped IDs, but the client refreshes only markers. Selectors and filters still refer to old IDs until a reload. Saving from these selectors can hit the partial-write problem above. Share links are also deleted by restore.

Fix: reload all affected stores, clear obsolete filters, and invalidate route/undo state after restore. Refresh or clear the share-link store as well.

**7. P2 — Backup does not preserve the coordinate-link preference. Reproduced.**

Location: [backup API](api/routes/backup.js), lines 12 and 107–120.

`use_coords` is missing from both backup export and restore insertion. A backup/restore round-trip changes it from 1 to its default of 0, changing how Google Maps links are generated. Portable marker export also omits it.

Fix: include the field and add a schema version plus a full-field round-trip check. Separately, backup excludes share links and restore deletes them: make that behavior explicit in the UI, or deliberately support restoring them if that is the intended product behavior.

**8. P2 — JSON import silently loses new persons. Reproduced.**

Locations: [JSON import](client/src/composables/useImportExport.js), line 275; [person creation](api/routes/persons.js), lines 33–36.

The importer sends `{ name }`; the person API requires `first_name`. Creation returns 400, the importer swallows the error, and the marker imports without that person. The success counter still counts the marker as successfully imported.

Fix: version the portable person format, map older name-only entries to a supported payload, and report relationship failures. Avoid guessing first/last-name splits without an explicit rule.

**9. P2 — CSV import discards data it just geocoded. Reproduced.**

Location: [CSV import](client/src/composables/useImportExport.js), lines 448–452.

The preview includes country, but the save payload omits it. Imported markers also omit source and are classified as `manual` by the API. JSON import similarly omits the exported source.

Fix: carry country through CSV saving and define consistent provenance handling for CSV and JSON. This also prevents unnecessary country lookups in statistics.

**10. P2 — Leaving the map throws before cleanup completes. Reproduced.**

Location: [map lifecycle](client/src/views/MapView.vue), lines 532 and 554–560.

`clickTimer` is declared inside the mounted callback but referenced in an outer unmount callback. That callback throws `ReferenceError: clickTimer is not defined`, skipping map removal, route cleanup, keyboard-listener removal, and search cleanup.

Fix: move the timer to component scope and make disposal cover pending routing/location requests too. Exercise login → map → logout → map navigation as a lifecycle regression check.

**11. P2 — Save errors cannot reach the marker modal's catch block. Vue behavior reproduced.**

Locations: [modal save/delete](client/src/components/MarkerModal.vue), lines 640–655; [parent handlers](client/src/composables/useModals.js), lines 48–60.

`await emit('save', ...)` does not await the async parent listener: Vue emit returns undefined. A rejected API write is handled outside the modal's try/catch. Its saving flag remains true and its intended error message never appears. Delete has the same ownership problem.

Fix: let the component performing the request own saving/error state, or pass an explicitly awaitable callback. Keep event emission for notifications after successful completion.

**12. P2 — Failed GETs corrupt store state; failed country writes look successful. GET behavior reproduced; PATCH path source-verified.**

Locations: [marker store](client/src/stores/markers.js), lines 36–38 and 72–80; equivalent fetch actions in categories, collections, persons, and shareLinks stores.

Fetch actions assign JSON without checking `res.ok`. A 401 produces `{ error: 'Unauthorized' }` in an array-valued store; the next filter operation throws `TypeError`. `patchCountry` updates local state even when the server rejects the request.

Fix: centralize status/content-type handling, preserve existing data on failure, and invalidate authentication on 401. Commit local changes only after a successful response. Surface a retryable map-loading error.

**13. P2 — Older search responses overwrite newer searches. Reproduced.**

Location: [search composable](client/src/composables/useSearch.js), lines 53–92.

Debouncing cancels pending timers but not already-started fetches. An old address search can overwrite a newer coordinate result or a cleared search. The old request can also reset loading/error state for a newer request.

Fix: abort obsolete requests and/or guard every result with a monotonically increasing request ID. Invalidate pending work on selection, clear, and unmount.

**14. P2 — Concurrent setup creates multiple users. Reproduced.**

Location: [setup](api/routes/auth.js), lines 27–36.

Two requests can both see an empty users table before awaiting bcrypt. Both then insert and receive valid sessions. Later login selects only one user with LIMIT 1, so one accepted setup password may not work.

Fix: enforce the singleton user in the database and perform a guarded insert after hashing. Return 409 to a competing setup request. Do not hold a SQLite transaction open across asynchronous hashing.

**15. P2 — Marker labels are interpreted as HTML. Source-verified.**

Locations: [tooltip creation/update](client/src/composables/useMarkerLayer.js), lines 102 and 149; [CSV preview tooltips](client/src/views/MapView.vue), line 579.

Leaflet receives raw label strings, and the installed Leaflet implementation assigns string tooltip content through `innerHTML` (`client/node_modules/leaflet/src/layer/DivOverlay.js`, lines 279–280). Imported labels containing markup therefore render as HTML on both private and shared maps. Vue's normal text escaping does not apply here.

Fix: pass a DOM element populated through `textContent`. The production CSP restricts script execution; this review confirms HTML injection, not a demonstrated production script-execution exploit.

**16. P2 — Larger imports hit the app's own write limit. Source-verified.**

Locations: [write limiter](api/index.js), lines 57–60; [JSON/CSV loops](client/src/composables/useImportExport.js), lines 291 and 448.

Both importers create one marker per HTTP request. The shared limiter allows 300 writes per 15 minutes, including category/person/collection creation and other edits. A sufficiently fast import exceeding that remaining budget receives 429s and continues failing without waiting or resuming.

Fix: add a bounded bulk-import endpoint with per-row reporting and suitable limits, or implement explicit Retry-After handling and resumable progress. Do not simply remove rate limiting.

**17. P2 — Trip mode edits do not follow the modal's Save/Cancel contract. Source-verified.**

Location: [trip order modal](client/src/components/TripOrderModal.vue), lines 29, 49, and 99–119.

Transport mode changes save immediately, whereas order changes wait for Save. Cancel therefore keeps mode changes. The fetch response is not checked and failures are swallowed, so highlighted modes can also disagree with persisted data. If A → B → C has B excluded, the map routes A → C, but the modal offers modes only for adjacent nonexcluded rows and supplies no control for A → C.

Fix: derive segments from the included stop sequence and save pending order/mode changes together. Alternatively, explicitly design an autosave interaction with success/error feedback and no misleading Cancel behavior.

**18. P2 — Network failure can leave public share loading stuck. Source-verified.**

Location: [share view](client/src/views/ShareView.vue), lines 266–295.

Initial loading and password submission await fetch/JSON parsing without catch/finally. A network rejection leaves the initial loading state unchanged; password submission can leave `loading = true`. Changing the route token within a reused ShareView also has no token watcher to reload the data.

Fix: handle request failures explicitly, reset loading in finally, and reload/cancel on token changes.

**Duplication and maintainability improvements**

- Consolidate marker read/serialization logic. `api/routes/markers.js` and `api/utils/shareUtils.js` repeat the same relation queries and grouping loops, while backup and multiple client editors maintain separate field lists. The actual field-loss bugs show why this deserves priority. Keep an explicit public-share projection so a future private field is not accidentally exposed through SELECT *.
- Introduce a small shared API client. The repeated fetch/create/update/delete code in five entity stores already has inconsistent error handling. Keep store-specific behavior explicit; a universal CRUD framework is unnecessary here.
- Centralize the tile registry, settings persistence, color rules, and date utilities. Tile definitions appear in MapView, ShareView, and SettingsModal. The frontend uses day 31 to normalize every month-end while the backend calculates the real month-end. Neither consistently rejects impossible calendar dates.
- Normalize relation state or update embedded fields consistently. Markers embed copies of category/collection/person objects, requiring patch helpers; collection updates patch only name, color, and is_trip, and person address changes/deletions can leave cached person data stale.
- Improve validation at API boundaries: finite coordinates during restore, date validity, positive integer positions, referenced IDs, segment endpoints belonging to the trip, and valid via-point coordinates. Positions updates currently only compare submitted positions with one another, not omitted existing stops, and lack an all-or-nothing transaction.
- Add ordered schema migrations and abort startup on unexpected migration errors. Repeated startup data-copy operations are not a safe substitute for version tracking.
- Add a small meaningful check suite: field-preserving updates, rollback on invalid relations, backup round-trip, restore-store refresh, import format compatibility, setup race/session revocation, and map mount/unmount. Add linting with undefined-variable checks; the successful Vite build did not catch the timer bug.
- Precompute category/collection/person counts in FilterPanel. Current sorting calls count functions that rescan all markers for comparator invocations. Also consider incremental marker rendering and pagination/virtualization for the table after measuring larger datasets.
- Make public sharing scope explicit. The current shared payload includes every category, collection, and person associated with selected markers, even when only one collection was selected to share. Confirm that this is the intended disclosure policy; the code alone cannot establish that it is wrong.
- Align operational docs: README advertises port 3082 and its nginx example uses 3082, while Compose publishes 3063. The root reset script uses Unix `rm`, which does not work with npm's normal Windows command shell. Document a consistent SQLite backup procedure rather than advising only a live copy of the main file while WAL mode is enabled.

Suggested implementation order: fix items 1–3 together with regression checks; handle migrations and restore/import integrity; repair UI error handling and lifecycle cleanup; then consolidate the duplicated helpers. Keep broad visual or architectural rewrites separate from these behavioral fixes so each change remains easy to review.
