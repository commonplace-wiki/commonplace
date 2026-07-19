'use client'

import { BaseEdge, EdgeLabelRenderer, useInternalNode, type EdgeProps } from '@xyflow/react'
import { useGraphHover } from './GraphHoverContext'

/**
 * Edge that attaches to the node boundary facing the other node (adapted from
 * semantic-visualizer): lines point at pill borders instead of fixed handles.
 */

interface Rect {
  cx: number
  cy: number
  w: number
  h: number
}

function getNodeRect(node: ReturnType<typeof useInternalNode>): Rect | null {
  if (!node) return null
  const w = node.measured?.width ?? 150
  const h = node.measured?.height ?? 36
  return {
    w,
    h,
    cx: node.internals.positionAbsolute.x + w / 2,
    cy: node.internals.positionAbsolute.y + h / 2,
  }
}

function intersect(rect: Rect, targetX: number, targetY: number, padding: number) {
  const dx = targetX - rect.cx
  const dy = targetY - rect.cy
  if (dx === 0 && dy === 0) return { x: rect.cx, y: rect.cy }
  const halfW = rect.w / 2 + padding
  const halfH = rect.h / 2 + padding
  const scaleX = Math.abs(dx) < 0.001 ? Infinity : halfW / Math.abs(dx)
  const scaleY = Math.abs(dy) < 0.001 ? Infinity : halfH / Math.abs(dy)
  const scale = Math.min(scaleX, scaleY)
  return { x: rect.cx + dx * scale, y: rect.cy + dy * scale }
}

export default function FloatingEdge({ id, source, target, label, style, markerEnd }: EdgeProps) {
  const { hovered } = useGraphHover()
  const sourceNode = useInternalNode(source)
  const targetNode = useInternalNode(target)
  const sourceRect = getNodeRect(sourceNode)
  const targetRect = getNodeRect(targetNode)
  if (!sourceRect || !targetRect) return null

  const sp = intersect(sourceRect, targetRect.cx, targetRect.cy, 2)
  const tp = intersect(targetRect, sourceRect.cx, sourceRect.cy, 6)
  const path = `M ${sp.x} ${sp.y} L ${tp.x} ${tp.y}`

  const active = hovered === source || hovered === target
  const dim = hovered !== null && !active
  const edgeStyle = {
    ...style,
    ...(active ? { stroke: '#475569', strokeWidth: 2 } : {}),
    opacity: dim ? 0.15 : 1,
    transition: 'opacity 0.2s',
  }

  return (
    <>
      <BaseEdge id={id} path={path} style={edgeStyle} markerEnd={markerEnd as string | undefined} />
      {label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${(sp.x + tp.x) / 2}px, ${(sp.y + tp.y) / 2}px)`,
              pointerEvents: 'none',
              fontSize: 10,
              fontWeight: 500,
              color: '#64748b',
              background: '#ffffffe6',
              padding: '1px 4px',
              borderRadius: 4,
              opacity: dim ? 0.15 : 1,
            }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}
