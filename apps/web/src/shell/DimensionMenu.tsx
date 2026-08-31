import type { AnnotationCommandId } from "../features/annotation/model.js";
import { CadIcon } from "../icons/CadIcon.js";
import { isInReioScope, UNSCOPED_COMMAND_MESSAGE } from "./reio-scope.js";

const DIMENSION_COMMANDS: ReadonlyArray<{
  commandId: AnnotationCommandId;
  rowId: string;
  label: string;
  selectionRequired?: boolean;
}> = Object.freeze([
  { commandId: "DIMLINEAR", rowId: "F-061", label: "Linear" },
  { commandId: "DIMALIGNED", rowId: "F-062", label: "Aligned" },
  { commandId: "DIMANGULAR", rowId: "F-063", label: "Angular" },
  { commandId: "DIMRADIUS", rowId: "F-063", label: "Radius", selectionRequired: true },
  { commandId: "DIMDIAMETER", rowId: "F-063", label: "Diameter", selectionRequired: true },
  { commandId: "DIMCONTINUE", rowId: "F-064", label: "Continue", selectionRequired: true },
  { commandId: "DIMBASELINE", rowId: "F-065", label: "Baseline", selectionRequired: true },
  { commandId: "DIMSTYLE", rowId: "F-066", label: "Dimension Style" },
]);

interface DimensionMenuProps {
  activeCommand: string | null;
  available: (rowId: string) => boolean;
  modelSpaceEditing: boolean;
  activeLayerLocked: boolean;
  selectedHandles: readonly string[];
  onCommand: (commandId: AnnotationCommandId, handles: readonly string[]) => void;
}

export function DimensionMenu({ activeCommand, available, modelSpaceEditing, activeLayerLocked, selectedHandles, onCommand }: DimensionMenuProps) {
  return (
    <details className="dimension-menu" data-testid="dimension-menu">
      <summary aria-label="Dimension commands">
        <span className="ribbon-glyph"><CadIcon name="dimension" /></span>
        <span>Dimension</span>
        <CadIcon name="chevronDown" />
      </summary>
      <div className="dimension-menu-popover" role="menu" aria-label="Dimension workflows">
        {DIMENSION_COMMANDS.map((item) => {
          const selected = isInReioScope(item.rowId);
          const runtimeAvailable = available(item.rowId);
          const selectionMissing = item.selectionRequired && selectedHandles.length === 0;
          const stateDisabled = !modelSpaceEditing || activeLayerLocked || selectionMissing;
          const disabled = !selected || !runtimeAvailable || stateDisabled;
          const reason = !selected
            ? UNSCOPED_COMMAND_MESSAGE
            : !runtimeAvailable
              ? "Arenduses · commit-liides pole veel ühendatud"
              : selectionMissing
                ? "Vali kõigepealt objekt"
                : stateDisabled
                  ? "Käsk pole praeguses olekus saadaval"
                  : "Valitud sinu töövoogu";
          return (
            <button
              key={item.commandId}
              type="button"
              role="menuitem"
              className={activeCommand === item.commandId ? "is-active" : ""}
              data-feature-row={item.rowId}
              data-command-id={item.commandId}
              data-state-reason={reason}
              title={`${item.label} · ${reason}`}
              disabled={disabled}
              onClick={(event) => {
                event.currentTarget.closest("details")?.removeAttribute("open");
                onCommand(item.commandId, selectedHandles);
              }}
            >
              <span className="ribbon-glyph"><CadIcon name={item.commandId === "DIMSTYLE" ? "settings" : "dimension"} /></span>
              <span>{item.label}</span>
              {selectionMissing && <small>selection</small>}
            </button>
          );
        })}
      </div>
    </details>
  );
}
