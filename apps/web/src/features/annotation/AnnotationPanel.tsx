import { ANNOTATION_TOOLS, createAnnotationAction, type AnnotationAction } from "./model.js";

export interface AnnotationPanelProps {
  selectedHandles: readonly string[];
  disabledRowIds?: ReadonlySet<string>;
  onAction: (action: AnnotationAction) => void;
}

export function AnnotationPanel({ selectedHandles, disabledRowIds = new Set(), onAction }: AnnotationPanelProps) {
  return (
    <section aria-label="Annotatsioon" data-feature="annotation">
      {ANNOTATION_TOOLS.map((tool) => {
        const disabled = tool.rowIds.some((rowId) => disabledRowIds.has(rowId)) || (tool.selection === "required" && selectedHandles.length === 0);
        return (
          <button key={tool.id} type="button" data-command={tool.id} disabled={disabled} title={tool.rowIds.join(", ")} onClick={() => onAction(createAnnotationAction(tool.id, selectedHandles))}>
            {tool.label}
          </button>
        );
      })}
    </section>
  );
}
