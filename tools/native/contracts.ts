import type { CadOperation, KDrawDocumentV1 } from "@kuubik/cad-schema";

export type NativeFeatureRow = "F-112" | "F-113" | "F-117" | "F-121";
export type LicensedNativeProvider = "oda-drawings-sdk" | "autodesk-realdwg";

export interface NativeSdkIdentity {
  provider: LicensedNativeProvider;
  product: string;
  version: string;
  licenseEvidenceId: string;
  runtimeSha256: string;
}

export interface NativeCapabilityReport {
  available: boolean;
  sdk: NativeSdkIdentity | null;
  supportedRows: NativeFeatureRow[];
  unknownObjectRoundtrip: boolean;
  processIsolated: boolean;
  networkRequired: boolean;
  blocker: string | null;
}

export interface NativeInput {
  fileName: string;
  bytes: Uint8Array;
  sourceSha256: string;
}

export interface NativeAuditManifest {
  sourceSha256: string;
  outputSha256: string;
  nativeObjectCount: number;
  proxyObjectCount: number;
  preservedUnknownObjectCount: number;
  warnings: string[];
}

export interface NativeImportResult {
  document: KDrawDocumentV1;
  audit: NativeAuditManifest;
}

export interface NativeExportResult {
  bytes: Uint8Array;
  audit: NativeAuditManifest;
}

export interface NativeXrefRequest {
  host: NativeInput;
  reference: NativeInput;
  referenceKind: "attach" | "overlay";
  storedPathKind: "relative" | "absolute";
  insertion: { x: number; y: number; scale: number; rotationRad: number };
}

export interface NativeCadAdapter {
  readonly capabilities: NativeCapabilityReport;
  importDwg(input: NativeInput, documentId: string): Promise<NativeImportResult>;
  applyOperations(input: NativeInput, operations: readonly CadOperation[]): Promise<NativeExportResult>;
  exportDwg(document: KDrawDocumentV1, targetVersion: "AC1032"): Promise<NativeExportResult>;
  createFromDwt(template: NativeInput, documentId: string): Promise<NativeImportResult>;
  attachXref(request: NativeXrefRequest): Promise<NativeExportResult>;
  auditAndRecover(input: NativeInput): Promise<NativeExportResult>;
}

export class NativeSdkUnavailableError extends Error {
  readonly code = "NATIVE_SDK_UNAVAILABLE";

  constructor(readonly blocker: string) {
    super(blocker);
    this.name = "NativeSdkUnavailableError";
  }
}

export function assertLicensedNativeCapability(report: NativeCapabilityReport): asserts report is NativeCapabilityReport & { available: true; sdk: NativeSdkIdentity } {
  if (!report.available || !report.sdk) throw new NativeSdkUnavailableError(report.blocker ?? "Licensed native CAD SDK is unavailable.");
  if (!report.sdk.licenseEvidenceId.trim()) throw new TypeError("Native SDK capability requires auditable license evidence.");
  if (!/^[0-9a-f]{64}$/u.test(report.sdk.runtimeSha256)) throw new TypeError("Native SDK runtime SHA-256 is invalid.");
  if (report.networkRequired) throw new TypeError("Native adapter certification must not require runtime network access.");
}

export function createBlockedNativeCadAdapter(blocker: string): NativeCadAdapter {
  const message = blocker.trim();
  if (!message) throw new TypeError("A precise native SDK blocker is required.");
  const fail = async (): Promise<never> => { throw new NativeSdkUnavailableError(message); };
  return {
    capabilities: {
      available: false,
      sdk: null,
      supportedRows: [],
      unknownObjectRoundtrip: false,
      processIsolated: false,
      networkRequired: false,
      blocker: message,
    },
    importDwg: fail,
    applyOperations: fail,
    exportDwg: fail,
    createFromDwt: fail,
    attachXref: fail,
    auditAndRecover: fail,
  };
}
