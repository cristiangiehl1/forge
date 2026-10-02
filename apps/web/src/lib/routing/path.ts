import type { Point } from '../geometry.ts'

const sign = (value: number) => Math.sign(value)

/**
 * An SVG path through the points of an orthogonal route, each corner rounded by a
 * quadratic curve. The radius shrinks when the pieces next to a corner are short,
 * so a tight bend never overshoots.
 */
export function pathFromPoints(points: Point[], radius = 10): string {
  const first = points[0]
  if (points.length < 2 || !first) return ''
  let path = `M ${first.x} ${first.y}`
  for (let i = 1; i < points.length; i++) {
    const previous = points[i - 1] as Point
    const current = points[i] as Point
    const next = points[i + 1]
    const straight =
      !next ||
      (previous.x === current.x && current.x === next.x) ||
      (previous.y === current.y && current.y === next.y)
    if (straight) {
      path += ` L ${current.x} ${current.y}`
      continue
    }
    const before =
      Math.abs(current.x - previous.x) + Math.abs(current.y - previous.y)
    const after = Math.abs(next.x - current.x) + Math.abs(next.y - current.y)
    const r = Math.min(radius, before / 2, after / 2)
    const a = {
      x: current.x - sign(current.x - previous.x) * r,
      y: current.y - sign(current.y - previous.y) * r,
    }
    const b = {
      x: current.x + sign(next.x - current.x) * r,
      y: current.y + sign(next.y - current.y) * r,
    }
    path += ` L ${a.x} ${a.y} Q ${current.x} ${current.y} ${b.x} ${b.y}`
  }
  return path
}

/** The point a fraction (0 to 1) of the way along a polyline, by its length. */
export function pointAlong(points: Point[], fraction: number): Point {
  const first = points[0]
  if (!first) return { x: 0, y: 0 }
  const lengths = points
    .slice(1)
    .map((p, i) =>
      Math.hypot(p.x - (points[i] as Point).x, p.y - (points[i] as Point).y)
    )
  const total = lengths.reduce((sum, length) => sum + length, 0)
  if (total === 0) return first
  let remaining = Math.min(Math.max(fraction, 0), 1) * total
  for (let i = 0; i < lengths.length; i++) {
    const length = lengths[i] as number
    if (remaining <= length || i === lengths.length - 1) {
      const a = points[i] as Point
      const b = points[i + 1] as Point
      const t = length === 0 ? 0 : remaining / length
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
    }
    remaining -= length
  }
  return first
}
