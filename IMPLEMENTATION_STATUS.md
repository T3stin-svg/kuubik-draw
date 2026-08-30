# Implementation status — 2026-08-30

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
- first AutoCAD-style visual shell wave with an eight-zone 1920×1080 dark
  workspace, dense Home ribbon, document tabs, docked Layer/Properties surface,
  command history, layout tabs and status toggles. Six Kuubik states are captured
  under `evidence/artifacts/visual-shell-wave-1`; the fixed visual score remains
  60.7% until equivalent AutoCAD reference states pass paired measurement.
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
- F-024 FILLET, F-025 CHAMFER and F-026 BREAK are certified with command
  options, typed geometry, atomic Undo/Redo, Chromium, owned AutoCAD Desktop,
  independent DXF/KDRAW1 read-back and zero-open-P0/P1 reviews.
- F-027 STRETCH is publicly certified for physical crossing window/polygon,
  partial and whole-object moves, locked refusal, preview=commit and exact
  Undo/Redo. AutoCAD source/result state and the independently parsed 14-entity
  DXF are checked field-by-field; every nested stage/source receipt is current.
  Independent review closed at 0 P0 / 0 P1.
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

- the new application is publicly certified through F-029 at **29/133**
  (**21.8% raw / 25.2% weighted**) with independent `0 P0 / 0 P1` review;
- all 22 legacy-certified rows, F-022…F-027 and F-029 are publicly mirrored;
  feature-commit `5b63ccb` passed exact-commit CI run `33323461138`;
- spline/NURBS rendering is rejected rather than drawn as a misleading control polygon;
- Unicode PDF text is rejected until a font-embedding path exists;
- LibreCAD/FreeCAD fixtures pass locally, but the machine has no signed OS
  egress-deny attestation, so the strict required-oracle gate remains honestly red;
- crash-recovery operation replay and cloud storage are not complete;
- 50,000-entity R-tree query passes, but 30 FPS browser pan/zoom is not yet proved;
- native DWG/DWT/XREF and PC3/CTB/STB remain deferred;
- no preview or production deployment has been made.
- all 29 certified rows were re-captured and independently read back after the
  visual shell change; F-102 additionally passed a fresh owned AutoCAD 2024 live
  Display/PAGESETUP/PDF/DWG run using the new measured browser viewport.

The F-027 full local gate passes 70 test files / 443 Vitest tests,
68 mutation tests, 43 DXF tests, 20 PDF tests and 99 Chromium E2E tests,
plus production build, license, public-tree and Gitleaks 8.30.1 with zero
findings across 919 source files. F-027 commit `57b1c14` passed GitHub Actions
run `33308045837`: fast completed in 1m02s and verify in 3m53s. F-026 commit
`b3474d3` passed GitHub Actions run `33305223655`. Protected-runner
jobs `required-oracles`, `autocad-2024-certification` and `row-certification`
were honestly skipped; the checked-in evidence had already passed the local
mandatory ratchet and independent review. The checked-in licensed AutoCAD evidence is
fresh for F-016/F-017/F-018/F-024/F-027/F-098/F-100/F-101/F-105; LibreCAD/FreeCAD
remain secondary oracles and report `FIXTURE_PASS_NOT_NETWORK_ISOLATED`, not
certification authority.

The architecture-efficiency wave in `ARCHITECTURE_ROADMAP.md` is closed with
public Ubuntu CI and an independent `0 P0 / 0 P1` review. Its App-shell refactor
was followed by all 22 browser captures, 23 independent read-backs, a fresh
F-102 native AutoCAD live run, schema-v3 exact stage receipts, real F-003
Chromium DXF capture and cross-platform content-address verification. F-025
CHAMFER has its public-green chain. F-026 BREAK now has a complete
AutoCAD/Chromium/DXF/KDRAW1/oracle chain, content-address ratchet and
zero-open-P0/P1 review and public-green exact commit. F-027 STRETCH now has the
same complete chain, zero-open-P0/P1 review and public-green exact commit. The
next highest-impact small Modify row is F-030
MATCHPROP; F-028 LENGTHEN and F-029 ALIGN remain in the same P1 wave. F-108 native
PC3/CTB/STB remains blocked on a licensed adapter. No production deployment is
authorized.

