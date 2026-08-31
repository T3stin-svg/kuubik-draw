# Precision and layers integration contract

This workstream intentionally does not edit shared `src/index.ts` files or
`apps/web/src/App.tsx`. The integration branch must add the exports and wiring
below. No new runtime dependency is required.

## Package exports

The integrated base `34683acfb1ab7a0546539cd6f72546ecb868011c`
already contains the required package exports below. No shared `src/index.ts`
file needs to change in the second-wave branch.

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
- `apps/web/src/features/precision/command-adapter.ts`
- `apps/web/src/features/layers/model.ts`
- `apps/web/src/features/layers/controller.ts`
- `apps/web/src/features/layers/command-adapter.ts`

## Typed shell adapter

Compose `PrecisionVisualShellAdapter` first and wrap it in
`LayerVisualShellCommandAdapter`. This implements the shell team's typed
`VisualShellCommandAdapter` without importing `shell/**` into either feature.

The precision state model owns F3 OSNAP, F7 GRID display, F8 ORTHO, F9 model
SNAP, F10 POLAR, F11 OTRACK and F12 Dynamic Input. The same state is available
through ORTHO/POLAR/GRID/SNAP/OSNAP/OTRACK/DYN/DYNMODE command-line input.
Keyboard events from editable controls and repeat events return `handled: false`.
GRID display and SNAP quantization are independent states.

`PrecisionCommandState.prepareRequest()` is the only feature-side conversion
from UI state to `PrecisionRequest`: it enables grid quantization only for SNAP,
filters OSNAP/OTRACK candidate lists when their master state is off, and supplies
the same request to preview, commit and Dynamic Input.

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

Second-wave integration should call `LayerManagerController.execute()` with a
typed command instead. The controller always plans against its latest document,
commits exactly one operation/revision, and returns a cloned document for
read-back. It covers create, rename, delete, current, visible, frozen, locked,
plottable, color, linetype, lineweight, transparency and draw order. A planner
error occurs before the operation id/revision is committed and leaves the
document unchanged.

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

- Connect the existing command-line and status controls to the typed feature
  adapters. Do not duplicate their key/command parsing in React.
- Connect Layer Manager fields/dialogs to `LayerManagerController` commands and
  replace the open document only with the returned read-back document.
- Draw-order commands and context menu actions.
- IndexedDB read-back and real-browser workflows on dev port 5212.

The integrated base currently uses row `F-086` for a Block Create ribbon tool,
while this assigned workstream contract uses `F-086` for draw order. The shared
integration owner must resolve that row ownership before binding
`LayerVisualShellCommandAdapter`; this branch does not edit `App.tsx` or scope
data to guess the resolution.

Do not change parity scores until the required AutoCAD 2024.1.2 and Chromium
live evidence is complete.
