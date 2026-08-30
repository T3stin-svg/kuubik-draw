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

1. F-029 on avalikult sertifitseeritud seisul **29/133 · 21,8% raw / 25,2% weighted**;
   AutoCAD/Chromium/DXF/KDRAW1/oracle risttõend ja sõltumatu lõppreview
   `0 P0 / 0 P1` on rohelised. Feature-commit `5b63ccb` läbis exact-commit
   GitHub Actions run'i `33323461138` fast- ja verify-väravad.
2. STRETCH crossing window/polygon, osaline ja whole-object liikumine, täielik
   14-objektiline native/DXF state, nested SHA-receipt'id ja atomic Undo/Redo
   kasutavad fail-closed ratchet'it. Sõltumatu review on `0 P0 / 0 P1`.
3. BREAK selection-first/First, ühe- ja kahepunktiline katkestus, värsked
   `BREAK + @`/`BREAKATPOINT` ellipse/spline fixture'id, täielik native state,
   nested SHA-receipt'id ning atomic Undo/Redo kasutavad fail-closed ratchet'it.
4. Quick/Standard TRIM ja EXTEND, closed bulge/width polyline, hidden/locked target,
   ignored HATCH loop, nested block layer-semantika ja rational SPLINE läbivad
   AutoCAD 2024.1.2, Chromiumi ning sõltumatu DXF/KDRAW1 read-back'i.
5. F-023 feature-commit `1f4a96c` ja CI portability fix `7e252de` läbisid
   GitHub Actions run'i `33260160549`; sõltumatu lõppreview oli `0 P0 / 0 P1`.
6. Architecture-efficiency gate on avalikult suletud: MOVE…TRIM kasutavad
   ühist workflow-moodulit, 23 sertifitseeritud rida on deklaratiivses
   parity-kit'is ning täpne ratchet töötab võrdselt Windowsis ja Linuxis.
   Põhilaine commit `da45a56`, lõpp-HEAD `d097b34` ja GitHub Actions run
   `33250270350` läbisid fast- ja täieliku certification-värava.
7. F-023 laine schema-v4 package-ratchet seob iga rea ainult tema transitiivsete
   npm authority-etappidega, hoides dependency- ja globaalse CI-pinna eraldi
   fail-closed kontrollis. Ühekordne v3→v4 receipt tõendab, et varasema 23 rea
   etapikäsud ning `package-lock.json` ei muutunud. Kõik CI checkout-stepid
   peavad fetchima pinned migratsioonibaasi täieliku ajaloo; step-aware test
   keeldub shallow, named-shallow ja valesse `env` scope'i pandud seadetest.

## Suletud — architecture-efficiency gate

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

Lokaalne vastuvõtt 2026-08-29:

- sünteetiline F-023 stage-spec töötab ilma cross-checkerita;
- `apps/web/src/workflows/modify-command.ts` kaardistub ainult F-015…F-022-le,
  mitte plot/PDF reale F-114;
- JSON-i ja lahtipakitud KDRAW1 dokumendi timestamp-only muutus säilitab
  semantilise SHA-256;
- `npm run parity:row -- F-100 --portable` läbis browser → read-back → cross →
  descriptor/ratchet → content-address → full parity jada;
- kõik 22 browser-artifact'i ja 23 sõltumatut read-back'i loodi pärast
  `App.tsx` ühekordset refaktorit uuesti;
- F-102 native AutoCAD live-run leidis ja sulges fixture'i kaks
  ebadeterminismi (viewporti stabiliseerimine ja COM media-listi retry) ning
  läbis native PAGESETUP/PlotToFile/DWG reopen värava.

Avalik GitHub Actions run `33250270350` läbis Ubuntu 24.04 peal 245 Vitest-testi,
34 mutation-, 30 DXF-, 19 PDF- ja 62 Chromiumi testi, production buildi,
parity/content-address-, litsentsi- ja turvaväravad. Sõltumatu lõppreview oli
`0 P0 / 0 P1`. Tingimuslikud self-hosted AutoCAD/oracle job'id jäid selle push'i
jaoks ausalt `skipped`; checked-in native tõendeid kontrolliti üldises ratchet'is.

## Next — Modify evidence batch F-028 / F-029 / F-030

F-030 `MATCHPROP` typed core/browser/DXF kandidaat on valmis ja kogu 107-testine
Chromiumi regressioon on roheline. Paberiruumi visible source→multi-target
viewport MATCHPROP ning cross-document Layer/Linetype/Text style/Dimension style
ressursiimport on samuti teostatud. Nime/ID konflikt ei kirjuta sihtdokumenti üle
ning kogu resource+entity muutus on üks Undo-samm. Rida jääb ausalt `0,75` peale,
kuni järgmised alamväravad on suletud:

1. lõpetada Multileader/Table/Center object koos F-060/F-069/F-071-ga, native
   plot-style definitions koos F-108-ga ja visible cross-document tabivalik
   koos F-128-ga; dependency-ratchet hoiab need read nimetajas;
