# TENGASELL-MOBILE-01 — MOB-01-R3-SESSION-01

## Scope and frozen authority
- Frozen parent: `7c15551f06cfad7d1661140c8b84edf18caceed0`.
- Branch: `fix/tengasell-mobile-mob01-r3-logout-continuity`.
- Findings addressed: `NXS-PHY01-SRC-01` and `NXS-PHY01-UX-02` only.
- No TrailBase backend contracts, gateway routing, commercial authority, migration, production operation, or native-experience redesign.

## TrailBase protocol evidence
TrailBase official [authentication documentation](https://trailbase.io/documentation/auth/) states:
- JWT auth tokens are stateless and remain usable until their expiry, even after logout.
- Refresh tokens are stateful and only non-revoked sessions can be refreshed.
- A successful `/api/auth/v1/logout` invalidates the server session/refresh token; the client still must discard its persisted auth token.
- The official [GET logout operation](https://trailbase.io/api/operations/logout_handler/) describes removal of session(s), and relies on client token discard.
- The [POST refresh operation](https://trailbase.io/api/operations/refresh_handler/) requires the opaque refresh token.

Consequently: a 2xx logout response is treated as evidence of refresh-session revocation, **not** JWT invalidation before expiry. No server behavior is silently changed. Remote failures are never counted as confirmed revocation.

## R3 state machine
```text
authenticated / network-degraded / signout-incomplete
  -> user sign-out or retry
  -> synchronously invalidate generation and privileged UI
  -> signout-pending
  -> persist and read back non-secret pending-v1 SecureStore intent marker
  -> settle any in-flight token-persistence write
  -> capture previous auth token for optional canonical revocation
  -> attempt BOTH token deletions, verify BOTH reads are null
  -> attempt canonical GET /api/auth/v1/logout
  -> ONLY if token deletion verified: delete marker and verify marker absent

  local deletion + marker removal verified + remote 2xx => anonymous
  local deletion + marker removal verified + remote unconfirmed => signed-out-locally
  otherwise => signout-incomplete, privileged UI inaccessible, retry offered
```

On startup a retained intent marker, unrecognized marker, or failed guard read cannot grant authentication. Pending intent is checked before reading stored credentials or requesting refresh. Explicit retry may inspect stored tokens solely for revocation; it never authenticates the user. A partially deleted token pair cannot be accepted.

The guard is deliberately non-secret and kept in SecureStore alongside the existing encrypted credentials. It must be **confirmed by readback** before relying on it. No refresh token, bearer token, account identifier, or password is persisted outside SecureStore.

## Crash and fault boundaries
- If the intent marker was successfully persisted, a crash after that point cannot silently auto-restore from retained credentials while the guard is readable.
- If deletion is verified, restart is anonymous even when server logout was unreachable; remote revocation is explicitly reported as unconfirmed.
- If deletion is unverified, the marker is NOT cleared. User sees incomplete logout with retry instructions.
- If the OS rejects **all** durable writes/deletions and server revocation also fails, the app cannot honestly guarantee logout continuity across a process death. It reports an incomplete state in the active process. No backend/policy changes have been made to imply a nonexistent guarantee.
- The app cannot guarantee behavior against complete OS secure-store corruption or loss of the marker while credentials survive. Native SecureStore persistence and OS kill/restart tests remain mandatory.
- Tests use controlled adapters and mocked canonical responses, not native device storage. Their result is **not** native NXS certification.
- JWTs may still remain valid until expiry on other devices after server revocation; local tokens are discarded for confirmed local sign-out.

## Deterministic regression
```sh
cd mobile
node --experimental-strip-types --test tests/logout-continuity.test.mjs
```
Covers R3-01..R3-13 including both local/remote failures, partial deletion, in-flight credential persistence, source generation guard and simulated delayed profile response, repeated auth, offline recovery, injected storage faults, process-restart checkpoint model, en/en-XA/ar-XB placeholder integrity. The R3-08 test inspects the active generation guard and separately models delayed-response rejection; it is **not** a React Native UI integration test.

## Buyer-facing NXS copy
Updated only existing English catalog keys and added new sign-out status/action keys. Replaced technical authority, TrailBase, HTTP diagnostics and MOB-01 implementation wording on normal customer surfaces with truthful action-oriented language. Known errors retain exact matching in the runtime-message mapping; unknown server/domain values remain untransformed. The existing `translateNxs` pseudolocale mechanism retains `en-XA` and `ar-XB` with placeholders transformed only in resource templates, never auction/user/domain values.

## Independent acceptance and physical gates
R3 implementation evidence is **not independent certification**. After the Moderator reviews the frozen R3 candidate, certify actual iOS/Android SecureStore faults and restart, logout-while-refresh/profile-request, 200% scaling, pseudolocales, and VoiceOver/TalkBack. Do not replace the original R2 branch, merge, or begin MOB-02 without Moderator authority.
