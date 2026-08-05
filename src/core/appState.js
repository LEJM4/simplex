// src/core/appState.js
// ---------------------------------------------------------------------------
// Central application state + a tiny event bus. Modules communicate through
// events and shared state keys — never by importing each other directly.
//
// Conventions:
//   - appState.set('someKey', value) stores a value and emits 'change:someKey'
//     with { value, previous } (only when the value actually changed).
//   - appState.emit('some:event', payload) broadcasts a plain event.
//   - appState.on(...) returns an unsubscribe function.
// ---------------------------------------------------------------------------

const state = new Map();
const listeners = new Map();

export const appState = {
  /** Read a state value. */
  get(key) {
    return state.get(key);
  },

  /** Write a state value; emits `change:<key>` when the value changed. */
  set(key, value) {
    const previous = state.get(key);
    if (previous === value) return;
    state.set(key, value);
    this.emit(`change:${key}`, { value, previous });
  },

  /** Subscribe to an event. Returns a function that unsubscribes. */
  on(event, handler) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(handler);
    return () => this.off(event, handler);
  },

  /** Unsubscribe a handler from an event. */
  off(event, handler) {
    listeners.get(event)?.delete(handler);
  },

  /** Broadcast an event to all subscribers. */
  emit(event, payload) {
    listeners.get(event)?.forEach((handler) => {
      try {
        handler(payload);
      } catch (error) {
        console.error(`[appState] listener for "${event}" failed`, error);
      }
    });
  },
};
