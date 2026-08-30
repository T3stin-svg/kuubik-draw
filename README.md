# Kuubik Draw

Kuubik Draw on eraldiseisev avalik 2D CAD-rakendus. Projekt sihib fikseeritud
AutoCAD 2024.1.2 Windowsi **2D Drafting & Annotation** 133-realise auditi
käitumispariteeti, mitte kogu AutoCADi toodet.

Uuendatud eesmärk, roadmap.sh arhitektuurikaart ja pärast F-022 kohustuslik
efektiivsusvärav on failis [`ARCHITECTURE_ROADMAP.md`](ARCHITECTURE_ROADMAP.md).

## Aus hetkeseis

- vana Drawi auditi snapshot: **63,9% raw / 68,3% weighted / 60,7% visual**;
- vana Drawi AutoCADi live-tõendiga read: **22/133**;
- selle uue eraldatud rakenduse lokaalselt sertifitseeritud seis pärast F-026:
  **27/133 · 20,3% raw / 23,7% weighted**;
- F-026 sõltumatu lõppreview: `0 P0 / 0 P1`; avalik exact-commit CI on veel
  selle laine viimane värav;
- F-025 feature-commit `d0d6421`, GitHub Actions run `33293697704`: `fast`
  roheline 54 sekundiga ja täielik `verify` 3 minuti 26 sekundiga;
- F-024 feature-commit `4462631`, GitHub Actions run `33283660256` ja
  sõltumatu review `0 P0 / 0 P1`;
- F-023 feature-commit `1f4a96c`, CI portability fix `7e252de`, GitHub Actions
  run `33260160549` ja sõltumatu review `0 P0 / 0 P1`;
- avalikult suletud arhitektuurivärav: lõpp-HEAD `d097b34`, GitHub Actions
  run `33250270350`, sõltumatu review `0 P0 / 0 P1`;
- native DWG/DWT/XREF ja PC3/CTB/STB pariteet on veel blokeeritud.
- F-027 `STRETCH` on kohalik kandidaat: typed crossing window/polygon,
  preview=commit, atomic Undo/Redo ning DXF/KDRAW1 read-back on rohelised, kuid
  rida ei ole samade kahe lõppväravata sertifitseeritud.

