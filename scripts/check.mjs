// 无第三方依赖的工程检查。与 node --test 分开运行，便于定位语法或资源问题。
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const folders = ['extension', 'site', 'prototypes', 'tests', 'breakglass-reader', 'breakglass-learning', 'scripts', 'learning-lab', 'learning-site'];
const files = [];
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full);
    else files.push(full);
  }
}
folders.forEach((folder) => walk(path.join(root, folder)));
let scripts = 0;
let references = 0;
const failures = [];
function reference(file, url) {
  if (!url || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(url)) return;
  references += 1;
  const [target] = url.split(/[?#]/);
  if (!target) return;
  let decoded;
  try { decoded = decodeURIComponent(target); } catch { failures.push(`${file}: malformed URL ${url}`); return; }
  const resolved = target.startsWith('/') ? path.join(root, decoded) : path.resolve(path.dirname(file), decoded);
  if (!fs.existsSync(resolved)) failures.push(`${path.relative(root, file)}: missing ${url}`);
}
for (const file of files) {
  if (/\.(?:m?js)$/.test(file)) {
    scripts += 1;
    const checked = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (checked.status !== 0) failures.push(checked.stderr || checked.error?.message || `Syntax failed: ${file}`);
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/\b(?:import|export)\s+(?:[^;'"\n]*?\s+from\s+)?['"](\.[^'"]+)['"]/g)) reference(file, match[1]);
  }
  if (/\.html$/.test(file)) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/\b(?:src|href)\s*=\s*['"]([^'"]+)['"]/gi)) reference(file, match[1]);
    for (const match of source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      if (/\bsrc\s*=/.test(match[1]) || /type\s*=\s*['"](?:application\/ld\+json|application\/json)['"]/.test(match[1])) continue;
      try { new vm.Script(match[2], { filename: file }); } catch (error) { failures.push(error.message); }
    }
  }
}
if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Syntax: ${scripts} JS/MJS files passed; local references: ${references} passed; inline scripts passed.`);
}
