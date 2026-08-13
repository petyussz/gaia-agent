import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

/**
 * Dev server proxies every `/api/*` call to the Express server (`npm run dev:server`).
 *
 * This deliberately differs from the sibling `generative-storyteller`, which proxies straight
 * to Ollama because its LLM calls happen in the browser. G.A.I.A owns the turn loop on the
 * server (it holds the Firecrawl key and the session history), so the browser must never reach
 * Ollama directly — in dev or in prod. Same origin, same paths, both modes.
 */
export default defineConfig(({ mode }) => {
  // Empty prefix: read plain env names, NOT `VITE_`-prefixed ones. Anything with a `VITE_`
  // prefix gets inlined into the client bundle, which is exactly what must not happen to keys.
  const env = loadEnv(mode, process.cwd(), '');
  const serverPort = Number(env['PORT'] ?? 8788);

  return {
    plugins: [react()],
    server: {
      port: 5274,
      proxy: {
        '/api': {
          target: `http://127.0.0.1:${serverPort}`,
          changeOrigin: true,
        },
      },
    },
  };
});
