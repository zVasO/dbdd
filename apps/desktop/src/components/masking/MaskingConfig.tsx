import { useMemo } from 'react';
import { ShieldCheck, ShieldAlert, Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import {
  detectSensitiveColumn,
  detectSensitiveColumnType,
} from '@/lib/dataMasking';

interface MaskingConfigProps {
  columns: string[];
  maskedColumns: Set<string>;
  onToggleColumn: (columnName: string) => void;
  productionSafeMode: boolean;
  onToggleProductionSafeMode: () => void;
}

export function MaskingConfig({
  columns,
  maskedColumns,
  onToggleColumn,
  productionSafeMode,
  onToggleProductionSafeMode,
}: MaskingConfigProps) {
  const analysis = useMemo(() => {
    return columns.map((col) => ({
      name: col,
      isSensitive: detectSensitiveColumn(col),
      sensitiveType: detectSensitiveColumnType(col),
      isMasked: maskedColumns.has(col),
    }));
  }, [columns, maskedColumns]);

  const sensitiveColumns = analysis.filter((c) => c.isSensitive);
  const otherColumns = analysis.filter((c) => !c.isSensitive);

  return (
    <div className="flex flex-col gap-4">
      {/* Production Safe Mode */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <ShieldAlert className="size-4 text-primary" />
            <CardTitle className="text-sm">Production Safe Mode</CardTitle>
          </div>
          <CardDescription>
            When enabled, all auto-detected sensitive columns are masked by
            default.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            size="sm"
            variant={productionSafeMode ? 'default' : 'outline'}
            onClick={onToggleProductionSafeMode}
          >
            {productionSafeMode ? (
              <ShieldCheck className="size-3.5" />
            ) : (
              <ShieldAlert className="size-3.5" />
            )}
            {productionSafeMode ? 'Enabled' : 'Disabled'}
          </Button>
        </CardContent>
      </Card>

      {/* Auto-detected sensitive columns */}
      {sensitiveColumns.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">
              Auto-Detected Sensitive Columns
            </CardTitle>
            <CardDescription>
              {sensitiveColumns.length} column
              {sensitiveColumns.length !== 1 ? 's' : ''} detected as
              potentially sensitive.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="max-h-[240px]">
              <div className="flex flex-col gap-1">
                {sensitiveColumns.map((col) => (
                  <div
                    key={col.name}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted/50"
                  >
                    <button
                      type="button"
                      onClick={() => onToggleColumn(col.name)}
                      className={cn(
                        'flex items-center justify-center size-6 rounded-md transition-colors',
                        col.isMasked
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {col.isMasked ? (
                        <EyeOff className="size-3.5" />
                      ) : (
                        <Eye className="size-3.5" />
                      )}
                    </button>
                    <span className="text-sm font-mono flex-1 min-w-0 truncate">
                      {col.name}
                    </span>
                    {col.sensitiveType && (
                      <Badge variant="secondary" className="text-[10px] shrink-0">
                        {col.sensitiveType}
                      </Badge>
                    )}
                    <Badge
                      variant={col.isMasked ? 'default' : 'outline'}
                      className="text-[10px] shrink-0"
                    >
                      {col.isMasked ? 'Masked' : 'Visible'}
                    </Badge>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {/* Other columns */}
      {otherColumns.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">All Columns</CardTitle>
            <CardDescription>
              Override masking for any column.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="max-h-[240px]">
              <div className="flex flex-col gap-1">
                {otherColumns.map((col) => (
                  <div
                    key={col.name}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted/50"
                  >
                    <button
                      type="button"
                      onClick={() => onToggleColumn(col.name)}
                      className={cn(
                        'flex items-center justify-center size-6 rounded-md transition-colors',
                        col.isMasked
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {col.isMasked ? (
                        <EyeOff className="size-3.5" />
                      ) : (
                        <Eye className="size-3.5" />
                      )}
                    </button>
                    <span className="text-sm font-mono flex-1 min-w-0 truncate">
                      {col.name}
                    </span>
                    <Badge
                      variant={col.isMasked ? 'default' : 'outline'}
                      className="text-[10px] shrink-0"
                    >
                      {col.isMasked ? 'Masked' : 'Visible'}
                    </Badge>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {columns.length === 0 && (
        <div className="text-sm text-muted-foreground text-center py-4">
          No columns to configure. Run a query first.
        </div>
      )}
    </div>
  );
}
