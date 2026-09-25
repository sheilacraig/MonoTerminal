import type { EventBus, MonoEvent } from '../../domain/events/types';
import type { Unsubscribe } from '../../domain/terminal/types';

type AnyListener = (event: MonoEvent) => void;

export class InMemoryEventBus implements EventBus {
  private readonly typedListeners = new Map<MonoEvent['type'], Set<AnyListener>>();
  private readonly allListeners = new Set<AnyListener>();

  public publish(event: MonoEvent): void {
    const set = this.typedListeners.get(event.type);
    if (set) {
      for (const listener of Array.from(set)) {
        try {
          listener(event);
        } catch (err) {
          console.error(`[InMemoryEventBus] Error in listener for ${event.type}:`, err);
        }
      }
    }
    for (const listener of Array.from(this.allListeners)) {
      try {
        listener(event);
      } catch (err) {
        console.error(`[InMemoryEventBus] Error in global listener for ${event.type}:`, err);
      }
    }
  }

  public subscribe<T extends MonoEvent['type']>(
    type: T,
    listener: (event: Extract<MonoEvent, { type: T }>) => void
  ): Unsubscribe {
    let set = this.typedListeners.get(type);
    if (!set) {
      set = new Set<AnyListener>();
      this.typedListeners.set(type, set);
    }
    const wrapped = listener as unknown as AnyListener;
    set.add(wrapped);

    return () => {
      const current = this.typedListeners.get(type);
      if (current) {
        current.delete(wrapped);
        if (current.size === 0) {
          this.typedListeners.delete(type);
        }
      }
    };
  }

  public subscribeAll(listener: (event: MonoEvent) => void): Unsubscribe {
    this.allListeners.add(listener);
    return () => {
      this.allListeners.delete(listener);
    };
  }
}
