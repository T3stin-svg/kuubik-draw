# Precision and layers integration contract

This workstream intentionally does not edit shared `src/index.ts` files or
`apps/web/src/App.tsx`. The integration branch must add the exports and wiring
below. No new runtime dependency is required.

## Required package exports

Add these exports to `packages/cad-core/src/index.ts`:

```ts
export * from "./precision-input.js";
export * from "./precision.js";
export * from "./units.js";
export * from "./layer-policy.js";
export * from "./layers.js";
export * from "./draw-order.js";
```

Add these exports to `packages/cad-renderer/src/index.ts`:

```ts
export * from "./snap.js";
export * from "./tracking.js";
export * from "./selection-index.js";
```

The feature controllers already live at:

- `apps/web/src/features/precision/model.ts`
- `apps/web/src/features/layers/model.ts`

## Precision wiring

1. Keep one `CadSnapIndex` and one `CadSelectionIndex` per open document. Call
   `setEntities` and `setBlocks` after a committed revision.
2. Convert the cursor aperture from pixels to document world units before
   querying either index.
3. Pass the same `PrecisionRequest` to `PrecisionFeatureModel.preview()` and
   `.commit()`. Do not reproduce ORTHO/POLAR/GRID/OSNAP/OTRACK rules in React.
4. Feed `CadObjectTrack.candidates()` into
   `PrecisionRequest.trackingCandidates`, and map `CadSnapCandidate` to
   `PrecisionCandidate` without changing `priority`, `point`, or `key`.
5. Dynamic Input must call `PrecisionFeatureModel.dynamicInput()`; its point is
   the exact pipeline result and only the displayed strings are rounded.
6. Explicit absolute/relative Cartesian input bypasses cursor aids. Direct
   distance follows the constrained cursor direction and then the shared
   GRID/OSNAP/OTRACK stages.

OSNAP priority is fixed as endpoint, midpoint, center, quadrant, intersection,
perpendicular, tangent, nearest. Ties are deterministic by distance, key and
coordinates.

## Layer and draw-order wiring

Every layer UI action calls the corresponding `LayerFeatureModel` planner and
commits its returned changes as one `CadSession` operation. The UI must not
mutate `document.layers` or `document.entities` directly.

Use `LayerFeatureModel.participates()` as the eligibility callback for the
selection and snap indexes. Renderer and print already implement the same
state matrix at the source commit; integration tests must keep the matrix
locked:

| Layer state | Render | Select | Snap | Print | Edit |
|---|---:|---:|---:|---:|---:|
| normal | yes | yes | yes | yes | yes |
| locked | yes | yes | yes | yes | no |
| off | no | no | no | no | no |
| frozen | no | no | no | no | no |
| non-plottable | yes | yes | yes | no | yes |

Draw order is the model-space `entities` array order. `planDrawOrderChanges()`
preserves entity values and handles and creates one atomic Undo step.

## App surfaces still requiring integration-branch edits

- Command-line and Dynamic Input fields for absolute, relative and direct
  distance input.
- F8 ORTHO, F10 POLAR, F7 GRID, F9 SNAP, F3 OSNAP and F11 OTRACK state wiring.
- Layer Manager CRUD/current and property editors.
- Draw-order commands and context menu actions.
- IndexedDB read-back and real-browser workflows on dev port 5202.

Do not change parity scores until the required AutoCAD 2024.1.2 and Chromium
live evidence is complete.
