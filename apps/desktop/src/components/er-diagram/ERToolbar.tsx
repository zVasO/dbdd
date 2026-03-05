import type { ReactFlowInstance } from '@xyflow/react';
import type { ERNode, EREdge } from '@/stores/erDiagramStore';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from '@/components/ui/tooltip';
import {
  ZoomIn,
  ZoomOut,
  Maximize,
  ArrowDownUp,
  ArrowLeftRight,
  Download,
  Sparkles,
} from 'lucide-react';
import { useERDiagramStore } from '@/stores/erDiagramStore';

interface ERToolbarProps {
  rfInstance: ReactFlowInstance<ERNode, EREdge> | null;
  onAiAnalyze?: () => void;
}

export function ERToolbar({ rfInstance, onAiAnalyze }: ERToolbarProps) {
  const layoutDirection = useERDiagramStore((s) => s.layoutDirection);
  const setLayoutDirection = useERDiagramStore((s) => s.setLayoutDirection);

  const handleZoomIn = () => {
    rfInstance?.zoomIn({ duration: 200 });
  };

  const handleZoomOut = () => {
    rfInstance?.zoomOut({ duration: 200 });
  };

  const handleFitView = () => {
    rfInstance?.fitView({ padding: 0.15, duration: 300 });
  };

  const handleToggleDirection = () => {
    setLayoutDirection(layoutDirection === 'TB' ? 'LR' : 'TB');
  };

  const handleExport = async () => {
    if (!rfInstance) return;

    // Find the ReactFlow viewport element and export as PNG via canvas
    const viewportEl = document.querySelector('.react-flow__viewport');
    if (!viewportEl) return;

    try {
      // Use the toObject method to get the current flow state for potential JSON export
      const flowData = rfInstance.toObject();
      const jsonString = JSON.stringify(flowData, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'er-diagram.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export failed:', err);
    }
  };

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex items-center gap-1 rounded-lg border border-border bg-background/95 px-1.5 py-1 shadow-sm backdrop-blur-sm">
        {/* Zoom In */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon-xs"
              variant="ghost"
              onClick={handleZoomIn}
            >
              <ZoomIn className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Zoom in</TooltipContent>
        </Tooltip>

        {/* Zoom Out */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon-xs"
              variant="ghost"
              onClick={handleZoomOut}
            >
              <ZoomOut className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Zoom out</TooltipContent>
        </Tooltip>

        {/* Fit View */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon-xs"
              variant="ghost"
              onClick={handleFitView}
            >
              <Maximize className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Fit to view</TooltipContent>
        </Tooltip>

        <div className="mx-0.5 h-4 w-px bg-border" />

        {/* Layout Direction */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon-xs"
              variant="ghost"
              onClick={handleToggleDirection}
            >
              {layoutDirection === 'TB' ? (
                <ArrowDownUp className="size-3.5" />
              ) : (
                <ArrowLeftRight className="size-3.5" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            Layout: {layoutDirection === 'TB' ? 'Top to Bottom' : 'Left to Right'}
          </TooltipContent>
        </Tooltip>

        <div className="mx-0.5 h-4 w-px bg-border" />

        {/* Export */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon-xs"
              variant="ghost"
              onClick={handleExport}
            >
              <Download className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Export diagram</TooltipContent>
        </Tooltip>

        {/* AI Analyze (optional) */}
        {onAiAnalyze && (
          <>
            <div className="mx-0.5 h-4 w-px bg-border" />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  onClick={onAiAnalyze}
                >
                  <Sparkles className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>AI analyze schema</TooltipContent>
            </Tooltip>
          </>
        )}
      </div>
    </TooltipProvider>
  );
}
