# Visual shell integration contract

This workstream owns only the Kuubik Draw shell, presentation state and visual evidence. It does not change CAD geometry, persistence formats, DXF/PDF behavior or print calculations.

## Scope source

`apps/web/src/shell/reio-scope.ts` is the typed visual copy of Reio's exported `kuubik-draw-reio-scope-v1.json` (schema 1, exported 2026-08-31T12:25:36.154Z). The integration branch owns the canonical public manifest. The shell copy exists so this isolated worktree does not depend on a Downloads path at runtime.

Ribbon and status controls expose `data-feature-row` and `data-scope-selected`. A row outside the selected set stays visible and disabled with the exact explanation `Pole sinu töövoogu valitud`.

## Runtime adapter

`apps/web/src/shell/runtime-adapter.ts` is the typed boundary between the visual shell and the integrated deterministic feature modules. A ribbon control is enabled only when both conditions hold: the F-row belongs to Reio's selected scope and `VisualShellRuntimeAdapter.canExecute()` confirms a real runtime binding.

Current bindings:

- LINE and RECTANGLE use `CommandLineEngine` + `CommandRegistry`; LINE is prepared by `prepareGeometryCommand`, and both commit through `CadSession` plus IndexedDB read-back.
- Existing Move/Copy/Rotate/Scale/Mirror/Offset/Trim/Stretch/Fillet/Match Properties application workflows retain their tested core planners and transaction path.
- GRID, ORTHO, OSNAP, OTRACK and DYN are live state controls. Cursor read-back passes through `PrecisionFeatureModel.preview()`; the status bar exposes the resulting precision source.
- Layer creation/current/toggles are planned by `LayerFeatureModel` and committed through the common document transaction path. React does not construct layer changes.
- Annotation and block panels call `createAnnotationAction` and `createBlockAction`. These are validated typed intents only; they do not claim annotation/block geometry completion.
- Document tabs use `document-tabs.ts` for open, activate, close, layout and dirty/persisted read-back. A `CadSession` is retained per open tab.

Selected commands without one of these bindings remain visible and disabled with the integration-pending explanation. Scope selection alone never enables a command.

The browser regression at dev port 5215 proves LINE, Undo/Redo, precision toggle, layer creation, MTEXT/INSERT intent and document tab switching while capturing zero console/page errors. It does not certify AutoCAD parity or raise any F-row/visual score.

## Persisted shell keys

- `kuubik-draw-workspace`: `drafting | focus | review`
- `kuubik-draw-palette-mode`: `docked | floating | auto-hide`

These keys affect presentation only and are deliberately outside `.kdraw` and IndexedDB document schemas.
