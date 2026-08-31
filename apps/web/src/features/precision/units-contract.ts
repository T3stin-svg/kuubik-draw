import type { CadLinearUnit, KDrawDocumentV1 } from "@kuubik/cad-schema";
import {
  planCadUnitsContract,
  readCadUnitsContract,
  resolveCadInsertionScale,
  type CadImportScaleReadback,
  type CadUnitsChangeOptions,
  type CadUnitsContractV1,
  type CadUnitsDocumentReadback,
} from "../../../../../packages/cad-core/src/units.js";

/** DOM-free F-053 boundary. Persistence remains the document owner's atomic responsibility. */
export class PrecisionUnitsFeatureModel {
  read(document: KDrawDocumentV1): CadUnitsContractV1 {
    return readCadUnitsContract(document);
  }

  plan(
    document: KDrawDocumentV1,
    contract: CadUnitsContractV1,
    options: CadUnitsChangeOptions = {},
  ): CadUnitsDocumentReadback {
    return planCadUnitsContract(document, contract, options);
  }

  insertionScale(
    sourceUnit: CadLinearUnit | undefined,
    contract: CadUnitsContractV1,
    explicitScale?: number,
  ): CadImportScaleReadback {
    return resolveCadInsertionScale(sourceUnit, contract, explicitScale);
  }
}
