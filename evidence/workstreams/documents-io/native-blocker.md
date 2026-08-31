# Native F-112/F-113/F-117/F-121 blocker

Observed 2026-08-31 in the documents-io worktree.

## Machine read-back

- No environment variables matching ODA, RealDWG or Autodesk SDK configuration.
- No installed-program entry for ODA Drawings SDK, Open Design Alliance Drawings SDK or Autodesk RealDWG.
- No RealDWG, `TD_Db` or ODA Drawings SDK binary available through PATH.
- `ODAFileConverter 27.1.0` is installed. This is not licensed Drawings SDK integration evidence and is not used.
- AutoCAD 2024 version 24.3.61.0 is installed. The AutoCAD application is a later live comparison authority; its presence is not a RealDWG redistribution/development license.

## Exact blocker

`NATIVE_SDK_UNAVAILABLE`: no licensed ODA Drawings SDK or Autodesk RealDWG runtime, auditable license evidence and approved anonymized native corpus are available to this worktree.

Therefore:

- F-112 DWG import remains blocked.
- F-113 DWG save/export/roundtrip remains blocked.
- F-117 native DWT workflow remains blocked.
- F-121 native XREF manager remains blocked.

Only adapter interfaces, semantic fixture requirements and the threat model are checked in. No native file was generated, converted, opened, repaired or claimed equivalent. No LibreDWG, FreeCAD or LibreCAD result is used as parity evidence.
