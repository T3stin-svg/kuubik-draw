import type { CadSession, CommittedOperation } from "@kuubik/cad-core";
import type { CommandExecutionResult, CommandDefinition, PreparedEngineCommand } from "../command-system/command-engine.js";
import { CommandEngineInputError, CommandLineEngine, CommandRegistry } from "../command-system/command-engine.js";
import { blockPromptPlan, type BlockCommandId } from "../blocks/model.js";
import { blockCommandLine, createBlockCommandDefinitions, type BlockCommandPlanner, type BlockEngineCommandId } from "../blocks/command-definition.js";
import type { BlockCommandInput } from "../blocks/command-adapter.js";
import { buildBlockPromptInput } from "../blocks/prompt-input.js";
import { annotationCommandLine, createAnnotationCommandDefinitions, type AnnotationCommandPlanner, type AnnotationEngineCommandId } from "./command-definition.js";
import type { AnnotationCommandInput } from "./command-adapter.js";
import { readBackAnnotationBlockCommit, type AnnotationBlockCommandReadBack } from "./command-read-back.js";
import { annotationPromptPlan, type AnnotationCommandId } from "./model.js";
import { buildAnnotationPromptInput, type AnnotationBlockPromptContext } from "./prompt-input.js";
import { CommandPromptStateMachine, type CommandPromptSnapshot } from "./prompt-state-machine.js";

export type AnnotationBlockShellCommandId = AnnotationEngineCommandId | BlockEngineCommandId;

export interface AnnotationBlockCommandCapability {
  commandId: AnnotationBlockShellCommandId;
  executable: boolean;
  code: "ready" | "missing-planner" | "missing-session-adapter" | "unsupported-dxf-version";
  message: string;
}

export interface AnnotationBlockSessionAdapter {
  session: CadSession;
}

export interface AnnotationBlockShellDependencies {
  sessionAdapter?: AnnotationBlockSessionAdapter | null;
  annotationPlanner?: AnnotationCommandPlanner | null;
  blockPlanner?: BlockCommandPlanner | null;
  dxfVersion?: string | null;
}

export interface AnnotationBlockPromptRequest {
  commandId: AnnotationBlockShellCommandId;
  dimensionCommandId?: Extract<AnnotationCommandId, `DIM${string}`>;
  context?: AnnotationBlockPromptContext;
}

export interface AnnotationBlockPromptPreview {
  input: AnnotationCommandInput | BlockCommandInput;
  prepared: PreparedEngineCommand;
}

export interface AnnotationBlockPromptCommit {
  input: AnnotationCommandInput | BlockCommandInput;
  prepared: PreparedEngineCommand;
  execution: Extract<CommandExecutionResult, { kind: "commit" }>;
  readBack: AnnotationBlockCommandReadBack;
}

export interface AnnotationBlockShellAdapter {
  readonly commandDefinitions: readonly CommandDefinition[];
  readonly capabilities: readonly AnnotationBlockCommandCapability[];
  capability(commandId: AnnotationBlockShellCommandId): AnnotationBlockCommandCapability;
  createPrompt(request: AnnotationBlockPromptRequest): CommandPromptStateMachine;
  previewPrompt(): AnnotationBlockPromptPreview;
  executePrompt(now?: string): AnnotationBlockPromptCommit;
  preview(input: AnnotationCommandInput | BlockCommandInput): PreparedEngineCommand;
  execute(input: AnnotationCommandInput | BlockCommandInput, now?: string): CommandExecutionResult;
  cancel(): CommandPromptSnapshot;
  repeat(): CommandPromptStateMachine;
  undo(now?: string): CommittedOperation | null;
  redo(now?: string): CommittedOperation | null;
}

const ANNOTATION_COMMANDS: readonly AnnotationEngineCommandId[] = ["TEXT", "MTEXT", "LEADER", "MLEADER", "DIM", "STYLE", "HATCH"];
const BLOCK_COMMANDS: readonly BlockEngineCommandId[] = ["BLOCK", "INSERT", "BEDIT", "EXPLODE", "ATTRIB"];

function engineCommandId(input: AnnotationCommandInput | BlockCommandInput): AnnotationBlockShellCommandId {
  if (input.commandId.startsWith("DIM")) return "DIM";
  return input.commandId as AnnotationBlockShellCommandId;
}

function isMLeaderVersionSupported(version: string | null | undefined): boolean {
  const match = version?.match(/^AC(\d{4})$/u);
  return match !== undefined && match !== null && Number(match[1]) >= 1021;
}

function capabilityFor(commandId: AnnotationBlockShellCommandId, dependencies: AnnotationBlockShellDependencies): AnnotationBlockCommandCapability {
  const isAnnotation = ANNOTATION_COMMANDS.includes(commandId as AnnotationEngineCommandId);
  if (isAnnotation ? !dependencies.annotationPlanner : !dependencies.blockPlanner) {
    return { commandId, executable: false, code: "missing-planner", message: `${commandId}: planner puudub.` };
  }
  if (!dependencies.sessionAdapter) return { commandId, executable: false, code: "missing-session-adapter", message: `${commandId}: session-adapter puudub.` };
  if (commandId === "MLEADER" && !isMLeaderVersionSupported(dependencies.dxfVersion)) {
    return { commandId, executable: false, code: "unsupported-dxf-version", message: "MLEADER nõuab DXF AC1021 või uuemat." };
  }
  return { commandId, executable: true, code: "ready", message: `${commandId}: valmis.` };
}

