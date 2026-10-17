// Renders the site to static files in dist/ for GitHub Pages.
// Edit mode is left out: the published site is read-only.
//
//   npm run build                  # base path /personalsite (GitHub Pages project site)
//   BASE_PATH= npm run build       # site served from the domain root
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { createRenderer } from './render.js';

const ROOT_DIR = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC_DIR = join(ROOT_DIR, 'public');
const OUT_DIR = join(ROOT_DIR, 'dist');
const BASE_PATH = process.env.BASE_PATH ?? '/personalsite';

// Sections to publish. Writing stays local-only for now.
const PUBLISH_WRITING = false;

const db = openDb(ROOT_DIR);
const { renderPage, renderEntry, getPosts } = createRenderer(db, ROOT_DIR);

function finalize(html) {
  let out = html
    // No edit mode on the published site
    .replace(/\n\s*<script type="module" src="\/edit\.js"><\/script>/, '');
  if (!PUBLISH_WRITING) out = out.replace(/\n\s*<a href="\/writing"[^>]*>[^<]*<\/a>/, '');
  // Root-relative links need the Pages base path
  return out.replace(/(href|src)="\/(?!\/)/g, `$1="${BASE_PATH}/`);
}

rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(join(OUT_DIR, 'uploads'), { recursive: true });

const pages = ['index.html', 'living-room.html', 'contact.html'];
if (PUBLISH_WRITING) pages.push('writing.html');

for (const page of pages) {
  const html = readFileSync(join(PUBLIC_DIR, page), 'utf8');
  writeFileSync(join(OUT_DIR, page), finalize(renderPage(html)));
}

if (PUBLISH_WRITING) {
  mkdirSync(join(OUT_DIR, 'writing'));
  for (const post of getPosts.all()) {
    writeFileSync(join(OUT_DIR, 'writing', `${post.slug}.html`), finalize(await renderEntry(post)));
  }
}

for (const asset of ['styles.css', 'main.js', 'fonts']) {
  cpSync(join(PUBLIC_DIR, asset), join(OUT_DIR, asset), { recursive: true });
}

// Only covers that are actually on a shelf
const images = db.prepare('SELECT image FROM items WHERE image IS NOT NULL').all();
for (const { image } of images) {
  cpSync(join(ROOT_DIR, 'data', 'uploads', image), join(OUT_DIR, 'uploads', image));
}

// Serve files as-is (no Jekyll processing)
writeFileSync(join(OUT_DIR, '.nojekyll'), '');

console.log(`Built ${pages.length} pages and ${images.length} covers into dist/ (base path "${BASE_PATH}")`);
