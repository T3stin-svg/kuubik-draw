import { BLOCK_TOOLS, createBlockAction, type BlockAction } from "./model.js";

export interface BlocksPanelProps {
  selectedHandles: readonly string[];
  disabledRowIds?: ReadonlySet<string>;
  onAction: (action: BlockAction) => void;
}

export function BlocksPanel({ selectedHandles, disabledRowIds = new Set(), onAction }: BlocksPanelProps) {
  return (
    <section aria-label="Plokid" data-feature="blocks">
      {BLOCK_TOOLS.map((tool) => {
        const selectionDisabled = tool.selection === "one" ? selectedHandles.length !== 1 : tool.selection === "many" ? selectedHandles.length === 0 : false;
        return (
          <button key={tool.id} type="button" data-command={tool.id} disabled={disabledRowIds.has(tool.rowId) || selectionDisabled} title={tool.rowId} onClick={() => onAction(createBlockAction(tool.id, selectedHandles))}>
            {tool.label}
          </button>
        );
      })}
    </section>
  );
}
