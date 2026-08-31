import type { CadEntity, KDrawDocumentV1 } from "@kuubik/cad-schema";
import { entityParticipates, type CadLayerPurpose } from "../../../../../packages/cad-core/src/layer-policy.js";
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

export class LayerFeatureModel {
  constructor(readonly document: KDrawDocumentV1) {}

  create(name: string): CadLayerPlan { return planCreateLayer(this.document, name); }
  rename(layerId: string, name: string): CadLayerPlan { return planRenameLayer(this.document, layerId, name); }
  delete(layerId: string): CadLayerPlan { return planDeleteLayer(this.document, layerId); }
  makeCurrent(layerId: string): CadLayerPlan { return planSetCurrentLayer(this.document, layerId); }
  toggle(layerId: string, property: CadLayerToggle, value: boolean): CadLayerPlan { return planSetLayerToggle(this.document, layerId, property, value); }
  appearance(layerId: string, patch: CadLayerAppearancePatch): CadLayerPlan { return planSetLayerAppearance(this.document, layerId, patch); }
  drawOrder(handles: readonly string[], action: CadDrawOrderAction, referenceHandle?: string) { return planDrawOrderChanges(this.document, handles, action, referenceHandle); }

  participates(entity: CadEntity, purpose: CadLayerPurpose): boolean {
    return entityParticipates(entity, this.document.layers, purpose).participates;
  }
}
