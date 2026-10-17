import { createServer } from 'node:http';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, slugify } from './db.js';
import { createRenderer } from './render.js';

const PORT = process.env.PORT || 3000;
const ROOT_DIR = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC_DIR = join(ROOT_DIR, 'public');
const UPLOADS_DIR = join(ROOT_DIR, 'data', 'uploads');
const PASSCODE = process.env.EDIT_PASSCODE;

const db = openDb(ROOT_DIR);
const { renderPage, renderEntry } = createRenderer(db, ROOT_DIR);
const upsertBlurb = db.prepare(`
  INSERT INTO blurbs (key, content, updated_at) VALUES (?, ?, datetime('now'))
  ON CONFLICT(key) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at
`);
const getItem = db.prepare('SELECT * FROM items WHERE id = ?');
const insertItem = db.prepare('INSERT INTO items (shelf, title, creator, image) VALUES (?, ?, ?, ?) RETURNING *');
const updateItem = db.prepare('UPDATE items SET title = ?, creator = ? WHERE id = ?');
const deleteItem = db.prepare('DELETE FROM items WHERE id = ?');

const getPostBySlug = db.prepare('SELECT * FROM posts WHERE slug = ?');
const getPostById = db.prepare('SELECT * FROM posts WHERE id = ?');
const slugTaken = db.prepare('SELECT 1 FROM posts WHERE slug = ?');
const insertPost = db.prepare('INSERT INTO posts (slug, title, subtitle) VALUES (?, ?, ?) RETURNING *');
const updatePost = db.prepare(`
  UPDATE posts SET title = ?, subtitle = ?, body = ?, updated_at = datetime('now') WHERE id = ?
`);
const deletePost = db.prepare('DELETE FROM posts WHERE id = ?');

function uniqueSlug(title) {
  const base = slugify(title);
  let slug = base;
  for (let n = 2; slugTaken.get(slug); n++) slug = `${base}-${n}`;
  return slug;
}

const SHELVES = ['books', 'records'];
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
// No SVG: it can carry scripts
const IMAGE_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

// --- Edit sessions -----------------------------------------------------------

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const sessions = new Map(); // token -> expiry timestamp

// A 4-digit passcode is easy to guess, so lock an IP out after a few misses.
const MAX_FAILURES = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
const failures = new Map(); // ip -> { count, lockedUntil }

function getSessionToken(req) {
  const match = /(?:^|;\s*)session=([a-f0-9]+)/.exec(req.headers.cookie || '');
  return match?.[1];
}

function isAuthed(req) {
  const token = getSessionToken(req);
  const expiry = token && sessions.get(token);
  if (!expiry) return false;
  if (expiry < Date.now()) {
    sessions.delete(token);
    return false;
  }
  return true;
}

function passcodeMatches(attempt) {
  const a = Buffer.from(String(attempt));
  const b = Buffer.from(PASSCODE);
  return a.length === b.length && timingSafeEqual(a, b);
}

// --- Helpers -----------------------------------------------------------------

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

