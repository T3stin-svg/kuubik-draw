# Licensed native CAD boundary

`contracts.ts` is the only planned entry surface for DWG import/export, DWT creation and XREF management. The checked-in implementation is deliberately blocked.

Unlock prerequisites:

1. Kuubik Projekt OÜ has a documented ODA Drawings SDK or Autodesk RealDWG license permitting this integration.
2. The pinned runtime and all loaded DLL SHA-256 values are recorded.
3. An owner-approved anonymized DWG/DWT/XREF corpus fills the semantic fixtures.
4. The isolated adapter passes reopen plus owned AutoCAD 2024.1.2 roundtrip read-back.

ODA File Converter, LibreDWG, LibreCAD and FreeCAD do not unlock the interface.
