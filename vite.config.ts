import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

function editorLevelSavePlugin(): Plugin {
  return {
    name: 'editor-level-save',
    configureServer(server) {
      server.middlewares.use('/__debug/perf', (req, res, next) => {
        if (req.method !== 'POST') {
          next();
          return;
        }

        let body = '';
        req.setEncoding('utf8');
        req.on('data', (chunk) => {
          body += chunk;
        });
        req.on('end', async () => {
          try {
            const entry = JSON.parse(body);
            const line = JSON.stringify({ t: new Date().toISOString(), ...entry });
            await fs.appendFile(path.resolve(rootDir, '.codex-perf-log.ndjson'), `${line}\n`, 'utf8');
            console.log(`[perf] fps=${entry.fps} calls=${entry.calls} tris=${entry.triangles} edgeLines=${entry.edgeLines} edgeSegments=${entry.edgeSegments}`);
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true }));
          } catch (error) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: false, error: String(error) }));
          }
        });
      });

      server.middlewares.use('/__editor/save-level', (req, res, next) => {
        if (req.method !== 'POST') {
          next();
          return;
        }

        let body = '';
        req.setEncoding('utf8');
        req.on('data', (chunk) => {
          body += chunk;
        });
        req.on('end', async () => {
          try {
            const level = JSON.parse(body);
            if (level.version !== 1 || !Array.isArray(level.instances)) {
              throw new Error('Invalid LevelFile v1');
            }

            const safeName = String(level.name || 'level').replace(/[^a-zA-Z0-9_-]/g, '');
            if (!safeName) throw new Error('Invalid level name');

            const levelsDir = path.resolve(rootDir, 'public', 'levels');
            const filePath = path.resolve(levelsDir, `${safeName}.json`);
            if (!filePath.startsWith(levelsDir + path.sep)) {
              throw new Error('Invalid level path');
            }

            await fs.writeFile(filePath, `${JSON.stringify(level, null, 2)}\n`, 'utf8');
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true, path: filePath }));
          } catch (error) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: false, error: String(error) }));
          }
        });
      });
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), editorLevelSavePlugin()],
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
});