F-030 MATCHPROP now has an **uncertified candidate implementation**: the exact
public MIT schema commit `a7d3e8e8ca4f71192926bffd0d13708da9df08f9` adds
optional linetype-scale, thickness, plot-style, material and typed viewport
special fields, and its public CI run `33311867348` is green;
the Draw core transfers AutoCAD's basic property set plus the represented
Polyline/Text/Dimension/Hatch special subsets through one pure preview/commit
predicate. The visible workflow supports physical source/target picks, multiple
destinations, persistent per-property settings, resolved color/weight/opacity/
linetype preview, one atomic operation, Undo/Redo and DXF/KDRAW1 read-back.
Viewport MATCHPROP is now a visible paper-space source→multi-target workflow:
it copies scale, display lock/on, shade plot, snap/grid and UCS-icon state while
preserving the destination frame, camera centre/twist, clip boundary and
per-viewport layer overrides. The core cross-document path imports Layer,
Linetype, Text style and Dimension style dependencies in the same atomic command,
with deterministic lossless ID/name collision remapping and exact Undo cleanup.
The remaining Multileader/Table/Center object surfaces are explicitly attached
to F-060/F-069/F-071, plot-style definition semantics to F-108 and visible
multi-document destination selection to F-128; those rows remain in the fixed
denominator. **F-030 remains at its existing 0.75 score** until the AutoCAD live
matrix, current-byte evidence and independent review pass.

F-028 LENGTHEN now also has an **uncertified candidate implementation**. One
typed predicate supports Delta, Percent, Total and Dynamic for LINE, ARC and
open POLYLINE plus Dynamic for elliptical arcs; the audited rational
control-point SPLINE fails closed while fit-point data remains an explicit
F-012/F-028 dependency. ARC accepts both length and
included-angle Delta/Total input. The picked endpoint moves, whole-polyline
length is used, terminal bulge/common properties survive and tapered terminal
widths interpolate or extrapolate by the exact length ratio. Multiple
targets use an immutable working map, command-local Undo removes the last pick
and the final commit is one atomic global Undo/Redo operation. Closed, locked,
missing and unsupported targets fail without partial mutation. The same result
passes physical canvas picking, preview=commit, IndexedDB operation capture,
production DXF/KDRAW1 download and independent DXF parser read-back. A new
regression caught and fixed Dynamic elliptical-arc start handling: the measured
length now follows the retained pre-end interval instead of the opposite arc.

F-029 ALIGN now also has an **uncertified candidate implementation**. One point
pair performs translation only; two pairs perform translation+rotation and an
explicit Yes/No uniform scale around the first source point. The typed command
rejects degenerate references and missing/proxy sources without mutation;
mixed locked selections commit only eligible targets and report each rejected
handle. Preview, commit, physical four-point canvas capture,
atomic Undo/Redo and exact KDRAW1/DXF read-back use the same transform contract.

The combined dirty Modify wave previously passed lint/typecheck/build, **79
Vitest files / 486 tests**, mutation **76/76**, DXF **47/47**, PDF **20/20** and
headless Chromium **107/107**. After the native LENGTHEN correction its targeted
unit/mutation/DXF suite passes **17/17**, its three Chromium workflows pass and
production read-back plus LibreCAD/FreeCAD secondary oracles are current. The
F-028 cross-check is exact for all represented geometry, modes, layer visibility
and source hashes. Global receipts and the full suite still require a final
rerun. F-028 remains at **0.75** because fit-point SPLINE, independent final
review, score ratchet and exact public CI remain open. The certified score
therefore stays **28/133, 21.1% raw / 24.7%
weighted**, with visual similarity unchanged at **60.7%**.

The F-029 certification harness is now implemented without launching AutoCAD.
Production `AL/ALIGN` read-back verifies exact LINE/CIRCLE/POLYLINE/rational
SPLINE/TEXT geometry, handles, supported appearance and one atomic Undo/Redo
through strict import, independent `dxf-parser` and KDRAW1 checksum decoding.
Two headless Chromium flows verify the visible Scale Yes workflow and four
physical canvas points. Pinned LibreCAD 2.2.1.5 and FreeCAD 1.1.3 fixtures pass
as secondary non-authorities. The owned AutoCAD Desktop matrix contract covers
one pair, two pairs Scale No/Yes, opposite direction, no-op, mixed locked
selection, five native families, complete DXF read-back and authenticated
process cleanup. It has not been run yet; F-029 therefore remains at `0.75`.

