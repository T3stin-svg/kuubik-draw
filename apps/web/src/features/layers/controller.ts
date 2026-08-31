import type { CadOperation, KDrawDocumentV1 } from "@kuubik/cad-schema";
import { CadSession, type CommittedOperation } from "../../../../../packages/cad-core/src/transaction.js";
import {
  planCreateLayer,
  planDeleteLayer,
  planRenameLayer,
  planSetCurrentLayer,
  planSetLayerAppearance,
  planSetLayerToggle,
  type CadLayerAppearancePatch,
  type CadLayerPlan,
  type CadLayerToggle,
} from "../../../../../packages/cad-core/src/layers.js";
import { planDrawOrderChanges, type CadDrawOrderAction } from "../../../../../packages/cad-core/src/draw-order.js";

export type LayerManagerCommand =
  | { type: "create"; name: string; requestedId?: string }
  | { type: "rename"; layerId: string; name: string }
  | { type: "delete"; layerId: string }
  | { type: "current"; layerId: string }
  | { type: "toggle"; layerId: string; property: CadLayerToggle; value: boolean }
  | { type: "appearance"; layerId: string; patch: CadLayerAppearancePatch }
  | { type: "draw-order"; handles: readonly string[]; action: CadDrawOrderAction; referenceHandle?: string };

export interface LayerManagerPlan {
  commandId: string;
  args: Record<string, unknown>;
  changes: CadLayerPlan["changes"];
  targetHandles: string[];
  resultHandles: string[];
  orderedHandles?: string[];
}

export interface LayerManagerCommit {
  committed: CommittedOperation;
  document: KDrawDocumentV1;
  orderedHandles?: string[];
}

export interface LayerManagerControllerOptions {
  opIdPrefix?: string;
  now?: () => string;
}

/** Plans first, then commits the complete layer or draw-order change in one revision. */
export class LayerManagerController {
  readonly #session: CadSession;
  readonly #opIdPrefix: string;
  readonly #now: () => string;
  #sequence = 0;

  constructor(document: KDrawDocumentV1, options: LayerManagerControllerOptions = {}) {
    this.#session = new CadSession(document);
    this.#opIdPrefix = options.opIdPrefix ?? "layer-manager";
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  get document(): KDrawDocumentV1 {
    return this.#session.document;
  }

  get canUndo(): boolean { return this.#session.canUndo; }
  get canRedo(): boolean { return this.#session.canRedo; }

  plan(command: LayerManagerCommand): LayerManagerPlan {
    const document = this.#session.document;
    if (command.type === "draw-order") {
      const planned = planDrawOrderChanges(document, command.handles, command.action, command.referenceHandle);
      return {
        commandId: planned.commandId,
        args: planned.args,
        changes: planned.changes,
        targetHandles: [...new Set(command.handles)],
        resultHandles: [...new Set(command.handles)],
        orderedHandles: planned.orderedHandles,
      };
    }
    let planned: CadLayerPlan;
    switch (command.type) {
      case "create": planned = planCreateLayer(document, command.name, command.requestedId); break;
      case "rename": planned = planRenameLayer(document, command.layerId, command.name); break;
      case "delete": planned = planDeleteLayer(document, command.layerId); break;
      case "current": planned = planSetCurrentLayer(document, command.layerId); break;
      case "toggle": planned = planSetLayerToggle(document, command.layerId, command.property, command.value); break;
      case "appearance": planned = planSetLayerAppearance(document, command.layerId, command.patch); break;
    }
    return { ...planned, targetHandles: [], resultHandles: [] };
  }

  execute(command: LayerManagerCommand): LayerManagerCommit {
    const planned = this.plan(command);
    const operation: CadOperation = {
      opId: `${this.#opIdPrefix}:${this.document.revision}:${++this.#sequence}:${planned.commandId}`,
      baseRevision: this.document.revision,
      commandId: planned.commandId,
      args: planned.args,
      targetHandles: planned.targetHandles,
      resultHandles: planned.resultHandles,
    };
    const committed = this.#session.commit(operation, planned.changes, this.#now());
    return { committed, document: this.document, ...(planned.orderedHandles ? { orderedHandles: planned.orderedHandles } : {}) };
  }

  undo(): LayerManagerCommit | null {
    const committed = this.#session.undo(this.#now());
    return committed ? { committed, document: this.document } : null;
  }

  redo(): LayerManagerCommit | null {
    const committed = this.#session.redo(this.#now());
    return committed ? { committed, document: this.document } : null;
  }
}
