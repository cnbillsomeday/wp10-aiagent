const http = require('http');
const fs = require('fs');
const path = require('path');

// 零依赖 Node 服务器：静态托管 public/ + /api-search + /api-proxy
// 后端搜索/代理逻辑在运行时从 worker.js 提取（单一源，与 Cloudflare 版保持一致）
const PORT = parseInt(process.env.PORT, 10) || 8787;
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC = path.join(__dirname, 'public');
const MAX_BODY = 20 * 1024 * 1024;

const workerSrc = fs.readFileSync(path.join(__dirname, 'worker.js'), 'utf8');
const startMark = 'function jsonError(';
const endMark = 'async function run(request) {';
const s = workerSrc.indexOf(startMark);
const e = workerSrc.indexOf(endMark);
if (s < 0 || e < 0) throw new Error('worker.js 结构不符合预期，无法提取后端逻辑');
const backendBlock = workerSrc.slice(s, e);
// backendBlock 内定义：jsonError / handleSearch 及其全部依赖（各搜索源、正文抓取等）
const backend = new Function(backendBlock + '\nreturn { handleSearch: handleSearch };')();
const handleSearch = backend.handleSearch;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function send(res, status, body, headers) {
  const h = Object.assign({ 'Access-Control-Allow-Origin': '*' }, headers || {});
  res.writeHead(status, h);
  res.end(body);
}
function sendJson(res, status, obj) {
  send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8' });
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function handleApiSearch(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }
  if (req.method !== 'POST') return sendJson(res, 405, { error: { message: 'Method Not Allowed' } });
  let body;
  try {
    body = JSON.parse(await readBody(req, MAX_BODY));
  } catch (e) {
    return sendJson(res, 400, { error: { message: '请求体无法解析：' + e.message } });
  }
  try {
    const r = await handleSearch({ json: async () => body });
    const text = await r.text();
    send(res, r.status, text, { 'Content-Type': r.headers.get('Content-Type') || 'application/json; charset=utf-8' });
  } catch (err) {
    sendJson(res, 500, { error: { message: '服务器内部错误：' + err.message } });
  }
}

async function handleApiProxy(req, res, url) {
  let base = req.headers['x-api-base'] || '';
  while (base.charAt(base.length - 1) === '/') base = base.slice(0, base.length - 1);
  if (base.indexOf('http://') !== 0 && base.indexOf('https://') !== 0) {
    return sendJson(res, 400, { error: { message: '缺少或无效的 X-Api-Base 请求头' } });
  }
  let target = base + '/' + url.pathname.slice('/api-proxy/'.length);
  if (url.search) target += url.search;
  const headers = {};
  if (req.headers['authorization']) headers['Authorization'] = req.headers['authorization'];
  headers['Content-Type'] = req.headers['content-type'] || 'application/json';
  const init = { method: req.method, headers };
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    try {
      init.body = await readBody(req, MAX_BODY);
    } catch (e) {
      return sendJson(res, 413, { error: { message: '请求体过大（上限 20MB）' } });
    }
  }
  try {
    const up = await fetch(target, init);
    const text = await up.text();
    send(res, up.status, text, { 'Content-Type': up.headers.get('Content-Type') || 'application/json; charset=utf-8' });
  } catch (err) {
    sendJson(res, 502, { error: { message: '无法连接目标 API：' + err.message } });
  }
}

function serveStatic(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method Not Allowed');
  let rel;
  try {
    rel = decodeURIComponent(url.pathname);
  } catch (e) {
    return send(res, 400, 'Bad Request');
  }
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC)) return send(res, 403, 'Forbidden');
  fs.readFile(file, (err, data) => {
    if (err) {
      // 未命中时回退 index.html（等价 nginx try_files /index.html；前端无子路由）
      return fs.readFile(path.join(PUBLIC, 'index.html'), (e2, d2) => {
        if (e2) return send(res, 404, 'Not Found');
        send(res, 200, d2, { 'Content-Type': 'text/html; charset=utf-8' });
      });
    }
    send(res, 200, data, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  try {
    if (url.pathname === '/api-search') return await handleApiSearch(req, res);
    if (url.pathname.indexOf('/api-proxy/') === 0) return await handleApiProxy(req, res, url);
    return serveStatic(req, res, url);
  } catch (err) {
    sendJson(res, 500, { error: { message: '服务器内部错误：' + err.message } });
  }
});

server.listen(PORT, HOST, () => {
  console.log('wp10-aiagent server listening on http://' + HOST + ':' + PORT);
  console.log('standalone OK; behind nginx, proxy /api-search and /api-proxy to this port');
});
