import type { ToolSchema } from '../ollama.ts';
import { config } from '../config.ts';
import { getDate } from './get-date.ts';
import { getWeather } from './get-weather.ts';
import { searchWeb } from './search-web.ts';
import type { Tool } from './types.ts';

const ALL_TOOLS: readonly Tool[] = [getDate, getWeather, searchWeb];

/**
 * Tools enabled for this process, resolved once at boot.
 *
 * `search_web` is dropped when no key is configured rather than being advertised and then
 * failing on every call — a bound-but-broken tool sends the model into retry loops.
 */
export const activeTools: readonly Tool[] = ALL_TOOLS.filter((tool) => {
  if (!config.enabledTools.includes(tool.name)) return false;
  if (tool.name === 'search_web' && config.firecrawlKey === '') {
    console.warn('[tools] search_web is enabled but FIRECRAWL_API_KEY is unset; skipping it.');
    return false;
  }
  return true;
});

const byName = new Map(activeTools.map((tool) => [tool.name, tool]));

export function findTool(name: string): Tool | undefined {
  return byName.get(name);
}

export function toolNames(): readonly string[] {
  return activeTools.map((tool) => tool.name);
}

export function toolGuidance(): readonly string[] {
  return activeTools.map((tool) => tool.guidance);
}

export function toolSchemas(): readonly ToolSchema[] {
  return activeTools.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}
