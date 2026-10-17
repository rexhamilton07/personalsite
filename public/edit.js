import { compareItems } from '/shelf-sort.js';

const isEditing = () => document.body.classList.contains('editing');

// Edit mode. Press Ctrl+Shift+E, enter the passcode, then click any outlined
// text to edit it. Text is stored in data/site.db, covers in data/uploads/.
const blurbs = [...document.querySelectorAll('[data-blurb]')];
const shelves = [...document.querySelectorAll('.shelf')];
const entryList = document.querySelector('.entries');
const entry = document.querySelector('.entry');
const SHELF_LABELS = { books: { noun: 'book', creator: 'Author' }, records: { noun: 'record', creator: 'Artist' } };
let toolbar;

document.addEventListener('keydown', async (e) => {
  if (!(e.ctrlKey && e.shiftKey && e.code === 'KeyE')) return;
  e.preventDefault();
  if (isEditing()) return;

  const { authed } = await fetch('/api/session').then((r) => r.json());
  if (authed) enterEditMode();
  else showLogin();
});

// Ctrl/Cmd+S saves while editing
document.addEventListener('keydown', (e) => {
  if (isEditing() && (e.metaKey || e.ctrlKey) && e.key === 's') {
    e.preventDefault();
    save();
  }
});

// After creating an entry we navigate to it; pick up edit mode on arrival
if (sessionStorage.getItem('resumeEditing')) {
  sessionStorage.removeItem('resumeEditing');
  fetch('/api/session').then((r) => r.json()).then(({ authed }) => {
    if (authed) {
      enterEditMode();
      entry?.querySelector('[data-entry-field="body"]').focus();
    }
  });
}

// While editing, links are text to edit, not places to go (tabs still switch)
document.addEventListener('click', (e) => {
  if (isEditing() && e.target.closest('a[data-blurb]:not([role="tab"])')) e.preventDefault();
}, true);

// Only paragraphs and entry bodies may contain line breaks
document.addEventListener('keydown', (e) => {
  const el = e.target;
  const multiline = el.tagName === 'P' || el.dataset.entryField === 'body';
  if (isEditing() && e.key === 'Enter' && el.isContentEditable && !multiline) e.preventDefault();
});

async function api(method, url, body, headers = { 'Content-Type': 'application/json' }) {
  const res = await fetch(url, { method, headers, body: headers['Content-Type'] === 'application/json' ? JSON.stringify(body) : body });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error);
  return data;
}

function showLogin() {
  const dialog = document.createElement('dialog');
  dialog.className = 'login';
  dialog.innerHTML = `
    <form method="dialog">
      <label for="passcode">Passcode</label>
      <input id="passcode" type="password" inputmode="numeric" autocomplete="off" required>
      <p class="login-error" aria-live="polite"></p>
    </form>`;
  document.body.append(dialog);
  dialog.addEventListener('close', () => dialog.remove());

  const form = dialog.querySelector('form');
  const error = dialog.querySelector('.login-error');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('POST', '/api/login', { passcode: form.passcode.value });
      dialog.close();
      enterEditMode();
    } catch (err) {
      error.textContent = err.message;
      form.passcode.select();
    }
  });

  dialog.showModal();
}

function makeEditable(el) {
  el.contentEditable = 'plaintext-only';
  // Firefox doesn't support plaintext-only
  if (el.contentEditable !== 'plaintext-only') el.contentEditable = 'true';
}

function enterEditMode() {
  document.body.classList.add('editing');
  blurbs.forEach(makeEditable);
  document.querySelectorAll('.shelf [data-field]').forEach(makeEditable);
  document.querySelectorAll('.shelf-item').forEach(addDeleteButton);
  shelves.forEach(addItemForm);
  if (entryList) addEntryForm();
  if (entry) {
    entry.querySelectorAll('[data-entry-field]').forEach(makeEditable);
    addEntryDeleteButton();
  }

  toolbar = document.createElement('div');
  toolbar.className = 'edit-toolbar';
  toolbar.innerHTML = `
    <span class="edit-status">Editing</span>
    <button type="button" data-action="cancel">Cancel</button>
    <button type="button" data-action="done">Done</button>`;
  document.body.append(toolbar);

  toolbar.addEventListener('click', async (e) => {
    const action = e.target.dataset.action;
    // Done saves, and stays in edit mode if the save fails
    if (action === 'done' && (await save())) {
      exitEditMode();
      shelves.forEach(sortShelf); // an edited author or artist may have moved
    }
    // Cancel discards unsaved text edits by reloading what's on the server
    if (action === 'cancel') location.reload();
  });
}

function setStatus(text) {
  toolbar.querySelector('.edit-status').textContent = text;
}