export function createAnnotationBlockShellAdapter(dependencies: AnnotationBlockShellDependencies): AnnotationBlockShellAdapter {
  const capabilities = [...ANNOTATION_COMMANDS, ...BLOCK_COMMANDS].map((commandId) => capabilityFor(commandId, dependencies));
  const executableIds = new Set(capabilities.filter((state) => state.executable).map((state) => state.commandId));
  const commandDefinitions = [
    ...(dependencies.annotationPlanner ? createAnnotationCommandDefinitions(dependencies.annotationPlanner) : []),
    ...(dependencies.blockPlanner ? createBlockCommandDefinitions(dependencies.blockPlanner) : []),
  ].filter((definition) => executableIds.has(definition.id as AnnotationBlockShellCommandId));
  const engine = dependencies.sessionAdapter ? new CommandLineEngine(dependencies.sessionAdapter.session, new CommandRegistry(commandDefinitions)) : null;
  let activePrompt: CommandPromptStateMachine | null = null;
  let activePromptRequest: AnnotationBlockPromptRequest | null = null;
  let lastPromptRequest: AnnotationBlockPromptRequest | null = null;

  const capability = (commandId: AnnotationBlockShellCommandId): AnnotationBlockCommandCapability => {
    const state = capabilities.find((candidate) => candidate.commandId === commandId);
    if (!state) throw new RangeError(`Unknown annotation/block command: ${commandId}.`);
    return structuredClone(state);
  };
  const requireEngine = (commandId: AnnotationBlockShellCommandId): CommandLineEngine => {
    const state = capability(commandId);
    if (!state.executable || !engine) throw new CommandEngineInputError(state.message);
    return engine;
  };
  const createPrompt = (request: AnnotationBlockPromptRequest): CommandPromptStateMachine => {
    requireEngine(request.commandId);
    let prompt: CommandPromptStateMachine;
    if (request.commandId === "DIM") {
      if (!request.dimensionCommandId) throw new CommandEngineInputError("DIM prompt requires a concrete dimension command.");
      prompt = new CommandPromptStateMachine(annotationPromptPlan(request.dimensionCommandId));
    } else if (ANNOTATION_COMMANDS.includes(request.commandId as AnnotationEngineCommandId)) {
      prompt = new CommandPromptStateMachine(annotationPromptPlan(request.commandId as Exclude<AnnotationCommandId, `DIM${string}`>));
    } else prompt = new CommandPromptStateMachine(blockPromptPlan(request.commandId as BlockCommandId));
    activePrompt = prompt;
    activePromptRequest = structuredClone(request);
    lastPromptRequest = structuredClone(request);
    return prompt;
  };
  const activeInput = (): AnnotationCommandInput | BlockCommandInput => {
    if (!activePrompt || !activePromptRequest) throw new CommandEngineInputError("Aktiivne annotation/block prompt puudub.");
    const snapshot = activePrompt.snapshot;
    if (snapshot.status !== "ready") throw new CommandEngineInputError(`${snapshot.commandId}: prompt ei ole valmis.`);
    const document = dependencies.sessionAdapter!.session.document;
    if (activePromptRequest.commandId === "DIM") return buildAnnotationPromptInput(document, activePromptRequest.dimensionCommandId!, snapshot.values, activePromptRequest.context);
    if (ANNOTATION_COMMANDS.includes(activePromptRequest.commandId as AnnotationEngineCommandId)) return buildAnnotationPromptInput(document, activePromptRequest.commandId as AnnotationCommandId, snapshot.values, activePromptRequest.context);
    return buildBlockPromptInput(document, activePromptRequest.commandId as BlockCommandId, snapshot.values, activePromptRequest.context);
  };

  return {
    commandDefinitions: [...commandDefinitions],
    capabilities: structuredClone(capabilities),
    capability,
    createPrompt,
    previewPrompt() {
      const input = activeInput();
      return { input: structuredClone(input), prepared: this.preview(input) };
    },
    executePrompt(now) {
      const { input, prepared } = this.previewPrompt();
      const execution = this.execute(input, now);
      if (execution.kind !== "commit") throw new CommandEngineInputError(`${prepared.commandId}: commit puudub.`);
      const readBack = readBackAnnotationBlockCommit(dependencies.sessionAdapter!.session, prepared, execution.committed);
      activePrompt = null;
      activePromptRequest = null;
      return { input: structuredClone(input), prepared, execution, readBack };
    },
    preview(input) {
      const id = engineCommandId(input);
      return requireEngine(id).preview(BLOCK_COMMANDS.includes(id as BlockEngineCommandId)
        ? blockCommandLine(input as BlockCommandInput)
        : annotationCommandLine(input as AnnotationCommandInput));
    },
    execute(input, now) {
      const id = engineCommandId(input);
      const raw = BLOCK_COMMANDS.includes(id as BlockEngineCommandId) ? blockCommandLine(input as BlockCommandInput) : annotationCommandLine(input as AnnotationCommandInput);
      return requireEngine(id).execute(raw, now);
    },
    cancel() {
      if (!activePrompt) throw new CommandEngineInputError("Aktiivne annotation/block prompt puudub.");
      engine?.handleKey("Escape");
      const snapshot = activePrompt.cancel();
      activePrompt = null;
      activePromptRequest = null;
      return snapshot;
    },
    repeat() {
      if (!lastPromptRequest) throw new CommandEngineInputError("Kordamiseks puudub eelmine annotation/block käsk.");
      return createPrompt(lastPromptRequest);
    },
    undo(now) {
      if (!engine) throw new CommandEngineInputError("Session-adapter puudub.");
      const result = engine.execute("U", now);
      return result.kind === "undo" ? result.committed : null;
    },
    redo(now) {
      if (!engine) throw new CommandEngineInputError("Session-adapter puudub.");
      const result = engine.execute("REDO", now);
      return result.kind === "redo" ? result.committed : null;
    },
  };
}
