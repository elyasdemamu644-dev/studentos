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