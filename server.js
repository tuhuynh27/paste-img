const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
const TOKEN = process.env.UPLOAD_TOKEN || '';
const MAX_BYTES = (Number(process.env.MAX_MB) || 20) * 1024 * 1024;
const RETENTION_DAYS = Number(process.env.RETENTION_DAYS) || 30;

const MIME = {
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
};

fs.mkdirSync(DATA_DIR, { recursive: true });

function sniff(b) {
  if (b.length < 12) return null;
  if (b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.slice(0, 3).toString() === 'GIF') return 'gif';
  if (b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP') return 'webp';
  if (b.slice(4, 8).toString() === 'ftyp' && /avif|avis/.test(b.slice(8, 12).toString())) return 'avif';
  if (b.slice(0, 2).toString() === 'BM') return 'bmp';
  return null;
}

function send(res, code, body, headers = {}) {
  const isObj = typeof body === 'object' && !Buffer.isBuffer(body);
  res.writeHead(code, { 'content-type': isObj ? 'application/json' : 'text/plain', ...headers });
  res.end(isObj ? JSON.stringify(body) : body);
}

function baseUrl(req) {
  if (PUBLIC_URL) return PUBLIC_URL;
  const proto = req.headers['x-forwarded-proto'] || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto.split(',')[0]}://${host}`;
}

function authed(req) {
  if (!TOKEN) return true;
  const given = Buffer.from(String(req.headers['x-token'] || ''));
  const want = Buffer.from(TOKEN);
  return given.length === want.length && crypto.timingSafeEqual(given, want);
}

function upload(req, res) {
  if (!authed(req)) return send(res, 401, { error: 'Invalid token' });

  const chunks = [];
  let size = 0;
  let aborted = false;

  req.on('data', (c) => {
    size += c.length;
    if (size > MAX_BYTES) {
      aborted = true;
      send(res, 413, { error: `File exceeds ${MAX_BYTES / 1024 / 1024} MB` }, { connection: 'close' });
      req.destroy();
      return;
    }
    chunks.push(c);
  });

  req.on('end', () => {
    if (aborted) return;
    const buf = Buffer.concat(chunks);
    const ext = sniff(buf);
    if (!ext) return send(res, 415, { error: 'Unsupported image type' });

    const name = `${crypto.randomBytes(9).toString('base64url')}.${ext}`;
    fs.writeFile(path.join(DATA_DIR, name), buf, (err) => {
      if (err) {
        console.error('write failed:', err.message);
        return send(res, 500, { error: 'Write failed' });
      }
      send(res, 201, { url: `${baseUrl(req)}/i/${name}`, name, bytes: buf.length });
    });
  });
}

function serveImage(req, res, file) {
  if (!/^[\w-]{12}\.(png|jpg|gif|webp|avif|bmp)$/.test(file)) return send(res, 404, 'Not found');
  const ext = file.split('.')[1];
  const stream = fs.createReadStream(path.join(DATA_DIR, file));
  stream.on('open', () => {
    res.writeHead(200, {
      'content-type': MIME[ext],
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
      'access-control-allow-origin': '*',
    });
    stream.pipe(res);
  });
  stream.on('error', () => send(res, 404, 'Not found'));
}

function serveIndex(res) {
  fs.readFile(path.join(__dirname, 'public', 'index.html'), (err, html) => {
    if (err) return send(res, 500, 'Missing UI');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
  });
}

const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://x');

  if (req.method === 'GET' && pathname === '/') return serveIndex(res);
  if (req.method === 'GET' && pathname === '/health') return send(res, 200, 'ok');
  if (req.method === 'GET' && pathname === '/api/config') {
    return send(res, 200, { tokenRequired: !!TOKEN, maxMb: MAX_BYTES / 1024 / 1024 });
  }
  if (req.method === 'POST' && pathname === '/api/upload') return upload(req, res);
  if (req.method === 'GET' && pathname.startsWith('/i/')) return serveImage(req, res, pathname.slice(3));

  send(res, 404, 'Not found');
});

function sweep() {
  if (!RETENTION_DAYS) return;
  const cutoff = Date.now() - RETENTION_DAYS * 864e5;
  fs.readdir(DATA_DIR, (err, files) => {
    if (err) return;
    for (const f of files) {
      const p = path.join(DATA_DIR, f);
      fs.stat(p, (e, st) => {
        if (!e && st.mtimeMs < cutoff) fs.unlink(p, () => {});
      });
    }
  });
}
sweep();
setInterval(sweep, 6 * 3600 * 1000).unref();

server.listen(PORT, () => console.log(`pasteimg on :${PORT}, data in ${DATA_DIR}`));
