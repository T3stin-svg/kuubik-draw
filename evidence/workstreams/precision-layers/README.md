# Precision and layers workstream evidence

Source baseline: `b09f4e1e0a661b06e5087e6cbb748220dbc48574`

Branch: `work/reio-precision-layers`

## Wave 15: F-053 AutoCAD 2024.1.2 live UNITS reference

- Baseline: `679a5963fc7ad9128dff78bb076b0e9dbf4c8923`
- Branch: `work15/reio-precision-units-autocad`
- Reproducer: `node tools/autocad/run-f053.mjs`
- A newly launched, authenticated AutoCAD process operated only on its blank
  scratch document. The pre-existing PID `64444` retained the same executable
  path and start identity, the owned PID `57308` terminated, and the process
  set was exactly restored.
- Nine native checks passed: baseline/commit settings, existing-coordinate
  preservation, atomic Undo/Redo, no-op stability, invalid `LUPREC` rejection,
  invalid `INSUNITS` rejection and geometry preservation after invalid input.
- Independent raw DXF read-back proved all required header variables and line
  coordinates within eight ULPs. COM `ANGBASE=pi/3` radians maps to DXF
  `$ANGBASE=60` degrees. The scratch DXF SHA-256 is
  `9fc4b83555e66216780ce755a6fd4fce0d461e9a0c73fe1b1a3dc8173a5e3dce`.
- Two items remain `NOT_RUN`: AutoCAD has one `INSUNITS` value rather than
  separate drawing/insertion-unit fields, and modal UNITS Cancel cannot be
  proven through COM variables without UI simulation.
- Targeted coverage passed 3 files / 7 tests: runner/process contract,
  mutation-resistant DXF parser and content-address binding.
- Repository-wide verification passed: 266 Vitest files / 1,188 tests, DXF 29
  files / 73 tests, PDF 7 files / 22 tests, typecheck, lint, 154-module build,
  public-tree scan of 1,807 files, 119-package license audit and diff-check.
- Evidence status is `PARTIAL` (9 PASS, 2 NOT_RUN), certification authority is
  false, F-053 remains uncertified and its score is unchanged.

## Wave 14: F-053 UNITS persistence and command contract

- Baseline: `a6d2cf917c55bf415257dc9ca1ba59684a53467c`
- Branch: `work14/reio-precision-units`
- Reproducer: `npx vite-node evidence/workstreams/precision-layers/units-persistence-wave14.ts`
- `PrecisionUnitsCommandAdapter` supplies a DOM-free UNITS dialog lifecycle on
  the existing normalized core contract. Invalid settings and degraded recovery
  fail closed before the live document can change.
- Preview and commit use the same planned contract. A drawing-unit change with
  existing geometry still requires explicit `preserve-coordinates`; no display
  precision or unit setting scales or rounds stored doubles.
- One `CadSession` operation persists drawing units and extension metadata
  together. Candidate commit/Undo/Redo state remains private until IndexedDB
  commit and exact document read-back both pass.
- IndexedDB reopen restores the append-only operation history. The evidence
  revision sequence is commit `1`, Undo `2`, Redo `3`, reopen+Undo `4`; recovery
  is clean from the operation log and all geometry SHA-256 values are identical.
- Targeted coverage passed 5 files / 12 tests: golden/unit, 2,000 property
  previews, 1,000 invalid fuzz patches, mutation, IndexedDB wiring and a 50,000
  object coordinate-preservation performance case.
- Repository-wide verification passed: 257 Vitest files / 1,162 tests, DXF 28
  files / 70 tests, PDF 7 files / 22 tests, typecheck, lint, 154-module build,
  public-tree scan of 1,772 files, 119-package license audit and diff-check.
- App/CSS integration, integrated Kuubik browser read-back and AutoCAD 2024.1.2
  live evidence were not run. F-053 remains uncertified and its score is
  unchanged.

## Wave 13: F-052 Dynamic Input

- Baseline: `0a0bc61cb631147138855bcee7779aa24c55780b`
- Branch: `work13/reio-precision-dynamic-input`
- Reproducer: `npx vite-node evidence/workstreams/precision-layers/dynamic-input-wave13.ts`
- DOM-free pointer overlay read-back exposes X/Y, distance/angle, fixed CSS
  offset, editable/active fields and exact unrounded result values.
