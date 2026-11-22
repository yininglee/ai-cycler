const destinations = new Set(["chat", "connections", "demo-events", "import", "plans", "pmc", "profile", "rides"]);

export function accountReturnPath(value: unknown): string {
  if (typeof value !== "string" || value.length > 2048 || !value.startsWith("/") || /[\\\u0000-\u001f\u007f]/.test(value)) {
    return "/chat";
  }
  try {
    const base = "https://cycler.invalid";
    const url = new URL(value, base);
    const section = url.pathname.split("/")[1];
    if (url.origin === base && destinations.has(section)) return url.pathname + url.search;
  } catch {
    // Invalid URLs use the main application entry.
  }
  return "/chat";
}
