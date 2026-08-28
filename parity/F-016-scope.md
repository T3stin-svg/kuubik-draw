# F-016 MOVE certification scope

F-016 covers `MOVE` in the fixed AutoCAD 2024.1.2 Windows 2D Drafting &
Annotation audit: base point, destination point, exact displacement, pre- and
postselection, preview, locked-layer handling, zero displacement and one-step
undo.

The standard-object matrix contains every non-proxy entity family in
`KDrawDocumentV1`: line, polyline, circle, arc, ellipse, spline, text, mtext,
leader, dimension, hatch and block reference. AutoCAD and Kuubik execute the
same `+500,+750` move for those twelve families and restore it with one undo.

`proxy` is intentionally outside that standard-object matrix. It represents an
opaque third-party/native object whose transform contract is unknown to the
TypeScript kernel. Kuubik therefore rejects it as `unsupported-entity` and
preserves its handle, raw payload and bounds byte-for-byte instead of guessing
or silently corrupting it. Editing native DWG proxy objects remains part of the
later licensed ODA/RealDWG compatibility phase; this boundary does not remove a
row or change the fixed denominator.
