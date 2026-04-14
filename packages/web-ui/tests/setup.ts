import "@testing-library/jest-dom";

// Minimal localStorage stub for environments where jsdom lacks it
if (typeof globalThis.localStorage === "undefined" || typeof (globalThis.localStorage as any).setItem !== "function") {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => { store.clear(); },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size; },
  };
}

// Minimal EventSource stub for jsdom (which lacks it)
if (typeof globalThis.EventSource === "undefined") {
  class EventSourceStub {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSED = 2;
    readyState = 1;
    onmessage: ((e: MessageEvent) => void) | null = null;
    onerror: ((e: Event) => void) | null = null;
    constructor(public url: string) {}
    addEventListener(_type: string, _handler: EventListenerOrEventListenerObject) {}
    removeEventListener(_type: string, _handler: EventListenerOrEventListenerObject) {}
    close() { this.readyState = 2; }
    dispatchEvent(_event: Event) { return true; }
  }
  (globalThis as any).EventSource = EventSourceStub;
}
