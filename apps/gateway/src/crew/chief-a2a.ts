import type { ChiefPort } from './agent-tasks';

/** Identity token for the Chief's Cloud Run URL. On Cloud Run it comes from the metadata server, so no key file exists. */
export type IdTokenSource = (audience: string, signal: AbortSignal) => Promise<string>;
const METADATA = 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity';

export function metadataIdToken(fetcher: typeof fetch = fetch, now = Date.now): IdTokenSource {
  const cache = new Map<string, { token: string; expiresAt: number }>();
  return async (audience, signal) => {
    const hit = cache.get(audience); if (hit && hit.expiresAt - 300_000 > now()) return hit.token;
    const response = await fetcher(`${METADATA}?audience=${encodeURIComponent(audience)}&format=full`, { headers: { 'Metadata-Flavor': 'Google' }, signal, redirect: 'error' });
    const token = (await response.text()).trim();
    if (!response.ok || !/^[A-Za-z0-9_.-]{20,4096}$/.test(token)) throw new Error('Identity token unavailable.');
    const exp = Number(JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')).exp) * 1000;
    cache.set(audience, { token, expiresAt: Number.isFinite(exp) ? exp : now() + 600_000 });
    return token;
  };
}

/** A2A JSON-RPC `message/stream` over HTTPS. Yields each event's `result`; the caller decides what to trust. */
export function httpChiefPort(chiefUrl: string, idToken: IdTokenSource, fetcher: typeof fetch = fetch): ChiefPort {
  const url = new URL(chiefUrl);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw new Error('The Chief URL must be HTTPS.');
  const origin = url.origin;
  return { async *stream(message, signal) {
    const token = await idToken(origin, signal);
    const response = await fetcher(`${origin}/`, { method: 'POST', signal, redirect: 'error', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'message/stream', params: { message } }) });
    if (!response.ok || !response.body) throw new Error(`The Chief refused the request (${response.status}).`);
    const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = '', total = 0;
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      total += value.length; if (total > 2_000_000) throw new Error('The Chief stream is too large.');
      buffer += decoder.decode(value, { stream: true });
      let boundary: number;
      while ((boundary = buffer.search(/\r?\n\r?\n/)) >= 0) {
        const block = buffer.slice(0, boundary); buffer = buffer.slice(boundary).replace(/^\r?\n\r?\n/, '');
        const data = block.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
        if (!data) continue;
        const parsed = JSON.parse(data) as { result?: Record<string, unknown>; error?: unknown };
        if (parsed.error || !parsed.result) throw new Error('The Chief reported an error.');
        yield parsed.result;
      }
    }
  } };
}
