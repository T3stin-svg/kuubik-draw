# F-110 licensed Desktop certification

## Boundary

- Exact base: `bb1c337bec54f59d3550c8bd28479648a41bbc09`.
- Branch: `work12/reio-documents-f110-desktop`.
- Scope: F-110 DXF import only. No `App.tsx`, CSS, package, scope, parity-score or production-deployment changes.
- The pre-existing AutoCAD PID 64444 and its user document were not controlled or closed. Only owned scratch PIDs 51612 and 26436 were used.

## Licensed AutoCAD Desktop authority

Autodesk AutoCAD 2024.1.2 reported `ACADVER=24.3s (LMS Tech)`; the installed executable version was `R24.3.152.0.0`.

1. An owned Desktop process opened `F-110-desktop-source.dxf` and wrote a native pre-save semantic manifest.
2. ActiveX `SaveAs` wrote a distinct `ac2018_dxf (65)` scratch copy. This is a real 86,099-byte serialization, not a `QSAVE` marker.
3. A second owned Desktop process reopened the saved file, repeated the manifest and ran `AUDIT` with repairs disabled.
4. Pre/post read-back retained `INSUNITS=4`, 11 model entities, handles `10..90`, `A0`, `B0`, named block `SYMBOL` handle `900`, dimension handle `A0`, type 33, style `DIM-ISO`, actual measurement `103.077640640442` and anonymous-block handle `700`.
5. AutoCAD's permitted anonymous name normalization was `*D1 -> *D0`. `AUDIT` reported 100 objects in both passes, two blocks, `Total errors found 0 fixed 0` and `Erased 0 objects`.

## Desktop-normalized import repairs

The licensed Desktop roundtrip exposed three production parser gaps, each closed fail-safe with positive and negative tests:

- AC1021 and newer byte streams now use strict UTF-8 decoding; legacy AC1018 remains on Windows-1252. Invalid modern UTF-8 fails closed.
- MTEXT group `11/21/31` direction vectors are accepted only when planar, non-zero, complete and not combined with group 50.
- AutoCAD's exact disabled-gradient HATCH tail (`450..470`) is accepted; enabled, named or malformed gradient state still fails closed.

## Independent read-back

- `ezdxf 1.4.3`: source and Desktop-save semantic manifests matched after only the documented version/name normalization; both audits returned zero errors and fixes.
- Kuubik parser: source and Desktop-save semantic manifests matched after 12-decimal numeric normalization, with zero skipped records and exact UTF-8 `TÕEND ŠŽ€` text.
- Source SHA-256: `99e40e4537e1788a6ebd2d9d6092b4501f3e7fc96fb7fe1769dbeaae549bb0d3`.
- Desktop-save SHA-256: `8540f77da4b011c39f38fee5cdeb285ca854e918398fa1fd8944eab31cd4cb4f`.

## Production Chromium

The exact Desktop-save SHA was imported through the visible production DXF file control at `http://127.0.0.1:5204/d/local`, not through the isolated harness. Chromium at 1920x1080 performed:

`DXF import -> select all -> MOVE 10,20 -> Undo -> Redo -> reload IndexedDB revision 4 -> DXF export`.

The exported 7,634-byte DXF reopened with all 11 model handles, both block entity handles, millimetres and UTF-8 text. Browser/page console errors: zero. A separate in-app Browser read-back confirmed visible production DXF import/export, MOVE, UNDO and REDO controls.

- Browser export SHA-256: `90f0ce92ff2c263cec219ed625b2f0d4bc7fec03fd194764b767e0ff177fb6e0`.
- Browser screenshot SHA-256: `4143d4aa063ac13933323de67d2947e40e69dcbe955134affe27850603cb848e`.

## Validation

- Targeted F-110 runner/parser suite: 4 files, 13 tests, PASS.
- Full Vitest: 235 files, 1,086 tests, PASS.
- Typecheck: PASS.
- Lint: PASS.
- DXF gate: 26 files, 67 tests, PASS.
- PDF gate: 7 files, 22 tests, PASS.
- Production Chromium F-110: 1 test, PASS.
- Build: PASS; existing Vite chunk-size warning only.
- Public-tree provenance: PASS, 1,719 files.
- License gate: PASS, 119 installed packages.
- `git diff --check`: PASS.
- `parity:kit:validate`: repository-global topology/content-address receipts are stale after the new source and evidence files; the many unmapped-source diagnostics also remain. Forbidden parity files were not rewritten.
- `parity:check`: F-022 stops at `currentSourceHashCoverage=false` because the shared DXF import source hash changed. Its behavior remains green in the full and DXF suites, but updating another row's evidence is outside this workstream. F-110 authority receipts content-address correctly.

F-110 receives PASS receipts in `evidence/autocad`, `evidence/browser` and `evidence/readback`. The parity score file remains unchanged per workstream ownership constraints.

## Native boundary

No DWG, DWT or XREF parity claim is made here. F-112, F-113, F-117 and F-121 still require a licensed ODA Drawings SDK or RealDWG integration; this F-110 DXF Desktop run neither supplies nor bypasses that gate.
