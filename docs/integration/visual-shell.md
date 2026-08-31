# Visual shell integration contract

This workstream owns only the Kuubik Draw shell, presentation state and visual evidence. It does not change CAD geometry, persistence formats, DXF/PDF behavior or print calculations.

## Scope source

`apps/web/src/shell/reio-scope.ts` is the typed visual copy of Reio's exported `kuubik-draw-reio-scope-v1.json` (schema 1, exported 2026-08-31T12:25:36.154Z). The integration branch owns the canonical public manifest. The shell copy exists so this isolated worktree does not depend on a Downloads path at runtime.

Ribbon and status controls expose `data-feature-row` and `data-scope-selected`. A row outside the selected set stays visible and disabled with the exact explanation `Pole sinu töövoogu valitud`.

## Temporary typed adapter

The shell currently emits two kinds of presentation-only intent:

- selected ribbon tools that already have an application command keep their existing handler;
- selected tools whose geometry workflow belongs to another workstream only update the command prompt/status and never mutate the document;
- `ORTHO`, `OSNAP`, `OTRACK` and `DYN` carry their selected F-row metadata but stay disabled until the geometry-engine workstream provides the adapter.

Integration must replace the temporary intents with typed command-registry calls. Until that happens, these controls must not be used as evidence that F-045, F-049, F-050 or F-052 geometry behavior is complete.

Recommended adapter boundary:

```ts
export interface VisualShellCommandAdapter {
  canExecute(rowId: string, context: "model" | "paper"): boolean;
  execute(rowId: string): void;
  precisionMode(rowId: "F-045" | "F-049" | "F-050" | "F-052"): boolean;
  setPrecisionMode(rowId: "F-045" | "F-049" | "F-050" | "F-052", enabled: boolean): void;
}
```

## Persisted shell keys

- `kuubik-draw-workspace`: `drafting | focus | review`
- `kuubik-draw-palette-mode`: `docked | floating | auto-hide`

These keys affect presentation only and are deliberately outside `.kdraw` and IndexedDB document schemas.
