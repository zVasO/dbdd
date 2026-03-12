import { useEffect } from 'react';
import { useUIStore } from '@/stores/uiStore';

export function useModal(id: string): void {
  const pushModal = useUIStore((s) => s.pushModal);
  const popModal = useUIStore((s) => s.popModal);

  useEffect(() => {
    pushModal(id);
    return () => popModal(id);
  }, [id, pushModal, popModal]);
}
