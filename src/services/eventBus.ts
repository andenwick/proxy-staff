import { EventEmitter } from 'events';
import { InternalEvent, InternalEventType } from '../types/trigger.js';
import { logger } from '../utils/logger.js';

/**
 * EventBus - Simple internal event bus for triggering workflows from internal events.
 * Uses Node.js EventEmitter for pub/sub within the process.
 */
class EventBusService extends EventEmitter {
  private static instance: EventBusService | null = null;

  private constructor() {
    super();
    this.setMaxListeners(100); // Allow many trigger listeners
  }

  static getInstance(): EventBusService {
    if (!EventBusService.instance) {
      EventBusService.instance = new EventBusService();
    }
    return EventBusService.instance;
  }

  /**
   * Emit an internal event that triggers may be listening for.
   */
  emitEvent(event: InternalEvent): void {
    logger.debug({ eventType: event.type, tenantId: event.tenantId }, 'EventBus: emitting event');
    this.emit(event.type, event);
    this.emit('*', event); // Wildcard for listeners that want all events
  }

  /**
   * Subscribe to a specific event type.
   */
  subscribe(eventType: InternalEventType | '*', handler: (event: InternalEvent) => void): void {
    this.on(eventType, handler);
    logger.debug({ eventType }, 'EventBus: handler subscribed');
  }

  /**
   * Unsubscribe from a specific event type.
   */
  unsubscribe(eventType: InternalEventType | '*', handler: (event: InternalEvent) => void): void {
    this.off(eventType, handler);
    logger.debug({ eventType }, 'EventBus: handler unsubscribed');
  }

  /**
   * Helper to emit a typed event with automatic timestamp.
   * Usage: eventBus.emitTyped('message.received', tenantId, { phone, content, messageId })
   */
  emitTyped<T extends InternalEventType>(type: T, tenantId: string, data: InternalEvent['data']): void {
    this.emitEvent({ type, tenantId, data, timestamp: new Date() });
  }

  /**
   * Clear all listeners (for testing/shutdown).
   */
  clear(): void {
    this.removeAllListeners();
    logger.debug('EventBus: all listeners cleared');
  }
}

// Export singleton instance
export const eventBus = EventBusService.getInstance();
export { EventBusService };