F-028 now has current local production and browser artifacts too. Its
five-family Delta-length fixture proves an exact +25 length change for LINE,
ARC, open POLYLINE, ELLIPSE and rational SPLINE, plus Percent/Total/Dynamic and
ARC angle modes, strict/independent DXF, KDRAW1 and atomic Undo/Redo. Three
headless Chromium flows cover Multiple, command-local Undo, locked refusal,
physical Dynamic endpoint/destination picks and ARC angle input. The complete
non-native gate now passes **80 Vitest files / 488 tests**, mutation **76/76**,
DXF **47/47**, PDF **20/20**, Chromium **107/107**, typecheck, lint and build.
`parity:kit:validate` still reports stale global topology/content addresses and
`parity:check` still fails F-022 current-source coverage by design until the
batched native evidence and receipt regeneration. Scores remain unchanged.

## 2026-08-30 current evidence-ratchet status

The batched evidence regeneration described above is now complete. All 28
score-1 rows have fresh AutoCAD/browser/read-back descriptors, current-byte
artifact hashes, a 28-row global-topology receipt and refreshed content
addresses. Every applicable F-022…F-027 and F-100…F-114 cross-evidence check
passes. Pinned Gitleaks 8.30.1 scanned 998 git-visible source files with zero
findings with the exact source-tree SHA recorded in
`evidence/security/gitleaks-run.json`; the public-tree scan passes 1001 files.
`parity:kit:validate` and
`parity:check` are green at **28/133, 21.1% raw / 24.7% weighted**, while
visual similarity remains **60.7%**.

Three native-runner defects found during regeneration are now ratcheted:
F-025 accepts failed authenticated Escape helpers only when independent
`CMDNAMES`/`CMDACTIVE` read-back proves AutoCAD is already idle; F-101 retries
temporarily null viewport COM values before coordinate access; F-105 creates
paper entities exactly once by resolving ambiguous COM responses from the
paper-block handle delta. The complete post-fix gate passes typecheck, lint,
production build, **82 Vitest files / 496 tests**, mutation **78/78**, DXF
**47/47**, PDF **20/20**, Chromium **107/107**, license, public-tree, Gitleaks,
parity-kit and parity checks. All owned AutoCAD processes were terminated and
the pre-existing PIDs `28304` and `33160` were preserved.

F-028 and F-030 remain deliberately outside `certifiedIds` at score `0.75`.
Their native AutoCAD, browser, production read-back, source coverage and
LibreCAD/FreeCAD secondary-oracle checks are current. F-028 still requires the
F-012 fit-point SPLINE dependency, independent final review, score ratchet and
exact public CI. F-030's supported basic/polyline/text subset is cross-exact,
but full certification remains blocked by F-060, F-069, F-071, F-108 and
F-128 plus an independent final review. No preview or production deployment
was performed.

## 2026-08-30 F-029 ALIGN public certification

F-029 is now in `certifiedIds` and `local-certifications.json` at score `1.00`.
The owned AutoCAD 2024.1.2 matrix proves one-pair move, two-pair rotation with
Scale No/Yes, opposite alignment, no-op, mixed locked selection, full native
state and authenticated process cleanup. The production round-trip and cross
checker compare a closed LWPOLYLINE and rational SPLINE degree, control points,
knots, normalized weights and flags exactly rather than accepting object counts.

The final local gate passes **82 test files / 496 Vitest tests**, mutation
**78/78**, DXF **47/47**, PDF **20/20**, Chromium **107/107**, typecheck, lint,
production build, parity-kit, parity, license and dependency audit. Pinned
LibreCAD 2.2.1.5 and FreeCAD 1.1.3 reports pass as
`certificationAuthority:false`; their local status remains
`FIXTURE_PASS_NOT_NETWORK_ISOLATED`, so they are secondary evidence only.
Independent final review found **0 P0 / 0 P1**. Feature-commit `5b63ccb` passed
GitHub Actions run `33323461138`: fast in 1m17s and verify in 4m37s; protected
AutoCAD/oracle jobs were honestly skipped while their checked-in local evidence
remained mandatory in the fail-closed ratchet. The resulting public score is
**29/133, 21.8% raw / 25.2% weighted**, while visual similarity remains
**60.7%**.

## 2026-08-30 AutoCAD visual palette fidelity wave 2

The fixed 1920×1080 comparison now uses the original private AutoCAD 2024.1.2
screenshots by SHA-256 without redistributing Autodesk pixels. Their measured
drawing boundary is y=182 and the docked Layer/Properties palette ends at
x=678. Kuubik now measures y=181 and x=680, within the fixed ±2 px zone gate.
The palette includes the 190 px filter rail, seven visible layer columns, a
working layer-name filter and ten honest document-backed General properties.

