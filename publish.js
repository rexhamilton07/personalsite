// Builds the site and pushes dist/ to the gh-pages branch, which GitHub Pages serves.
// gh-pages only ever holds the latest build, so it's force-pushed each time.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT_DIR = fileURLToPath(new URL('.', import.meta.url));
const OUT_DIR = join(ROOT_DIR, 'dist');
const run = (cmd, args, cwd = ROOT_DIR) => execFileSync(cmd, args, { cwd, stdio: 'inherit' });
const output = (cmd, args) => execFileSync(cmd, args, { cwd: ROOT_DIR, encoding: 'utf8' }).trim();

run('node', ['build.js']);

const remote = output('git', ['remote', 'get-url', 'origin']);
run('git', ['init', '--quiet', '--initial-branch=gh-pages'], OUT_DIR);
run('git', ['add', '--all'], OUT_DIR);
run('git', ['commit', '--quiet', '--message', `Publish ${new Date().toISOString()}`], OUT_DIR);
run('git', ['push', '--force', '--quiet', remote, 'gh-pages'], OUT_DIR);

console.log('Published. GitHub Pages usually updates within a minute.');
