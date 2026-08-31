# F-110 anonymous dimension-block audit repair

## Boundary

- Branch: `work11/reio-documents-f110-audit`.
- Exact integrator base: `6d6213d9e1c59a2471a106bdb3985176b9a1f41c`.
- Scope: repair and prove the anonymous DIMENSION picture-block contract only.
- F-110 parity score remains unchanged. AutoCAD desktop save/reopen is still an owner gate; this wave proves the requested licensed AutoCAD 2024 Core Console read-only AUDIT.

## Root cause and repair

The prior exporter emitted the first picture block as `*D1`, but wrote DIMENSION group 70 as only subtype `0` or `1` and wrote its BLOCK group 70 as `0`. Autodesk's DXF contract requires bit 32 on R13+ DIMENSION entities when group 2 names a picture block owned by that dimension, and bit 1 on an anonymous BLOCK. AutoCAD consequently generated/reported an invalid `*D0` during audit even though the source text named `*D1`.

The repaired exporter now:

- emits DIMENSION group 70 as `32 | subtype`;
- emits anonymous dimension BLOCK group 70 as `1`;
- keeps the same name in DIMENSION group 2, BLOCK_RECORD group 2, BLOCK groups 2 and 3;
- keeps BLOCK and ENDBLK group 330 owners equal to the matching BLOCK_RECORD handle;
- normalizes anonymous picture-block names deterministically as `*D1`, `*D2`, ... in document-entity order.

The strict importer continues to omit AutoCAD-owned picture blocks from editable user blocks. Re-export regenerates the same deterministic names and bytes.

## Regression ratchet

`f110-dimension-block-audit.test.ts` failed on the exact base before the repair with:

```text
expected +0 to be 32
packages/cad-dxf/test/f110-dimension-block-audit.test.ts:45
```

It now checks the DIMENSION single-owner bit, anonymous BLOCK bit, shared name, BLOCK_RECORD handle and BLOCK/ENDBLK owner references.

## Fixture and independent read-back

- Path used for the native run: `C:\Users\Olav\AppData\Local\Temp\kuubik-f110-audit-20260831\f110-audit-fixed.dxf`.
- Size: `7,587` bytes.
- SHA-256 before and after AutoCAD: `99e40e4537e1788a6ebd2d9d6092b4501f3e7fc96fb7fe1769dbeaae549bb0d3`.
- Kuubik strict import/re-export: byte-equal; imported handles `C0,C1,10,20,30,40,50,60,70,80,90,A0,B0`.
- `ezdxf 1.4.3`: `$INSUNITS=4`, DIMENSION picture name `*D1`, blocks `*D1` and `SYMBOL`, and one each of LINE/LWPOLYLINE/CIRCLE/ARC/ELLIPSE/SPLINE/TEXT/MTEXT/HATCH/DIMENSION/INSERT.

## Licensed AutoCAD 2024 Core Console stdout

Read-only script: `f110-coreconsole.scr`; AUDIT repair answer `_N`, then quit and discard.

```text
AutoCAD Core Engine Console - Copyright 2023 Autodesk, Inc.  All rights reserved. (U.152.0.0)
Version Number: U.152.0.0 (UNICODE)
Auditing Header
Auditing Tables
Auditing Entities Pass 1
Pass 1 100     objects audited
Auditing Entities Pass 2
Pass 2 100     objects audited
Auditing Blocks
 2       Blocks audited
Auditing AcDsRecords
Total errors found 0 fixed 0
Erased 0 objects
```

Process exit code was `0`; no AutoCAD Core Console process remained. The unchanged post-run SHA proves the audited input was not repaired or replaced.

## Real browser read-back

The existing isolated Chromium/IndexedDB F-110 harness passed on dev port 5204:

- import revision 1;
- Undo revision 2;
- Redo and recovered revision 3;
- `cm -> mm`, insertion scale 10;
- handles `C0,10,20`;
- operations `DXFIN,UNDO,DXFIN`;
- recovery source `operation-log`, unclean session `f110-browser-crashed`.

## Final gates

- Targeted F-110 audit/import/read-back suite: PASS, 4 files and 9 tests; 50,000-entity import 0.899 seconds.
- `npm run typecheck`: PASS.
- `npm run lint`: PASS.
- `npm run test`: PASS, 232 files and 1,075 tests.
- `npm run gate:dxf`: PASS, 26 files and 66 tests; 50,000-entity import 1.624 seconds.
- `npm run gate:pdf`: PASS, 7 files and 22 tests.
- `npm run build`: PASS; 153 web modules transformed.
- `node tools/provenance/scan-public-tree.mjs`: PASS, 1,694 files and no blocked artifacts or secret patterns.
- `npm run license:check`: PASS, 7 files, 5 provenance entries and 119 installed packages audited.
- `git diff --check`: PASS.
