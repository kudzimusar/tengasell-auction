/**
 * R3 sign-out settlement. Pure, injected I/O for deterministic fault testing.
 * A successful server logout revokes refresh sessions, but JWT expiry is separate.
 */
export interface LogoutPorts {
  markIntent: () => Promise<void>;
  awaitPendingWrite: () => Promise<void>;
  captureAuthToken: () => Promise<string | null>;
  clearCredentials: () => Promise<void>;
  revokeSession: (authToken: string) => Promise<boolean>;
  clearIntent: () => Promise<void>;
}

export type LogoutStatus = "complete" | "local-only" | "incomplete";

export interface LogoutEvidence {
  status: LogoutStatus;
  intentVerified: boolean;
  localDeletionVerified: boolean;
  remoteRevocationConfirmed: boolean;
  markerClearedVerified: boolean;
}

export async function settleLogout(ports: LogoutPorts): Promise<LogoutEvidence> {
  let intentVerified = false;
  let localDeletionVerified = false;
  let remoteRevocationConfirmed = false;
  let markerClearedVerified = false;

  // Persist denial of automatic restoration BEFORE waiting for any work.
  try {
    await ports.markIntent();
    intentVerified = true;
  } catch {
    // The marker may have been written before an error occurred. Continue
    // cleanup, but never assume a rejected operation proves marker absence.
  }

  try { await ports.awaitPendingWrite(); } catch { /* cleanup still necessary */ }

  let authToken: string | null = null;
  try { authToken = await ports.captureAuthToken(); } catch { /* no false revocation */ }

  try {
    await ports.clearCredentials();
    localDeletionVerified = true;
  } catch { /* local credential absence was not verified */ }

  if (authToken) {
    try { remoteRevocationConfirmed = await ports.revokeSession(authToken); }
    catch { /* remote revocation unconfirmed */ }
  }

  if (localDeletionVerified) {
    try {
      await ports.clearIntent();
      markerClearedVerified = true;
    } catch { /* do not claim completion with unresolved durable marker */ }
  }

  return {
    status: !localDeletionVerified || !markerClearedVerified
      ? "incomplete"
      : remoteRevocationConfirmed ? "complete" : "local-only",
    intentVerified,
    localDeletionVerified,
    remoteRevocationConfirmed,
    markerClearedVerified,
  };
}
