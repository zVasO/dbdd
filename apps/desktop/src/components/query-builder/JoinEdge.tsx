import { memo, useState, useCallback, useRef, useEffect } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
} from '@xyflow/react';
import type { EdgeProps, Edge } from '@xyflow/react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useQueryBuilderStore } from '@/stores/queryBuilderStore';
import type { JoinConfig } from '@/stores/queryBuilderStore';

interface JoinEdgeData extends Record<string, unknown> {
  joinType: JoinConfig['joinType'];
  sourceColumn: string;
  targetColumn: string;
}

type JoinEdgeType = Edge<JoinEdgeData, 'joinEdge'>;

const JOIN_TYPES: JoinConfig['joinType'][] = ['INNER', 'LEFT', 'RIGHT', 'FULL'];

const JOIN_COLORS: Record<JoinConfig['joinType'], string> = {
  INNER: 'bg-blue-500/90 text-white',
  LEFT: 'bg-emerald-500/90 text-white',
  RIGHT: 'bg-amber-500/90 text-white',
  FULL: 'bg-purple-500/90 text-white',
};

function JoinEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  style,
  markerEnd,
}: EdgeProps<JoinEdgeType>) {
  const [isHovered, setIsHovered] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const updateJoinType = useQueryBuilderStore((s) => s.updateJoinType);
  const removeJoin = useQueryBuilderStore((s) => s.removeJoin);

  const joinType = (data?.joinType ?? 'INNER') as JoinConfig['joinType'];

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 12,
  });

  const handleLabelClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setShowDropdown((prev) => !prev);
  }, []);

  const handleTypeSelect = useCallback(
    (type: JoinConfig['joinType']) => {
      updateJoinType(id, type);
      setShowDropdown(false);
    },
    [id, updateJoinType]
  );

  const handleRemove = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      removeJoin(id);
    },
    [id, removeJoin]
  );

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!showDropdown) return;

    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as HTMLElement)) {
        setShowDropdown(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showDropdown]);

  // Determine stroke color based on join type
  const strokeColor =
    joinType === 'INNER'
      ? 'hsl(217, 91%, 60%)'
      : joinType === 'LEFT'
        ? 'hsl(160, 84%, 39%)'
        : joinType === 'RIGHT'
          ? 'hsl(38, 92%, 50%)'
          : 'hsl(271, 91%, 65%)';

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: strokeColor,
          strokeWidth: 2,
          ...style,
        }}
        markerEnd={markerEnd}
      />
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan pointer-events-auto"
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
          }}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          ref={dropdownRef}
        >
          <div className="relative flex items-center gap-1">
            {/* Join type label button */}
            <button
              onClick={handleLabelClick}
              className={cn(
                'rounded px-2 py-0.5 text-[11px] font-semibold shadow-sm cursor-pointer transition-all',
                'border border-transparent hover:border-border/50',
                JOIN_COLORS[joinType]
              )}
              title="Click to change join type"
            >
              {joinType} JOIN
            </button>

            {/* Delete button (visible on hover) */}
            {isHovered && (
              <button
                onClick={handleRemove}
                className="rounded-full bg-destructive/90 p-0.5 text-white hover:bg-destructive shadow-sm transition-colors"
                title="Remove join"
              >
                <X className="size-2.5" />
              </button>
            )}

            {/* Dropdown for join type selection */}
            {showDropdown && (
              <div className="absolute top-full left-0 mt-1 z-50 rounded-md border border-border bg-popover p-1 shadow-lg min-w-[100px]">
                {JOIN_TYPES.map((type) => (
                  <button
                    key={type}
                    onClick={() => handleTypeSelect(type)}
                    className={cn(
                      'flex w-full items-center rounded-sm px-2 py-1 text-xs transition-colors',
                      'hover:bg-accent hover:text-accent-foreground',
                      type === joinType && 'bg-accent text-accent-foreground font-medium'
                    )}
                  >
                    {type} JOIN
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

export const JoinEdge = memo(JoinEdgeComponent);
