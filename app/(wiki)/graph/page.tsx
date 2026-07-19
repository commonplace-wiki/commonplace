'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  useNodesState,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
} from 'd3-force'
import FloatingEdge from '@/components/FloatingEdge'
import { GraphHoverContext, useGraphHover } from '@/components/GraphHoverContext'
import '@xyflow/react/dist/style.css'

interface GraphNode {
  id: string
  title: string
  type: string | null
  dir: string
}

interface GraphEdge {
  source: string
  target: string
  weight: number
  kind: 'link' | 'tree'
}

/** Accent/background pairs in the semantic-visualizer style, per directory. */
const THEMES = [
  { accent: '#3b82f6', bg: '#eff6ff' }, // blue
  { accent: '#22c55e', bg: '#f0fdf4' }, // green
  { accent: '#8b5cf6', bg: '#f5f3ff' }, // violet
  { accent: '#f59e0b', bg: '#fffbeb' }, // amber
  { accent: '#ec4899', bg: '#fdf2f8' }, // pink
  { accent: '#14b8a6', bg: '#f0fdfa' }, // teal
]
const NEUTRAL = { accent: '#64748b', bg: '#f8fafc' }

const PageIcon = ({ color }: { color: string }) => (
  <svg width="14" height="14" viewBox="0 0 20 20" fill={color}>
    <path
      fillRule="evenodd"
      d="M4 2a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.414A2 2 0 0 0 17.414 6L14 2.586A2 2 0 0 0 12.586 2H4Zm2 5a1 1 0 0 0 0 2h8a1 1 0 1 0 0-2H6Zm0 4a1 1 0 1 0 0 2h8a1 1 0 1 0 0-2H6Z"
      clipRule="evenodd"
    />
  </svg>
)

const FolderIcon = ({ color }: { color: string }) => (
  <svg width="14" height="14" viewBox="0 0 20 20" fill={color}>
    <path d="M2 6a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6Z" />
  </svg>
)

type PillData = {
  label: string
  accent: string
  bg: string
  count?: number
}

function PillNode({ id, data }: NodeProps<Node<PillData>>) {
  const { hovered, neighbors } = useGraphHover()
  const dimmed = hovered !== null && id !== hovered && !neighbors.get(hovered)?.has(id)
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 7,
        padding: '7px 14px',
        borderRadius: 20,
        background: dimmed ? '#f8fafc' : data.bg,
        border: `2px solid ${dimmed ? '#e2e8f0' : data.accent}`,
        boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
        whiteSpace: 'nowrap',
        opacity: dimmed ? 0.35 : 1,
        transition: 'opacity 0.2s, border-color 0.2s, background 0.2s',
        cursor: 'pointer',
      }}
    >
      <Handle type="target" position={Position.Top} style={{ visibility: 'hidden', width: 6, height: 6 }} />
      <Handle type="source" position={Position.Bottom} style={{ visibility: 'hidden', width: 6, height: 6 }} />
      {data.count !== undefined ? <FolderIcon color={data.accent} /> : <PageIcon color={data.accent} />}
      <span style={{ fontWeight: 600, fontSize: 13, color: dimmed ? '#94a3b8' : '#1e293b' }}>
        {data.label}
      </span>
      {data.count !== undefined && (
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: data.accent,
            background: '#ffffffb0',
            borderRadius: 10,
            padding: '1px 7px',
          }}
        >
          {data.count}
        </span>
      )}
    </div>
  )
}

const nodeTypes = { pill: PillNode }
const edgeTypes = { floating: FloatingEdge }

/** Force layout (adapted from semantic-visualizer): runs synchronously. */
function layout(
  nodes: { id: string; label: string }[],
  edges: { source: string; target: string }[]
): Record<string, { x: number; y: number }> {
  const n = nodes.length
  if (n === 0) return {}
  const radius = Math.max(n * 8, 260)
  const simNodes = nodes.map((nd, i) => ({
    id: nd.id,
    x: Math.cos((2 * Math.PI * i) / n) * radius,
    y: Math.sin((2 * Math.PI * i) / n) * radius,
  }))
  const simLinks = edges.map((e) => ({ source: e.source, target: e.target }))
  const widths = new Map(nodes.map((nd) => [nd.id, nd.label.length * 4 + 44]))
  type Sim = { id: string; x: number; y: number }
  forceSimulation(simNodes as never)
    .force(
      'link',
      forceLink(simLinks as never)
        .id((d) => (d as Sim).id)
        .distance(190)
        .strength(0.6)
    )
    .force('charge', forceManyBody().strength(-700))
    .force('center', forceCenter(0, 0))
    .force('x', forceX(0).strength(0.06))
    .force('y', forceY(0).strength(0.06))
    .force('collide', forceCollide((d) => Math.max(55, widths.get((d as Sim).id) || 55)))
    .stop()
    .tick(300)
  const pos: Record<string, { x: number; y: number }> = {}
  for (const sn of simNodes) pos[sn.id] = { x: sn.x, y: sn.y }
  return pos
}

