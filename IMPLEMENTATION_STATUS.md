# Implementation status — 2026-08-29

## Shipped foundation

- separate public GPL application and MIT schema dependency;
- immutable 133-row legacy audit snapshot plus separate local-certification file;
- typed double-precision document model and stable handles;
- atomic entity transaction, monotonic revisions, idempotent opIds and one-step undo/redo;
- atomic IndexedDB document + snapshot + append-only operation commit;
- checksum-verifying `.kdraw` document/attachment envelope;
- read-only legacy Draw-blob migration that ignores Plan walls, rooms and 3D data;
- Canvas2D renderer with uniform world scale, R-tree culling and bulged polyline arcs;
- initial DXF writer with deterministic valid handles and independent `dxf-parser` read-back;
- initial SVG/vector-PDF writer with plottable-layer filtering and xref verification;
- developer-only pinned LibreCAD/FreeCAD fixtures with executable-SHA checks,
  disposable profiles and independent geometry read-back; they never certify an AutoCAD row;
- dependency-license, public-tree, Gitleaks, build, unit, mutation and Chromium gates.
- declarative parity-kit with source-to-row dependency mapping, fail-closed
  runtime coverage, semantic JSON/KDRAW1 content addresses, one-row execution
  and fast/row/full CI tiers; MOVE…TRIM preview and commit now share one typed
  web workflow module instead of duplicated parsing/execution branches.
- schema-v4 package evidence binding separates the immutable dependency surface,
  each row's transitive npm stage-command graph and the global CI topology. The
  checked-in v3→v4 migration receipt proves that F-023 alone added authority-stage
  commands while the prior 23 rows and `package-lock.json` stayed unchanged.
- F-003 RECTANGLE mirrored through command registry, atomic browser commit, IndexedDB reload,
  production DXF, independent parser and a fresh AutoCAD 2024 Core Console live workflow.
- F-015 ERASE mirrored through selectable browser objects, locked-layer refusal, one atomic
  delete/UNDO, empty production DXF and a fresh AutoCAD 2024 Core Console live workflow.
- F-016…F-021 MOVE/COPY/ROTATE/SCALE/MIRROR/OFFSET mirrored through owned AutoCAD
  desktop workflows, Chromium, atomic operation logs and independent DXF/KDRAW1 read-back.
- F-022 TRIM mirrored Quick/Standard, explicit/all cutting edges, Edge/Project,
  Erase, command/global Undo, Fence/Crossing, physical Shift-Extend, six geometry
  families, closed bulge-width polylines and layer-safe nested blocks. The same
  rational SPLINE production DXF passes Chromium, typed AutoCAD COM and an
  independently parsed AutoCAD-saved DXF; final review is 0 P0 / 0 P1.
- F-023 EXTEND mirrored Quick/Standard boundary selection, Fence/Crossing,
  Edge Extend/No extend, Project None/UCS/View, command Undo, physical
  Shift-TRIM and atomic global Undo/Redo across line/polyline/arc/circle/
  ellipse/rational-spline geometry. Chromium, production DXF/KDRAW1,
  independent read-back, secondary pinned LibreCAD/FreeCAD oracles and an
  owned AutoCAD 2024 desktop live matrix all pass locally.
- F-097 Layout tabs mirrored with create/rename/copy-before-source/reorder/delete,
  independent viewport and paper-entity identifiers, atomic Undo/Redo, IndexedDB reload,
  production KDRAW1 read-back and an owned AutoCAD native-DWG reopen workflow.
- F-098 Visible paper sheet mirrored with validated paper dimensions, deterministic A4
  fallback, exact paper-world rendering, a measured 1920x1080 browser sheet/desk/canvas,
  IndexedDB/KDRAW1 read-back and owned AutoCAD native-DWG/pixel verification.
- F-099…F-101 mirrored multiple clipped viewports, custom/preset camera transforms,
  cursor-anchor zoom, rotated pan/twist and the native display-lock lifecycle.
- F-102 Page setup mirrored ISO paper/orientation, Layout/Window/Extents/Display,
  Fit/custom scale, center/offset, atomic persistence and physical SVG/PDF output.
  Native AutoCAD measurement established that media changes preserve existing
  viewport paper coordinates; the older proportional-refit assumption was removed.
  Chromium and native AutoCAD Display now consume the same measured paper-view
  source; PC3 printable-origin parity remains explicitly scoped to F-108.
  Display now requires the current paper view, arbitrary Window coordinates are
  accepted and native PDF line endpoints prove the 1:2 physical scale.
