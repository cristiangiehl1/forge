import type { Point, Rect, Side } from '../geometry.ts'

/** A connection point, and the side of its table the line leaves or arrives by. */
export interface Endpoint {
  point: Point
  side: Side
}

export interface RouteOptions {
  /** How far a line keeps from a table it goes round. */
  margin?: number
  /** The straight piece that leaves a table before the line may turn. */
  stub?: number
  /** What a bend costs, in pixels of extra length. */
  bendCost?: number
}

export interface Route {
  points: Point[]
  cost: number
}

// right, left, down, up
const STEP = [
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 0, dy: -1 },
] as const
const OPPOSITE = [1, 0, 3, 2] as const

/** Drops repeated points and the middle of every straight run. */
function simplify(points: Point[]): Point[] {
  const distinct = points.filter(
    (p, i) => i === 0 || p.x !== points[i - 1]?.x || p.y !== points[i - 1]?.y
  )
  return distinct.filter((p, i) => {
    if (i === 0 || i === distinct.length - 1) return true
    const before = distinct[i - 1] as Point
    const after = distinct[i + 1] as Point
    return !(
      (before.x === p.x && p.x === after.x) ||
      (before.y === p.y && p.y === after.y)
    )
  })
}

export function polylineCost(points: Point[], bendCost: number): number {
  let cost = 0
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as Point
    const b = points[i] as Point
    cost += Math.abs(b.x - a.x) + Math.abs(b.y - a.y)
    if (i > 1) {
      const before = points[i - 2] as Point
      const turned = (before.x === a.x) !== (a.x === b.x)
      if (turned) cost += bendCost
    }
  }
  return cost
}

/** A lane in the middle of every gap between two groups of tables. */
function addGapLines(lines: Set<number>, spans: [number, number][]) {
  const sorted = [...spans].sort((a, b) => a[0] - b[0])
  let reach = Number.NEGATIVE_INFINITY
  for (const [from, to] of sorted) {
    if (reach !== Number.NEGATIVE_INFINITY && from > reach) {
      lines.add((reach + from) / 2)
    }
    reach = Math.max(reach, to)
  }
}

/** A binary min-heap on (priority, insertion order), so ties break the same way every time. */
class Heap {
  private readonly items: { priority: number; order: number; value: number }[] =
    []
  private counter = 0

  get size() {
    return this.items.length
  }

  push(priority: number, value: number) {
    const item = { priority, order: this.counter++, value }
    this.items.push(item)
    let at = this.items.length - 1
    while (at > 0) {
      const parent = (at - 1) >> 1
      if (!this.before(item, this.items[parent] as typeof item)) break
      this.items[at] = this.items[parent] as typeof item
      at = parent
    }
    this.items[at] = item
  }

  pop(): number {
    const top = this.items[0] as { value: number }
    const last = this.items.pop() as (typeof this.items)[number]
    if (this.items.length > 0) {
      let at = 0
      for (;;) {
        const left = at * 2 + 1
        const right = left + 1
        let smallest = last
        let child = -1
        if (
          left < this.items.length &&
          this.before(this.items[left] as typeof last, smallest)
        ) {
          smallest = this.items[left] as typeof last
          child = left
        }
        if (
          right < this.items.length &&
          this.before(this.items[right] as typeof last, smallest)
        ) {
          smallest = this.items[right] as typeof last
          child = right
        }
        if (child === -1) break
        this.items[at] = smallest
        at = child
      }
      this.items[at] = last
    }
    return top.value
  }

  private before(
    a: { priority: number; order: number },
    b: { priority: number; order: number }
  ) {
    return (
      a.priority < b.priority ||
      (a.priority === b.priority && a.order < b.order)
    )
  }
}

/**
 * An orthogonal line from one connection point to another that goes round the
 * tables instead of through them. It searches (A*) a grid made of the edges of
 * every table, pushed out by a margin, plus a lane in each gap between tables,
 * and charges for bends, so it prefers few, long runs. It leaves its table
 * outwards and arrives from outside the other one.
 *
 * If no way exists (a table hard against the source, say) it still returns a
 * route between the two points, ignoring the tables, at a very high cost.
 */
