import type { PrecisionShellRow, VisualShellCommandAdapter } from "../precision/command-adapter.js";

export type LayerShellRow = "F-072" | "F-073" | "F-074" | "F-075" | "F-076" | "F-077" | "F-078" | "F-079" | "F-080";
export type LayerShellAction = "create" | "current" | "lock" | "visibility" | "freeze" | "color" | "linetype" | "lineweight" | "plot" | "manager";

const LAYER_ROWS: Readonly<Record<LayerShellRow, LayerShellAction>> = Object.freeze({
  "F-072": "create",
  "F-073": "visibility",
  "F-074": "lock",
  "F-075": "freeze",
  "F-076": "color",
  "F-077": "linetype",
  "F-078": "lineweight",
  "F-079": "plot",
  "F-080": "manager",
});

/** Composes layer action intents with the precision adapter without importing shell code. */
export class LayerVisualShellCommandAdapter implements VisualShellCommandAdapter {
  constructor(
    readonly base: VisualShellCommandAdapter,
    private readonly onLayerAction: (action: LayerShellAction, rowId: LayerShellRow) => void,
  ) {}

  canExecute(rowId: string, context: "model" | "paper"): boolean {
    if (Object.hasOwn(LAYER_ROWS, rowId)) return true;
    return this.base.canExecute(rowId, context);
  }

  execute(rowId: string): void {
    if (Object.hasOwn(LAYER_ROWS, rowId)) {
      const typedRow = rowId as LayerShellRow;
      this.onLayerAction(LAYER_ROWS[typedRow], typedRow);
      return;
    }
    this.base.execute(rowId);
  }

  precisionMode(rowId: PrecisionShellRow): boolean {
    return this.base.precisionMode(rowId);
  }

  setPrecisionMode(rowId: PrecisionShellRow, enabled: boolean): void {
    this.base.setPrecisionMode(rowId, enabled);
  }
}
