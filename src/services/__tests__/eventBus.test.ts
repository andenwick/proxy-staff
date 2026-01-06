/**
 * EventBus Service Tests
 */

import { EventBusService, eventBus } from '../eventBus.js';
import { InternalEvent, InternalEventType } from '../../types/trigger.js';

// Mock logger
jest.mock('../../utils/logger.js', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('EventBusService', () => {
  beforeEach(() => {
    eventBus.clear();
  });

  describe('singleton', () => {
    it('returns the same instance', () => {
      const instance1 = EventBusService.getInstance();
      const instance2 = EventBusService.getInstance();
      expect(instance1).toBe(instance2);
    });

    it('exported eventBus is a singleton instance', () => {
      expect(eventBus).toBe(EventBusService.getInstance());
    });
  });

  describe('emitEvent', () => {
    it('emits event to specific type listeners', () => {
      const handler = jest.fn();
      const event: InternalEvent = {
        type: 'message.received',
        tenantId: 'tenant-1',
        data: { content: 'hello' },
        timestamp: new Date(),
      };

      eventBus.subscribe('message.received', handler);
      eventBus.emitEvent(event);

      expect(handler).toHaveBeenCalledWith(event);
    });

    it('emits event to wildcard listeners', () => {
      const wildcardHandler = jest.fn();
      const event: InternalEvent = {
        type: 'tool.success',
        tenantId: 'tenant-1',
        data: {},
        timestamp: new Date(),
      };

      eventBus.subscribe('*', wildcardHandler);
      eventBus.emitEvent(event);

      expect(wildcardHandler).toHaveBeenCalledWith(event);
    });

    it('does not emit to unrelated type listeners', () => {
      const handler = jest.fn();
      const event: InternalEvent = {
        type: 'tool.success',
        tenantId: 'tenant-1',
        data: {},
        timestamp: new Date(),
      };

      eventBus.subscribe('message.received', handler);
      eventBus.emitEvent(event);

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('emitTyped', () => {
    it('emits event with automatic timestamp', () => {
      const handler = jest.fn();
      const beforeEmit = new Date();

      eventBus.subscribe('session.started', handler);
      eventBus.emitTyped('session.started', 'tenant-1', { sessionId: 'sess-1' });

      expect(handler).toHaveBeenCalledTimes(1);
      const emittedEvent = handler.mock.calls[0][0] as InternalEvent;
      expect(emittedEvent.type).toBe('session.started');
      expect(emittedEvent.tenantId).toBe('tenant-1');
      expect(emittedEvent.data).toEqual({ sessionId: 'sess-1' });
      expect(emittedEvent.timestamp.getTime()).toBeGreaterThanOrEqual(beforeEmit.getTime());
    });
  });

  describe('subscribe', () => {
    it('adds handler for event type', () => {
      const handler = jest.fn();
      eventBus.subscribe('tool.failure', handler);

      eventBus.emitTyped('tool.failure', 'tenant-1', { error: 'test' });

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('allows multiple handlers for same event type', () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();

      eventBus.subscribe('message.received', handler1);
      eventBus.subscribe('message.received', handler2);
      eventBus.emitTyped('message.received', 'tenant-1', {});

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
    });
  });

  describe('unsubscribe', () => {
    it('removes handler for event type', () => {
      const handler = jest.fn();
      eventBus.subscribe('tool.success', handler);
      eventBus.unsubscribe('tool.success', handler);

      eventBus.emitTyped('tool.success', 'tenant-1', {});

      expect(handler).not.toHaveBeenCalled();
    });

    it('does not affect other handlers', () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();

      eventBus.subscribe('tool.success', handler1);
      eventBus.subscribe('tool.success', handler2);
      eventBus.unsubscribe('tool.success', handler1);

      eventBus.emitTyped('tool.success', 'tenant-1', {});

      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).toHaveBeenCalledTimes(1);
    });
  });

  describe('clear', () => {
    it('removes all listeners', () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();

      eventBus.subscribe('tool.success', handler1);
      eventBus.subscribe('message.received', handler2);
      eventBus.clear();

      eventBus.emitTyped('tool.success', 'tenant-1', {});
      eventBus.emitTyped('message.received', 'tenant-1', {});

      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).not.toHaveBeenCalled();
    });
  });
});