async function save() {
  const blurbUpdates = Object.fromEntries(blurbs.map((el) => [el.dataset.blurb, el.innerText.trim()]));
  const itemUpdates = Object.fromEntries(
    [...document.querySelectorAll('.shelf-item')].map((li) => [
      li.dataset.itemId,
      { title: li.querySelector('.item-title').innerText.trim(), creator: li.querySelector('.item-creator').innerText.trim() },
    ])
  );
  try {
    await api('PUT', '/api/blurbs', blurbUpdates);
    await api('PUT', '/api/items', itemUpdates);
    if (entry) {
      const field = (name) => entry.querySelector(`[data-entry-field="${name}"]`).innerText.trim();
      await api('PUT', `/api/posts/${entry.dataset.entryId}`, {
        title: field('title'),
        subtitle: field('subtitle'),
        body: field('body'),
      });
      document.title = `${field('title')} — ${document.title.split(' — ').pop()}`;
    }
    setStatus('Saved');
    return true;
  } catch (err) {
    setStatus(`Save failed: ${err.message}`);
    return false;
  }
}

function exitEditMode() {
  document.body.classList.remove('editing');
  document.querySelectorAll('[contenteditable]').forEach((el) => el.removeAttribute('contenteditable'));
  document.querySelectorAll('.edit-only').forEach((el) => el.remove());
  toolbar?.remove();
}

// --- Books & records ---------------------------------------------------------

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Keep in sync with renderItem() in db.js
function renderItem(item) {
  const li = document.createElement('li');
  li.className = 'shelf-item';
  li.dataset.itemId = item.id;
  li.innerHTML = `
    ${item.image ? `<img src="/uploads/${escapeHtml(item.image)}" alt="" loading="lazy">` : '<div class="cover-blank"></div>'}
    <span class="item-title" data-field="title">${escapeHtml(item.title)}</span>
    <span class="item-creator" data-field="creator">${escapeHtml(item.creator)}</span>`;
  return li;
}

// Same order the server renders, so new and edited items land in place
function sortShelf(shelf) {
  const fields = (li) => ({
    creator: li.querySelector('.item-creator').innerText.trim(),
    title: li.querySelector('.item-title').innerText.trim(),
  });
  const items = [...shelf.children].sort((a, b) => compareItems(shelf.dataset.shelf, fields(a), fields(b)));
  shelf.append(...items);
}

function addDeleteButton(li) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'item-delete edit-only';
  button.setAttribute('aria-label', 'Remove');
  button.textContent = '×';
  button.addEventListener('click', async () => {
    const title = li.querySelector('.item-title').innerText;
    if (!confirm(`Remove “${title}”?`)) return;
    try {
      await api('DELETE', `/api/items/${li.dataset.itemId}`);
      li.remove();
    } catch (err) {
      setStatus(`Remove failed: ${err.message}`);
    }
  });
  li.append(button);
}

function addItemForm(shelf) {
  const { noun, creator } = SHELF_LABELS[shelf.dataset.shelf];
  const form = document.createElement('form');
  form.className = 'add-item edit-only';
  form.innerHTML = `
    <p class="add-item-heading">Add a ${noun}</p>
    <label>Cover <input name="image" type="file" accept="image/jpeg,image/png,image/webp,image/gif"></label>
    <input name="title" placeholder="Title" required>
    <input name="creator" placeholder="${creator}">
    <button type="submit">Add ${noun}</button>
    <p class="add-item-error" aria-live="polite"></p>`;
  shelf.after(form);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const error = form.querySelector('.add-item-error');
    const button = form.querySelector('button');
    error.textContent = '';
    button.disabled = true;
    try {
      const file = form.elements.image.files[0];
      const { image = null } = file ? await api('POST', '/api/uploads', file, { 'Content-Type': file.type }) : {};
      const item = await api('POST', '/api/items', {
        shelf: shelf.dataset.shelf,
        title: form.elements.title.value,
        creator: form.elements.creator.value,
        image,
      });
      const li = renderItem(item);
      li.querySelectorAll('[data-field]').forEach(makeEditable);
      addDeleteButton(li);
      shelf.append(li);
      sortShelf(shelf);
      form.reset();
    } catch (err) {
      error.textContent = err.message;
    } finally {
      button.disabled = false;
    }
  });
}

// --- Writing -----------------------------------------------------------------

function addEntryForm() {
  const form = document.createElement('form');
  form.className = 'add-item edit-only';
  form.innerHTML = `
    <p class="add-item-heading">New entry</p>
    <input name="title" placeholder="Title" required>
    <input name="subtitle" placeholder="Subtitle">
    <button type="submit">Create and open</button>
    <p class="add-item-error" aria-live="polite"></p>`;
  entryList.before(form);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await save(); // keep any edits made on this page
      const post = await api('POST', '/api/posts', {
        title: form.elements.title.value,
        subtitle: form.elements.subtitle.value,
      });
      sessionStorage.setItem('resumeEditing', '1');
      location.href = `/writing/${post.slug}`;
    } catch (err) {
      form.querySelector('.add-item-error').textContent = err.message;
    }
  });
}

function addEntryDeleteButton() {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'entry-delete edit-only';
  button.textContent = 'Delete entry';
  button.addEventListener('click', async () => {
    if (!confirm('Delete this entry? This can’t be undone.')) return;
    try {
      await api('DELETE', `/api/posts/${entry.dataset.entryId}`);
      location.href = '/writing';
    } catch (err) {
      setStatus(`Delete failed: ${err.message}`);
    }
  });
  entry.append(button);
}
