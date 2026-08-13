import { readFileSync, statSync } from 'node:fs';

import { config } from './config.ts';

/**
 * Used only if the persona file is missing or unreadable. Deliberately terse — it is a
 * degraded mode, not a second copy of `system_prompt.md` that could silently drift from it.
 */
const FALLBACK_PERSONA = [
  'You are G.A.I.A, a calm, precise local assistant.',
  'Lead with the answer. Never invent facts. Say plainly when you do not know.',
].join('\n');

let cached: { mtimeMs: number; text: string } | null = null;
let warned = false;

/**
 * Reads the operator-editable persona, re-reading only when the file's mtime changes.
 *
 * An mtime stat per turn is cheaper than maintaining a watcher, and crucially it is *reliable*:
 * `fs.watch` misfires or goes silent on network and cloud-synced filesystems, which is exactly
 * where this file tends to live.
 */
export function loadPersona(): string {
  try {
    const stat = statSync(config.systemPromptPath);
    if (cached !== null && cached.mtimeMs === stat.mtimeMs) return cached.text;

    const text = readFileSync(config.systemPromptPath, 'utf8').trim();
    cached = { mtimeMs: stat.mtimeMs, text };
    warned = false;
    return text;
  } catch {
    if (!warned) {
      console.warn(
        `[prompt] Cannot read ${config.systemPromptPath}; using the built-in fallback persona.`,
      );
      warned = true;
    }
    return FALLBACK_PERSONA;
  }
}

/**
 * Composes the full system message: operator persona, then tool guidance derived from the
 * tools actually bound for this turn.
 *
 * Generating the tool section rather than letting the operator write it means the prompt can
 * never advertise a tool that is not bound — the failure mode where a model repeatedly calls
 * something that does not exist and cannot recover.
 */
export function composeSystemPrompt(toolGuidance: readonly string[]): string {
  const persona = loadPersona();
  if (toolGuidance.length === 0) {
    return `${persona}\n\n## Tools\n\nYou have no tools available. Answer from your own knowledge, and say so when that is not enough.`;
  }

  const lines = toolGuidance.map((line) => `- ${line}`).join('\n');
  return [
    persona,
    '',
    '## Tools',
    '',
    'Call a tool only when it genuinely changes the answer. For anything you already know, just answer.',
    '',
    lines,
    '',
    'When you call a tool, emit the call alone with no accompanying prose — the operator sees a status line for it. Once results arrive, answer normally in your own voice. Do not restate the raw tool output.',
  ].join('\n');
}