- Tab/Shift+Tab cycles the mode fields; Escape cancels without revision; Enter
  requests commit only after a valid immutable preview.
- Dot/comma locale and absolute/relative Cartesian, absolute/relative polar and
  direct-distance input reuse the shared parser and precision pipeline.
- ORTHO precedes POLAR and OSNAP precedes OTRACK. Zoom changes move only the
  world aperture; the CSS overlay remains fixed and atomic commit reuses the
  exact prepared frame.
- Targeted precision coverage passed 32 files / 83 tests, including 2,000
  property cases, 5,000 malformed-input fuzz cases and mutation/wiring gates.
- The 50,000-object / 100-frame profile measured complete shell+session+adapter
  build `575.025 ms`, p95 `0.268 ms`, max `3.052 ms` and preview=commit.
- Repository-wide verification passed: 249 Vitest files / 1,136 tests, DXF 27
  files / 68 tests, PDF 7 files / 22 tests, typecheck, lint, 154-module build,
  public-tree scan of 1,758 files, 119-package license audit and diff-check.
- App/CSS wiring, integrated Kuubik browser read-back and AutoCAD 2024.1.2 live
  evidence were not run. F-052 remains uncertified and its score is unchanged.

## Wave 12: F-045..F-051 precision modes, OSNAP and OTRACK

- Baseline: `633d32ae052951ac475696e7e900cd3170cb59bd`
- Branch: `work12/reio-precision-snaps`
- Reproducer: `npx vite-node evidence/workstreams/precision-layers/precision-snaps-wave12.ts`
- ORTHO precedes POLAR; OSNAP precedes OTRACK. GRID display (F7) and SNAP
  quantization (F9) remain separate and have DOM-free state read-back.
- The snap aperture is defined in CSS pixels and converted without rounding by
  the viewport world scale for OSNAP, OTRACK, preview and commit.
- The fixed 13-mode OSNAP matrix adds Apparent Intersection between exact
  Intersection and Extension. Straight supporting-line intersections are
  canonical under entity order; unsupported curved cases fail closed.
- Off/frozen owners are excluded and purge OTRACK acquisition; locked owners
  remain selectable/snappable but not editable.
- Targeted precision/snap/tracking coverage passed 26 files / 72 tests. The
  50,000-object profile measured build `362.613 ms`, p95 `0.226 ms`, max
  `2.986 ms`, one selection hit and exact preview/commit equality.
- Repository-wide verification passed: 233 Vitest files / 1,086 tests,
  DXF 25 files / 65 tests, PDF 7 files / 22 tests, typecheck, lint, production
  build, public-tree scan of 1,698 files, license audit of 119 installed
  packages and `git diff --check`.
- GRID rendering still needs the visual owner to consume
  `precisionModeReadback().grid`; this branch does not edit App/style.
- AutoCAD 2024.1.2 and integrated Kuubik browser read-back were not run. No
  parity score changed.

## Wave 11: F-041/F-042/F-044 coordinate entry

- Baseline: `608ce72ff9ab5ecf699ecd6026051e11be275b85`
- Branch: `work11/reio-precision-coordinates`
- Reproducer: `npx vite-node evidence/workstreams/precision-layers/coordinate-entry-wave11.ts`
- Covers absolute/relative Cartesian and polar coordinates, direct distance,
  locale/unit conversion, negative angles, exact zero-length behavior,
  retry/cancel and atomic `CadSession` commit/Undo/Redo.
- The 50,000-object profile and final repository counts are recorded in
  `coordinate-entry-wave11-20260831.json` and `test-matrix.json`.
- AutoCAD and Kuubik browser live read-back were not run. App/command-line DOM
  wiring is reserved for the integration owner and no F-score changed.

## Wave 10: F-080 transparency and F-086 draw order

