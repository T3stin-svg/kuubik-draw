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
