export type AnnotationCommandId = "DIMLINEAR" | "DIMALIGNED" | "DIMANGULAR" | "DIMRADIUS" | "DIMDIAMETER" | "DIMCONTINUE" | "DIMSTYLE" | "TEXT" | "MTEXT" | "STYLE" | "LEADER" | "MLEADER" | "HATCH";

export interface AnnotationTool {
  rowIds: string[];
  id: AnnotationCommandId;
  label: string;
  selection: "none" | "optional" | "required";
}

export const ANNOTATION_TOOLS: readonly AnnotationTool[] = Object.freeze([
  { rowIds: ["F-061"], id: "DIMLINEAR", label: "Lineaarmõõt", selection: "optional" },
  { rowIds: ["F-062"], id: "DIMALIGNED", label: "Joondatud mõõt", selection: "optional" },
  { rowIds: ["F-063"], id: "DIMANGULAR", label: "Nurkmõõt", selection: "optional" },
  { rowIds: ["F-063"], id: "DIMRADIUS", label: "Raadiuse mõõt", selection: "required" },
  { rowIds: ["F-063"], id: "DIMDIAMETER", label: "Diameetri mõõt", selection: "required" },
  { rowIds: ["F-064", "F-065"], id: "DIMCONTINUE", label: "Jätkuv mõõt", selection: "required" },
  { rowIds: ["F-066"], id: "DIMSTYLE", label: "Mõõdustiilid", selection: "none" },
  { rowIds: ["F-057"], id: "TEXT", label: "Üherealine tekst", selection: "none" },
  { rowIds: ["F-057"], id: "MTEXT", label: "Mitmerealine tekst", selection: "none" },
  { rowIds: ["F-058"], id: "STYLE", label: "Tekstistiilid", selection: "none" },
  { rowIds: ["F-059"], id: "LEADER", label: "Viitjoon", selection: "none" },
  { rowIds: ["F-060"], id: "MLEADER", label: "Multiviide", selection: "none" },
  { rowIds: ["F-067", "F-068"], id: "HATCH", label: "Viirutus", selection: "required" },
]);

export interface AnnotationAction {
  commandId: AnnotationCommandId;
  selectedHandles: string[];
}

export type AnnotationPromptValueKind = "point" | "points" | "string" | "number" | "select" | "boolean" | "handles" | "attributes";

export interface AnnotationPromptField {
  id: string;
  label: string;
  valueKind: AnnotationPromptValueKind;
  required: boolean;
  choices?: readonly string[];
}

export interface AnnotationPromptPlan {
  commandId: AnnotationCommandId;
  fields: readonly AnnotationPromptField[];
}

