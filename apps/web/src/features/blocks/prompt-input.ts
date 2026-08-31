import type { BlockAttributeDefinition } from "@kuubik/cad-core";
import type { CadEntity, CadPoint2, KDrawDocumentV1 } from "@kuubik/cad-schema";
import { allocateDocumentHandles, type AnnotationBlockPromptContext } from "../annotation/prompt-input.js";
import type { CommandPromptValue } from "../annotation/prompt-state-machine.js";
import type { BlockCommandInput } from "./command-adapter.js";
import { createBlockAction, type BlockCommandId } from "./model.js";

function required<T>(values: Readonly<Record<string, CommandPromptValue>>, id: string): T {
  if (!(id in values)) throw new RangeError(`Prompt value ${id} is required.`);
  return structuredClone(values[id]) as T;
}

function optional<T>(values: Readonly<Record<string, CommandPromptValue>>, id: string): T | undefined {
  return id in values ? structuredClone(values[id]) as T : undefined;
}

export function buildBlockPromptInput(
  document: KDrawDocumentV1,
  commandId: BlockCommandId,
  values: Readonly<Record<string, CommandPromptValue>>,
  context: AnnotationBlockPromptContext = {},
): BlockCommandInput {
  const selectedHandles = createBlockAction(commandId, context.selectedHandles ?? []).selectedHandles;
  const layerId = context.activeLayerId ?? document.currentLayerId;
  switch (commandId) {
    case "BLOCK": {
      const attributes = optional<BlockAttributeDefinition[]>(values, "attributes");
      return { commandId, id: required<string>(values, "id"), name: required<string>(values, "name"), basePoint: required<CadPoint2>(values, "basePoint"), selectedHandles, insertHandle: allocateDocumentHandles(document, 1)[0]!, layerId, ...(attributes === undefined ? {} : { attributes }) };
    }
    case "INSERT": {
      const attributes = optional<Record<string, string>>(values, "attributes");
      return { commandId, handle: allocateDocumentHandles(document, 1)[0]!, layerId, blockId: required<string>(values, "blockId"), insertion: required<CadPoint2>(values, "insertion"), scale: { x: required<number>(values, "scaleX"), y: required<number>(values, "scaleY") }, rotationRad: required<number>(values, "rotationRad"), ...(attributes === undefined ? {} : { attributes }) };
    }
    case "EXPLODE": {
      if (!required<boolean>(values, "confirm")) throw new RangeError("EXPLODE confirmation is required.");
      return { commandId, insertHandle: selectedHandles[0]! };
    }
    case "BEDIT": {
      const attributes = optional<BlockAttributeDefinition[]>(values, "attributes");
      return { commandId, insertHandle: selectedHandles[0]!, basePoint: required<CadPoint2>(values, "basePoint"), entities: required<CadEntity[]>(values, "entities"), ...(attributes === undefined ? {} : { attributes }) };
    }
    case "ATTRIB": return { commandId, insertHandle: selectedHandles[0]!, values: required<Record<string, string>>(values, "values") };
  }
}
