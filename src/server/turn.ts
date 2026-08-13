import { randomUUID } from 'node:crypto';

import type { TurnEvent } from '../shared/protocol.ts';
import { config } from './config.ts';
import { streamChat, type OllamaMessage, type OllamaToolCall } from './ollama.ts';
import { composeSystemPrompt } from './prompt.ts';
import * as session from './session.ts';
import type { StoredMessage } from './session.ts';
import { findTool, toolGuidance, toolSchemas } from './tools/index.ts';

export interface TurnOptions {
  readonly sessionId: string;
  readonly model: string;
  readonly prompt: string;
  readonly signal: AbortSignal;
}

interface Completion {
  readonly content: string;
  readonly toolCalls: readonly OllamaToolCall[];
}

/**
 * Runs one `/api/chat` call to completion, forwarding prose as it arrives.
 *
 * Tokens are emitted optimistically because we cannot know whether a reply will end in a tool
 * call until it does. If it turns out to contain one, the caller retracts what was shown.
 */
async function* complete(
  messages: readonly OllamaMessage[],
  model: string,
  useTools: boolean,
  signal: AbortSignal,
): AsyncGenerator<TurnEvent, Completion> {
  let content = '';
  const toolCalls: OllamaToolCall[] = [];

  const schemas = toolSchemas();
  for await (const chunk of streamChat({
    model,
    messages,
    signal,
    ...(useTools && schemas.length > 0 ? { tools: schemas } : {}),
  })) {
    const delta = chunk.message?.content;
    if (delta) {
      content += delta;
      yield { type: 'token', delta };
    }

    const calls = chunk.message?.tool_calls;
    if (calls) toolCalls.push(...calls);
  }

  return { content, toolCalls };
}

/**
 * Executes one turn: model call, tool calls, model call again, until it answers in prose.
 *
 * The loop is what keeps this workable on small local models. Each request is either "decide
 * and call a tool" or "write the answer" — never both in one reply, which is the pattern local
 * models handle badly.
 */
export async function* runTurn(options: TurnOptions): AsyncGenerator<TurnEvent> {
  const { sessionId, model, prompt, signal } = options;

  const systemPrompt = composeSystemPrompt(toolGuidance());
  const stored = session.history(sessionId);

  const messages: OllamaMessage[] = [
    { role: 'system', content: systemPrompt },
    ...session.toOllamaMessages(stored),
    { role: 'user', content: prompt },
  ];

  // Buffered until the turn succeeds: a failed turn must not leave a half-exchange in history
  // that would poison every subsequent turn.
  const pending: StoredMessage[] = [{ role: 'user', content: prompt }];

  let searches = 0;
  let answer = '';

  for (let iteration = 0; iteration <= config.maxToolIterations; iteration += 1) {
    // The final iteration runs without tools, forcing prose. Otherwise a model that keeps
    // reaching for tools would end the turn having said nothing at all.
    const useTools = iteration < config.maxToolIterations;

    let streamed = false;
    let result: Completion;

    const generator = complete(messages, model, useTools, signal);
    for (;;) {
      const next = await generator.next();
      if (next.done) {
        result = next.value;
        break;
      }
      if (next.value.type === 'token') streamed = true;
      yield next.value;
    }

    if (result.toolCalls.length === 0) {
      answer = result.content;
      pending.push({ role: 'assistant', content: answer });
      break;
    }

    // The prose that arrived alongside the tool call is a preamble to work that has not
    // happened yet ("Let me look that up..."). Retract it rather than stranding it above the
    // real answer.
    if (streamed) yield { type: 'rollback' };

    messages.push({
      role: 'assistant',
      content: result.content,
      tool_calls: result.toolCalls,
    });
    pending.push({
      role: 'assistant',
      content: result.content,
      toolCalls: result.toolCalls,
    });

    for (const call of result.toolCalls) {
      const name = call.function?.name ?? '';
      const args = call.function?.arguments ?? {};
      const id = randomUUID();

      yield { type: 'tool_start', call: { id, name, args } };

      const outcome = await executeTool(name, args, signal, () => {
        searches += 1;
        return searches <= config.maxSearchesPerTurn;
      });

      yield { type: 'tool_end', id, ok: outcome.ok, summary: outcome.summary };

      const toolMessage: StoredMessage = {
        role: 'tool',
        content: outcome.content,
        toolName: name,
      };
      messages.push({ role: 'tool', content: outcome.content, tool_name: name });
      pending.push(toolMessage);
    }
  }

  session.append(sessionId, pending);
  yield { type: 'done', text: answer };
}

async function executeTool(
  name: string,
  args: Record<string, unknown>,
  signal: AbortSignal,
  chargeSearchBudget: () => boolean,
): Promise<{ ok: boolean; summary: string; content: string }> {
  const tool = findTool(name);
  if (!tool) {
    return {
      ok: false,
      summary: `Unknown tool "${name}"`,
      content: `There is no tool named "${name}". Answer using the tools you were given, or from your own knowledge.`,
    };
  }

  if (name === 'search_web' && !chargeSearchBudget()) {
    return {
      ok: false,
      summary: 'Search budget exhausted',
      content: `You have used all ${config.maxSearchesPerTurn} searches allowed this turn. Stop searching and answer with what you already have.`,
    };
  }

  try {
    return await tool.run(args, { signal });
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown error';
    return {
      ok: false,
      summary: `${name} failed`,
      content: `The tool "${name}" failed: ${reason}. Do not retry it; answer without it and say what is missing.`,
    };
  }
}