- F-103 Plot profiles mirrored Color/Monochrome/Grayscale, ACI/TrueColor,
  ByLayer/explicit lineweights, transparency and persisted plot-style preview.
- F-104 Layout vector output mirrored deterministic SVG/PDF for two independent
  clipped viewports, paper-space geometry and physical paper dimensions.
- F-105 Batch publish mirrored ordered include/exclude settings, one multi-page
  or separate PDF workflow, per-layout Display sources and Windows-safe names.
- F-106 Model-space print mirrored persisted Extents/Window/Display areas,
  Fit/custom scale, center/offset, A4/A3 output, atomic Undo/Redo and exact
  vector SVG/PDF read-back. Native AutoCAD reopens the synthetic DWG and
  independent readers measure the known LINE/CIRCLE geometry on paper.
- F-107 Named page setups/templates mirrored unique create/apply/rename/delete,
  assignment cleanup, strict geometry-free template export/import, collision-safe
  IDs/names, one-step Undo/Redo and IndexedDB/KDRAW1 persistence. AutoCAD creates
  the same A4 portrait Layout 1:1 named setup, saves a native DWT and reads the
  named setup plus applied Layout1 settings, millimetre units, plot origin and
  printable margins back from a fresh drawing. Import rejects incompatible units,
  dangling/stale assignments, unknown nested keys and oversized files before commit;
  semantic equality is independent of JSON object-key order. Independent final
  review closed at 0 P0 / 0 P1 / 0 P2.
- F-109 DXF export mirrored 40 production entities, layer/style semantics,
  255 exact ACI colors and native aligned dimensions through Chromium, strict
  ezdxf, AutoCAD Core Console and an owned desktop AutoCAD read-back.

## Certified state and explicit remaining limits

- the new application has **24/133** publicly certified parity rows
  (**18.0% raw / 21.7% weighted**); F-023 feature commit `1f4a96c` and CI
  portability fix `7e252de` passed GitHub Actions run `33260160549`;
- the F-024 local release candidate has **25/133** rows
  (**18.8% raw / 22.6% weighted**) with a complete local gate and independent
  `0 P0 / 0 P1` review; public GitHub Actions is still pending;
- all 22 legacy-certified rows and the first three new rows F-022/F-023/F-024
  are locally mirrored;
- spline/NURBS rendering is rejected rather than drawn as a misleading control polygon;
- Unicode PDF text is rejected until a font-embedding path exists;
- LibreCAD/FreeCAD fixtures pass locally, but the machine has no signed OS
  egress-deny attestation, so the strict required-oracle gate remains honestly red;
- crash-recovery operation replay and cloud storage are not complete;
- 50,000-entity R-tree query passes, but 30 FPS browser pan/zoom is not yet proved;
- native DWG/DWT/XREF and PC3/CTB/STB remain deferred;
- no preview or production deployment has been made.

The F-024 final local full gate passed 56 test files / 351 Vitest tests,
50 mutation tests, 36 DXF tests, 20 PDF tests and 79 Chromium E2E tests.
GitHub Actions run `33260160549` passed both `fast` and full `verify` jobs on
the exact public commit `7e252de`; the preceding shallow-checkout failure is
ratcheted by requiring every checkout step to fetch the pinned schema-v3
migration base. The checked-in licensed AutoCAD evidence is fresh for
F-022/F-023/F-109/F-111. LibreCAD/FreeCAD remain secondary oracles and report
`FIXTURE_PASS_NOT_NETWORK_ISOLATED`, not certification authority.

The architecture-efficiency wave in `ARCHITECTURE_ROADMAP.md` is closed with
public Ubuntu CI and an independent `0 P0 / 0 P1` review. Its App-shell refactor
was followed by all 22 browser captures, 23 independent read-backs, a fresh
F-102 native AutoCAD live run, schema-v3 exact stage receipts, real F-003
Chromium DXF capture and cross-platform content-address verification. The next
functional row after the local F-024 candidate is F-025 CHAMFER. F-108 native
PC3/CTB/STB remains blocked on a licensed adapter. No production deployment is
authorized.
