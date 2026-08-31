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
- GRID, ORTHO, OSNAP, OTRACK and DYN are owned by `PrecisionCommandState`; the same state handles status clicks, F-key dispatch and command-line input. Cursor read-back uses `PrecisionCommandState.prepareRequest()` before `PrecisionFeatureModel.preview()`.
- Layer creation/current/toggles are planned by `LayerManagerController.plan()` and committed through the common document transaction path. React does not construct layer changes.
- MTEXT and LEADER use `prepareAnnotationCommand` and the same atomic runtime commit/read-back path. Dimension, hatch, style and all block commands remain disabled until the shell can collect every required prompt and prove the resulting commit.
- Document tabs use `document-tabs.ts`; New uses `createNewModelSpaceDocument`, and one `CadSession` is retained per open tab.

Selected commands without one of these bindings remain visible and disabled with the integration-pending explanation. Scope selection alone never enables a command.

The browser regression at dev port 5225 proves LINE, Undo/Redo, PLINE, CIRCLE, ARC, F8 ORTHO, command-line GRID, layer creation, committed MTEXT/LEADER and ModelSpaceDocument tab switching while capturing zero console/page errors. It also proves that unfinished dimension, hatch and block commands remain disabled. It does not certify AutoCAD parity or raise any F-row/visual score.

## Remaining integrator interfaces

- `DocumentSessionCoordinator` needs a persisted Undo/Redo or explicit candidate-acceptance API before the shell can replace its existing per-document `CadSession` map without weakening durable read-back.
- Precision OSNAP/OTRACK needs per-document `CadSnapIndex`, `CadSelectionIndex` and world-aperture ownership at the application boundary before candidate snapping can be called live rather than shown as a state toggle.
- Dimension/HATCH and block commands need a shell-owned typed prompt result for every required field. Until then their visible controls stay `Arenduses` and disabled.
- Autosave recovery and PDF-underlay surfaces remain document-workstream integration tasks; this wave does not claim them.

## Persisted shell keys

- `kuubik-draw-workspace`: `drafting | focus | review`
- `kuubik-draw-palette-mode`: `docked | floating | auto-hide`

These keys affect presentation only and are deliberately outside `.kdraw` and IndexedDB document schemas.
