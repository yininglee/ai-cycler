export function scopedBrowserKey(key: string, scope?: string): string {
  return scope ? `cycler-account:${scope}:${key}` : key;
}