async function readBody(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('Body too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson(req, limit = 100_000) {
  const body = (await readBody(req, limit)).toString('utf8');
  return JSON.parse(body || '{}');
}

function removeUpload(image) {
  if (image) unlink(join(UPLOADS_DIR, image)).catch(() => {});
}

// --- API ---------------------------------------------------------------------

async function handleApi(req, res, pathname) {
  if (pathname === '/api/session' && req.method === 'GET') {
    return sendJson(res, 200, { authed: isAuthed(req) });
  }

  if (pathname === '/api/login' && req.method === 'POST') {
    if (!PASSCODE) return sendJson(res, 503, { error: 'Editing is disabled (EDIT_PASSCODE not set)' });

    const ip = req.socket.remoteAddress;
    const record = failures.get(ip);
    if (record?.lockedUntil > Date.now()) {
      return sendJson(res, 429, { error: 'Too many attempts. Try again later.' });
    }

    const { passcode } = await readJson(req);
    if (!passcodeMatches(passcode ?? '')) {
      const count = (record?.lockedUntil ? 0 : record?.count ?? 0) + 1;
      failures.set(ip, count >= MAX_FAILURES ? { count, lockedUntil: Date.now() + LOCKOUT_MS } : { count });
      return sendJson(res, 401, { error: 'Wrong passcode' });
    }

    failures.delete(ip);
    const token = randomBytes(32).toString('hex');
    sessions.set(token, Date.now() + SESSION_TTL_MS);
    return sendJson(res, 200, { ok: true }, {
      'Set-Cookie': `session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS / 1000}`,
    });
  }

  if (pathname === '/api/logout' && req.method === 'POST') {
    sessions.delete(getSessionToken(req));
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': 'session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
  }

  if (pathname === '/api/blurbs' && req.method === 'PUT') {
    if (!isAuthed(req)) return sendJson(res, 401, { error: 'Not logged in' });
    const updates = await readJson(req);
    const save = db.transaction((entries) => {
      for (const [key, content] of entries) upsertBlurb.run(key, content);
    });
    const entries = Object.entries(updates).filter(([k, v]) => typeof k === 'string' && typeof v === 'string');
    save(entries);
    return sendJson(res, 200, { ok: true, saved: entries.length });
  }

  // Everything below requires an edit session
  if (!isAuthed(req)) return sendJson(res, 401, { error: 'Not logged in' });

  // Raw image body; returns the stored filename to attach to an item
  if (pathname === '/api/uploads' && req.method === 'POST') {
    const ext = IMAGE_TYPES[req.headers['content-type']];
    if (!ext) return sendJson(res, 415, { error: 'Use a JPEG, PNG, WebP or GIF image' });
    const data = await readBody(req, MAX_UPLOAD_BYTES);
    const image = randomBytes(12).toString('hex') + ext;
    await writeFile(join(UPLOADS_DIR, image), data);
    return sendJson(res, 201, { image });
  }

  if (pathname === '/api/items' && req.method === 'POST') {
    const { shelf, title, creator = '', image = null } = await readJson(req);
    if (!SHELVES.includes(shelf) || typeof title !== 'string' || !title.trim()) {
      return sendJson(res, 400, { error: 'A shelf and title are required' });
    }
    if (image !== null && !/^[a-f0-9]{24}\.(jpg|png|webp|gif)$/.test(image)) {
      return sendJson(res, 400, { error: 'Bad image' });
    }
    return sendJson(res, 201, insertItem.get(shelf, title.trim(), String(creator).trim(), image));
  }

  // Batch edit: { [id]: { title, creator } }
  if (pathname === '/api/items' && req.method === 'PUT') {
    const updates = await readJson(req);
    const save = db.transaction(() => {
      for (const [id, { title, creator }] of Object.entries(updates)) {
        if (typeof title === 'string' && title.trim()) updateItem.run(title.trim(), String(creator ?? '').trim(), Number(id));
      }
    });
    save();
    return sendJson(res, 200, { ok: true });
  }

  if (pathname === '/api/posts' && req.method === 'POST') {
    const { title, subtitle = '' } = await readJson(req);
    if (typeof title !== 'string' || !title.trim()) return sendJson(res, 400, { error: 'A title is required' });
    return sendJson(res, 201, insertPost.get(uniqueSlug(title), title.trim(), String(subtitle).trim()));
  }

  const postMatch = /^\/api\/posts\/(\d+)$/.exec(pathname);
  if (postMatch) {
    const post = getPostById.get(Number(postMatch[1]));
    if (!post) return sendJson(res, 404, { error: 'Not found' });

    if (req.method === 'PUT') {
      const { title, subtitle = '', body = '' } = await readJson(req, 2_000_000);
      if (typeof title !== 'string' || !title.trim()) return sendJson(res, 400, { error: 'A title is required' });
      updatePost.run(title.trim(), String(subtitle).trim(), String(body), post.id);
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === 'DELETE') {
      deletePost.run(post.id);
      return sendJson(res, 200, { ok: true });
    }
  }

  const itemMatch = /^\/api\/items\/(\d+)$/.exec(pathname);
  if (itemMatch && req.method === 'DELETE') {
    const item = getItem.get(Number(itemMatch[1]));
    if (!item) return sendJson(res, 404, { error: 'Not found' });
    deleteItem.run(item.id);
    removeUpload(item.image);
    return sendJson(res, 200, { ok: true });
  }

  sendJson(res, 404, { error: 'Not found' });
}

// --- Server ------------------------------------------------------------------

const server = createServer(async (req, res) => {
  let pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);

  if (pathname.startsWith('/api/')) {
    try {
      return await handleApi(req, res, pathname);
    } catch {
      return sendJson(res, 400, { error: 'Bad request' });
    }
  }

  // Uploaded covers live outside public/
  if (pathname.startsWith('/uploads/')) {
    const file = pathname.slice('/uploads/'.length);
    if (!/^[a-f0-9]{24}\.(jpg|png|webp|gif)$/.test(file)) return res.writeHead(404).end('Not found');
    try {
      const data = await readFile(join(UPLOADS_DIR, file));
      res.writeHead(200, {
        'Content-Type': MIME_TYPES[extname(file)],
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'public, max-age=31536000, immutable',
      });
      return res.end(data);
    } catch {
      return res.writeHead(404).end('Not found');
    }
  }

  const entryMatch = /^\/writing\/([a-z0-9-]+)\/?$/.exec(pathname);
  if (entryMatch) {
    const post = getPostBySlug.get(entryMatch[1]);
    if (!post) return res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
    res.writeHead(200, { 'Content-Type': MIME_TYPES['.html'] });
    return res.end(await renderEntry(post));
  }

  if (pathname.endsWith('/')) pathname += 'index.html';
  // Clean URLs: /writing serves public/writing.html
  else if (!extname(pathname)) pathname += '.html';

  // Prevent path traversal outside public/
  const filePath = normalize(join(PUBLIC_DIR, pathname));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  try {
    const ext = extname(filePath);
    let data = await readFile(filePath);
    if (ext === '.html') data = renderPage(data.toString('utf8'));
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  if (!PASSCODE) console.log('EDIT_PASSCODE not set: editing is disabled');
});