- Baseline: `c607df360f68714e87b475ffbbc1a889abf93306`
- Branch: `work10/reio-precision-transparency-draworder`
- Deterministic read-back: `transparency-draw-order-wave10-20260831.json`
- Reproducer: `npx vite-node evidence/workstreams/precision-layers/transparency-draw-order-wave10.ts`
- Golden/property/fuzz/mutation/wiring coverage: 16 targeted tests in 5 files.
- 50,000 entities: a 100-entity stable front move planned in 60.692 ms with
  200 minimal atomic changes; Undo/Redo and ByLayer transparency read-back pass.
- AutoCAD and integrated Chromium live read-back were not run, so no F-score
  changed. Canvas draw-order traversal remains a renderer-owner integration
  blocker; print-SVG order and renderer/print opacity are wired.

Scope file read: `C:\Users\Olav\Downloads\kuubik-draw-reio-scope-v1.json`

## Implemented candidate coverage

- F-041, F-042, F-044: strict shared double parser and resolver.
- F-045, F-046, F-047: deterministic ORTHO/POLAR/GRID+SNAP pipeline.
- F-048, F-049, F-050: indexed OSNAP candidates and fixed priorities.
- F-051, F-052: OTRACK acquisition and Dynamic Input on the same result model.
- F-053: display precision and unit conversion without geometry mutation.
- F-072..F-080: atomic layer CRUD/current/state/appearance planners.
- F-086: stable model-space draw-order planning with one Undo step.

All rows remain uncertified in parity score data. This workstream contains no
AutoCAD live capture and `App.tsx` integration is deliberately reserved for the
integration branch.

## Automated evidence

- TypeScript package and web typecheck passes.
- 19 targeted tests pass: unit, seeded property/fuzz, mutation guard, renderer,
  UI wiring and performance.
- Full repository gate passes: 93 test files / 540 tests, lint, typecheck and
  production build.
- Public-tree scan passes on 1,209 files and the license gate passes on 119
  installed packages.
- The 50,000-object test builds both snap and selection indexes, then asserts a
  local selection query below 100 ms and total index construction below 5 s.
  The first recorded targeted Vitest run completed the whole two-test
  renderer performance file in 121 ms on the reference workstation.
- Preview and commit equality is asserted through
  `PrecisionFeatureModel.preview()` and `.commit()` with one shared pure
  resolver.
- Layer participation is locked for render/select/snap/print/edit, including
  locked, off, frozen and non-plottable states.

## Evidence boundary

No parity, visual score, security evidence or production deployment file was
changed. Dev port 5202 can only provide a meaningful feature preview after the
integration branch connects the feature controllers to `App.tsx` and package
exports.

The existing shell was opened at `http://127.0.0.1:5202/`: title and visible DOM
loaded and browser console error count was zero. The DOM also independently
showed ORTHO, OSNAP, OTRACK and DYN as disabled, which is why this is a shell
smoke test rather than feature live evidence.

## Integrated-base second wave

- Integrated base: `34683acfb1ab7a0546539cd6f72546ecb868011c`.
- Branch: `work2/reio-precision-layers`.
- Typed precision and layer adapters implement the documented
  `VisualShellCommandAdapter` contract without importing or editing `shell/**`.
- F3/F7/F8/F9/F10/F11/F12 and ORTHO/POLAR/GRID/SNAP/OSNAP/OTRACK/DYNMODE
  share one deterministic state model. Editable and repeat keyboard events are
  deliberately not consumed.
- Ellipse tangent OSNAP is analytical. Trimmed ellipse candidates are filtered
  to the actual parameter interval. General spline tangent is unsupported and
  therefore fails closed; spline endpoints, intersections, perpendicular and
  nearest reuse the existing NURBS trim predicates.
- `LayerManagerController` plans before commit and writes each layer or draw
  order action as one atomic document revision with Undo/Redo read-back.
- The shared layer participation matrix is exercised through the actual canvas
  renderer, selection index, snap index, edit predicate and SVG print output.
- `spatial-profile.ts` is a repeatable 50,000-object profiler. The recorded
  Node v26.7.0 run built the selection index in 49.50 ms, snap index in 46.70 ms
  and completed both local queries in 8.82 ms (one selection hit, four snap
  candidates).

No parity score, scope, security-evidence, production deployment or forbidden
integration file is changed in this wave. Live feature certification remains
blocked until the integration owner wires the adapter and controller into the
shared shell and runs the required browser/AutoCAD read-back.

