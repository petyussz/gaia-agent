import { describe, expect, it } from 'vitest';

import { readNdjson } from './ndjson.ts';

function streamOf(chunks: readonly Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

async function collect<T>(stream: ReadableStream<Uint8Array>): Promise<T[]> {
  const out: T[] = [];
  for await (const value of readNdjson<T>(stream)) out.push(value);
  return out;
}

describe('readNdjson', () => {
  it('parses whole lines', async () => {
    const stream = streamOf([encode('{"a":1}\n{"a":2}\n')]);
    await expect(collect(stream)).resolves.toEqual([{ a: 1 }, { a: 2 }]);
  });

  it('reassembles a JSON object split across chunks', async () => {
    const stream = streamOf([encode('{"a":'), encode('1}\n{"a":2}\n')]);
    await expect(collect(stream)).resolves.toEqual([{ a: 1 }, { a: 2 }]);
  });

  it('emits a trailing line that has no newline', async () => {
    const stream = streamOf([encode('{"a":1}\n{"a":2}')]);
    await expect(collect(stream)).resolves.toEqual([{ a: 1 }, { a: 2 }]);
  });

  it('reassembles a multi-byte character split across chunks', async () => {
    // "°" is two bytes in UTF-8; splitting between them must not produce U+FFFD.
    const payload = encode('{"t":"12°C"}\n');
    const boundary = payload.indexOf(0xc2);
    const stream = streamOf([payload.slice(0, boundary + 1), payload.slice(boundary + 1)]);
    await expect(collect(stream)).resolves.toEqual([{ t: '12°C' }]);
  });

  it('ignores blank lines', async () => {
    const stream = streamOf([encode('\n\n{"a":1}\n\n')]);
    await expect(collect(stream)).resolves.toEqual([{ a: 1 }]);
  });
});
