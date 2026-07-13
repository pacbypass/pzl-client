// Minimal static server with SPA fallback for the exported web build.
// Serves dist/, falling back to index.html so client-side routes (e.g. /auth,
// the OAuth callback) load the app instead of 404ing.
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, 'dist');
const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;
const HOST = process.env.HOST || '0.0.0.0';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
};

function send(res, status, body, type) {
  res.writeHead(status, { 'Content-Type': type || 'text/plain' });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  let filePath = path.join(ROOT, urlPath);

  // Prevent path traversal outside dist/.
  if (!filePath.startsWith(ROOT)) return send(res, 403, 'Forbidden');

  fs.stat(filePath, (err, stat) => {
    if (!err && stat.isDirectory()) filePath = path.join(filePath, 'index.html');

    fs.readFile(filePath, (readErr, data) => {
      if (readErr) {
        // SPA fallback: unknown path without a file extension → index.html
        if (!path.extname(urlPath)) {
          return fs.readFile(path.join(ROOT, 'index.html'), (e2, html) =>
            e2 ? send(res, 404, 'Not found') : send(res, 200, html, TYPES['.html']),
          );
        }
        return send(res, 404, 'Not found');
      }
      const type = TYPES[path.extname(filePath)] || 'application/octet-stream';
      send(res, 200, data, type);
    });
  });
});

server.listen(PORT, HOST, () => {
  console.log(`PZŁ client web build served on http://${HOST}:${PORT}`);
});
