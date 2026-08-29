# Kuubik Draw — arhitektuurieesmärk ja teekaart

## Uuendatud eesmärk

Viia Kuubik Draw fikseeritud AutoCAD 2024.1.2 Windows 2D Drafting & Annotation
133-realise auditi järgi 133/133 reale skoorile `1,00`, raw ja weighted
kattuvusele `100,0%` ning seejärel kõigis viies visuaalkategoorias `100,0%`.

Sama oluline täiendav eesmärk on ehitada pariteeti kasvava platvormina: uus
funktsioon ei tohi muuta seoseta sertifitseeritud rea tõendit aegunuks ega nõuda
uue browser/read-back/cross-evidence skriptikolmiku käsitsi kopeerimist. Täielik
ratchet, sõltumatu tõend ja aus skoor jäävad alles; optimeerimine vähendab
kordust, mitte kontrolli tugevust.

## Roadmap.sh harud, mida projekt tegelikult kasutab

| Haru | Kuubik Drawis | Otsus |
|---|---|---|
| Programming Languages | TypeScript/JavaScript, Python, PowerShell | säilitada selged keelepiirid |
| Patterns & Design Principles | command, immutable transaction, atomic Undo/Redo, DDD/CQRS-laadne op-log, TDD | süvendada ühiste lepingutega |
| Architecture | layered/component, client/server adapterid | vältida enneaegseid microservice'e |
| Security | SHA-256, fail-closed import, PID/foreground kontroll, network isolation, secret scan | kohustuslik sertifitseerimisvärav |
| Working with Data | KDRAW, DXF/PDF, IndexedDB, revision/op-log | versioneeritud skeem ja determinism |
| APIs & Integrations | AutoCAD COM, LibreCAD CLI, FreeCADCmd, tulevane ODA/RealDWG | adapteripiirid, oracle ei ole autoriteet |
| Web | React/Vite SPA, Canvas2D, Playwright | käsupõhised workflow-moodulid |
| Tools | Git, GitHub Actions, self-hosted runnerid | astmeline CI |
| Operations | build, CI/CD, artefaktid, read-back | content-addressed tõendid |
| Networks | egress-deny attestatsioon ja runneri identiteet | ainult seal, kus väline protsess seda nõuab |

Microservices, Kubernetes, Hadoop/Spark, SAP/ERP, ESB/BPEL, TOGAF ja mobiilne
native-rakendus ei liiguta fikseeritud 133-realise 2D auditi tulemust ning on
selles teekaardis teadlikult `Won't have`.

## Now

1. F-022 lokaalne sertifikaat on valmis: **23/133 · 17,3% raw / 20,7% weighted**.
2. Quick/Standard TRIM, closed bulge/width polyline, hidden/locked target,
   ignored HATCH loop, nested block layer-semantika ja rational SPLINE läbivad
   AutoCAD 2024.1.2, Chromiumi ning sõltumatu DXF/KDRAW1 read-back'i.
3. Sõltumatu review lõppes `0 P0 / 0 P1`; avalik CI peab sama commit'i veel
   roheliseks kinnitama enne laine lõplikku sulgemist.

## Next — architecture-efficiency gate

Järgmist funktsioonirida ei alustata enne järgmisi tulemusi:

1. `apps/web/src/App.tsx` käsukohane loogika on eraldatud workflow-mooduliteks;
   TRIM-i muudatus ei aegunda seoseta plot/PDF/DXF UI-tõendeid.
2. Ühine `parity-kit` loeb deklaratiivset F-rea spetsifikatsiooni ja juhib
   browser-, read-back-, AutoCAD-, oracle- ja cross-evidence samme.
3. Lähtefailide sõltuvusgraaf arvutab muutusest mõjutatud F-read; kõik
   runtime-allikad peavad endiselt vähemalt ühe tõendikaardiga kaetud olema.
4. Artefakti sisuline räsi ei muutu ainult `observedAt` või genereerimisaja
   tõttu. Ajatempel on eraldi provenance, mitte geomeetria identiteet.
5. Üks käsk käivitab ühe rea täieliku lokaalse sertifitseerimisjada ja teine
   näitab muutusest mõjutatud ridu.
6. CI-l on kolm taset: kiire muudatusevärav, ühe F-rea sertifitseerimisvärav ja
   täielik 133-rea ratchet. AutoCAD ja oracle jäävad eri usalduspiiridega
   runneritesse ning nende väljund seotakse baitide SHA-ga.
7. Suured otsused talletatakse ADR-idena: GPL/MIT piir, renderer, dokumendimudel,
   evidence architecture ja native DWG adapter.

Värav on läbitud, kui uue sünteetilise F-rea lisamine ei vaja kopeeritud checkerit,
seoseta UI-mooduli muudatus ei aegunda selle tõendit, timestamp-only rerun ei
muuda sisuräsi ning täielik senine parity-ratchet jääb roheliseks.

## Later

1. Jätkata pärast F-022 mõjupõhises P0 → P1 → P2 järjekorras kuni 133/133.
2. Native DWG/DWT/XREF ja PC3/CTB/STB ainult litsentsitud ODA/RealDWG teega.
3. Pärast funktsionaalset 133/133 väravat viia kõik viis visuaalkategooriat
   eraldi `100,0%` peale.
4. Production deploy ainult Reio eraldi kinnituste `JAH (1/2)` ja `JAH (2/2)`
   järel.

## Peamised riskid ja sõltuvused

- F-022 sõltub litsentsitud AutoCAD 2024.1.2 runnerist ning kaitstud oracle-runneri
  võrgu-isolatsiooni attestatsioonist.
- Native failiread sõltuvad ODA/RealDWG litsentsist ja anonümiseeritud korpusest.
- Arhitektuurivärav ei tohi muuta nimetajat, kaale, olemasolevaid skoore ega
  nõrgendada live/read-back nõuet.
- Vana `kuubik-3d` tööpuu ja kasutaja AutoCADi protsess jäävad puutumata.
