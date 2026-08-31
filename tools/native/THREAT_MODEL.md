# Native DWG/DWT/XREF adapter threat model

Scope: future F-112, F-113, F-117 and F-121 implementation behind a licensed ODA Drawings SDK or Autodesk RealDWG adapter.

## Trust boundaries

1. Browser and KDraw documents are untrusted inputs.
2. Native DWG/DWT/XREF bytes and every transitive reference are untrusted.
3. The licensed SDK runtime is a pinned native-code dependency with a recorded license id and SHA-256.
4. AutoCAD 2024.1.2 is the live comparison authority, not the runtime adapter.
5. LibreDWG, LibreCAD, FreeCAD and ODA File Converter are not certification authorities for these rows.

## Required controls

- Parse in a disposable, low-privilege worker process with CPU, memory, object-count, nesting-depth and wall-clock limits.
- Pass bytes through a broker; never let an untrusted drawing choose an arbitrary host path.
- Disable network access. Reject UNC, device, URL and traversal paths. Resolve permitted relative XREFs inside one explicit corpus root.
- Pin and hash every loaded native DLL; use safe DLL search flags and a private runtime directory.
- Reject encrypted/password-protected files unless a separately approved owner flow exists.
- Treat OLE, scripts, data links, external images, fonts, point clouds and other active/external payloads as blocked attachments until individually modeled.
- Preserve unknown/proxy objects across save or refuse the operation. Object-count equality alone is insufficient.
- Write to a new temporary output, reopen it with the same licensed SDK, then with owned AutoCAD, compare the semantic manifest and only then expose bytes. Never overwrite the source.
- Authenticate and terminate only adapter-owned or test-owned processes. Preserve every pre-existing AutoCAD process.
- Log source/output SHA-256, SDK identity, license evidence id, warnings, proxy counts, recovery actions and AutoCAD read-back.

## Failure policy

Any missing license evidence, runtime hash, corpus approval, XREF dependency, proxy preservation proof, output reopen, AutoCAD read-back or resource limit produces a hard failure. A repaired or partially imported file is never silently labeled equivalent.
