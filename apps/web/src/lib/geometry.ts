/**
 * The size of a table node is fixed on purpose, and the CSS pins the same
 * numbers (see `styles.css`). That lets layout and line routing work out where
 * every table and every connection point is without measuring the page, so they
 * stay pure, deterministic and testable.
 */
export const NODE_WIDTH = 220
const NODE_BORDER = 1
/** The title bar, including its bottom border. */
export const HEADER_HEIGHT = 31
export const ROW_HEIGHT = 26

export interface Point {
  x: number
  y: number
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** `l` is the left edge of a node, `r` the right edge. */
export type Side = 'l' | 'r'

export function nodeHeight(columnCount: number): number {
  return NODE_BORDER * 2 + HEADER_HEIGHT + ROW_HEIGHT * columnCount
}

export function nodeRect(position: Point, columnCount: number): Rect {
  return {
    x: position.x,
    y: position.y,
    width: NODE_WIDTH,
    height: nodeHeight(columnCount),
  }
}

/** The vertical centre of a column's row. */
export function rowCenterY(position: Point, rowIndex: number): number {
  return (
    position.y + NODE_BORDER + HEADER_HEIGHT + ROW_HEIGHT * (rowIndex + 0.5)
  )
}

/** Where a column's connection point is, on the left or the right edge of its node. */
export function handlePoint(
  position: Point,
  rowIndex: number,
  side: Side
): Point {
  return {
    x: side === 'l' ? position.x : position.x + NODE_WIDTH,
    y: rowCenterY(position, rowIndex),
  }
}
