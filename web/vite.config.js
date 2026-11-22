import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { renderIndexHtml } from './src/locales.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export default defineConfig(({ mode }) => {
  // LOCALE comes from .env in the project root, same as for the server.
  const env = { ...loadEnv(mode, root, ''), ...process.env };
  return {
    plugins: [
      react(),
      {
        // Only the dev server renders the language in. The production build keeps the
        // placeholders, and server.js fills them in, so one build works for any LOCALE.
        name: 'santa-locale',
        apply: 'serve',
        transformIndexHtml: (html) => renderIndexHtml(html, env.LOCALE),
      },
    ],
    server: { proxy: { '/api': 'http://localhost:3000' } },
  };
});
