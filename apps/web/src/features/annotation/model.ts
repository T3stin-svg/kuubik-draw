export type AnnotationCommandId = "DIMLINEAR" | "DIMALIGNED" | "DIMANGULAR" | "DIMRADIUS" | "DIMDIAMETER" | "DIMCONTINUE" | "DIMSTYLE" | "MTEXT" | "STYLE" | "LEADER" | "MLEADER" | "HATCH";

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

export function createAnnotationAction(commandId: AnnotationCommandId, selectedHandles: readonly string[]): AnnotationAction {
  const tool = ANNOTATION_TOOLS.find((candidate) => candidate.id === commandId);
  if (!tool) throw new RangeError(`Unknown annotation command: ${commandId}.`);
  const handles = [...new Set(selectedHandles.map((handle) => handle.trim()).filter(Boolean))];
  if (tool.selection === "required" && !handles.length) throw new RangeError(`${commandId} requires a selection.`);
  if (tool.selection === "none" && handles.length) throw new RangeError(`${commandId} does not accept a preselection.`);
  return { commandId, selectedHandles: handles };
}
