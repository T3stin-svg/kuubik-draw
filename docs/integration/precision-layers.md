# Precision and layers integration contract

This workstream intentionally does not edit shared `src/index.ts` files or
`apps/web/src/App.tsx`. The integration branch must add the exports and wiring
below. No new runtime dependency is required.

## Package exports

The current integrated base `9af0b7b241ec28f6d5976ed69f79d973611f1c5b`
already contains all required package exports. No shared `src/index.ts` file
needs to change for this workstream.

The existing core exports consumed by the contract are:

```ts
export * from "./precision-input.js";
export * from "./precision.js";
export * from "./units.js";
export * from "./layer-policy.js";
export * from "./layers.js";
export * from "./draw-order.js";
```

The existing renderer exports consumed by the contract are:

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

The third-wave DOM-independent composition root is:

- `apps/web/src/features/precision/shell-contract.ts`

The integrator should construct one `PrecisionLayersShellContract` per open
document and replace duplicated React precision/layer state with that instance.
This application feature is imported directly; it does not require a new
shared-package export.

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

1. Construct `PrecisionLayersShellContract(document, options)`. It owns one
   `CadSnapIndex`, one `CadSelectionIndex`, one `CadObjectTrack`, the typed
   precision state and the layer controller for that document.
2. Convert the cursor aperture from pixels to document world units before
   setting `options.settings.aperture` or preparing a pointer frame.
3. For every pointer frame, call `preparePointer()` exactly once. Use the
   returned `PreparedPrecisionPointer.preview()`, `.commit()` and
   `.dynamicInput()` methods. The object owns a cloned immutable request, so a
   later mode or layer change cannot make the committed point differ from its
   preview.
4. Call `querySnap()` for cursor markers, `acquireTracking()` after an OSNAP
   acquisition and `trackingCandidates()` for guide rendering. Do not rebuild
   candidate priority or layer filtering in React.
5. Only displayed Dynamic Input strings are rounded; its `point` and the
   committed document geometry retain double precision.
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

Live integration should call `PrecisionLayersShellContract.executeLayer()` with
a typed command, then replace the shell document with the returned cloned
read-back. `undoLayer()` and `redoLayer()` provide the same read-back contract.
Every successful call refreshes both spatial indexes. The controller always
plans against its latest document and commits exactly one operation/revision.
It covers create, rename, delete, current, visible, frozen, locked, plottable,
color, linetype, lineweight, transparency and draw order. A planner error occurs
before the operation id/revision is committed and leaves the document unchanged.

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

## Exact integrator touch points

- Use `contract.commandAdapter` wherever the shell currently expects a
  `VisualShellCommandAdapter`.
- Send F3/F7/F8/F9/F10/F11/F12 to `handlePrecisionKey()` and command-line text
  to `executePrecisionCommand()`.
- Use `preparePointer()` once per pointer frame; never separately reconstruct a
  precision request for commit.
- Consume layer ribbon/menu requests with `takeLayerIntents()`, map each typed
  intent to the relevant dialog/result and finish it through `executeLayer()`.
- Replace the open shell document only from `executeLayer()`, `undoLayer()` or
  `redoLayer()` read-back.
- Use `select()`, `querySnap()` and `participates()` instead of independent
  hidden/frozen/locked predicates.

## App surfaces still requiring integration-owner edits

- Connect the existing command-line and status controls to the typed feature
  adapters. Do not duplicate their key/command parsing in React.
- Connect Layer Manager fields/dialogs to typed layer commands and replace the
  open document only with the returned read-back document.
- Draw-order commands and context menu actions.
- IndexedDB read-back and real-browser workflows on the integration owner's
  selected dev port.

The integrated base currently uses row `F-086` for a Block Create ribbon tool,
while this assigned workstream contract uses `F-086` for draw order. The shared
integration owner must resolve that row ownership before binding
`LayerVisualShellCommandAdapter`; this branch does not edit `App.tsx` or scope
data to guess the resolution.

Do not change parity scores until the required AutoCAD 2024.1.2 and Chromium
live evidence is complete.
