# F-097 Layout tab certification scope

The fixed AutoCAD 2024.1.2 Windows 2D row is `Layout tabs – create/copy/reorder/delete`.

Required AutoCAD and Kuubik workflows:

- the Model layout remains first and cannot be copied, renamed, reordered or deleted;
- create adds a paper layout with a unique case-insensitive name;
- layout names contain 1–255 valid characters and duplicates are refused case-insensitively;
- no more than 255 paper layouts may exist;
- copy uses AutoCAD's incremental `Name (2)` convention and inserts immediately before the source;
- copy deep-clones paper settings, viewports and paper-space entities while allocating fresh viewport IDs and entity handles;
- changing source paper geometry after copy cannot mutate the copy;
- reorder changes only paper-tab order and never moves Model;
- deleting the active copy activates the adjacent surviving source and cannot delete the final paper layout;
- every create, rename, copy, reorder and delete is one revision and one atomic Undo/Redo operation;
- ordered layouts survive IndexedDB reload and production `.kdraw` serialization;
- the owned AutoCAD matrix saves and reopens a temporary native DWG, but no DWG is retained in the public repository;
- browser and independent readers verify the exact operation log, tab order, identifiers, paper data and hashes.

F-097 owns layout-tab management and paper-space copy identity. Named page setup
authoring and persistence belong to F-102/F-107 and are not double-counted here.

The implementation is independent TypeScript. LibreCAD and FreeCAD are not
certification authorities for AutoCAD's layout database or UI behavior.
