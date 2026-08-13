import { describe, expect, it } from 'vitest';

import { trimHistory, type StoredMessage } from './session.ts';

const user = (text: string): StoredMessage => ({ role: 'user', content: text });
const assistant = (text: string): StoredMessage => ({ role: 'assistant', content: text });
const tool = (text: string): StoredMessage => ({ role: 'tool', content: text, toolName: 't' });

describe('trimHistory', () => {
  it('returns everything when under the limit', () => {
    const messages = [user('a'), assistant('b')];
    expect(trimHistory(messages, 10)).toEqual(messages);
  });

  it('keeps the most recent messages', () => {
    const messages = [user('a'), assistant('b'), user('c'), assistant('d')];
    expect(trimHistory(messages, 2)).toEqual([user('c'), assistant('d')]);
  });

  it('drops a leading tool result so the window never starts mid-exchange', () => {
    // A naive slice would leave the tool result first. Ollama rejects a tool message with no
    // preceding call, so the window has to snap forward to the next user turn.
    const messages = [user('a'), assistant('b'), tool('c'), assistant('d'), user('e'), assistant('f')];
    expect(trimHistory(messages, 4)).toEqual([user('e'), assistant('f')]);
  });

  it('drops a leading assistant turn', () => {
    const messages = [user('a'), assistant('b'), user('c'), assistant('d')];
    expect(trimHistory(messages, 3)).toEqual([user('c'), assistant('d')]);
  });

  it('returns nothing when no clean boundary exists in the window', () => {
    const messages = [user('a'), assistant('b'), tool('c')];
    expect(trimHistory(messages, 2)).toEqual([]);
  });
});
