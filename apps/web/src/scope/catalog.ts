import { parityManifest, type ParityManifestRow } from "../../../../parity/autocad-2024-2d.manifest.mjs";

export type ScopeRecommendation = "recommended" | "partial" | "optional" | "expensive";

export interface ScopeGroup {
  id: number;
  title: string;
  description: string;
  recommendation: ScopeRecommendation;
  rowIds: readonly string[];
}

const range = (start: number, end: number): string[] =>
  Array.from({ length: end - start + 1 }, (_, index) => `F-${String(start + index).padStart(3, "0")}`);

export const SCOPE_GROUPS: readonly ScopeGroup[] = Object.freeze([
  { id: 1, title: "Põhijoonestamine", description: "Sirged, polüjooned, ristkülikud, ringid ja kaared.", recommendation: "recommended", rowIds: range(1, 5) },
  { id: 2, title: "Muud kujundid", description: "Hulknurgad, ellipsid, abijooned, punktid ja revisjonipilved.", recommendation: "optional", rowIds: range(6, 11) },
  { id: 3, title: "Keerukad kõverad ja piirid", description: "Spline'id, multijooned ja suletud regioonid.", recommendation: "optional", rowIds: range(12, 14) },
  { id: 4, title: "Põhimuudatused", description: "Kustutamine, liigutamine, kopeerimine, pööramine, skaleerimine, peegeldamine ja nihe.", recommendation: "recommended", rowIds: range(15, 21) },
  { id: 5, title: "Kärpimine ja nurgad", description: "TRIM, EXTEND, FILLET ja CHAMFER igapäevaseks puhastamiseks.", recommendation: "recommended", rowIds: range(22, 25) },
  { id: 6, title: "Täiendavad muudatused", description: "Katkestamine, venitamine, pikkuse muutmine, joondamine ja omaduste kopeerimine.", recommendation: "optional", rowIds: range(26, 30) },
  { id: 7, title: "Massmuudatused", description: "Massiivid, ühendamine, polüjoonte töötlus ja duplikaatide puhastus.", recommendation: "optional", rowIds: range(31, 35) },
  { id: 8, title: "Valik ja gripid", description: "Aken/crossing, gripid, kattuvate objektide valik ja grupid.", recommendation: "recommended", rowIds: range(36, 40) },
  { id: 9, title: "Täpsed koordinaadid", description: "Absoluutne, suhteline, polaarsisend ja otsene kaugus.", recommendation: "recommended", rowIds: range(41, 44) },
  { id: 10, title: "Joonestamise täpsusrežiimid", description: "ORTHO, POLAR, GRID, SNAP, OSNAP ja objektijälitus.", recommendation: "recommended", rowIds: range(45, 51) },
  { id: 11, title: "Sisestus, ühikud ja UCS", description: "Dynamic Input, joonise ühikud, DIST ning kasutaja koordinaatsüsteem.", recommendation: "recommended", rowIds: range(52, 55) },
  { id: 12, title: "Tekst ja viited", description: "Ühe- ja mitmerealine tekst, tekstistiilid ning viitejooned.", recommendation: "recommended", rowIds: range(56, 60) },
  { id: 13, title: "Mõõdud", description: "Pikkus-, nurga-, raadius- ja läbimõõdumõõdud koos stiilidega.", recommendation: "recommended", rowIds: range(61, 66) },
  { id: 14, title: "Viirutus ja andmeväljad", description: "HATCH, tabelid, väljad ning keskjooned ja -märgid.", recommendation: "partial", rowIds: range(67, 71) },
  { id: 15, title: "Põhikihid", description: "Kihtide loomine, nähtavus, lukustus, värv, joone tüüp ja paksus.", recommendation: "recommended", rowIds: range(72, 79) },
  { id: 16, title: "Täiendavad kihid ja Properties", description: "Kihi olekud, viewport-erisused ja täielik omaduste muutmine.", recommendation: "recommended", rowIds: range(80, 86) },
  { id: 17, title: "Põhiplokid", description: "Plokkide loomine, sisestamine, lõhkumine ja atribuudid.", recommendation: "recommended", rowIds: range(87, 91) },
  { id: 18, title: "Täiendavad plokid", description: "Dünaamilised ja pesastatud plokid, teek ning WBLOCK.", recommendation: "optional", rowIds: range(92, 95) },
  { id: 19, title: "Model ja Layout", description: "Paberiruum, layout'id ja vaateaknad.", recommendation: "recommended", rowIds: range(96, 101) },
  { id: 20, title: "Printimine", description: "Page Setup, mõõtkavas trükk, plotistiilid ja publish.", recommendation: "recommended", rowIds: range(102, 108) },
  { id: 21, title: "DXF", description: "DXF import, eksport ja kadudeta edasi-tagasi töövoog.", recommendation: "recommended", rowIds: range(109, 111) },
  { id: 22, title: "DWG, DWT ja XREF", description: "Native AutoCADi failid, mallid ja välisviited; eraldi kulukas investeering.", recommendation: "expensive", rowIds: ["F-112", "F-113", "F-117", "F-121"] },
  { id: 23, title: "PDF, SVG ja PNG", description: "PDF-i alus/import ning vektor- ja pildieksport.", recommendation: "recommended", rowIds: range(114, 116) },
  { id: 24, title: "Audit ja ajalugu", description: "Joonise parandamine, versiooniajalugu ja võrdlemine.", recommendation: "optional", rowIds: range(118, 120) },
  { id: 25, title: "CAD-i põhikasutajaliides", description: "Ribbon, käsurida, F2-ajalugu, menüüd ja olekuriba.", recommendation: "recommended", rowIds: range(122, 126) },
  { id: 26, title: "Paletid ja dokumenditöö", description: "Dokumenditabid, paletid, Undo/Redo ja käsualiased.", recommendation: "recommended", rowIds: range(127, 130) },
  { id: 27, title: "Tööruum ja autosave", description: "Salvestatavad tööruumid, puhas CAD-visuaal ja taastatav automaatsalvestus.", recommendation: "recommended", rowIds: range(131, 133) },
]);

