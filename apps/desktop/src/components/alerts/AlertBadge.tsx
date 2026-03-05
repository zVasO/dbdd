import { useEffect, useState } from 'react';
import { useAlertStore } from '@/stores/alertStore';
import { cn } from '@/lib/utils';

interface AlertBadgeProps {
  className?: string;
}

export function AlertBadge({ className }: AlertBadgeProps) {
  const alerts = useAlertStore((s) => s.alerts);
  const unreadCount = alerts.filter((a) => !a.read).length;
  const [pulse, setPulse] = useState(false);
  const [prevCount, setPrevCount] = useState(unreadCount);

  useEffect(() => {
    if (unreadCount > prevCount) {
      setPulse(true);
      const timeout = setTimeout(() => setPulse(false), 2000);
      return () => clearTimeout(timeout);
    }
    setPrevCount(unreadCount);
  }, [unreadCount, prevCount]);

  useEffect(() => {
    setPrevCount(unreadCount);
  }, [unreadCount]);

  if (unreadCount === 0) {
    return null;
  }

  return (
    <span
      className={cn(
        'inline-flex items-center justify-center rounded-full bg-red-500 text-white font-medium leading-none',
        'min-w-[18px] h-[18px] px-1 text-[10px]',
        pulse && 'animate-pulse',
        className,
      )}
    >
      {unreadCount > 99 ? '99+' : unreadCount}
    </span>
  );
}
