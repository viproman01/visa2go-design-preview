import {cp, mkdir, readdir, lstat, writeFile, rm} from 'node:fs/promises';
import {resolve, join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, '..');
const output = join(here, 'dist', 'public');
// This fixed ignored directory contains only this script's rebuildable output.
await rm(output, {recursive: true, force: true});
await mkdir(output, {recursive: true});
// Only public assets enter the host bundle; backend source, local databases,
// secrets, tests and repository metadata cannot become public by accident.
const files = await readdir(root);
for (const name of files) {
  if (/^(?:index|admin|privacy|terms|credits)\.html$/.test(name) || /^(?:app|admin|core|train-windows)\.(?:m?js)$/.test(name) || /^[a-z-]+\.css$/.test(name) || ['version.json', 'favicon.ico', 'favicon.svg'].includes(name)) {
    if ((await lstat(join(root, name))).isFile()) await cp(join(root, name), join(output, name));
  }
}
for (const name of ['assets', 'config']) {
  try {
    await cp(join(root, name), join(output, name), {recursive: true, filter: async path => !(await lstat(path)).isSymbolicLink() && !path.split('/').some(part => part.startsWith('.'))});
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim();
await writeFile(join(here, 'dist', 'build.json'), JSON.stringify({sourceSha, builtAt: new Date().toISOString()}, null, 2));
console.log(`Public assets prepared. Source commit: ${sourceSha}`);
