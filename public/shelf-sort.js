// Shelf ordering, shared by the server (server.js) and the browser (edit.js).
// Records sort by artist, ignoring a leading "The". Books sort by the first
// author's last name. Items without a creator go at the end; ties sort by title.

const SUFFIXES = /^(jr|sr|ii|iii|iv|phd|md)\.?$/i;
const PARTICLES = /^(le|la|de|del|della|des|du|da|di|van|von|der|den|st\.?)$/i;

function authorLastName(creator) {
  const first = creator.split(/\s+(?:and|&)\s+|;/i)[0].trim();
  const [beforeComma, afterComma] = first.split(',', 2).map((p) => p.trim());
  if (afterComma && !SUFFIXES.test(afterComma)) return beforeComma; // "Tolkien, J.R.R."
  const words = first.replace(/,/g, ' ').split(/\s+/).filter((w) => w && !SUFFIXES.test(w));
  // Keep name particles with the surname: "Le Guin", "de Beauvoir", "van Gogh"
  let start = words.length - 1;
  while (start > 0 && PARTICLES.test(words[start - 1])) start--;
  return words.slice(start).join(' ');
}

function artistName(creator) {
  return creator.replace(/^the\s+/i, '');
}

export function shelfSortKey(shelf, creator) {
  const name = shelf === 'books' ? authorLastName(creator.trim()) : artistName(creator.trim());
  return name.toLowerCase();
}

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

export function compareItems(shelf, a, b) {
  const ka = shelfSortKey(shelf, a.creator);
  const kb = shelfSortKey(shelf, b.creator);
  if (!ka !== !kb) return ka ? -1 : 1; // no creator: last
  return collator.compare(ka, kb) || collator.compare(a.creator, b.creator) || collator.compare(a.title, b.title);
}