Repository-wide verification passed on the second-wave head: 121 Vitest files
and 667 tests, typecheck, lint, production build, public-tree scan of 1,367
files, license audit of 119 installed packages and `git diff --check`.
The shell at `http://127.0.0.1:5212/` loaded as `Kuubik Draw` with zero browser
console errors. Visible DOM read-back showed GRID enabled and ORTHO, OSNAP,
OTRACK and DYN disabled, confirming this remains a shell smoke test rather than
live evidence of the unintegrated feature adapters.

## Integrated-base third wave

- Integrated base: `9af0b7b241ec28f6d5976ed69f79d973611f1c5b`.
- Branch: `work3/reio-precision-live`.
- `PrecisionLayersShellContract` is the DOM-independent application boundary
  combining typed precision command state, immutable pointer frames, OSNAP,
  OTRACK, indexed selection and atomic layer/draw-order control.
- A prepared pointer frame clones the shared `PrecisionRequest`; preview,
  commit and Dynamic Input are therefore proven against the same inputs even
  if shell mode state changes before commit.
- OSNAP ordering and OSNAP-over-OTRACK precedence are exercised through real
  renderer candidates. Locked entities remain renderable/selectable/snappable
  but not editable; hidden and frozen entities participate in none of those
  paths.
- Layer create, invalid-command rollback, draw-order mutation, one-step Undo,
  exact Redo and spatial reindex read-back are covered at the composed contract
  boundary.
- Seeded property coverage runs 2,000 finite double-precision pointer frames.
- The 50,000-object regression runs 100 paired selection/snap queries and
  records build, total, p95 and maximum query latency in
  `spatial-profile-wave3-20260831.json`.

The workstream still does not edit `App.tsx`, shell files, parity scores, scope
data, security evidence or deployment files. It adds a live-ready integration
contract, not Chromium or AutoCAD certification. All assigned F-rows remain
uncertified until the integration owner wires the contract into the shared
shell and captures the required AutoCAD/live read-back.

Repository-wide third-wave verification passed: 132 Vitest files / 719 tests,
15 DXF files / 50 tests, typecheck, lint, production build, public-tree scan of
1,404 files, license audit of 119 installed packages and `git diff --check`.
The focused precision/layers matrix passed 18 files / 46 tests.

## Integrated-base fourth wave

- Integrated base: `cef8bb6edfdf706d92b289d325fb2de69c6af8ca`.
- Branch: `work4/reio-precision-live`.
- `LayerManagerShellAdapter` supplies DOM-independent typed capability commands
  for create/current, on/off, freeze/thaw, lock/unlock, plot, color, linetype,
  lineweight, transparency, combined property batches and draw order.
- A multi-layer property batch is fully planned before one
  `LAYER_BATCH_PROPERTIES` operation. A late invalid layer leaves the document,
  revision, Undo stack and read-back callback unchanged.
- One Undo and Redo restore exact layer collections for a batch. The composed
  precision contract refreshes selection and snap indexes after typed execute,
  Undo and Redo read-back.
- Locked entities remain selectable, snappable and printable but not editable;
  off and frozen entities are excluded from selection, snap, modify and print.
  The contract is exercised through the real indexes and SVG printer.
- Seeded property coverage executes 512 two-layer patches with exact Undo/Redo.
- Both the renderer regression and the Layer Manager eligibility regression use
  50,000 objects and 100 paired selection/snap queries. The repeatable profile
  is recorded in `spatial-profile-wave4-20260831.json`.
- F-086 is not routed by its row string. `layers.draw-order` is the runtime
  capability; `F-086` remains conflict metadata because the shared shell owns
  the same row for Block Create.

This wave contains no `App.tsx`, shell, package, scope, parity-score, security
evidence or deployment change. Chromium-integrated and AutoCAD live read-back
were not run, so no assigned F-row is certified or scored by this evidence.

Repository-wide fourth-wave verification passed: 143 Vitest files / 756 tests,
16 DXF files / 51 tests, 7 PDF files / 22 tests, typecheck, lint, production
build, public-tree scan of 1,423 files, license audit of 119 installed packages
and `git diff --check`. The focused precision/layers/print matrix passed 29
files / 74 tests.

