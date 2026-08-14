import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import type { AppEvent } from '../lib/types';
import { applyAppEvent } from '../stores/activityStore';

/**
 * Subscribes once to the backend's `app-event` bus and dispatches each event
 * into activityStore. Mount exactly once at the app root — `listen()` isn't
 * testable in node, so this hook stays thin and delegates to `applyAppEvent`.
 */
export function useTauriEvent(): void {
  useEffect(() => {
    const unlisten = listen<AppEvent>('app-event', (event) => {
      applyAppEvent(event.payload);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);
}
