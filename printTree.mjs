// printTree.mjs
import { readdirSync, statSync } from 'fs';
import { join } from 'path';

const IGNORE = new Set([
  'node_modules', '.git', '.next', 'out', '.vercel', 'dist', 'build', 'coverage',
  '.DS_Store', '.turbo', '.idea', '.vscode'
]);

function tree(dir, prefix = '') {
  const entries = readdirSync(dir).filter(n => !IGNORE.has(n)).sort((a,b)=>a.localeCompare(b));
  const last = entries.length - 1;

  entries.forEach((name, i) => {
    const p = join(dir, name);
    const isDir = statSync(p).isDirectory();
    const branch = i === last ? '└─ ' : '├─ ';
    const nextPrefix = prefix + (i === last ? '   ' : '│  ');
    console.log(prefix + branch + name + (isDir ? '/' : ''));
    if (isDir) tree(p, nextPrefix);
  });
}

tree(process.cwd());