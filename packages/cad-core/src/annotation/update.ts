import type { KDrawDocumentV1 } from "@kuubik/cad-schema";
import type { EntityChange } from "../transaction.js";
import { updateAssociativeDimensions } from "./dimensions.js";
import { updateAssociativeHatches } from "./hatch.js";
import { updateAssociativeLeaders } from "./text.js";

export interface AssociativeAnnotationUpdate {
  changes: EntityChange[];
  updatedHandles: string[];
  broken: Array<{ annotationHandle: string; targetHandle: string; kind: "dimension" | "hatch" | "leader" }>;
}

/**
 * Run against the staged document after geometry changes. Append the returned
 * changes to the geometry changes and commit the entire list exactly once.
 */
export function updateAssociativeAnnotations(document: KDrawDocumentV1, changedHandles: readonly string[]): AssociativeAnnotationUpdate {
  const dimensions = updateAssociativeDimensions(document, changedHandles);
  const hatches = updateAssociativeHatches(document, changedHandles);
  const leaders = updateAssociativeLeaders(document, changedHandles);
  return {
    changes: [...dimensions.changes, ...hatches.changes, ...leaders.changes],
    updatedHandles: [...dimensions.updatedHandles, ...hatches.updatedHandles, ...leaders.updatedHandles],
    broken: [
      ...dimensions.broken.map((item) => ({ annotationHandle: item.dimensionHandle, targetHandle: item.targetHandle, kind: "dimension" as const })),
      ...hatches.broken.map((item) => ({ annotationHandle: item.hatchHandle, targetHandle: item.boundaryHandle, kind: "hatch" as const })),
      ...leaders.broken.map((item) => ({ annotationHandle: item.leaderHandle, targetHandle: item.targetHandle, kind: "leader" as const })),
    ],
  };
}