## Integrated-base fifth wave

- Integrated base: `6490e7ce9a7c187d79c2d749ae65ee651996d7f9`.
- Branch: `work5/reio-precision-live`.
- The candidate engine covers Endpoint, Midpoint, Center, Quadrant,
  Intersection, Extension, Insertion, Perpendicular, Tangent, Nearest,
  GeometricCenter and Parallel in one fixed priority order.
- Candidate IDs exclude priority/distance and canonicalize intersection entity
  order. Selection cycling retains the active semantic ID across fresh queries.
- Extension supports straight terminal continuation and analytical trimmed-arc
  continuation. Explicit reference handles make far Extension/Parallel queries
  index-safe instead of forcing a whole-document scan.
- GeometricCenter covers straight closed polylines and area-weighted hatch loops
  with hole subtraction. Unsupported curved polygon centroids fail closed.
- OTRACK has exact acquisition/release/clear read-back, canonical polar lines,
  two-line intersections and IDs independent of acquisition/angle order.
- Prepared pointer read-back contains the immutable request, full candidate ID
  list and explicit selected ID. Preview, commit and Dynamic Input use that one
  cloned request.
- Dynamic Input exposes unrounded coordinate, delta, distance and normalized
  angle values. Units/precision are validated and cloned; formatting does not
  round stored geometry.
- Seeded coverage includes 2,000 full-mode candidate sets, 1,000 OTRACK order
  permutations and 2,000 double-precision pointer frames.
- The 50,000-object profile runs all 12 OSNAP modes, 100 paired queries and the
  shared normal/locked/off/frozen participation predicate. Results are recorded
  in `spatial-profile-wave5-20260831.json`.

This wave does not modify `App.tsx`, visual shell/worker, package files, scope,
parity scores, security evidence or deployment. No Chromium-integrated or
AutoCAD live read-back was run, so F-048–F-053 remain uncertified.

Repository-wide fifth-wave verification passed: typecheck, lint, 157 Vitest
files / 793 tests, DXF gate 17 files / 52 tests, PDF gate 7 files / 22 tests,
build, public-tree scan of 1,462 files, license audit of 119 installed packages
and `git diff --check`. The focused precision/layers matrix passed 25 files /
79 tests.

## Integrated-base sixth wave

- Integrated base: `e5b65b566912c969320989f5cbb7365e34fe1a1d`.
- Branch: `work6/reio-precision-live`.
- The shared double-precision parser now covers absolute/relative Cartesian,
  absolute/relative polar and direct-distance input with physical-unit suffixes.
- Dot- and comma-decimal forms are deterministic: comma decimals require a
  semicolon Cartesian separator. Negative and zero values are explicit golden
  cases; non-finite, malformed and unitless/physical mixtures fail closed.
- Explicit coordinates bypass all cursor aids. Direct distance uses the exact
  ORTHO-before-POLAR, GRID, OSNAP-before-OTRACK pipeline for preview, commit and
  Dynamic Input.
- Spatial candidates are queried around the provisional constrained/grid point,
  so an intersection at the resolved target is not lost merely because the raw
  cursor was outside the aperture.
- The F3/F7–F12 shortcut contract maps keys, commands, toggles and parity rows
  in one exported table. F-047 keeps GRID display and SNAP quantization as two
  distinct toggles.
- Seeded coverage includes 3,000 locale round-trips, 5,000 malformed-input fuzz
  cases and the existing 2,000 immutable pointer frames, plus golden, mutation
  and DOM-free wiring tests.
- The 50,000-object/100-frame profile measured build `281.9355 ms`, query p50
  `0.0732 ms`, p95 `0.1907 ms` and max `2.7009 ms`; exact output is in
  `precision-profile-wave6-20260831.json`.

This wave does not modify App/style/shell, documents, annotation, blocks,
geometry, command-system, package, scope, parity-score or deployment files.
No AutoCAD or Chromium live read-back was run, so F-041, F-042 and F-044–F-047
remain uncertified and their scores are unchanged.

