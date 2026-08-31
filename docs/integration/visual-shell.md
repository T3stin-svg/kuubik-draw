# Visual shell integration contract

This workstream owns only the Kuubik Draw shell, presentation state and visual evidence. It does not change CAD geometry, persistence formats, DXF/PDF behavior or print calculations.

## Scope source

`apps/web/src/shell/reio-scope.ts` is the typed visual copy of Reio's exported `kuubik-draw-reio-scope-v1.json` (schema 1, exported 2026-08-31T12:25:36.154Z). The integration branch owns the canonical public manifest. The shell copy exists so this isolated worktree does not depend on a Downloads path at runtime.

Ribbon and status controls expose `data-feature-row` and `data-scope-selected`. A row outside the selected set stays visible and disabled with the exact explanation `Pole sinu töövoogu valitud`.

## Runtime adapter

`apps/web/src/shell/runtime-adapter.ts` is the typed boundary between the visual shell and the integrated deterministic feature modules. A ribbon control is enabled only when both conditions hold: the F-row belongs to Reio's selected scope and `VisualShellRuntimeAdapter.canExecute()` confirms a real runtime binding.

Current bindings:

- LINE, PLINE, RECTANGLE, CIRCLE and ARC use `CommandLineEngine` + `CommandRegistry`; geometry is prepared by the integrated core adapters and committed once through `CadSession` plus IndexedDB read-back. The host supplies a UUID operation id because a newly constructed engine's private sequence restarts at one.
- Existing Move/Copy/Rotate/Scale/Mirror/Offset/Trim/Stretch/Fillet/Match Properties application workflows retain their tested core planners and transaction path.
- GRID, ORTHO, OSNAP, OTRACK and DYN retain one command state, while pointer frames now run through `PrecisionLayersShellContract`. The contract owns the real snap/selection indexes, acquired tracking candidates, immutable preview/commit request and Dynamic Input read-back. React never fabricates empty candidate arrays.
- Layer creation/current/toggles execute first through `PrecisionLayersShellContract.executeLayer()` and the exact committed change set then passes the shared durable transaction path. React does not construct layer changes.
- MTEXT and LEADER keep their compact command-line path. DIMLINEAR, DIMSTYLE, HATCH, STYLE, BLOCK, INSERT, BEDIT, EXPLODE and ATTRIB use `VisualShellLivePrompt`, which wraps `AnnotationBlockShellAdapter`, exposes one typed field at a time, previews with the feature planner, commits once with a UUID operation and runs `readBackAnnotationBlockCommit`. The durable `DocumentLiveOrchestrator` commit reuses the exact same `committedAt` timestamp and must equal the adapter document byte-for-byte.
- Document open/activate/layout/close, recovery boundaries and all forward durable commits now pass through `DocumentLiveOrchestrator`. New still uses `createNewModelSpaceDocument` as the pure constructor. The Properties palette exposes PDF underlay import through `preparePdfUnderlay` -> `DocumentLiveOrchestrator.attachPdf()` -> stored byte/checksum read-back.

Selected commands without one of these bindings remain visible and disabled with the integration-pending explanation. Scope selection alone never enables a command.

The browser regression at isolated dev port 5235 contains six workflows. In addition to the earlier shell and accessibility matrix it proves DIMSTYLE + DIMLINEAR, associative HATCH, BLOCK -> ATTRIB -> BEDIT -> INSERT -> EXPLODE, real OSNAP/OTRACK/DYN candidate read-back, multi-document orchestration/recovery and atomic PDF attachment byte read-back while capturing zero console/page errors. It does not certify AutoCAD parity or raise any F-row/visual score.

## Remaining integrator interfaces

- Persisted Undo/Redo still originates in the active shell `CadSession`, then uses `DocumentLiveOrchestrator.commit()` for durable acceptance. A future coordinator-owned persisted Undo/Redo API would remove this remaining mirrored in-memory session.
- DIMALIGNED, DIMANGULAR, DIMRADIUS, DIMDIAMETER, DIMCONTINUE and MLEADER stay visibly disabled because their dedicated selection/anchor UX is not yet measured in the shell.
- BEDIT's typed entity/attribute fields accept explicit JSON. This is a real atomic path, but a CAD-native block editor canvas remains future UI work.
- PDF pages with inherited/compressed MediaBox values stay fail-closed until the document adapter receives a PDF.js inspection boundary.

## Persisted shell keys

- `kuubik-draw-workspace`: `drafting | focus | review`
- `kuubik-draw-palette-mode`: `docked | floating | auto-hide`

These keys affect presentation only and are deliberately outside `.kdraw` and IndexedDB document schemas.