export function routeEdge(
  obstacles: Rect[],
  source: Endpoint,
  target: Endpoint,
  options: RouteOptions = {}
): Route {
  const margin = options.margin ?? 16
  const stub = options.stub ?? 16
  const bendCost = options.bendCost ?? 40

  const outward = (end: Endpoint): Point => ({
    x: end.point.x + (end.side === 'r' ? stub : -stub),
    y: end.point.y,
  })
  const start = outward(source)
  const goal = outward(target)
  const startDirection = source.side === 'r' ? 0 : 1
  // The last step runs into the table: right into a left edge, left into a right one.
  const goalDirection = target.side === 'l' ? 0 : 1

  const boxes = obstacles.map((r) => ({
    x0: r.x - margin,
    y0: r.y - margin,
    x1: r.x + r.width + margin,
    y1: r.y + r.height + margin,
  }))

  const xSet = new Set<number>([start.x, goal.x])
  const ySet = new Set<number>([start.y, goal.y])
  for (const b of boxes) {
    xSet.add(b.x0)
    xSet.add(b.x1)
    ySet.add(b.y0)
    ySet.add(b.y1)
  }
  if (boxes.length <= 60) {
    addGapLines(
      xSet,
      boxes.map((b) => [b.x0, b.x1])
    )
    addGapLines(
      ySet,
      boxes.map((b) => [b.y0, b.y1])
    )
  }
  // A lane just outside everything, on every side: a line that has to arrive
  // moving towards a table on the edge of the drawing needs room to come round.
  const xLow = Math.min(...xSet) - margin
  const xHigh = Math.max(...xSet) + margin
  const yLow = Math.min(...ySet) - margin
  const yHigh = Math.max(...ySet) + margin
  xSet.add(xLow)
  xSet.add(xHigh)
  ySet.add(yLow)
  ySet.add(yHigh)
  const xs = [...xSet].sort((a, b) => a - b)
  const ys = [...ySet].sort((a, b) => a - b)
  const xIndex = new Map(xs.map((value, i) => [value, i]))
  const yIndex = new Map(ys.map((value, i) => [value, i]))
  const nx = xs.length
  const ny = ys.length

  // Which grid points and which steps between two neighbours are inside a table.
  const pointBlocked = new Uint8Array(nx * ny)
  const horizontalBlocked = new Uint8Array(Math.max(nx - 1, 0) * ny)
  const verticalBlocked = new Uint8Array(nx * Math.max(ny - 1, 0))
  for (const b of boxes) {
    const a = xIndex.get(b.x0) as number
    const z = xIndex.get(b.x1) as number
    const c = yIndex.get(b.y0) as number
    const d = yIndex.get(b.y1) as number
    for (let j = c + 1; j < d; j++) {
      for (let i = a + 1; i < z; i++) pointBlocked[j * nx + i] = 1
      for (let i = a; i < z; i++) horizontalBlocked[j * (nx - 1) + i] = 1
    }
    for (let i = a + 1; i < z; i++) {
      for (let j = c; j < d; j++) verticalBlocked[j * nx + i] = 1
    }
  }

  const startI = xIndex.get(start.x) as number
  const startJ = yIndex.get(start.y) as number
  const goalI = xIndex.get(goal.x) as number
  const goalJ = yIndex.get(goal.y) as number

  const encode = (i: number, j: number, direction: number) =>
    (j * nx + i) * 4 + direction
  const cost = new Float64Array(nx * ny * 4).fill(Number.POSITIVE_INFINITY)
  const cameFrom = new Int32Array(nx * ny * 4).fill(-1)
  const heap = new Heap()
  const heuristic = (i: number, j: number) =>
    Math.abs((xs[i] as number) - goal.x) + Math.abs((ys[j] as number) - goal.y)

  let found = -1
  if (
    !pointBlocked[startJ * nx + startI] &&
    !pointBlocked[goalJ * nx + goalI]
  ) {
    const first = encode(startI, startJ, startDirection)
    cost[first] = 0
    heap.push(heuristic(startI, startJ), first)
    while (heap.size > 0) {
      const state = heap.pop()
      const direction = state % 4
      const cell = (state - direction) / 4
      const i = cell % nx
      const j = (cell - i) / nx
      if (i === goalI && j === goalJ && direction === goalDirection) {
        found = state
        break
      }
      const here = cost[state] as number
      for (let next = 0; next < 4; next++) {
        if (next === OPPOSITE[direction]) continue
        const step = STEP[next] as (typeof STEP)[number]
        const ni = i + step.dx
        const nj = j + step.dy
        if (ni < 0 || nj < 0 || ni >= nx || nj >= ny) continue
        if (pointBlocked[nj * nx + ni]) continue
        const blocked =
          step.dy === 0
            ? horizontalBlocked[j * (nx - 1) + Math.min(i, ni)]
            : verticalBlocked[Math.min(j, nj) * nx + i]
        if (blocked) continue
        const length =
          Math.abs((xs[ni] as number) - (xs[i] as number)) +
          Math.abs((ys[nj] as number) - (ys[j] as number))
        const total = here + length + (next === direction ? 0 : bendCost)
        const target = encode(ni, nj, next)
        if (total < (cost[target] as number)) {
          cost[target] = total
          cameFrom[target] = state
          heap.push(total + heuristic(ni, nj), target)
        }
      }
    }
  }

  if (found === -1) {
    const points = simplify([
      source.point,
      start,
      { x: start.x, y: goal.y },
      goal,
      target.point,
    ])
    return { points, cost: 1_000_000 + polylineCost(points, bendCost) }
  }

  const path: Point[] = []
  for (let state = found; state !== -1; state = cameFrom[state] as number) {
    const direction = state % 4
    const cell = (state - direction) / 4
    const i = cell % nx
    path.push({ x: xs[i] as number, y: ys[(cell - i) / nx] as number })
  }
  path.reverse()
  const points = simplify([source.point, ...path, target.point])
  return { points, cost: polylineCost(points, bendCost) }
}
