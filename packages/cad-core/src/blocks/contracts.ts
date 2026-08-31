import type { CadBlockDefinition, CadPoint2 } from "@kuubik/cad-schema";

export const BLOCK_EXTENSION_KEY = "kuubik.block.v1" as const;

export interface BlockAttributeDefinition {
  tag: string;
  prompt: string;
  defaultValue: string;
  position: CadPoint2;
  height: number;
  rotationRad?: number;
  textStyleId?: string;
  constant?: boolean;
  invisible?: boolean;
}

export interface BlockDefinitionExtension {
  kind: "block-definition";
  version: 1;
  attributeDefinitions: BlockAttributeDefinition[];
}

export type KuubikBlockDefinition = CadBlockDefinition & { extensionData?: Record<string, unknown> };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function withBlockAttributes(definition: CadBlockDefinition, attributes: readonly BlockAttributeDefinition[]): KuubikBlockDefinition {
  return {
    ...structuredClone(definition),
    extensionData: {
      ...(isRecord((definition as KuubikBlockDefinition).extensionData) ? structuredClone((definition as KuubikBlockDefinition).extensionData) : {}),
      [BLOCK_EXTENSION_KEY]: { kind: "block-definition", version: 1, attributeDefinitions: structuredClone([...attributes]) },
    },
  };
}

export function readBlockAttributes(definition: CadBlockDefinition): BlockAttributeDefinition[] {
  const extensionData = (definition as KuubikBlockDefinition).extensionData;
  const value = extensionData?.[BLOCK_EXTENSION_KEY];
  if (!isRecord(value) || value.kind !== "block-definition" || value.version !== 1 || !Array.isArray(value.attributeDefinitions)) return [];
  const result: BlockAttributeDefinition[] = [];
  for (const candidate of value.attributeDefinitions) {
    if (!isRecord(candidate) || typeof candidate.tag !== "string" || typeof candidate.prompt !== "string" || typeof candidate.defaultValue !== "string") return [];
    if (!isRecord(candidate.position) || !Number.isFinite(candidate.position.x) || !Number.isFinite(candidate.position.y) || !Number.isFinite(candidate.height) || !(Number(candidate.height) > 0)) return [];
    if (candidate.rotationRad !== undefined && !Number.isFinite(candidate.rotationRad)) return [];
    if (candidate.textStyleId !== undefined && typeof candidate.textStyleId !== "string") return [];
    result.push({
      tag: candidate.tag,
      prompt: candidate.prompt,
      defaultValue: candidate.defaultValue,
      position: { x: Number(candidate.position.x), y: Number(candidate.position.y) },
      height: Number(candidate.height),
      ...(candidate.rotationRad === undefined ? {} : { rotationRad: Number(candidate.rotationRad) }),
      ...(typeof candidate.textStyleId === "string" ? { textStyleId: candidate.textStyleId } : {}),
      ...(candidate.constant === undefined ? {} : { constant: Boolean(candidate.constant) }),
      ...(candidate.invisible === undefined ? {} : { invisible: Boolean(candidate.invisible) }),
    });
  }
  return result;
}
