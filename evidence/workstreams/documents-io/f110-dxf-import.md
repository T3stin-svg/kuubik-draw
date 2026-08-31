# F-110 DXF import candidate evidence

## Boundary

- Branch: `work10/reio-documents-f110-import`
- Integrator base: `c607df360f68714e87b475ffbbc1a889abf93306`
- Scope: selected F-110 ASCII DXF import, editable document transaction and export read-back only.
- No `App.tsx`, style, package, scope, parity-score, native-DWG adapter or security-evidence file is changed.
- This wave does not change the F-110 score. AutoCAD remains the final authority.

## Implemented contract

- Typed import: LINE, RAY, XLINE, LWPOLYLINE including bulge/start/end widths, CIRCLE, ARC, ELLIPSE, rational/non-rational SPLINE, TEXT, MTEXT, straight-loop HATCH, linear/aligned DIMENSION and named BLOCK/INSERT.
- Resources: layers, ACI/TrueColor, lineweight, linetype/pattern, text style and dimension style.
- Units: `unitless/in/ft/mm/cm/m` header read-back. `targetUnits` applies one deterministic geometry/resource insertion scale. Unitless conversion is refused without an external interpretation.
- Handles: source entity and block-entity handles remain stable and globally unique. Duplicate table, block, object or entity handles refuse the whole file.
- Unknown records: optional inert proxy preservation includes exact ordered group pairs and a separate proxy-handle receipt. DXFIN still refuses every partial import before mutation. Proxies cannot be insertion-scaled or silently exported.
- Named blocks: definition base point, child entities and INSERT point/X-Y scale/rotation are editable typed state. Missing definitions, zero scale, MINSERT arrays and non-planar transforms fail closed.
- MTEXT: multiline content, style, height, angle, width and attachment survive deterministic import/export. Direction-vector rotation is outside this bounded path and fails closed.
- DXFIN: parse first, preserve paper layouts/resources, persist one `replace-drawing-content` operation, then export and reparse the persisted revision. Undo/Redo use the same append-only recovery log.

## Independent read-back

- Production fixture: `7,586` bytes; SHA-256 `f9f237a8dfa6a1183799a5cacb397123a07577678cad0486739d46e5c5a0f254`.
- Third-party `dxf-parser` reopened the physical bytes, read `$INSUNITS=4`, model INSERT and named `SYMBOL` block.
- Independent `ezdxf 1.4.3` read the same SHA and reported one each of LINE/LWPOLYLINE/CIRCLE/ARC/ELLIPSE/SPLINE/TEXT/MTEXT/HATCH/DIMENSION/INSERT, `SYMBOL` present and INSERT name `SYMBOL`.
- Kuubik strict parser reimported block handles `C0,C1` and model handles `10,20,30,40,50,60,70,80,90,A0,B0`; second-generation bytes equal the first generation.
- Real Chromium/IndexedDB harness: import revision 1, Undo revision 2, Redo revision 3, unclean recovery revision 3, `cm -> mm` scale 10, handles `C0,10,20`, operation commands `DXFIN,UNDO,DXFIN`, recovery source `operation-log`.
- 50,000 LINE import completed in 1.511 seconds in the final DXF gate; the fail threshold is 8 seconds.

## Native authority blocker

Licensed AutoCAD 2024 Core Console `U.152.0.0` opened the exact fixture. Its read-only `AUDIT` found two errors for an invalid anonymous dimension block named `*D0`; no repair was accepted. The source DXF itself consistently contains and references `*D1`, so this is an unresolved AutoCAD dimension-block materialization mismatch rather than a parser-count mismatch.

Therefore F-110 is a green implementation candidate but not an AutoCAD-certified parity row. A dedicated owned AutoCAD desktop roundtrip must resolve the anonymous DIMENSION block, save/reopen the DXF, and return zero AUDIT errors before any score change. LibreCAD/FreeCAD results, if run, remain secondary and cannot clear this blocker.

Follow-up `work11/reio-documents-f110-audit` corrects the DIMENSION/BLOCK anonymous flags and obtains a licensed AutoCAD 2024 Core Console read-only `AUDIT` result of `Total errors found 0 fixed 0`; see `f110-dimension-block-audit.md`. The parity score remains unchanged until the separate AutoCAD desktop owner gate is completed.

## Tests

- Golden/core roundtrip, deterministic units and insertion scale.
- Mutation matrix for units, tables, blocks, handles, ellipse, spline, MTEXT and INSERT.
- Deterministic malformed numeric-token fuzz corpus.
- Physical temp-file write/hash/reopen with `dxf-parser`, strict parser and byte-equal second export.
- Atomic DXFIN, refusal-before-mutation, Undo/Redo, multi-document isolation and append-only recovery.
- Real browser IndexedDB harness and source-order wiring ratchets.

## Final gates

- `npm run typecheck`: PASS.
- `npm run lint`: PASS.
- `npm run test`: PASS, 216 files and 1,030 tests.
- `npm run gate:dxf`: PASS, 24 files and 64 tests; the 50,000-entity F-110 case completed in 1.511 seconds.
- `npm run gate:pdf`: PASS, 7 files and 22 tests.
- `npm run build`: PASS for cad-core, cad-renderer, cad-dxf, cad-print and web.
- `node tools/provenance/scan-public-tree.mjs`: PASS, 1,669 files and no blocked artifacts or secret patterns.
- `npm run license:check`: PASS, 7 files, 5 provenance entries and 119 installed packages audited.
- `git diff --check`: PASS.
