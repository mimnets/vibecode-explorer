const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export type PreviewUrlResult = { ok: true; url: string } | { ok: false; reason: string };

/** Accepts only http(s) URLs on loopback hosts, without embedded credentials. */
export function validatePreviewUrl(raw: string): PreviewUrlResult {
  const value = raw.trim();
  if (!value) return { ok: false, reason: 'No preview URL configured. Set "vibecodeExplorer.previewUrl" (e.g. http://localhost:3000).' };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, reason: `"${value}" is not a valid URL.` };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, reason: 'Only http and https URLs are allowed.' };
  if (url.username || url.password) return { ok: false, reason: 'URLs with embedded credentials are not allowed.' };
  const host = url.hostname.toLowerCase();
  if (!LOOPBACK_HOSTS.has(host) && !host.endsWith('.localhost')) {
    return { ok: false, reason: 'Only local addresses (localhost, 127.0.0.1, [::1]) are allowed.' };
  }
  return { ok: true, url: url.toString() };
}
