// A tiny static server for web/, for local use and for the headless runner.
// Usage: node tools/serve.mjs [port]   (default 8080, listens on 127.0.0.1 only)

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../web/', import.meta.url)));
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.task': 'application/octet-stream',
  '.tflite': 'application/octet-stream',
};

export function startServer(port = 8080, host = '127.0.0.1') {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      let path = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
      if (path === '' || path.endsWith('/')) path += 'index.html';
      const file = join(ROOT, path);
      if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
      const info = await stat(file);
      if (!info.isFile()) { res.writeHead(404).end(); return; }
      res.writeHead(200, {
        'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(await readFile(file));
    } catch {
      res.writeHead(404).end();
    }
  });
  return new Promise((ok) => server.listen(port, host, () => ok(server)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.argv[2] ?? 8080);
  await startServer(port);
  console.log(`Serving web/ on http://127.0.0.1:${port}/`);
}
