// MOB-03 — connection ownership epoch.
//
// A socket connect is asynchronous: by the time it succeeds the session may
// have been logged out, the account switched, or the screen unmounted. This
// guard makes "who owns the connection" explicit so a late completion can be
// discarded instead of resurrecting bidding capability for a signed-out user.

export class ConnectionEpoch {
  private epoch = 0;

  /** Take ownership of a new connection attempt. */
  next(): number {
    this.epoch += 1;
    return this.epoch;
  }

  /** Invalidate every outstanding attempt (logout, account switch, unmount). */
  invalidate(): void {
    this.epoch += 1;
  }

  /** The current owner token. */
  current(): number {
    return this.epoch;
  }

  /** True only for the most recent owner. */
  isCurrent(token: number): boolean {
    return token === this.epoch;
  }
}