Need arvud on vana Drawi auditi muutmatu snapshot. Uus rakendus ei päri skoori
enne, kui sama töövoog on siin reprodutseeritud ja tõendatud. LibreCADi või
FreeCADi roheline tulemus üksi ei tõsta ühtegi rida skoorile `1,00`.
Mirror-read F-003 `RECTANGLE` ning F-015…F-021 `ERASE`, `MOVE`, `COPY`,
`ROTATE`, `SCALE`, `MIRROR` ja `OFFSET` on tõendatud AutoCAD 2024, Chromiumi
ning sõltumatu väljundi tagasilugemisega. Transformatsioonid katavad kõik 12
standardset KDraw objektiperekonda; F-021 lisab analüütilise LINE/POLYLINE/
CIRCLE/ARC offset'i ja AutoCADiga mõõdetud ELLIPSE→SPLINE käitumise. Tundmatu
proxy säilitatakse muutmata ning lükatakse ausalt tagasi, kuni litsentsitud
native-adapter suudab selle transformatsioonilepingu tõendada.
F-022 `TRIM` lisab Quick/Standard režiimi, eraldi või kõik cutting edge'id,
Edge/Project/Erase/command Undo, Fence/Crossing, füüsilise Shift-Extend'i,
line/polyline/circle/arc/ellipse/rational-SPLINE geomeetria ning layer-safe
nested block piirid. Sama production rational NURBS DXF läbib Chromiumi,
AutoCAD 2024 typed COM-i, AutoCADi salvestatud DXF-i sõltumatu parseri ja
Kuubiku DXF/KDRAW1 read-back'i; sõltumatu review lõppes `0 P0 / 0 P1`.
F-023 `EXTEND` lisab sama typed töövoo peale Quick/Standard boundary-valiku,
Fence/Crossing režiimid, Edge Extend/No extend, Project None/UCS/View 2D
semantika, käsusisese Undo, füüsilise Shift-TRIM-i ning ühe atomaarse
globaalse Undo/Redo sammu. Line/polyline/arc/circle/ellipse/rational-SPLINE
maatriks läbib Chromiumi, tootmis-DXF/KDRAW1 sõltumatu tagasilugemise,
LibreCADi/FreeCADi sekundaarse oracle-kontrolli ja omatud AutoCAD 2024 desktopi
live-jooksu.
F-024 `FILLET` lisab Radius/Trim/No Trim/Multiple/Polyline,
Shift-raadius-null, `FILLETPOLYARC=0/1`, line/arc/circle/ellipse/polyline/
rational-SPLINE paarid, RAY/XLINE konstruktsioonijooned, täpse segmendivaliku,
layer-safe mixed tulemuse, ühe atomaarse Undo/Redo ning DXF/KDRAW1 read-back'i.
AutoCAD 2024, Chromium, LibreCAD ja FreeCAD kontrollid on rohelised; oracle'id
ei ole sertifitseerimisautoriteet.
F-025 `CHAMFER` lisab Distance/Angle/Method, Trim/No Trim, Multiple/Polyline,
Shift-nullkauguse, täpse polyline-segmendivaliku ja avatud terminali sulgemise.
Liiga lühike valitud polyline-segment keeldub muutmata dokumendi ja Undo-olekuga,
standalone LINE/RAY/XLINE jääb pikendatavaks ning full process-identity ratchet
kaitseb olemasolevaid AutoCADi protsesse. Chromium, AutoCAD 2024 ning sõltumatu
DXF/KDRAW1 read-back on rohelised; sama exact commit läbis ka avaliku CI.
F-026 `BREAK` lisab selection-first/First-point ja ühe- või kahepunktilise
katkestuse LINE/ARC/CIRCLE/ELLIPSE/open-closed LWPOLYLINE/rational-SPLINE
geomeetriale. Eraldi värsked AutoCADi fixture'id tõendavad, et avatud ELLIPSE
jaguneb nii `BREAK + @` kui `BREAKATPOINT` kaudu, kuid avatud SPLINE jääb
mõlemas muutmata. Täielik native state, handle'id, layer-omadused, polyline'i
laiused/bulge'id, spline'i control point'id/knots/weights, atomic Undo/Redo,
Chromium, DXF/KDRAW1 ning nested SHA-receipt'id läbisid; sõltumatu review oli
`0 P0 / 0 P1`.
F-027 `STRETCH` jääb kandidaadiks ega mõjuta skoori enne eraldatud AutoCAD
Desktopi tõendit, sõltumatut review'd ja rohelist avalikku CI-d.
F-097 `Layout tabs` lisab revisioneeritud create/copy/reorder/delete töövoo,
AutoCADi copy-before-source nimekuju, sõltumatud viewport'i ID-d ja paberiruumi
handle'id, atomaarse Undo/Redo ning IndexedDB/`.kdraw` taastamise.
F-098 `Visible paper sheet` lisab valideeritud füüsilise paberidomeeni, tumedal
töölaual nähtava valge lehe, täpse paberisuhtes Canvas2D renderduse ning sama
lehe IndexedDB/`.kdraw` ja native-DWG taasavamise tõendi.
F-099…F-101 lisavad mitu sõltumatut viewporti, ristküliku/polügooni clip'i,
custom/preset scale'i, kursoriankruga zoom'i, pööratud pan'i, twist'i ning
AutoCADiga mõõdetud display-lock'i elutsükli.
F-102 `Page setup` lisab per-layout ISO paberi ja orientatsiooni, Layout/Window/
Extents/Display plot area, Fit või fikseeritud mõõtkava, center/offset seaded,
atomaarse Undo/Redo ning füüsilise SVG/PDF väljundi. Native AutoCADi live-test
parandas vana oletuse: paberivahetus jätab viewporti paberikoordinaadid muutmata.
Display kasutab mõlemas programmis sama brauserist mõõdetud paberivaadet; PC3
prinditava ala absoluutne serv jääb eraldi F-108 töösse.
Display nõuab aktiivset paberivaadet ja Window lubab AutoCADi kombel ka
negatiivseid või lehest välja jäävaid layout-koordinaate.
F-103 `Plot profile, lineweights and transparency` lisab Color/Monochrome/
Grayscale väljundi, ACI/TrueColor ja ByLayer/explicit omadused, live-testitud
0,00/0,35/0,70 mm laiused, AutoCADi width-zero hairline'i, täpse murdarvulise
alpha ning OFF→ON tõendatud püsiva `Display plot styles` preview-valiku.
Native AutoCADi test loeb ja kirjutab päris `Layout.PlotTransparency` väärtust,
kasutab override'i `1` ainult Page Setup väärtuse austamiseks, avab DWG uuesti
ning taastab kõik puudutatud AutoCADi kasutajaseaded; `SECURELOAD` jäetakse
muutmata. SVG/PDF/KDRAW1, Poppler,
`pypdf`, `pdfplumber` ja Chromium kontrollivad sama tulemust sõltumatult.
F-104 `Layout vector PDF/SVG` lisab ühe A3 lehe kahe sõltumatu lukustatud
viewport'iga: ristkülik 1:50 ja `VPCLIP`-iga polügoon 1:100. Chromiumi SVG/PDF
on pärast IndexedDB taasavamist bititäpselt deterministlik ning tootmispaketi
väljundiga identne; XML, päris SVG Chromiumi raster, range `pypdf`, `pdfplumber`
ja Poppler kinnitavad kaks clip'i, mõlema viewport'i sisu, füüsilise A3 formaadi,
paberiruumi raamkirja ja null rasterpilti.
AutoCAD 2024 live-värav salvestab ja avab native DWG uuesti ning plotib mõlemad
olekud `DWG To PDF.pc3` kaudu. AutoCADi enda PDF-kataloogi dubleeritud
`/PageMode` võti on tõendis ausalt kirjas; tolerantne tagasilugemine ja Poppler
kinnitavad muutumatu vektortulemuse.
F-105 `Batch publish layouts` salvestab layout'ide järjekorra, inclusion-state'i,
ühe mitmeleheküljelise või eraldi PDF-ide režiimi ning failinime dokumendi
metadata sisse ühe atomaarse Undo/Redo sammuna. Chromiumi live-töövoog tõendas
teadlikult mitte-tähestikulise PLAN 20 → SECTION 10 järjekorra, 2→1 välistamise,
taastamise, kahe lehe PDF-i ja kaks eraldi Windowsi-kindla nimega faili; reload
säilitas kõik seaded. Inaktiivse SECTION 10 layout'i täpne DOM-ist mõõdetud
Display-aken salvestati ning sõltumatu PDF-operaatorite tagasilugemine tõendas
sama source clip'i ja outer transformi. Tootmis-PDF-i baidid kattusid brauseri
download'iga ning `pypdf`, `pdfplumber` ja Poppler kinnitasid A4 lehejärjekorra
ning null rasterpilti. AutoCAD 2024 live `SetLayoutsToPlot` andis samas
järjekorras kaks native PDF-i ja ühe lehega välistatud komplekti, seejärel avati
native DWG uuesti.
F-106 `Model-space print/PDF` lisab Model-tab'ile eraldi püsiva PAGESETUP-i,
mis katab Extents/Window/Display alad, Fit või fikseeritud mõõtkava,
center/offset paigutuse ning A4 portrait/A3 landscape väljundi. Chromiumi
töövoog tõendab atomaarset Undo/Redo'd, IndexedDB taastamist, täpseid
production SVG/PDF baite ja ausat veateadet tühja Extents-väljundi korral.
AutoCAD 2024 live-värav plotib samad kolm juhtu native `DWG To PDF.pc3`
PDF-ideks, salvestab ja avab DWG uuesti ning kontrollib seadme, media ja kõigi
püsivate page-setup väljade säilimist. `pypdf`, `pdfplumber` ja Poppler mõõdavad
line/circle geomeetria füüsilised pikkused ja asukohad; kõik väljundid on
vektorid ilma rasterpiltideta.
F-107 `Named page setups/templates` lisab nimega setup'i create/apply/rename/
delete töövoo, atomaarse assignment'i ja rangelt geomeetriavaba JSON-template'i.
Import tõkestab tundmatud väljad, ühikute vastuolu, rippuvad või semantiliselt
vananenud viited ning liiga suure faili enne commit'i; võtmete järjekord ei muuda
semantiliselt sama setup'i. Chromium tõendab Undo/Redo, IndexedDB ja KDRAW1
taastamise. AutoCAD 2024 live-värav salvestab native DWT, loob sellest värske
joonise ning loeb tagasi INSUNITS-i, PlotOrigin'i, marginaalid, mõõtkava ja
named PlotConfiguration'i ainult PID-ga tõendatud omatud protsessis.
F-109 `DXF export` väljastab production-tee kaudu deterministliku millimeetri-DXF-i
40 objektiga, säilitades kihid, ACI/TrueColori, lineweight'id, linetype'id,
tekstistiilid, bulge'id, viirutused ja native aligned-dimension'i. Range `ezdxf`,
AutoCAD 2024 Core Console ning eraldi omatud desktop AutoCAD loevad sama faili
tagasi. AutoCADi live AcCmColor-värav kinnitab kõik 255 ACI värvi täpse SHA-ga;
runneri, maatriksi ja tootmislähte SHA muutus muudab tõendi automaatselt aegunuks.
F-111 `DXF roundtrip fidelity` impordib sama 40-objektilise AC1018/ANSI_1252
DXF-i schema-valideeritud muudetavaks dokumendiks ning väljastab pärast
brauseri import→MOVE→Undo/Redo→IndexedDB reload töövoogu bititäpselt sama
13 679-baidise faili. DXFIN asendab mudeliruumi ühe atomaarse operatsioonina,
kuid säilitab Kuubiku layout'id ja nende transitiivsed ressursid collision-safe
remap'iga. Importija blokeerib osalise impordi, dubleeruvad TABLES/BLOCKS/
OBJECTS/ENTITIES handle'id, mittetoetatud HATCH-i grammatika, ühikuvahetuse
unit-sensitive layout state'i korral ning mahu- ja struktuurieelarve ületuse.
Chromium, range `ezdxf`, AutoCAD 2024 Core Console ja eraldi omatud desktop
AutoCAD kinnitavad 40 native objekti; sõltumatu kordusülevaatus lõppes 0 P0/P1.
F-114 `PDF vector output` avaldab ühe tootmiskäsuga ISO A3 landscape ja ISO A4
portrait layout'id samasse rangesse PDF 1.4 faili. Chromiumi nähtav töövoog
avab A3 lehe, avaldab mõlemad lehed, kontrollib A4 paberit, taastab dokumendi
IndexedDB-st ning väljastab bititäpselt sama faili uuesti. Range `pypdf`,
`pdfplumber` ja Poppler kinnitavad füüsilised lehesuurused, otsitava teksti,
punase/sinise vektorgeomeetria, läbipaistvuse ExtGState'i, teravad raamid ja
null image XObject'i. Värske omatud AutoCAD 2024 referents plotib native A3
layout'i `DWG To PDF.pc3` kaudu enne ja pärast scratch-DWG taasavamist ning
taastab algse protsessikomplekti. Lehejärjekorra, geomeetria, alpha ja raster-
fallback'i mutatsioonid on eraldi tõendatud.

