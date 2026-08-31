# Precision and layers integration contract

This workstream intentionally does not edit shared `src/index.ts` files or
`apps/web/src/App.tsx`. The integration branch must add the exports and wiring
below. No new runtime dependency is required.

## Package exports

The current integrated base `e5b65b566912c969320989f5cbb7365e34fe1a1d`
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

The fourth-wave typed Layer Manager boundary is:

- `apps/web/src/features/layers/shell-adapter.ts`

It is available as `PrecisionLayersShellContract.layerManager`, or a caller may
construct `LayerManagerShellAdapter` around an existing
`LayerManagerController`. Runtime dispatch uses `LayerManagerCapability` values
such as `layers.visibility`, `layers.properties` and `layers.draw-order`; F-row
strings are metadata only.

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

## Typed input and constraint pipeline

The sixth-wave parser is still the existing exported
`parseCadPrecisionInput()` core entry point; no second command-line or Dynamic
Input parser exists. `PrecisionLayersShellContract.preparePointer()` parses a
string once, stores the typed value in the immutable request and sends that
same request to preview, commit and Dynamic Input.

Supported forms are:

- absolute Cartesian `x,y` or `#x,y`;
- relative Cartesian `@dx,dy`;
- absolute polar `distance<angle` and relative polar `@distance<angle`;
- direct distance `distance`.

Length tokens may use `mm`, `cm`, `m`, `in` or `ft`; returned values are always
converted to the document's linear unit. Polar angles default to degrees and
accept `deg`, `°` or `rad`. Dot-decimal input accepts comma or semicolon between
Cartesian values. Comma-decimal input requires semicolon, for example
`@1,5m;-250,25mm`, so `1,5` is unambiguously one scalar. Malformed, non-finite,
mixed unitless/physical and ambiguous locale input fails closed.

Signed and zero distance are accepted without rounding. A zero direct distance
first resolves to the exact base point and then, like every direct-distance
entry, continues through active GRID, OSNAP and OTRACK stages. Explicit
Cartesian and polar coordinates bypass cursor aids and therefore avoid spatial
queries entirely.

For cursor/direct-distance frames, candidate generation is centered on the
provisional result from the same core resolver after ORTHO/POLAR and GRID, not
on the raw pointer. This keeps an intersection at the constrained target
eligible and preserves the fixed OSNAP-before-OTRACK priority. The layer list
used by pointer queries is snapshotted when spatial indexes are rebuilt; a
pointer frame no longer clones the full document.

Set locale/default input behavior through
`PrecisionLayersShellContractOptions.inputFormat`. Use the exported
`PRECISION_TOGGLE_SHORTCUTS` contract for F3 and F7–F12. F-047 intentionally
has two distinct capabilities: F7 controls GRID display and F9 controls model
SNAP quantization. Row-only dispatch maps F-047 to GRID; the shell must route
F9 through the shortcut capability instead of treating the parity row as a
unique toggle identifier.

OSNAP priority is fixed as endpoint, midpoint, center, quadrant, intersection,
extension, insertion, perpendicular, tangent, nearest, geometric center and
parallel. Ties are deterministic by distance and stable semantic candidate ID.
The ID contains mode, canonical entity/segment identity and exact point, but not
priority, cursor distance or entity input order.

## Complete snap/tracking shell boundary

The fifth-wave renderer API adds `CadSnapSelectionCycle`. Call
`updateSnapCycle()` for a fresh candidate stack, `cycleSnap()` for next/previous
selection and pass the returned `candidateId` to `preparePointer()` as
`snapCandidateId`. A prepared pointer then contains exactly that candidate and
returns `request`, `snapCandidateIds` and `selectedSnapCandidateId` beside its
preview, commit and Dynamic Input read-back. A stale explicit ID fails closed.

Extension and Parallel can require a previously hovered/acquired object outside
its finite R-tree bounds. Pass those handles as `referenceHandles` to
`CadSnapIndex.query()`, or as `snapReferenceHandles` to `preparePointer()`.
This avoids scanning all directional objects and preserves the 50,000-object
spatial bound. Parallel also requires `referencePoint`.

OTRACK acquisition uses the stable snap candidate ID. `acquireTracking()`
returns the exact stored point/time, while `releaseTracking()` and
`clearTracking()` return mutation read-back. Polar extensions canonicalize
opposite angles onto one infinite line; IDs do not depend on angle-list or
acquisition order. When POLAR is enabled, the shell contract derives OTRACK
angles from the configured increment and additional angles.

`DynamicInputModel` exposes unrounded `coordinate`, `delta`, `distanceValue`
and normalized `[0, 2π)` `angleRad`, plus the normalized units snapshot and
formatted `x`, `y`, `distance` and `angleDeg`. Display precision never changes
the committed point.

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

For new shell wiring, prefer `executeLayerCapability()` or
`contract.layerManager.execute()` with a `LayerManagerShellCommand`. Visibility,
freeze, lock, plot and appearance commands accept multiple layer ids. The
`layers.properties` capability combines visible, frozen, locked, plottable,
color, ACI/true-color method, linetype, lineweight and transparency changes.
All layer ids and every property are validated against an isolated planning
document before one `LAYER_BATCH_PROPERTIES` operation is committed. A failure
on the last layer therefore cannot leave earlier layers changed. One Undo and
one Redo restore the exact pre/post layer collections.

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
  intent to the relevant dialog/result and finish it through
  `executeLayerCapability()`.
- Bind Layer Manager fields to `LAYER_MANAGER_CAPABILITY`; use
  `layers.properties` for multi-selection property edits instead of issuing one
  command per layer.
- Replace the open shell document only from `executeLayer()`, `undoLayer()` or
  `redoLayer()` read-back.
- Use `select()`, `querySnap()` and `participates()` instead of independent
  hidden/frozen/locked predicates.
- Use `updateSnapCycle()` / `cycleSnap()` and feed the selected ID back to
  `preparePointer()`; the visual worker must not reorder or regenerate IDs.
- Use `acquireTracking()`, `releaseTracking()` and `trackingCandidates()` for
  OTRACK markers and guides. Do not keep a second UI-side acquisition store.

## App surfaces still requiring integration-owner edits

- Connect the existing command-line and status controls to the typed feature
  adapters. Do not duplicate their key/command parsing in React.
- Connect Layer Manager fields/dialogs to typed layer commands and replace the
  open document only with the returned read-back document.
- Draw-order commands and context menu actions.
- IndexedDB read-back and real-browser workflows on the integration owner's
  selected dev port.

The integrated base uses row `F-086` for a Block Create ribbon tool, while this
assigned workstream records `F-086` as draw-order parity metadata. The legacy
`LayerVisualShellCommandAdapter` deliberately no longer claims the `F-086`
string. Draw order is callable only through the typed capability
`LAYER_MANAGER_CAPABILITY.drawOrder` (`layers.draw-order`). The integration
owner must bind Block Create and draw order by their separate capability keys
and resolve the duplicated parity-row ownership before changing scope data.
This branch does not edit `App.tsx`, shell files or the scope manifest.

Do not change parity scores until the required AutoCAD 2024.1.2 and Chromium
live evidence is complete.
