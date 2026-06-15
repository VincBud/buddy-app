type EventKey = 'notifications:changed' | 'jobs:changed';
type Listener = () => void;

const registry = new Map<EventKey, Set<Listener>>();

export const eventBus = {
  on(event: EventKey, fn: Listener): () => void {
    if (!registry.has(event)) registry.set(event, new Set());
    registry.get(event)!.add(fn);
    return () => registry.get(event)?.delete(fn);
  },
  emit(event: EventKey): void {
    registry.get(event)?.forEach((fn) => fn());
  },
};
