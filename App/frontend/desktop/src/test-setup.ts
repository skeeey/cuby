// The UI now follows the system locale, and happy-dom reports en-US. The
// existing UI assertions are written against the previous Chinese default, so
// pin the test environment to zh-CN.
Object.defineProperty(navigator, "language", {
  configurable: true,
  value: "zh-CN"
});