export default function GraphPage() {
  const router = useRouter()
  const [data, setData] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hovered, setHovered] = useState<string | null>(null)
  const [folded, setFolded] = useState<Set<string>>(new Set())
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<PillData>>([])

  useEffect(() => {
    fetch('/api/graph').then(async (res) => {
      const json = await res.json()
      if (res.ok) setData(json)
      else setError(json.error || 'Failed to load graph')
    })
  }, [])

  const dirs = useMemo(
    () => [...new Set((data?.nodes || []).map((n) => n.dir).filter(Boolean))].sort(),
    [data]
  )
  const themes = useMemo(() => {
    const map = new Map<string, { accent: string; bg: string }>()
    dirs.forEach((dir, i) => map.set(dir, THEMES[i % THEMES.length]))
    return map
  }, [dirs])

  // Fold state: pages of a folded directory collapse into one group pill.
  const derived = useMemo(() => {
    if (!data) return null
    const groupId = (dir: string) => `group:${dir}`
    const mapId = (id: string) => {
      const dir = id.includes('/') ? id.split('/')[0] : ''
      return dir && folded.has(dir) ? groupId(dir) : id
    }
    const nodes: { id: string; label: string; dir: string; count?: number }[] = []
    const counts = new Map<string, number>()
    for (const node of data.nodes) {
      if (node.dir && folded.has(node.dir)) {
        counts.set(node.dir, (counts.get(node.dir) || 0) + 1)
      } else {
        nodes.push({ id: node.id, label: node.title, dir: node.dir })
      }
    }
    for (const dir of folded) {
      if (counts.has(dir))
        nodes.push({ id: groupId(dir), label: dir.replace(/[-_]/g, ' '), dir, count: counts.get(dir) })
    }
    const seen = new Map<string, GraphEdge>()
    for (const e of data.edges) {
      const source = mapId(e.source)
      const target = mapId(e.target)
      if (source === target) continue
      const key = `${source}\n${target}`
      const existing = seen.get(key)
      if (!existing || (existing.kind === 'tree' && e.kind === 'link')) {
        seen.set(key, { source, target, weight: e.weight, kind: e.kind })
      }
    }
    return { nodes, edges: [...seen.values()] }
  }, [data, folded])

  // New layout whenever the derived graph changes; positions afterwards
  // belong to React Flow so pills stay where the user drags them.
  useEffect(() => {
    if (!derived) return
    const positions = layout(derived.nodes, derived.edges)
    setNodes(
      derived.nodes.map((node) => {
        const theme = node.dir ? themes.get(node.dir) || NEUTRAL : NEUTRAL
        return {
          id: node.id,
          type: 'pill',
          position: positions[node.id] || { x: 0, y: 0 },
          data: {
            label: node.label,
            accent: theme.accent,
            bg: theme.bg,
            ...(node.count !== undefined ? { count: node.count } : {}),
          },
        }
      })
    )
  }, [derived, themes, setNodes])

  const flowEdges: Edge[] = useMemo(() => {
    if (!derived) return []
    return derived.edges.map((e) => ({
      id: `${e.source}->${e.target}`,
      source: e.source,
      target: e.target,
      type: 'floating',
      ...(e.kind === 'tree' ? { label: 'contains' } : {}),
      style: {
        stroke: '#94a3b8',
        strokeWidth: 1.5,
        strokeDasharray: e.kind === 'tree' ? '5 4' : undefined,
      },
      markerEnd: { type: MarkerType.ArrowClosed, color: '#94a3b8', width: 16, height: 16 },
    }))
  }, [derived])

  const neighbors = useMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const e of derived?.edges || []) {
      if (!map.has(e.source)) map.set(e.source, new Set())
      if (!map.has(e.target)) map.set(e.target, new Set())
      map.get(e.source)!.add(e.target)
      map.get(e.target)!.add(e.source)
    }
    return map
  }, [derived])

  const hoverValue = useMemo(() => ({ hovered, neighbors }), [hovered, neighbors])

  if (error) return <div className="error-banner">{error}</div>
  if (!data || !derived) return <p className="muted">Loading graph…</p>
  if (data.nodes.length === 0)
    return <p className="muted">No pages yet — the graph appears once pages exist.</p>

  const allFolded = dirs.length > 0 && dirs.every((d) => folded.has(d))

  return (
    <div className="graph-page">
      <div className="graph-overlay">
        <div className="graph-legend">
          {dirs.map((dir) => {
            const theme = themes.get(dir) || NEUTRAL
            const isFolded = folded.has(dir)
            return (
              <button
                key={dir}
                className="graph-legend-item graph-legend-toggle"
                title={isFolded ? 'Unfold directory' : 'Fold directory into one node'}
                onClick={() =>
                  setFolded((prev) => {
                    const next = new Set(prev)
                    if (next.has(dir)) next.delete(dir)
                    else next.add(dir)
                    return next
                  })
                }
                style={{ opacity: isFolded ? 0.55 : 1 }}
              >
                <span className="graph-legend-dot" style={{ background: theme.accent }} />
                {dir}
              </button>
            )
          })}
        </div>
        {dirs.length > 0 && (
          <button
            className="btn graph-fold-all"
            onClick={() => setFolded(allFolded ? new Set() : new Set(dirs))}
          >
            {allFolded ? 'Unfold all' : 'Fold all'}
          </button>
        )}
      </div>
      <div className="graph-canvas">
        <GraphHoverContext.Provider value={hoverValue}>
          <ReactFlow
            key={[...folded].sort().join('|')}
            nodes={nodes}
            edges={flowEdges}
            onNodesChange={onNodesChange}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            fitView
            fitViewOptions={{ padding: 0.15, maxZoom: 1.2 }}
            minZoom={0.2}
            proOptions={{ hideAttribution: true }}
            nodesConnectable={false}
            onNodeMouseEnter={(_, node) => setHovered(node.id)}
            onNodeMouseLeave={() => setHovered(null)}
            onNodeClick={(_, node) => {
              if (node.id.startsWith('group:')) {
                const dir = node.id.slice('group:'.length)
                setFolded((prev) => {
                  const next = new Set(prev)
                  next.delete(dir)
                  return next
                })
              } else {
                router.push(`/${node.id}`)
              }
            }}
          >
            <Background variant={BackgroundVariant.Dots} gap={22} size={1.5} color="#e2e8f0" />
            <Controls showInteractive={false} />
          </ReactFlow>
        </GraphHoverContext.Provider>
      </div>
    </div>
  )
}