2. läbida üks koondatud AutoCAD 2024.1.2 live-maatriks ja värskendada shared
   App/schema muudatusest mõjutatud varasemad browser/read-back/cross receipt'id;
3. sõltumatu `0 P0 / 0 P1` review, exact public commit ja roheline GitHub CI.

F-028 `LENGTHEN` typed core/browser/DXF kandidaat on samuti valmis. Delta,
Percent, Total ja Dynamic kasutavad sama preview/commit predikaati LINE/ARC/open
POLYLINE/elliptical-arc/open rational-SPLINE geomeetrial; ARC toetab length/angle
variante. Kogu ühendatud regressioon on 472 Vitest, 72 mutation, 46 DXF, 20 PDF
ja 104 Chromiumi testi. Rida jääb `0,75` peale kuni owned AutoCAD 2024.1.2
live-maatriksi, sõltumatu read-back'i/cross-evidence'i ning `0 P0 / 0 P1`
review'ni. Mittekuubilise SPLINE extension keeldub seni fail-closed.

F-029 `ALIGN` typed core/browser/DXF kandidaat on valmis. Autodesk 2024 ametliku 2D lepingu järgi
üks source→destination punktipaar tegema ainult translatsiooni; kaks paari
teevad translatsiooni ja pöörde ning küsivad eraldi Yes/No ühtlase scale'i,
mille referents on kahe source- ja destination-punkti vaheline pikkus. Kolme
punktipaari 3D tilt jääb fikseeritud 2D auditi nimetajast välja, mitte peidetud
`N/A` erandiks. Vastuvõtukorpus sisaldab:

1. preselection ja command-first valik, üks ning kaks punktipaari;
2. Scale Yes/No, vastassuunaline joondus, null-/kokkulangeva referentsi aus
   refusal ja samade punktide no-op semantika;
3. standardne 2D entity-maatriks, mixed locked-layer valik, properties/handles,
   preview=commit ja üks atomic Undo/Redo;
4. füüsilised canvas-pick'id, IndexedDB, KDRAW1/DXF read-back ja null console
   errors;
5. owned AutoCAD 2024.1.2 live-maatriks, current-byte cross-evidence, sõltumatu `0 P0 / 0 P1` review,
   kõikide mõjutatud receipt'ide regenereerimine, exact public commit ja roheline
   GitHub CI.

Rakendatud ALIGN läbib nullreferentsi/no-op/mixed-locked keeldumised, füüsilise
nelja canvas-punkti valiku, preview=commit, ühe atomaarse Undo/Redo ning
KDRAW1/DXF täpse tagasilugemise. Sertifikaati ega skoori ei anta enne punkti 5.

AutoCADi akent ei avata iga väikese koodimuudatuse järel: F-028/F-029/F-030
native kontrollid koondatakse ühe valmis maatriksiga tõendusväravasse.

Checkpoint: F-029 production/browser/oracle/owned-runner/cross-evidence leping
on täidetud ja rida avalikult skooril `1,00`. Owned AutoCAD 2024.1.2 Desktop,
Chromium, sõltumatu DXF/KDRAW1 read-back, LibreCAD/FreeCAD secondary oracle'id,
täielik current-byte ratchet ja sõltumatu `0 P0 / 0 P1` review on rohelised.
Exact-commit `5b63ccb` avalik run `33323461138` on roheline. F-028 jääb `0,75`
peale F-012 fit-point SPLINE sõltuvuse tõttu; F-030 jääb `0,75` peale
F-060/F-069/F-071/F-108/F-128 sõltuvuste tõttu. Järgmine geomeetriat avav
laine on F-012 SPLINE → F-028.

## Later

1. Sertifitseerida järgmised Modify-read mõjupõhises P0 → P1 → P2 järjekorras
   kuni 133/133.
2. Native DWG/DWT/XREF ja PC3/CTB/STB ainult litsentsitud ODA/RealDWG teega.
3. Pärast funktsionaalset 133/133 väravat viia kõik viis visuaalkategooriat
   eraldi `100,0%` peale.
4. Production deploy ainult Reio eraldi kinnituste `JAH (1/2)` ja `JAH (2/2)`
   järel.

## Peamised riskid ja sõltuvused

- F-022 native tõend pärineb litsentsitud lokaalsest AutoCAD 2024.1.2 live-run'ist.
  Avaliku run'i self-hosted AutoCAD/oracle job'id jäid repo muutujate puudumisel
  ausalt `skipped`; kaitstud oracle-runner vajab endiselt võrgu-isolatsiooni
  attestatsiooni.
- Native failiread sõltuvad ODA/RealDWG litsentsist ja anonümiseeritud korpusest.
- Arhitektuurivärav ei tohi muuta nimetajat, kaale, olemasolevaid skoore ega
  nõrgendada live/read-back nõuet.
- Vana `kuubik-3d` tööpuu ja kasutaja AutoCADi protsess jäävad puutumata.
