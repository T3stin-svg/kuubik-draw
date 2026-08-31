# Precision and layers workstream evidence

Source baseline: `b09f4e1e0a661b06e5087e6cbb748220dbc48574`

Branch: `work/reio-precision-layers`

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
