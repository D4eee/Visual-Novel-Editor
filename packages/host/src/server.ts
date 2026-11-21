/**
 * Browser-mode host: serves the editor and the host API over HTTP on 127.0.0.1.
 * Useful for development, automated UI tests and machines without Electron.
 * Run with `npm run serve` and open the printed URL.
 */
import * as http from 'node:http';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { createHost } from './api';
import { mimeOf, within } from './fsutil';

const ROOT = path.resolve(process.env.VNE_ROOT || path.join(__dirname, '..'));
const PORT = Number(process.env.PORT || 5199);
const HOST = '127.0.0.1';
const DIST = path.join(ROOT, 'dist');

const host = createHost({
  mode: 'browser',
  distDir: DIST,
  examplesDir: path.join(ROOT, 'examples'),
  userDataDir: process.env.VNE_USER_DATA || path.join(os.homedir(), '.vne'),
  urlBase: `http://${HOST}:${PORT}/fs/`,
  templateDirs: [path.join(ROOT, 'resources', 'runtime-templates')],
});

async function sendFile(req: http.IncomingMessage, res: http.ServerResponse, file: string): Promise<void> {
  let st: fs.Stats;
  try { st = await fsp.stat(file); } catch { res.writeHead(404); res.end('Not found'); return; }
  if (st.isDirectory()) { res.writeHead(404); res.end('Not found'); return; }
  const type = mimeOf(file);
  const range = req.headers.range;
  const headers: Record<string, string | number> = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' };
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    const start = m && m[1] ? Number(m[1]) : 0;
    const end = m && m[2] ? Number(m[2]) : st.size - 1;
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
    fs.createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { ...headers, 'Content-Length': st.size });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);
    // Only accept requests addressed to this machine (blocks DNS-rebinding pages from using the API).
    const hostHeader = String(req.headers.host || '');
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(hostHeader)) { res.writeHead(403); res.end('Forbidden'); return; }
    if (url.pathname.startsWith('/api/') && req.method === 'POST') {
      // Only the editor page may call the API: other web pages can send simple (text/plain or form)
      // requests to localhost, but not JSON ones without a CORS preflight, which this server refuses.
      const origin = req.headers.origin;
      const ctype = String(req.headers['content-type'] || '');
      if ((origin && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(String(origin))) || !ctype.startsWith('application/json')) {
        res.writeHead(403); res.end('Forbidden'); return;
      }
      const name = decodeURIComponent(url.pathname.slice(5));
      const fn = host.methods[name];
      if (!fn) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: `Unknown method ${name}` })); return; }
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
      try {
        const result = await fn(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ result: result ?? null }));
      } catch (err: any) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err?.message || String(err) }));
      }
      return;
    }
    if (url.pathname.startsWith('/fs/')) {
      const file = await host.resolveFile(url.pathname.slice(4));
      if (!file) { res.writeHead(404); res.end('Not found'); return; }
      await sendFile(req, res, file);
      return;
    }
    // Static editor files
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/' || rel === '') rel = '/editor/index.html';
    if (rel.startsWith('/player/') || rel.startsWith('/editor/')) {
      await sendFile(req, res, within(DIST, rel.slice(1)));
      return;
    }
    await sendFile(req, res, within(path.join(DIST, 'editor'), rel.slice(1)));
  } catch (err: any) {
    res.writeHead(500);
    res.end(String(err?.message || err));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Visual Novel Editor (browser mode) → http://${HOST}:${PORT}/`);
});
