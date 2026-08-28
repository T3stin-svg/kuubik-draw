# Kuubik Draw

Kuubik Draw on eraldiseisev avalik 2D CAD-rakendus. Projekt sihib fikseeritud
AutoCAD 2024.1.2 Windowsi **2D Drafting & Annotation** 133-realise auditi
käitumispariteeti, mitte kogu AutoCADi toodet.

## Aus hetkeseis

- vana Drawi auditi snapshot: **63,9% raw / 68,3% weighted / 60,7% visual**;
- vana Drawi AutoCADi live-tõendiga read: **22/133**;
- selle uue eraldatud rakenduse kohalik sertifikaat: **14/133 · 10,5% raw / 13,1% weighted**;
- native DWG/DWT/XREF ja PC3/CTB/STB pariteet on veel blokeeritud.

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

Rakendus: `apps/web`. Tuum, renderdus ning failiadapterid on eraldi pakettides.
Avalik failiskeem elab MIT-litsentsiga projektis
[`T3stin-svg/kuubik-cad-schema`](https://github.com/T3stin-svg/kuubik-cad-schema).

Litsents: `GPL-2.0-only`.
