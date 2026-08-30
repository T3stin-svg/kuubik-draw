export function planAuthenticatedCleanup(authenticatedSidecar, automationCandidates) {
  const authenticatedProcessId = authenticatedSidecar?.processId ?? null;
  const refusedProcessIds = automationCandidates
    .map(({ processId }) => processId)
    .filter((processId) => Number.isInteger(processId) && processId > 0 && processId !== authenticatedProcessId)
    .toSorted((first, second) => first - second);
  return {
    terminate: authenticatedSidecar ?? null,
    refusedProcessIds,
  };
}

function canonicalProcessIdentity(identity) {
  if (!Number.isInteger(identity?.processId) || identity.processId <= 0
    || typeof identity.executablePath !== "string" || identity.executablePath.trim() === ""
    || typeof identity.startTimeUtc !== "string" || identity.startTimeUtc.trim() === "") return null;
  return {
    processId: identity.processId,
    executablePath: identity.executablePath.trim().replaceAll("/", "\\").toLowerCase(),
    startTimeUtc: identity.startTimeUtc.trim(),
  };
}

export function canonicalProcessSet(identities) {
  if (!Array.isArray(identities)) return null;
  const canonical = identities.map(canonicalProcessIdentity);
  if (canonical.some((identity) => identity === null)) return null;
  return canonical.toSorted((first, second) => first.processId - second.processId
    || first.executablePath.localeCompare(second.executablePath)
    || first.startTimeUtc.localeCompare(second.startTimeUtc));
}

/** Exact fail-closed comparison: a PID alone never proves that the same process survived. */
export function processIdentitySetsEqual(expected, current) {
  const canonicalExpected = canonicalProcessSet(expected);
  const canonicalCurrent = canonicalProcessSet(current);
  return canonicalExpected !== null && canonicalCurrent !== null
    && JSON.stringify(canonicalExpected) === JSON.stringify(canonicalCurrent);
}
