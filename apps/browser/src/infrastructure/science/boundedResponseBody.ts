/** Reads a fetch response body in bounded chunks so an oversized loopback reply cannot exhaust memory. */

/** Collects the response body up to `maxBytes`; beyond that the read is cancelled and `onOverflow()` is thrown. */
export async function readBoundedResponseBody(
  response: Response,
  maxBytes: number,
  onOverflow: () => Error,
): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > maxBytes) {
        await reader.cancel();
        throw onOverflow();
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const combined = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined;
}
