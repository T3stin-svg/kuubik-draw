export type BlockCommandId = "BLOCK" | "INSERT" | "EXPLODE" | "BEDIT" | "ATTEDIT";

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
  { rowId: "F-091", id: "ATTEDIT", label: "Muuda atribuute", selection: "one" },
]);

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