All six Kuubik states were recaptured under
`evidence/artifacts/visual-shell-wave-2`; the visual browser test verifies the
680 px dock, seven columns, property density and zero console errors. The wider
overlay initially blocked physical canvas picks, and the regression gate found
16 failures. Non-interactive palette surfaces now pass pointer input through
while its real inputs and buttons remain interactive; all 52 affected Modify
tests then passed.

The visual score remains deliberately **60.7%** because this is not a complete
five-category same-environment re-audit and the sixth AutoCAD command-history
reference is still absent. The functional score also remains **29/133, 21.8%
raw / 25.2% weighted**. All 29 certified rows received fresh browser/read-back,
cross, global-topology and content-address evidence. No production deployment
was performed.

## 2026-08-30 AutoCAD selection and grip fidelity wave 3

The selected-object state now has an AutoCAD-like cyan highlight and typed,
screen-sized grips rendered as a non-document overlay. A closed rectangular
polyline exposes its four vertices and four segment midpoints, matching the
eight grips in the private AutoCAD 2024.1.2 selected-properties reference.
The same grip mapper covers the supported line, construction-line, circle,
arc, ellipse, spline, annotation, hatch, dimension and block-reference
families without mutating the document or polluting file output. Solid hatches
retain their normal fill while the selection overlay highlights only geometry.

The fixed 1920x1080 Chromium read-back under
`evidence/artifacts/visual-shell-wave-3` detected 676 cyan selection pixels,
exactly eight rectangle grips, all six required Kuubik states and zero console
errors. Renderer unit coverage proves the eight grip locations and the overlay
paint calls. All 29 certified rows received fresh current-byte browser,
read-back and applicable cross evidence after the shared renderer change.

Scores remain deliberately unchanged at **29/133, 21.8% raw / 25.2%
weighted**, and **60.7% visual**. This focused state improvement is not the
required five-category same-environment audit, and the sixth private AutoCAD
command-history/context reference is still absent. No preview or production
deployment was performed.

The complete local gate passes typecheck, lint, production build, **82 Vitest
files / 497 tests**, mutation **78/78**, DXF **47/47**, PDF **20/20** and
Chromium **108/108**. Parity-kit, all current cross-evidence, license and
public-tree checks pass. Pinned Gitleaks 8.30.1 found zero leaks in 1,031
git-visible source files. LibreCAD 2.2.1.5 and FreeCAD 1.1.3 fixtures pass as
secondary non-authorities with the honest local status
`FIXTURE_PASS_NOT_NETWORK_ISOLATED`.

## 2026-08-30 AutoCAD F2 text-window visual fidelity wave 4

The previously missing sixth AutoCAD audit state now has an authenticated
private 1920×1080 reference. A newly created owned AutoCAD 2024.1.2 process
opened the native F2 Text Window, was identified by exact PID and title, and
was privately captured at 96 DPI / 100%. The runner restored the observed
profile geometry and closed state, terminated only its owned process, and
proved that the pre-existing AutoCAD process set was unchanged. Autodesk
pixels are not redistributed; the public evidence contains only measured
geometry, colors and SHA-256 references.

Kuubik now exposes a functional full-window F2 command history with a 30 px
title, 22 px menu, measured gray transcript area, white 28 px command prompt,
working close button and Escape handling. Fixed Chromium read-back is exact
for window, title and menu geometry; the prompt boundary differs from the
native reference by only -1 px. Reference and implementation colors match at
`#ffffff` and `#c8c8c8`. The visual ratchet now reports **1/6 paired states
PASS**, all six fresh Kuubik states, and zero console errors.

The score remains deliberately **29/133, 21.8% raw / 25.2% weighted**, and
**60.7% visual**. One paired state does not establish a complete re-audit of
all five visual categories. All 29 certified functional rows received fresh
browser, independent read-back, cross-evidence, global-topology and
content-address receipts after the shared App/style change. LibreCAD and
FreeCAD remain secondary non-authorities. No preview or production deployment
was performed.

The complete local gate passes typecheck, lint, production build, **83 Vitest
files / 498 tests**, mutation **78/78**, DXF **47/47**, PDF **20/20** and
Chromium **108/108**. Parity-kit, parity, visual, license and public-tree
checks pass. Pinned Gitleaks 8.30.1 found zero leaks in 1,042 git-visible
source files. LibreCAD 2.2.1.5 and FreeCAD 1.1.3 passed as
`FIXTURE_PASS_NOT_NETWORK_ISOLATED`, with `certificationAuthority:false`.

