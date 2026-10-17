# personalsite
Repo for my personal website

## Running locally

Requires Node 20+. No dependencies to install.

```sh
npm run dev    # auto-restarts on server changes
npm start      # plain start
```

Then open http://localhost:3000. Site content lives in `public/`.

## Editing content

Page text lives in `data/site.db` (SQLite, table `blurbs`). Any element with a
`data-blurb="key"` attribute is filled from the database when the page is served;
new keys are seeded from the HTML on server start.

To edit on the site: press **Ctrl+Shift+E**, enter the passcode (`EDIT_PASSCODE`
in `.env`; see `.env.example`), click any outlined text, then **Done** to save.

Books and records on the Living Room page are stored in the `items` table, with
cover images in `data/uploads/`. In edit mode each shelf gets an "Add" form, and
each item gets a × button to remove it.

Writing entries are stored in the `posts` table and served at `/writing/<slug>`
(rendered from `templates/entry.html`). In edit mode the Writing page has a
"New entry" form; it creates the entry and opens it so you can write the text.
Ctrl/Cmd+S saves while editing; **Done** saves and exits, **Cancel** discards unsaved edits.

## Publishing

The public site is a static, read-only copy hosted on GitHub Pages at
https://rexhamilton07.github.io/personalsite/.

```sh
npm run publish   # builds into dist/ and force-pushes it to the gh-pages branch
npm run build     # just build into dist/
```

Edit mode isn't included in the published site, and the Writing section is
held back until `PUBLISH_WRITING` is set to `true` in `build.js`.

`data/` (the database and uploaded covers) is gitignored because it holds
unpublished drafts, so **back it up yourself** — git does not have a copy.
