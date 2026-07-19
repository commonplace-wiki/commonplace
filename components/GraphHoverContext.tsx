'use client'

import { createContext, useContext } from 'react'

/**
 * Hover state for the knowledge graph. It lives in a context consumed by the
 * node and edge components so the React Flow `nodes`/`edges` props stay
 * referentially stable while hovering — replacing them made React Flow
 * re-adopt the elements and the edges flicker between fallback and measured
 * node geometry.
 */
export interface GraphHover {
  hovered: string | null
  neighbors: Map<string, Set<string>>
}

export const GraphHoverContext = createContext<GraphHover>({
  hovered: null,
  neighbors: new Map(),
})

export function useGraphHover() {
  return useContext(GraphHoverContext)
}
