import type { CadEntity, KDrawDocumentV1 } from "@kuubik/cad-schema";

export type QuickSelectProperty = "kind" | "layerId" | "color" | "linetypeId" | "lineweightMm" | "handle";
export type QuickSelectOperator = "equals" | "not-equals" | "greater-than" | "less-than";

export interface QuickSelectInput {
  scope: "entire-drawing" | "current-selection";
  currentSelection: readonly string[];
  property: QuickSelectProperty;
  operator: QuickSelectOperator;
  value: string | number;
  resultMode: "replace" | "append" | "exclude";
}

export interface QuickSelectResult {
  handles: string[];
  matchedHandles: string[];
  examinedCount: number;
}

export type SelectSimilarCriterion = Exclude<QuickSelectProperty, "handle">;

function propertyValue(entity: CadEntity, property: QuickSelectProperty): string | number | undefined {
  if (property === "kind") return entity.kind;
  if (property === "layerId") return entity.layerId;
  if (property === "handle") return entity.handle;
  return entity.appearance?.[property];
}

function matches(value: string | number | undefined, operator: QuickSelectOperator, expected: string | number): boolean {
  if (operator === "equals" || operator === "not-equals") {
    const equal = typeof value === "string" && typeof expected === "string"
      ? value.toLocaleLowerCase() === expected.toLocaleLowerCase()
      : value === expected;
    return operator === "equals" ? equal : !equal;
  }
  if (typeof value !== "number" || typeof expected !== "number" || !Number.isFinite(expected)) return false;
  return operator === "greater-than" ? value > expected : value < expected;
}

function uniqueExisting(document: KDrawDocumentV1, handles: readonly string[]): string[] {
  const existing = new Set(document.entities.map((entity) => entity.handle));
  return [...new Set(handles)].filter((handle) => existing.has(handle));
}

export function quickSelect(document: KDrawDocumentV1, input: QuickSelectInput): QuickSelectResult {
  const current = uniqueExisting(document, input.currentSelection);
  const currentSet = new Set(current);
  const candidates = input.scope === "entire-drawing"
    ? document.entities
    : document.entities.filter((entity) => currentSet.has(entity.handle));
  const matchedHandles = candidates
    .filter((entity) => matches(propertyValue(entity, input.property), input.operator, input.value))
    .map((entity) => entity.handle);
  const matched = new Set(matchedHandles);
  let handles: string[];
  if (input.resultMode === "replace") handles = matchedHandles;
  else if (input.resultMode === "append") handles = [...current, ...matchedHandles.filter((handle) => !currentSet.has(handle))];
  else handles = current.filter((handle) => !matched.has(handle));
  return { handles, matchedHandles, examinedCount: candidates.length };
}

export function selectSimilar(
  document: KDrawDocumentV1,
  sourceHandle: string,
  criteria: readonly SelectSimilarCriterion[],
  currentSelection: readonly string[] = [],
  append = false,
): QuickSelectResult {
  const source = document.entities.find((entity) => entity.handle === sourceHandle);
  if (!source) throw new TypeError(`SELECTSIMILAR source ${sourceHandle} does not exist.`);
  const selectedCriteria = [...new Set(criteria)];
  if (selectedCriteria.length === 0) throw new TypeError("SELECTSIMILAR requires at least one comparison criterion.");
  const matchedHandles = document.entities
    .filter((entity) => selectedCriteria.every((criterion) => propertyValue(entity, criterion) === propertyValue(source, criterion)))
    .map((entity) => entity.handle);
  const current = uniqueExisting(document, currentSelection);
  const currentSet = new Set(current);
  const handles = append ? [...current, ...matchedHandles.filter((handle) => !currentSet.has(handle))] : matchedHandles;
  return { handles, matchedHandles, examinedCount: document.entities.length };
}
