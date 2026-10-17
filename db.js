import Database from 'better-sqlite3';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Each piece of editable text on the site is a "blurb", keyed by the
// data-blurb attribute on its element in public/*.html.
export const BLURB_PATTERN = /(<(\w+)\b[^>]*\bdata-blurb="([^"]+)"[^>]*>)([\s\S]*?)(<\/\2>)/g;

export const SHELF_PATTERN = /<ul class="shelf" data-shelf="(\w+)"><\/ul>/g;

export function openDb(rootDir) {
  const dataDir = join(rootDir, 'data');
  mkdirSync(join(dataDir, 'uploads'), { recursive: true });

  const db = new Database(join(dataDir, 'site.db'));
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS blurbs (
      key        TEXT PRIMARY KEY,
      content    TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Books and records in the Living Room. image is a filename in data/uploads/.
    CREATE TABLE IF NOT EXISTS items (
      id         INTEGER PRIMARY KEY,
      shelf      TEXT NOT NULL CHECK (shelf IN ('books', 'records')),
      title      TEXT NOT NULL,
      creator    TEXT NOT NULL DEFAULT '',
      image      TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Writing entries. slug is set once at creation so links don't break on rename.
    CREATE TABLE IF NOT EXISTS posts (
      id         INTEGER PRIMARY KEY,
      slug       TEXT NOT NULL UNIQUE,
      title      TEXT NOT NULL,
      subtitle   TEXT NOT NULL DEFAULT '',
      body       TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  seedFromHtml(db, join(rootDir, 'public'));
  return db;
}

// Insert the text currently in the HTML for any blurb not yet in the database.
// Existing rows are never overwritten, so edits made on the site win.
function seedFromHtml(db, publicDir) {
  const insert = db.prepare('INSERT OR IGNORE INTO blurbs (key, content) VALUES (?, ?)');
  for (const file of readdirSync(publicDir).filter((f) => f.endsWith('.html'))) {
    const html = readFileSync(join(publicDir, file), 'utf8');
    for (const [, , , key, inner] of html.matchAll(BLURB_PATTERN)) {
      insert.run(key, decodeEntities(inner.trim()));
    }
  }
}

function decodeEntities(text) {
  return text
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

export function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Keep in sync with renderItem() in public/edit.js
export function renderItem(item) {
  const cover = item.image
    ? `<img src="/uploads/${escapeHtml(item.image)}" alt="" loading="lazy">`
    : '<div class="cover-blank"></div>';
  return `<li class="shelf-item" data-item-id="${item.id}">
        ${cover}
        <span class="item-title" data-field="title">${escapeHtml(item.title)}</span>
        <span class="item-creator" data-field="creator">${escapeHtml(item.creator)}</span>
      </li>`;
}

export const ENTRIES_PATTERN = /<ul class="entries"><\/ul>/;

// Dates are stored in UTC ("YYYY-MM-DD HH:MM:SS") and shown in Toronto time
const SITE_TIME_ZONE = 'America/Toronto';
const parseUtc = (createdAt) => new Date(`${createdAt.replace(' ', 'T')}Z`);

export function formatDate(createdAt) {
  return parseUtc(createdAt).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: SITE_TIME_ZONE,
  });
}

// YYYY-MM-DD for <time datetime>
export function isoDate(createdAt) {
  return parseUtc(createdAt).toLocaleDateString('en-CA', { timeZone: SITE_TIME_ZONE });
}

export function renderEntryListItem(post) {
  return `<li>
        <a href="/writing/${escapeHtml(post.slug)}">${escapeHtml(post.title)}</a>
        ${post.subtitle ? `<span class="entry-subtitle">${escapeHtml(post.subtitle)}</span>` : ''}
        <time datetime="${isoDate(post.created_at)}">${formatDate(post.created_at)}</time>
      </li>`;
}

export function slugify(title) {
  return (
    title
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60)
      .replace(/-+$/, '') || 'entry'
  );
}