export const ANNOTATION_PROMPT_PLANS: Readonly<Record<AnnotationCommandId, AnnotationPromptPlan>> = Object.freeze({
  DIMLINEAR: { commandId: "DIMLINEAR", fields: [
    { id: "first", label: "Esimene mõõtepunkt", valueKind: "point", required: true },
    { id: "second", label: "Teine mõõtepunkt", valueKind: "point", required: true },
    { id: "dimensionLinePoint", label: "Mõõtjoone asukoht", valueKind: "point", required: true },
    { id: "axis", label: "Suund", valueKind: "select", required: true, choices: ["horizontal", "vertical"] },
    { id: "associative", label: "Assotsiatiivne", valueKind: "boolean", required: true },
  ] },
  DIMALIGNED: { commandId: "DIMALIGNED", fields: [
    { id: "first", label: "Esimene mõõtepunkt", valueKind: "point", required: true },
    { id: "second", label: "Teine mõõtepunkt", valueKind: "point", required: true },
    { id: "dimensionLinePoint", label: "Mõõtjoone asukoht", valueKind: "point", required: true },
    { id: "associative", label: "Assotsiatiivne", valueKind: "boolean", required: true },
  ] },
  DIMANGULAR: { commandId: "DIMANGULAR", fields: [
    { id: "vertex", label: "Nurga tipp", valueKind: "point", required: true },
    { id: "firstRayPoint", label: "Esimene haar", valueKind: "point", required: true },
    { id: "secondRayPoint", label: "Teine haar", valueKind: "point", required: true },
    { id: "arcPoint", label: "Mõõtkaare asukoht", valueKind: "point", required: true },
  ] },
  DIMRADIUS: { commandId: "DIMRADIUS", fields: [
    { id: "center", label: "Keskpunkt", valueKind: "point", required: true },
    { id: "circumferencePoint", label: "Ringjoone punkt", valueKind: "point", required: true },
    { id: "textPoint", label: "Mõõtteksti asukoht", valueKind: "point", required: true },
  ] },
  DIMDIAMETER: { commandId: "DIMDIAMETER", fields: [
    { id: "center", label: "Keskpunkt", valueKind: "point", required: true },
    { id: "circumferencePoint", label: "Ringjoone punkt", valueKind: "point", required: true },
    { id: "textPoint", label: "Mõõtteksti asukoht", valueKind: "point", required: true },
  ] },
  DIMCONTINUE: { commandId: "DIMCONTINUE", fields: [
    { id: "points", label: "Mõõtketi punktid", valueKind: "points", required: true },
    { id: "dimensionLinePoint", label: "Mõõtjoone asukoht", valueKind: "point", required: true },
    { id: "axis", label: "Suund", valueKind: "select", required: true, choices: ["horizontal", "vertical"] },
    { id: "chainId", label: "Mõõtketi ID", valueKind: "string", required: true },
  ] },
  DIMSTYLE: { commandId: "DIMSTYLE", fields: [
    { id: "mode", label: "Tegevus", valueKind: "select", required: true, choices: ["create", "update"] },
    { id: "style", label: "Mõõdustiil", valueKind: "attributes", required: true },
  ] },
  TEXT: { commandId: "TEXT", fields: [
    { id: "position", label: "Sisestuspunkt", valueKind: "point", required: true },
    { id: "text", label: "Tekst", valueKind: "string", required: true },
    { id: "height", label: "Kõrgus", valueKind: "number", required: true },
    { id: "rotationRad", label: "Pööre", valueKind: "number", required: false },
    { id: "styleId", label: "Tekstistiil", valueKind: "string", required: false },
  ] },
  MTEXT: { commandId: "MTEXT", fields: [
    { id: "position", label: "Sisestuspunkt", valueKind: "point", required: true },
    { id: "text", label: "Tekst", valueKind: "string", required: true },
    { id: "height", label: "Kõrgus", valueKind: "number", required: true },
    { id: "width", label: "Tekstiala laius", valueKind: "number", required: true },
  ] },
  STYLE: { commandId: "STYLE", fields: [
    { id: "mode", label: "Tegevus", valueKind: "select", required: true, choices: ["create", "update"] },
    { id: "style", label: "Tekstistiil", valueKind: "attributes", required: true },
  ] },
  LEADER: { commandId: "LEADER", fields: [
    { id: "vertices", label: "Viitjoone punktid", valueKind: "points", required: true },
    { id: "text", label: "Tekst", valueKind: "string", required: false },
  ] },
  MLEADER: { commandId: "MLEADER", fields: [
    { id: "vertices", label: "Multiviite punktid", valueKind: "points", required: true },
    { id: "text", label: "Tekst", valueKind: "string", required: true },
    { id: "textPosition", label: "Teksti asukoht", valueKind: "point", required: true },
    { id: "styleId", label: "Multiviite stiil", valueKind: "string", required: true },
  ] },
  HATCH: { commandId: "HATCH", fields: [
    { id: "boundaryHandles", label: "Piirid", valueKind: "handles", required: true },
    { id: "pattern", label: "Muster", valueKind: "string", required: true },
    { id: "angleRad", label: "Nurk", valueKind: "number", required: true },
    { id: "scale", label: "Mõõtkava", valueKind: "number", required: true },
    { id: "associative", label: "Assotsiatiivne", valueKind: "boolean", required: true },
  ] },
});

export function annotationPromptPlan(commandId: AnnotationCommandId): AnnotationPromptPlan {
  return structuredClone(ANNOTATION_PROMPT_PLANS[commandId]);
}

export function createAnnotationAction(commandId: AnnotationCommandId, selectedHandles: readonly string[]): AnnotationAction {
  const tool = ANNOTATION_TOOLS.find((candidate) => candidate.id === commandId);
  if (!tool) throw new RangeError(`Unknown annotation command: ${commandId}.`);
  const handles = [...new Set(selectedHandles.map((handle) => handle.trim()).filter(Boolean))];
  if (tool.selection === "required" && !handles.length) throw new RangeError(`${commandId} requires a selection.`);
  if (tool.selection === "none" && handles.length) throw new RangeError(`${commandId} does not accept a preselection.`);
  return { commandId, selectedHandles: handles };
}
