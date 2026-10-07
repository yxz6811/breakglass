export const PROVIDER_RESPONSE_LIMIT = 64 * 1024;
export class ProviderPayloadError extends Error {
  constructor(code) { super(code); this.name = 'ProviderPayloadError'; this.code = code; }
}
const stop = (reader) => { try { Promise.resolve(reader.cancel()).catch(() => {}); } catch {} };
export function cancelProviderResponse(response) {
  if (response.body?.cancel) stop(response.body);
}

/** Bounds even a transport that ignores AbortSignal; no late value can win the race. */
export async function withProviderAbort(signal, run) {
  signal.throwIfAborted();
  let cancel;
  const aborted = new Promise((_, reject) => {
    cancel = () => reject(signal.reason ?? new DOMException('Cancelled', 'AbortError'));
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
  });
  try { return await Promise.race([Promise.resolve().then(() => { signal.throwIfAborted(); return run(); }), aborted]); }
  finally { signal.removeEventListener('abort', cancel); }
}

/** Count real response bytes before JSON parsing; json-only objects are test substitutes. */
export async function readProviderPayload(response, signal) {
  try { return await withProviderAbort(signal, async () => {
    if (response.body?.getReader) {
      const reader = response.body.getReader();
      const chunks = []; let size = 0; let cancelled = false;
      const cancel = () => { if (!cancelled) { cancelled = true; stop(reader); } };
      signal.addEventListener('abort', cancel, { once: true });
      try {
        if (signal.aborted) { cancel(); signal.throwIfAborted(); }
        for (;;) {
          signal.throwIfAborted();
          const item = await reader.read();
          signal.throwIfAborted();
          if (item.done) break;
          size += item.value.byteLength;
          if (size > PROVIDER_RESPONSE_LIMIT) { cancel(); throw new ProviderPayloadError('response_limit'); }
          chunks.push(Buffer.from(item.value));
        }
        try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
        catch { throw new ProviderPayloadError('model_bad_json'); }
      } catch (error) {
        cancel(); throw error;
      } finally {
        signal.removeEventListener('abort', cancel);
        try { reader.releaseLock(); } catch { /* A non-cooperating stream may still have a read pending. */ }
      }
    }
    signal.throwIfAborted();
    let value;
    try { value = await response.json(); }
    catch { signal.throwIfAborted(); throw new ProviderPayloadError('model_bad_json'); }
    signal.throwIfAborted();
    let text;
    try { text = JSON.stringify(value); } catch { throw new ProviderPayloadError('model_bad_json'); }
    if (typeof text !== 'string') throw new ProviderPayloadError('model_bad_json');
    if (Buffer.byteLength(text) > PROVIDER_RESPONSE_LIMIT) throw new ProviderPayloadError('response_limit');
    return value;
  }); } catch (error) {
    signal.throwIfAborted();
    if (error instanceof ProviderPayloadError) throw error;
    throw new ProviderPayloadError('model_unreadable');
  }
}
