import { describe, expect, it } from 'vitest'
import type { GitGraphRow } from '../src/shared/git-graph'
import { layoutGraph } from '../src/client/features/git-graph/layout'

function row(sha: string, parents: string[]): GitGraphRow {
  return {
    sha,
    shortSha: sha,
    parents,
    author: '',
    timestamp: 0,
    subject: sha,
    refs: [],
    kind: parents.length > 1 ? 'merge' : 'commit',
  }
}

describe('commit graph layout', () => {
  it('keeps parallel parent lines continuous until they meet at the parent commit', () => {
    // A and B both lead back to P. C and D must appear before P in topo order.
    const layout = layoutGraph([
      row('A', ['B', 'P']),
      row('B', ['P', 'C']),
      row('C', ['D']),
      row('D', ['P']),
      row('P', []),
    ])

    expect(layout.laneCount).toBe(3)
    expect(layout.nodes[1].lanesAfter).toEqual(['P', 'P', 'C'])
    expect(layout.edges.filter((edge) => edge.fromRow === 1 && edge.fromCol === 0))
      .toEqual(expect.arrayContaining([
        { fromRow: 1, fromCol: 0, toRow: 2, toCol: 0 },
        { fromRow: 1, fromCol: 0, toRow: 2, toCol: 2 },
      ]))
    expect(layout.edges).toContainEqual({ fromRow: 1, fromCol: 1, toRow: 2, toCol: 1 })
    expect(layout.edges).toContainEqual({ fromRow: 2, fromCol: 1, toRow: 3, toCol: 1 })
    expect(layout.edges).toContainEqual({ fromRow: 3, fromCol: 1, toRow: 4, toCol: 0 })

    for (const edge of layout.edges) {
      const source = layout.nodes[edge.fromRow]
      const next = layout.nodes[edge.toRow]
      const sha = source.lanesBefore[edge.fromCol]
      if (sha === null || sha === undefined || sha === source.row.sha) continue
      if (next.row.sha === sha) {
        expect(edge.toCol).toBe(next.column)
      } else if (next.lanesBefore[edge.fromCol] === sha) {
        expect(edge.toCol).toBe(edge.fromCol)
      }
    }
  })
})
