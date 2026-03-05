import { memo } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
} from '@xyflow/react';
import type { EdgeProps } from '@xyflow/react';
import type { EREdge } from '@/stores/erDiagramStore';

function RelationEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  label,
  style,
  markerEnd,
}: EdgeProps<EREdge>) {
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 8,
  });

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: 'hsl(var(--muted-foreground))',
          strokeWidth: 1.5,
          ...style,
        }}
        markerEnd={markerEnd}
      />
      {(label || data?.fkName) && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan pointer-events-auto"
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            }}
          >
            <div className="rounded-md bg-background/90 border border-border px-2 py-1 text-[10px] text-muted-foreground shadow-sm backdrop-blur-sm max-w-[180px]">
              <div className="font-medium truncate">
                {data?.fkName ?? ''}
              </div>
              {label && (
                <div className="truncate opacity-80">
                  {String(label)}
                </div>
              )}
            </div>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const RelationEdge = memo(RelationEdgeComponent);