export const SCOPE_ROWS: readonly ParityManifestRow[] = parityManifest.rows;
export const SCOPE_DENOMINATOR = parityManifest.denominator;
export const SCOPE_BENCHMARK = parityManifest.benchmark;

export const ROW_BY_ID: ReadonlyMap<string, ParityManifestRow> = new Map<string, ParityManifestRow>(
  SCOPE_ROWS.map((row) => [row.id, row]),
);

export function recommendationLabel(recommendation: ScopeRecommendation): string {
  switch (recommendation) {
    case "recommended": return "Soovitatud";
    case "partial": return "Osaliselt soovitatud";
    case "expensive": return "Kulukas / valikuline";
    default: return "Valikuline";
  }
}

export function readinessLabel(score: number): "Valmis" | "Osaline" | "Puudu" {
  if (score === 1) return "Valmis";
  if (score > 0) return "Osaline";
  return "Puudu";
}

export function validateCatalog(): string[] {
  const errors: string[] = [];
  const expectedIds = range(1, 133);
  const manifestIds = new Set<string>(SCOPE_ROWS.map((row) => row.id));
  const groupedIds = SCOPE_GROUPS.flatMap((group) => group.rowIds);
  const duplicates = groupedIds.filter((id, index) => groupedIds.indexOf(id) !== index);
  if (SCOPE_ROWS.length !== 133) errors.push(`Manifestis on ${SCOPE_ROWS.length} rida, oodati 133.`);
  if (SCOPE_GROUPS.length !== 27) errors.push(`Gruppe on ${SCOPE_GROUPS.length}, oodati 27.`);
  if (duplicates.length) errors.push(`Topeltread: ${[...new Set(duplicates)].join(", ")}`);
  if (expectedIds.some((id) => !manifestIds.has(id))) errors.push("Manifesti F-ID jada ei ole täielik.");
  if (expectedIds.some((id) => !groupedIds.includes(id))) errors.push("Grupid ei kata kõiki F-ID-sid.");
  if (groupedIds.some((id) => !manifestIds.has(id))) errors.push("Grupp sisaldab tundmatut F-ID-d.");
  return errors;
}
