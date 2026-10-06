import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mp4': 'video/mp4' };
export function createLabServer() {
  return http.createServer((request, response) => {
    let pathname;
    try { pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); }
    catch { response.writeHead(400); response.end(); return; }
    const normalized = path.posix.normalize(pathname);
    const allowed = pathname === normalized && !pathname.includes('\\') &&
      (pathname.startsWith('/learning-lab/') || pathname.startsWith('/extension/assets/video/') || pathname === '/extension/src/ui/theme.css');
    const file = path.resolve(root, `.${pathname}`);
    if (!allowed || !file.startsWith(root) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { response.writeHead(404); response.end(); return; }
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405); response.end(); return; }
    const size = fs.statSync(file).size;
    const range = request.headers.range;
    const match = range && /^bytes=(\d+)-(\d*)$/.exec(range);
    const start = match ? Number(match[1]) : 0;
    const end = match && match[2] ? Number(match[2]) : size - 1;
    if (range && (!match || start > end || end >= size)) { response.writeHead(416, { 'content-range': `bytes */${size}` }); response.end(); return; }
    const headers = { 'content-type': mime[path.extname(file)] || 'application/octet-stream', 'content-length': end - start + 1, 'accept-ranges': 'bytes', 'cache-control': 'no-store' };
    if (range) headers['content-range'] = `bytes ${start}-${end}/${size}`;
    response.writeHead(range ? 206 : 200, headers);
    if (request.method === 'HEAD') response.end(); else fs.createReadStream(file, { start, end }).pipe(response);
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createLabServer().listen(4173, '127.0.0.1', () => console.log('自制教学站：http://localhost:4173/learning-lab/lesson.html'));
}