## 2026-08-30 AutoCAD model-space navigation visual fidelity wave 5

Kuubik model space now uses a deterministic world-aligned 1/2/5-decade grid
that adapts to screen density and fills the complete visible canvas, including
non-square viewports. GRID is a real status-bar toggle. Pointer movement uses
the same invertible viewport transform as selection and Modify commands to
drive a screen-sized crosshair and four-decimal live X/Y/Z readout. An
original Kuubik TOP/WCS orientation indicator communicates the fixed 2D view
without copying Autodesk assets.

The fixed 1920x1080 Chromium evidence under
`evidence/artifacts/visual-shell-wave-5` measures 219,710 grid pixels, proves
the GRID on/off/on lifecycle, records exact cursor world coordinates, captures
all six required states and reports zero console errors. Renderer unit tests
prove deterministic spacing, full rectangular-canvas coverage and that the
display-only grid cannot mutate its viewport input.

The score remains deliberately **29/133, 21.8% raw / 25.2% weighted**, and
**60.7% visual** with **1/6 paired states PASS**. A more AutoCAD-familiar model
space is not a complete same-environment re-audit of all five fixed visual
categories. All 29 certified functional rows received fresh browser,
independent read-back, applicable cross-evidence, global-topology and
content-address receipts after the shared App/renderer change. LibreCAD and
FreeCAD remain secondary non-authorities. No preview or production deployment
was performed.

The complete local gate passes typecheck, lint, production build, **83 Vitest
files / 500 tests**, mutation **78/78**, DXF **47/47**, PDF **20/20** and
Chromium **108/108**. Parity-kit, parity, visual, license and public-tree
checks pass. Pinned Gitleaks 8.30.1 reports zero findings across 1,051
git-visible source files. LibreCAD 2.2.1.5 and FreeCAD 1.1.3 pass as
`FIXTURE_PASS_NOT_NETWORK_ISOLATED`, with `certificationAuthority:false`.

## 2026-08-31 AutoCAD drawing context-menu visual fidelity wave 6

An owned scratch AutoCAD 2024.1.2 process now provides a private native
drawing-context reference without redistributing Autodesk pixels. The runner
rejects pre-existing process ownership, fixes the main window at 1920x1080 and
96 DPI, resolves the Win32 `#32768` popup under the pointer, verifies that the
popup belongs to the owned process, records its geometry and colors, dismisses
it and proves that the pre-existing AutoCAD process set is unchanged. The
measured native envelope is exactly 200x371 px with a `#f0f0f0` surface and
`#a0a0a0` border/separators.

Kuubik now opens a keyboard-accessible drawing context menu at the real model
canvas world position. Its 200x371 px envelope and measured colors match the
native reference exactly. Active-command and selected-object variants expose
working Cancel, Undo, Redo, Erase, Deselect All, Count and Properties actions;
unsupported entries remain visibly disabled instead of pretending to work.
Arrow/Home/End navigation, focus, hover, outside-click, blur, resize and Escape
dismissal are covered. Escape closes only the popup and preserves the active
command or selection.

The fixed Chromium evidence under `evidence/artifacts/visual-shell-wave-6`
contains all six audit states, the selected-object context state and zero
console errors. The public comparison stores only dimensions, colors and the
private screenshot SHA-256. All 29 certified functional rows received fresh
browser, independent read-back, applicable cross-evidence, global-topology and
content-address receipts after the shared App/style change.

Scores remain deliberately unchanged at **29/133, 21.8% raw / 25.2%
weighted**, and **60.7% visual** with **1/6 paired states PASS**. A precise
context-menu supplement is not a complete same-environment re-audit of all
five visual categories. No preview or production deployment was performed.

The complete local gate passes typecheck, lint, production build, **84 Vitest
files / 504 tests**, mutation **78/78**, DXF **47/47**, PDF **20/20** and
Chromium **108/108**. Parity-kit, parity, visual, license and public-tree pass.
Pinned Gitleaks 8.30.1 found zero leaks in 1,064 git-visible source files.
LibreCAD 2.2.1.5 and FreeCAD 1.1.3 fixtures pass as secondary non-authorities
with honest `FIXTURE_PASS_NOT_NETWORK_ISOLATED` status.
