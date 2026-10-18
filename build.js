// Renders the site to static files in dist/ for GitHub Pages.
// Edit mode is left out: the published site is read-only.
//
//   npm run build                  # base path /personalsite (GitHub Pages project site)
//   BASE_PATH= npm run build       # site served from the domain root
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { createRenderer } from './render.js';
import sharp from 'sharp';

const ROOT_DIR = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC_DIR = join(ROOT_DIR, 'public');
const OUT_DIR = join(ROOT_DIR, 'dist');
const BASE_PATH = process.env.BASE_PATH ?? '/personalsite';

// Sections to publish. Writing stays local-only for now.
const PUBLISH_WRITING = false;

// Covers are shown ~140px wide; 800px on the long side stays sharp on retina screens.
const COVER_MAX_PX = 800;
const COVER_QUALITY = 85;
// Resized covers are cached here (uploads never change once written)
const COVER_CACHE_DIR = join(ROOT_DIR, 'data', 'cache', `covers-${COVER_MAX_PX}-q${COVER_QUALITY}`);

const db = openDb(ROOT_DIR);
const { renderPage, renderEntry, getPosts } = createRenderer(db, ROOT_DIR);

function finalize(html) {
  let out = html
    // No edit mode on the published site
    .replace(/\n\s*<script type="module" src="\/edit\.js"><\/script>/, '');
  if (!PUBLISH_WRITING) out = out.replace(/\n\s*<a href="\/writing"[^>]*>[^<]*<\/a>/, '');
  // Published covers are resized WebP copies of the originals
  out = out.replace(/(src="\/uploads\/[a-f0-9]+)\.(?:jpg|png|webp|gif)"/g, '$1.webp"');
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

// Only covers that are actually on a shelf, resized for the web
mkdirSync(COVER_CACHE_DIR, { recursive: true });
const images = db.prepare('SELECT image FROM items WHERE image IS NOT NULL').all();
let originalBytes = 0;
let publishedBytes = 0;
for (const { image } of images) {
  const source = join(ROOT_DIR, 'data', 'uploads', image);
  const name = image.replace(/\.\w+$/, '.webp');
  const cached = join(COVER_CACHE_DIR, name);
  if (!existsSync(cached)) {
    await sharp(source, { animated: false })
      .rotate() // respect phone photo orientation
      .resize({ width: COVER_MAX_PX, height: COVER_MAX_PX, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: COVER_QUALITY })
      .toFile(cached);
  }
  cpSync(cached, join(OUT_DIR, 'uploads', name));
  originalBytes += readFileSync(source).length;
  publishedBytes += readFileSync(cached).length;
}
const mb = (bytes) => `${(bytes / 1e6).toFixed(1)} MB`;

// Serve files as-is (no Jekyll processing)
writeFileSync(join(OUT_DIR, '.nojekyll'), '');

console.log(`Built ${pages.length} pages and ${images.length} covers into dist/ (base path "${BASE_PATH}")`);
console.log(`Covers: ${mb(originalBytes)} originals -> ${mb(publishedBytes)} published`);
