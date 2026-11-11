export interface LatestRequestGuard {
  next(): number;
  invalidate(): number;
  isCurrent(id: number): boolean;
  current(): number;
}

/**
 * Monotonic request-sequence guard preventing slower older requests from
 * overwriting results or clearing loading state for a newer user selection.
 */
export function createRequestGuard(): LatestRequestGuard {
  let latest = 0;
  return {
    next: () => {
      latest += 1;
      return latest;
    },
    invalidate: () => {
      latest += 1;
      return latest;
    },
    isCurrent: (id: number) => id === latest,
    current: () => latest,
  };
}