Repository-wide sixth-wave verification passed: typecheck, lint, 168 Vitest
files / 838 tests, DXF gate 18 files / 53 tests, PDF gate 7 files / 22 tests,
build, public-tree scan of 1,499 files, license audit of 119 installed packages
and `git diff --check`. The focused precision matrix passed 16 files / 43
tests.

## Integrated-base seventh wave

- Integrated base: `e150ebbbaaec5c3aa04eb480b576aefca8d677f8`.
- Branch: `work7/reio-precision-live`.
- F-053 has a schema-v1 document extension for drawing/insertion units, five
  length formats, five angle formats, both precisions, locale decimal separator,
  clockwise direction and base angle.
- Legacy `document.units` and the extension must agree on drawing unit and both
  precisions. Reopen read-back fails closed on disagreement.
- Format/parse is canonical at configured precision, including imperial carry,
  fractional denominators, DMS carry, full-turn rounding and surveyor axes.
- Typed polar input derives degrees/grads/radians from the persisted contract;
  Dynamic Input uses the same contract for coordinate, distance and angle text.
- Drawing-unit changes with existing geometry require explicit
  `preserve-coordinates`; geometry SHA is identical before/after and reported
  scale is exactly 1.
- Known physical import units produce exact scale. Unitless/physical import is
  refused unless a positive explicit scale is supplied.
- Seeded coverage includes 10,000 length and 10,000 angle round-trips, 5,000
  fuzz strings, mutation guards, golden vectors, document JSON reopen and
  DOM-free wiring.
- `units-readback-wave7-20260831.json` records the complete contract, all ten
  golden formats, import-scale read-back, typed-input read-back and identical
  before/after geometry SHA-256.

This wave does not change App/style/shell, document/IndexedDB, DXF/PDF adapters,
geometry/modify, annotation/blocks, package, scope, parity-score or deployment
files. No AutoCAD or Chromium live/output read-back was run, so F-053 remains
uncertified and its score is unchanged.

Verification passed: typecheck, lint, 180 files / 906 tests, DXF gate 19 files /
54 tests, PDF gate 7 files / 22 tests, build, public-tree scan of 1,521 files,
license audit of 119 installed packages and `git diff --check`. The focused
precision matrix passed 17 files / 64 tests.

## Integrated-base eighth wave

- Integrated base: `7bfa2bea649583129844444f9f5788a701ff21a4`.
- Branch: `work8/reio-precision-live`.
- F-072–F-079 capability metadata now matches the parity manifest exactly;
  CRUD includes typed create/rename/delete/current commands.
- Layer `0` is protected by its normalized name. Canonical `Defpoints` is
  protected and permanently non-plottable.
- Invalid/control/reserved and case-equivalent duplicate names fail closed.
  Persisted reopen also rejects missing current layers and orphan linetypes.
- The indexed ByLayer resolver covers color/ACI method, linetype and scale,
  lineweight and transparency with explicit entity/layer/default provenance.
- Multi-entity layer/property updates validate every target before one session
  revision. Null clears an override back to ByLayer; one Undo/Redo restores the
  exact before/after entity arrays.
- Seeded coverage includes 2,000 property cases, 5,000 malformed-name fuzz
  cases, mutation guards, a golden contract, renderer wiring and JSON reopen.
- The 50,000-entity profile measured selection build `40.0779 ms`, snap build
  `31.0304 ms`, query p95 `0.1145 ms`, max `8.2298 ms` and all-property ByLayer
  resolution `11.9206 ms`. Exact output is in
  `layers-readback-wave8-20260831.json`.

This wave does not change App/style/shell, geometry, annotation, documents,
DXF/PDF adapters, package, scope, parity-score or deployment files. No AutoCAD
or integrated Chromium/output read-back was run, so F-072–F-079 remain
uncertified and their scores are unchanged.

Repository-wide eighth-wave verification passed: typecheck, lint, 204 Vitest
files / 984 tests, DXF gate 21 files / 56 tests, PDF gate 7 files / 22 tests,
150-module production build, public-tree scan of 1,610 files, license audit of
119 installed packages and `git diff --check`. The focused layer matrix passed
17 files / 36 tests.
