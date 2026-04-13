import "@testing-library/jest-dom";

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
