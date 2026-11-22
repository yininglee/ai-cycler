export async function readResponseBytes(response: Response, max: number, invalid: () => Error): Promise<Uint8Array> {
  if (!response.body) throw invalid();
  if (Number(response.headers.get("content-length")) > max) {
    await response.body.cancel();
    throw invalid();
  }
  const reader = response.body.getReader();
  const buffers: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) {
        await reader.cancel();
        throw invalid();
      }
      buffers.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(buffers, size);
}