## Piirid

- ainult 2D; 3D, renderdus ja erialatööriistad on väljas;
- `/plan/` andmeid ei avata ega muudeta;
- vahetus Planiga toimub ainult DXF, PDF, SVG/PNG või `.kdraw` faili kaudu;
- LibreCAD ja FreeCAD on ainult arendaja/CI oracle’id, mitte rakenduse runtime;
- AutoCADi kaubamärgid kuuluvad Autodeskile. Projekt ei ole Autodeski poolt
  toetatud, sertifitseeritud ega seotud.

## Arendus

```bash
npm install
npm run check
```

Pariteedi arhitektuurikäsud:

```bash
npm run parity:affected
npm run parity:row -- F-100 --portable
npm run parity:kit:validate
npm run check:fast
npm run check:full
```

`parity:affected` kasutab vaikimisi Git HEAD + tööpuu diffi ja keeldub uuest
kaardistamata runtime-failist. `parity:row` juhib ühe sertifitseeritud rea
browser/read-back/oracle/AutoCAD/cross samme, uuendab SHA-seosed ning käivitab
lõpliku 133-rea ratchet'i; `--portable` jätab litsentsitud AutoCADi ja kohaliku
oracle-runneri ausalt vahele.

Content-address schema v4 seob `package.json` muudatuse rea tõendiga ainult siis,
kui muutus dependency-pind või selle rea authority-etapi transitiivne npm-käsk.
Kõik muud scripts/CI-topoloogia muutused peavad endiselt värskendama ühist
fail-closed topology receipt'i; v3→v4 üleminek on eraldi kontrollitava receipt'iga.

Rakendus: `apps/web`. Tuum, renderdus ning failiadapterid on eraldi pakettides.
Avalik failiskeem elab MIT-litsentsiga projektis
[`T3stin-svg/kuubik-cad-schema`](https://github.com/T3stin-svg/kuubik-cad-schema).

Litsents: `GPL-2.0-only`.
