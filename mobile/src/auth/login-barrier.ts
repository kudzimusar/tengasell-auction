// RACE01 — pre-authentication generation barrier.
//
// Defect (ICR01-SRC-01): the sign-in path awaited `hasLogoutIntent()` BEFORE
// taking ownership of a session generation. A logout beginning during that
// read incremented the generation, then the stale login incremented it again
// and became the newest owner — publishing a session after the user had
// signed out.
//
// Correct order, implemented here and used by SessionProvider:
//   1. take ownership synchronously, before any await;
//   2. recheck ownership after the logout-intent read;
//   3. recheck ownership after authentication;
//   4. persist/publish only through the caller's generation-checked `apply`.
//
// The module takes injected IO so the production ordering can be tested
// directly, without a toy scheduler.

import { SessionRestorationBlockedError } from "./session-storage-logic.ts";

export class SupersededLoginError extends Error {
  constructor(
    message = "The sign-in was superseded by a newer session action.",
  ) {
    super(message);
    this.name = "SupersededLoginError";
  }
}

export interface LoginBarrierDeps<T> {
  /** Synchronously take ownership of a new generation; returns its id. */
  begin: () => number;
  /** The current generation id. */
  current: () => number;
  /** Read the persisted logout intent (async, may be slow or fail). */
  hasLogoutIntent: () => Promise<boolean>;
  /** Authenticate against the canonical authority. */
  authenticate: () => Promise<T>;
  /** Persist and publish; must reject if the generation is no longer current. */
  apply: (tokens: T, generation: number) => Promise<void>;
}

export async function runGuardedLogin<T>(deps: LoginBarrierDeps<T>): Promise<void> {
  // 1. Ownership first, synchronously. Any later logout invalidates this run.
  const generation = deps.begin();

  // 2. The intent read may resolve after a logout began; ownership decides.
  const intent = await deps.hasLogoutIntent();
  if (deps.current() !== generation) throw new SupersededLoginError();
  if (intent) throw new SessionRestorationBlockedError();

  // 3. Authentication may also outlive a logout.
  const tokens = await deps.authenticate();
  if (deps.current() !== generation) throw new SupersededLoginError();

  // 4. Persistence/publication re-checks the generation internally as well.
  await deps.apply(tokens, generation);
}
