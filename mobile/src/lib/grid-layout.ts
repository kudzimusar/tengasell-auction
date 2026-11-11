export const MAX_MARKETPLACE_CONTENT_WIDTH = 920;

export interface GridMetricsInput {
  viewportWidth: number;
  columns: 2 | 3;
  padding: number;
  gap?: number;
  safeLeft?: number;
  safeRight?: number;
  maxContentWidth?: number;
}

export interface GridMetrics {
  usableViewportWidth: number;
  containerWidth: number;
  padding: number;
  gap: number;
  columns: 2 | 3;
  cardWidth: number;
  totalRowWidth: number;
}

/**
 * Computes exact pixel geometry for multi-column marketplace grids without
 * double-applying outer screen padding or exceeding maxContentWidth on wide screens.
 */
export function computeGridMetrics(input: GridMetricsInput): GridMetrics {
  const safeLeft = Math.max(0, input.safeLeft ?? 0);
  const safeRight = Math.max(0, input.safeRight ?? 0);
  const maxContentWidth = input.maxContentWidth ?? MAX_MARKETPLACE_CONTENT_WIDTH;
  const usableViewportWidth = Math.max(0, input.viewportWidth - safeLeft - safeRight);
  const containerWidth = Math.min(usableViewportWidth, maxContentWidth);
  const padding = Math.max(0, input.padding);
  const defaultGap = containerWidth < 400 ? 10 : 12;
  const gap = Math.max(0, input.gap ?? defaultGap);
  const totalPadding = padding * 2;
  const totalGaps = gap * (input.columns - 1);
  const innerAvailable = Math.max(0, containerWidth - totalPadding - totalGaps);
  const cardWidth = Math.max(0, Math.floor(innerAvailable / input.columns));
  const totalRowWidth = totalPadding + cardWidth * input.columns + totalGaps;

  return {
    usableViewportWidth,
    containerWidth,
    padding,
    gap,
    columns: input.columns,
    cardWidth,
    totalRowWidth,
  };
}
