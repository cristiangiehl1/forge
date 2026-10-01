/**
 * React Flow deletes whatever is selected, and a deleted table drags every
 * relationship touching it along, silently. This guard lets a deletion go
 * through only when no table is part of it, so a keypress can remove a selected
 * relationship but never a table or the relationships of a table.
 */
export function edgesOnly<N, E>(deletion: {
  nodes: N[]
  edges: E[]
}): { nodes: N[]; edges: E[] } | false {
  return deletion.nodes.length === 0 ? deletion : false
}
