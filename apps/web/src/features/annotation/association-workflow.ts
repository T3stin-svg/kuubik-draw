import { updateAssociativeAnnotations, type CadSession, type EntityChange } from "@kuubik/cad-core";
import type { KDrawDocumentV1 } from "@kuubik/cad-schema";
import { createAtomicCommandWorkflow, type AtomicCommandAdapter, type PreparedAtomicCommand } from "../draw-modify/atomic-command-workflow.js";

export interface AssociativeEntityCommandInput {
  commandId: string;
  entityChanges: EntityChange[];
  changedHandles: string[];
  allowBrokenAssociations?: boolean;
  operationArgs?: unknown;
}

function stageEntityChanges(document: KDrawDocumentV1, changes: readonly EntityChange[]): KDrawDocumentV1 {
  const staged = structuredClone(document);
  const entities = new Map(staged.entities.map((entity) => [entity.handle, entity]));
  for (const change of changes) {
    if (change.type === "put") entities.set(change.entity.handle, structuredClone(change.entity));
    else if (!entities.delete(change.handle)) throw new RangeError(`Cannot stage deletion of missing entity ${change.handle}.`);
  }
  staged.entities = [...entities.values()];
  return staged;
}

function putHandles(changes: readonly EntityChange[]): string[] {
  return changes.flatMap((change) => change.type === "put" ? [change.entity.handle] : []);
}

export function prepareAssociativeEntityCommand(document: KDrawDocumentV1, input: AssociativeEntityCommandInput): PreparedAtomicCommand {
  if (!input.commandId.trim() || !input.entityChanges.length) throw new TypeError("Associative geometry command id and changes are required.");
  const changedHandles = [...new Set(input.changedHandles.map((handle) => handle.trim()).filter(Boolean))];
  if (!changedHandles.length) throw new TypeError("Associative geometry command requires changed handles.");
  const directlyChanged = new Set(input.entityChanges.map((change) => change.type === "put" ? change.entity.handle : change.handle));
  if (changedHandles.some((handle) => !directlyChanged.has(handle))) throw new RangeError("Every changed handle must have a matching entity change.");
  const staged = stageEntityChanges(document, input.entityChanges);
  const associations = updateAssociativeAnnotations(staged, changedHandles);
  if (associations.broken.length && !input.allowBrokenAssociations) {
    const first = associations.broken[0]!;
    throw new RangeError(`Broken ${first.kind} association ${first.annotationHandle} -> ${first.targetHandle}.`);
  }
  const directTargets = new Set(directlyChanged);
  const overlap = associations.updatedHandles.find((handle) => directTargets.has(handle));
  if (overlap) throw new RangeError(`Geometry command also changes associated annotation ${overlap}; merge is ambiguous.`);
  const changes = [...structuredClone(input.entityChanges), ...associations.changes];
  return {
    commandId: input.commandId,
    changes,
    targetHandles: [...changedHandles, ...associations.updatedHandles],
    resultHandles: [...putHandles(input.entityChanges), ...associations.updatedHandles],
    operationArgs: structuredClone(input.operationArgs ?? { changedHandles }),
  };
}

export function createAssociativeEntityCommandAdapter(): AtomicCommandAdapter<AssociativeEntityCommandInput> {
  return { prepare: prepareAssociativeEntityCommand };
}

export function createAssociativeEntityWorkflow(session: CadSession) {
  return createAtomicCommandWorkflow(session, createAssociativeEntityCommandAdapter());
}
