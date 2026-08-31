# Annotation and blocks workstream evidence

Scope: F-057..F-068 and F-087..F-091 from Reio's selected scope.

This workstream contains typed core planners, immutable extension contracts, feature-intent UI
modules and unit/golden/mutation tests. It intentionally contains no AutoCAD evidence and no
DXF/PDF adapter changes. Therefore no owned F-row is promoted to `1.00` here.

Local targeted verification on 2026-08-31:

- six Vitest files;
- 22 targeted tests passed;
- dimension and hatch stable-handle association updates covered;
- nested block cycle rejection covered;
- BLOCK, BEDIT, EXPLODE and association batches covered by atomic Undo/Redo tests;
- golden JSON contracts checked for dimensions, hatch metadata, block definitions and inserts.

The first full repository regression after implementation passed 92 Vitest files / 543 tests.

Second-wave additions:

- typed annotation and block command adapters prepare exactly one `CadSession` commit;
- prompt/option plans cover F-057..F-068 and F-087..F-091;
- geometry plus associative dimension/hatch refresh is one atomic Undo/Redo operation and keeps
  the annotation handle;
- BLOCK, INSERT, BEDIT, EXPLODE and ATTRIB workflows reject block cycles before commit;
- the DXF capability gate rejects missing, lossy, unsupported and version-incompatible claims;
- `dxf-readback-fixture.json` records the required session 4 read-back, but is not certification
  evidence and cannot promote an F-row to `1.00`.

Final second-wave regression on 2026-08-31 passed 117 Vitest files / 673 tests, plus repository
typecheck, lint, build, public-tree provenance scan, license check and `git diff --check`. Final
commit SHA is recorded in the delivery report.

Third-wave live-shell contract additions:

- typed CommandLineEngine definitions for TEXT, MTEXT, LEADER, MLEADER, DIM, STYLE, HATCH,
  BLOCK, INSERT, BEDIT, EXPLODE and ATTRIB;
- `AnnotationBlockShellAdapter` as the only visual-worker boundary;
- command-specific prompt value/option validation, cancel and prompt repeat;
- preview and commit share the same planner, while one command remains one session commit and one
  Undo/Redo step;
- user-visible missing-planner, missing-session and unsupported-DXF capability states;
- AC1018 MLEADER is absent from the executable registry and fails before document mutation;
- corrupt typed-payload property/mutation cases fail without revision changes.

This is application-runtime contract evidence only. No App/shell wiring, DXF file output,
AutoCAD round trip or F-score promotion is claimed.

Final third-wave regression on 2026-08-31 passed 120 Vitest files / 690 tests. Repository
typecheck, lint, production build, public-tree scan (1370 files), license gate (119 installed
packages) and `git diff --check` also passed.

Fourth-wave live-readiness additions:

- prompt values now build the real typed planner inputs with deterministic free handles;
- the DOM-independent workflow covers TEXT, MTEXT, LEADER, native AC1021 MLEADER, DIM, STYLE,
  HATCH and the complete BLOCK → INSERT → ATTRIB → BEDIT → EXPLODE sequence;
- every tested command performs preview, one CadSession commit, exact read-back, Undo and Redo;
- associative DIM keeps stable target handles; hatch keeps boundary handles, pattern and origin;
- BEDIT preserves both existing insert handles, transforms and attribute values while replacing
  only the immutable definition;
- corrupt prompt/payload and tampered committed-change mutants fail before a false success;
- the JSON-round-tripped DXF capability receipt rejects handle drift and AC1021 → AC1018 MLEADER
  downgrade without modifying a DXF adapter.

The wave still contains no App/shell integration, produced annotation/block DXF, AutoCAD live
workflow or score promotion.

Final fourth-wave regression on 2026-08-31 passed 132 Vitest files / 732 tests. Dedicated gates
passed 15 DXF files / 50 tests and 7 PDF files / 22 tests. Repository typecheck, lint, production
build, public-tree scan (1409 files), license gate (119 installed packages) and
`git diff --check` also passed.

Fifth-wave F-061..F-066 additions:

- DIM BASELINE complements continued chains with an immutable common origin, stable association
  handles and explicit chain mode;
- dimension style create/update/apply preserves style IDs and entity handles, including atomic
  multi-dimension Undo/Redo;
- the namespaced style profile covers drawing/display units, linear/angular precision, rounding,
  four tolerance modes, annotation scale, arrow form, extension distance and text gap;
- deterministic presentation derives exact formatted text, dimension/extension lines, arrow
  tips/directions and angular arc geometry from model coordinates plus the referenced style;
- locked layers and orphan stable-handle associations expose fail-closed capability results;
- golden, deterministic-property, mutation and DOM-independent prompt/planner/commit/read-back
  tests cover the added behavior.

Targeted fifth-wave verification passed 7 files / 44 tests before the full repository regression.
No adapter was changed, no annotation DXF/PDF was produced or reopened, no AutoCAD workflow was
run and no F-score promotion is claimed.

Final fifth-wave regression on 2026-08-31 passed 142 Vitest files / 763 tests. Dedicated gates
passed 16 DXF files / 51 tests and 7 PDF files / 22 tests. Repository typecheck, lint, production
build, public-tree scan (1442 files), license gate (119 installed packages) and
`git diff --check` also passed.
