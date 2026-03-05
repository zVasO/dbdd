import { useState } from 'react';
import {
  Plus,
  Trash2,
  Bell,
  BellOff,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useMonitoringStore } from '@/stores/monitoringStore';

const METRIC_OPTIONS = [
  { value: 'queries_per_sec', label: 'Queries/sec' },
  { value: 'active_connections', label: 'Active Connections' },
  { value: 'cache_hit_ratio', label: 'Cache Hit Ratio' },
  { value: 'slow_queries', label: 'Slow Queries' },
] as const;

const OPERATOR_OPTIONS = [
  { value: '>', label: '>' },
  { value: '<', label: '<' },
  { value: '>=', label: '>=' },
  { value: '<=', label: '<=' },
  { value: '==', label: '==' },
] as const;

type Operator = '>' | '<' | '>=' | '<=' | '==';

export function AlertConfig() {
  const { alertRules, addAlertRule, removeAlertRule, toggleAlertRule } =
    useMonitoringStore();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newMetric, setNewMetric] = useState('queries_per_sec');
  const [newOperator, setNewOperator] = useState<Operator>('>');
  const [newThreshold, setNewThreshold] = useState('100');

  const handleAdd = () => {
    const threshold = parseFloat(newThreshold);
    if (isNaN(threshold) || !newName.trim()) return;

    addAlertRule({
      name: newName.trim(),
      metric: newMetric,
      operator: newOperator,
      threshold,
      enabled: true,
    });

    // Reset form
    setNewName('');
    setNewMetric('queries_per_sec');
    setNewOperator('>');
    setNewThreshold('100');
    setDialogOpen(false);
  };

  const metricLabel = (metric: string) =>
    METRIC_OPTIONS.find((m) => m.value === metric)?.label ?? metric;

  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Bell className="size-4 text-primary" />
        <h3 className="text-sm font-semibold">Alert Rules</h3>
        <Badge variant="secondary" className="text-xs">
          {alertRules.length}
        </Badge>
        <div className="flex-1" />
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="xs" variant="outline">
              <Plus className="size-3" />
              Add Rule
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New Alert Rule</DialogTitle>
              <DialogDescription>
                Create a rule to trigger alerts when a metric crosses a threshold.
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="alert-name" className="text-xs">
                  Rule Name
                </Label>
                <Input
                  id="alert-name"
                  placeholder="e.g. High query rate"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs">Metric</Label>
                  <Select value={newMetric} onValueChange={setNewMetric}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {METRIC_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs">Operator</Label>
                  <Select
                    value={newOperator}
                    onValueChange={(v) => setNewOperator(v as Operator)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {OPERATOR_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="alert-threshold" className="text-xs">
                    Threshold
                  </Label>
                  <Input
                    id="alert-threshold"
                    type="number"
                    placeholder="100"
                    value={newThreshold}
                    onChange={(e) => setNewThreshold(e.target.value)}
                  />
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button
                onClick={handleAdd}
                disabled={!newName.trim() || isNaN(parseFloat(newThreshold))}
              >
                Create Rule
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Rules Table */}
      {alertRules.length === 0 ? (
        <div className="text-sm text-center py-6 text-muted-foreground border rounded-md">
          No alert rules configured. Add a rule to get notified when metrics
          cross thresholds.
        </div>
      ) : (
        <div className="rounded-md border max-h-[300px] overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Metric</TableHead>
                <TableHead>Condition</TableHead>
                <TableHead className="text-center">Status</TableHead>
                <TableHead className="w-[60px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {alertRules.map((rule) => (
                <TableRow
                  key={rule.id}
                  className={cn(!rule.enabled && 'opacity-50')}
                >
                  <TableCell className="text-xs font-medium">
                    {rule.name}
                  </TableCell>
                  <TableCell className="text-xs">
                    {metricLabel(rule.metric)}
                  </TableCell>
                  <TableCell className="text-xs font-mono">
                    {rule.operator} {rule.threshold}
                  </TableCell>
                  <TableCell className="text-center">
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => toggleAlertRule(rule.id)}
                      title={rule.enabled ? 'Disable' : 'Enable'}
                    >
                      {rule.enabled ? (
                        <Bell className="size-3.5 text-green-500" />
                      ) : (
                        <BellOff className="size-3.5 text-muted-foreground" />
                      )}
                    </Button>
                  </TableCell>
                  <TableCell>
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => removeAlertRule(rule.id)}
                      title="Delete rule"
                    >
                      <Trash2 className="size-3.5 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
