import {createServer} from 'node:http';
import {readFile, mkdir, stat} from 'node:fs/promises';
import {resolve, extname, dirname, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {SQLiteD1} from './sqlite-adapter.mjs';
import worker from './worker.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..'), data = resolve(here, 'data');
await mkdir(data, {recursive: true});
const DB = new SQLiteD1(resolve(data, 'visa2go.sqlite'));
DB.exec(await readFile(resolve(here, 'schema.sql'), 'utf8'));
if (!DB.database.prepare('SELECT value FROM settings WHERE key=?').get('catalog')) {
  try {
    const config = JSON.parse(await readFile(resolve(root, 'config/site.json'), 'utf8'));
    DB.database.prepare('INSERT INTO settings VALUES(?,?,?)').run('catalog', JSON.stringify(config.catalog), new Date().toISOString());
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
const types = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp'};
const env = {...process.env, LOCAL_TEST: 'true', DB, ASSETS: {async fetch(request) {
  const url = new URL(request.url);
  let pathname; try { pathname = decodeURIComponent(url.pathname); } catch { return new Response('Bad request', {status: 400}); }
  const path = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
  const relative = path.slice(root.length + 1);
  if (!path.startsWith(`${root}${sep}`) || relative.split('/').some(p => p.startsWith('.')) || !/^(?:(?:assets|config)\/|(?:index|admin|privacy|terms|credits)\.html$|(?:app|admin|core|train-windows)\.(?:m?js)$|[a-z-]+\.css$|version\.json$|favicon\.(?:ico|svg)$)/.test(relative)) return new Response('Not found', {status: 404});
  try {
    if (!(await stat(path)).isFile()) return new Response('Not found', {status: 404});
    const contents = await readFile(path), type = types[extname(path)] || 'application/octet-stream';
    // Videos support byte ranges in browser preview, just like hosted static assets.
    const range = request.headers.get('range')?.match(/^bytes=(\d+)-(\d*)$/);
    if (range) {
      const start = Number(range[1]), end = Math.min(range[2] ? Number(range[2]) : contents.length - 1, contents.length - 1);
      if (start > end) return new Response('', {status: 416, headers: {'Content-Range': `bytes */${contents.length}`}});
      return new Response(contents.subarray(start, end + 1), {status: 206, headers: {'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${contents.length}`, 'Accept-Ranges': 'bytes'}});
    }
    return new Response(contents, {headers: {'Content-Type': type, 'Accept-Ranges': 'bytes'}});
  } catch { return new Response('Not found', {status: 404}); }
}}};
const jobs = new Set();
const server = createServer(async (incoming, outgoing) => {
  try {
    const headers = new Headers(); for (const [key, value] of Object.entries(incoming.headers)) if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(',') : value);
    // Never trust an inbound IP header in the local runner.
    headers.set('cf-connecting-ip', incoming.socket.remoteAddress || '127.0.0.1');
    const url = `http://127.0.0.1:${process.env.PORT || 4173}${incoming.url}`;
    const request = new Request(url, {method: incoming.method, headers, ...(!['GET', 'HEAD'].includes(incoming.method) ? {body: incoming, duplex: 'half'} : {})});
    const response = await worker.fetch(request, env, {waitUntil(promise) { jobs.add(promise); promise.finally(() => jobs.delete(promise)); }});
    outgoing.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    outgoing.end(incoming.method === 'HEAD' ? undefined : Buffer.from(await response.arrayBuffer()));
  } catch { outgoing.writeHead(500); outgoing.end('Local server error'); }
});
server.listen(Number(process.env.PORT || 4173), '127.0.0.1', () => console.log(`Visa2Go preview: http://127.0.0.1:${process.env.PORT || 4173} (collection ${env.LEAD_COLLECTION_ENABLED === 'true' ? 'requires reviewed catalogue' : 'disabled'})`));
const interval = setInterval(() => { const job = worker.scheduled({}, env); jobs.add(job); job.finally(() => jobs.delete(job)); }, 300000);
async function close() { clearInterval(interval); server.close(); await Promise.allSettled([...jobs]); DB.close(); process.exit(0); }
process.once('SIGINT', close); process.once('SIGTERM', close);
