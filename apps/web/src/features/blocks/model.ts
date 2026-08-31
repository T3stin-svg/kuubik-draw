export type BlockCommandId = "BLOCK" | "INSERT" | "EXPLODE" | "BEDIT" | "ATTRIB";

export interface BlockTool {
  rowId: "F-087" | "F-088" | "F-089" | "F-090" | "F-091";
  id: BlockCommandId;
  label: string;
  selection: "none" | "one" | "many";
}

export const BLOCK_TOOLS: readonly BlockTool[] = Object.freeze([
  { rowId: "F-087", id: "BLOCK", label: "Loo plokk", selection: "many" },
  { rowId: "F-088", id: "INSERT", label: "Sisesta plokk", selection: "none" },
  { rowId: "F-089", id: "EXPLODE", label: "Lahuta plokk", selection: "one" },
  { rowId: "F-090", id: "BEDIT", label: "Muuda plokki", selection: "one" },
  { rowId: "F-091", id: "ATTRIB", label: "Muuda atribuute", selection: "one" },
]);

export type BlockPromptValueKind = "point" | "string" | "number" | "entities" | "attributes" | "select" | "boolean";

export interface BlockPromptField {
  id: string;
  label: string;
  valueKind: BlockPromptValueKind;
  required: boolean;
}

export interface BlockPromptPlan {
  commandId: BlockCommandId;
  fields: readonly BlockPromptField[];
}

export const BLOCK_PROMPT_PLANS: Readonly<Record<BlockCommandId, BlockPromptPlan>> = Object.freeze({
  BLOCK: { commandId: "BLOCK", fields: [
    { id: "id", label: "Ploki ID", valueKind: "string", required: true },
    { id: "name", label: "Ploki nimi", valueKind: "string", required: true },
    { id: "basePoint", label: "Baasipunkt", valueKind: "point", required: true },
    { id: "insertHandle", label: "Insert-handle", valueKind: "string", required: true },
    { id: "attributes", label: "Atribuudimääratlused", valueKind: "attributes", required: false },
  ] },
  INSERT: { commandId: "INSERT", fields: [
    { id: "blockId", label: "Plokk", valueKind: "string", required: true },
    { id: "insertion", label: "Sisestuspunkt", valueKind: "point", required: true },
    { id: "scaleX", label: "X mõõtkava", valueKind: "number", required: true },
    { id: "scaleY", label: "Y mõõtkava", valueKind: "number", required: true },
    { id: "rotationRad", label: "Pööre", valueKind: "number", required: true },
    { id: "attributes", label: "Atribuudiväärtused", valueKind: "attributes", required: false },
  ] },
  EXPLODE: { commandId: "EXPLODE", fields: [
    { id: "confirm", label: "Lahuta valitud plokk", valueKind: "boolean", required: true },
  ] },
  BEDIT: { commandId: "BEDIT", fields: [
    { id: "basePoint", label: "Baasipunkt", valueKind: "point", required: true },
    { id: "entities", label: "Uus plokisisu", valueKind: "entities", required: true },
    { id: "attributes", label: "Atribuudimääratlused", valueKind: "attributes", required: false },
  ] },
  ATTRIB: { commandId: "ATTRIB", fields: [
    { id: "values", label: "Atribuudiväärtused", valueKind: "attributes", required: true },
  ] },
});

export function blockPromptPlan(commandId: BlockCommandId): BlockPromptPlan {
  return structuredClone(BLOCK_PROMPT_PLANS[commandId]);
}

export interface BlockAction {
  commandId: BlockCommandId;
  selectedHandles: string[];
}

export function createBlockAction(commandId: BlockCommandId, selectedHandles: readonly string[]): BlockAction {
  const tool = BLOCK_TOOLS.find((candidate) => candidate.id === commandId);
  if (!tool) throw new RangeError(`Unknown block command: ${commandId}.`);
  const handles = [...new Set(selectedHandles.map((handle) => handle.trim()).filter(Boolean))];
  if (tool.selection === "none" && handles.length) throw new RangeError(`${commandId} does not accept a preselection.`);
  if (tool.selection === "one" && handles.length !== 1) throw new RangeError(`${commandId} requires exactly one INSERT.`);
  if (tool.selection === "many" && handles.length === 0) throw new RangeError(`${commandId} requires a non-empty selection.`);
  return { commandId, selectedHandles: handles };
}
