import "@testing-library/jest-dom/vitest";

// jsdom does not implement matchMedia; provide a minimal stub so theme
// code that follows the system colour scheme does not throw in tests.
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

// jsdom implements no layout, so the scroll-into-view calls the chat uses for
// auto-scrolling are missing. Stub them rather than guarding production code.
if (typeof window !== "undefined" && typeof Element.prototype.scrollIntoView !== "function") {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}

// jsdom's localStorage can be undefined in some environments; ensure it exists.
if (typeof window !== "undefined" && typeof window.localStorage === "undefined") {
  Object.defineProperty(window, "localStorage", {
    writable: true,
    value: (() => {
      const store = new Map<string, string>();
      return {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, String(value)),
        removeItem: (key: string) => void store.delete(key),
        clear: () => store.clear(),
        key: (index: number) => Array.from(store.keys())[index] ?? null,
        get length() { return store.size; },
      };
    })(),
  });
}