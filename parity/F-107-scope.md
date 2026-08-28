# F-107 — Named page setups and templates

F-107 owns reusable named page setups and drawing-template workflows for the
fixed AutoCAD 2024.1.2 2D audit.

## Included acceptance matrix

- Create a uniquely named page setup from the active layout.
- Reject a case-insensitive duplicate without changing the document revision.
- Apply the saved setup after the active layout has been changed.
- Rename and delete named setups; deleting a setup removes assignments but
  leaves every layout's current plot settings intact.
- Persist the full A4 portrait / Layout / 1:1 / zero-origin / monochrome /
  lineweight contract and its paper margins.
- Export a deterministic, strictly validated, geometry-free template containing
  units, named setups, Model/Paper layout definitions and viewports.
- Import through a visible file input as one atomic operation, with stable new
  IDs and collision-safe names. Existing model and paper geometry must survive,
  while newly imported layouts contain no drawing entities.
- Global Undo/Redo must remove and restore the entire imported setup/layout
  graph as one step; IndexedDB reload must preserve the resulting revision and
  references.
- Reject malformed JSON, unknown keys, incompatible units, duplicate IDs/names,
  dangling or semantically stale setup references and templates over the size
  limit before commit. Equivalent JSON object-key order must not change validity.
- Chromium at 1920x1080 downloads and reimports the exact production bytes with
  zero console/page errors. A second production invocation must create the same
  bytes, and KDRAW1 checksum read-back must preserve geometry and assignments.
- AutoCAD 2024.1.2 creates, applies, renames and deletes named
  `PlotConfiguration` objects in an isolated scratch process, saves a native
  AutoCAD 2018 DWT, creates a new drawing from it and reads the named setup plus
  applied Layout1 settings, `INSUNITS`, plot origin, paper units, printable
  margins and scale back unchanged. The harness may quit only the independently
  PID-proven process it owns.

AutoCAD's DWT and Kuubik's JSON template are different lawful container
formats. F-107 certifies equivalent named-setup/template behavior, not native
DWG/DWT byte compatibility.

## Excluded rows

- Base paper-space page setup authoring: F-102.
- Plot-style rendering semantics: F-103.
- Vector layout output: F-104.
- Batch publish: F-105.
- Model-space plotting: F-106.
- Native PC3/CTB/STB file interchange: F-108.
- Native DWG/DXF import/export: F-109–F-113.
- Native DWT import/export compatibility: F-117.
