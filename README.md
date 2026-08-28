# Kuubik Draw

Kuubik Draw on eraldiseisev avalik 2D CAD-rakendus. Projekt sihib fikseeritud
AutoCAD 2024.1.2 Windowsi **2D Drafting & Annotation** 133-realise auditi
käitumispariteeti, mitte kogu AutoCADi toodet.

## Aus hetkeseis

- vana Drawi auditi snapshot: **63,9% raw / 68,3% weighted / 60,7% visual**;
- vana Drawi AutoCADi live-tõendiga read: **22/133**;
- selle uue eraldatud rakenduse kohalik sertifikaat: **1/133 · 0,8% raw / 0,9% weighted**;
- native DWG/DWT/XREF ja PC3/CTB/STB pariteet on veel blokeeritud.

Need arvud on vana Drawi auditi muutmatu snapshot. Uus rakendus ei päri skoori
enne, kui sama töövoog on siin reprodutseeritud ja tõendatud. LibreCADi või
FreeCADi roheline tulemus üksi ei tõsta ühtegi rida skoorile `1,00`.
Esimese mirror-reana on F-003 `RECTANGLE` värskelt tõendatud AutoCAD 2024,
Chromiumi ja sõltumatu DXF-parseri sama geomeetriaga.

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
