import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import type { AppEvent } from '../lib/types';

export function useTauriEvent(
  callback: (event: AppEvent) => void,
  deps: React.DependencyList = [],
) {
  useEffect(() => {
    const unlisten = listen<AppEvent>('app-event', (event) => {
      callback(event.payload);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
