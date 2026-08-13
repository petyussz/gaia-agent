/**
 * Newline-delimited JSON reader, shared by the server (reading Ollama) and the browser
 * (reading `/api/turn`).
 *
 * Three details make this correct rather than merely working:
 *  1. `decoder.decode(value, { stream: true })` — a multi-byte UTF-8 character can straddle a
 *     chunk boundary, and a stateless decode would emit a replacement character.
 *  2. `lines.pop()` keeps the trailing partial line buffered — a JSON object can straddle a
 *     chunk boundary too, and is far more likely to than a single character.
 *  3. The post-loop flush handles a final line with no trailing newline.
 */
export async function* readNdjson<T>(stream: ReadableStream<Uint8Array>): AsyncGenerator<T> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffered = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffered += decoder.decode(value, { stream: true });
      const lines = buffered.split('\n');
      buffered = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.length > 0) yield JSON.parse(trimmed) as T;
      }
    }

    const tail = buffered.trim();
    if (tail.length > 0) yield JSON.parse(tail) as T;
  } finally {
    // Runs on early `break` from the consumer too, so an abandoned stream is not left open.
    await reader.cancel().catch(() => undefined);
  }
}
