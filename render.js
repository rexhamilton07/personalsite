import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  BLURB_PATTERN, SHELF_PATTERN, ENTRIES_PATTERN,
  escapeHtml, renderItem, renderEntryListItem, formatDate, isoDate,
} from './db.js';
import { compareItems } from './public/shelf-sort.js';

// Fills page HTML with content from the database. Shared by the dev server
// (server.js) and the static build (build.js).
export function createRenderer(db, rootDir) {
  const getBlurbs = db.prepare('SELECT key, content FROM blurbs');
  const getShelf = db.prepare('SELECT * FROM items WHERE shelf = ?');
  const getPosts = db.prepare('SELECT * FROM posts ORDER BY id DESC');
  const entryTemplate = join(rootDir, 'templates', 'entry.html');

  function renderPage(html) {
    const blurbs = new Map(getBlurbs.all().map((b) => [b.key, b.content]));
    return html
      .replace(BLURB_PATTERN, (match, open, tag, key, inner, close) =>
        blurbs.has(key) ? open + escapeHtml(blurbs.get(key)) + close : match
      )
      .replace(SHELF_PATTERN, (match, shelf) => {
        const items = getShelf.all(shelf).sort((a, b) => compareItems(shelf, a, b)).map(renderItem).join('\n      ');
        return `<ul class="shelf" data-shelf="${shelf}">${items ? `\n      ${items}\n      ` : ''}</ul>`;
      })
      .replace(ENTRIES_PATTERN, () => {
        const posts = getPosts.all().map(renderEntryListItem).join('\n      ');
        return `<ul class="entries">${posts ? `\n      ${posts}\n    ` : ''}</ul>`;
      });
  }

  async function renderEntry(post) {
    const values = {
      id: String(post.id),
      title: escapeHtml(post.title),
      subtitle: escapeHtml(post.subtitle),
      body: escapeHtml(post.body),
      date: formatDate(post.created_at),
      isoDate: isoDate(post.created_at),
    };
    const template = await readFile(entryTemplate, 'utf8');
    return renderPage(template.replace(/\{\{(\w+)\}\}/g, (m, key) => values[key] ?? m));
  }

  return { renderPage, renderEntry, getPosts };
}
