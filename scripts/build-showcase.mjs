// Build the original branch's standalone showcase from its editable frontend sources.
// Scope: docs/BreakGlass-constitution.md — P0 preset parabola; no backend or P1 implementation.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (file) => readFile(path.join(root, file), 'utf8');

function replaceOnce(source, needle, replacement, label) {
  const first = source.indexOf(needle);
  if (first === -1 || source.indexOf(needle, first + needle.length) !== -1) {
    throw new Error(`${label}: expected exactly one source occurrence`);
  }
  return source.slice(0, first) + replacement + source.slice(first + needle.length);
}

function inlineSvg(source, attributes, prefix = '') {
  const svg = source.trim().match(/^<svg\b([^>]*)>([\s\S]*)<\/svg>$/);
  if (!svg) throw new Error('Expected a complete SVG asset');
  let body = svg[2].replace(/\s*<(title|desc)\b[^>]*>[\s\S]*?<\/\1>/g, '');
  if (prefix) {
    const ids = [...body.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
    const names = new Map(ids.map((id) => [id, `${prefix}${id}`]));
    body = body.replace(/\bid="([^"]+)"/g, (_, id) => `id="${names.get(id)}"`);
    body = body.replace(/\b((?:xlink:)?href)="#([^"]+)"/g, (_, attribute, id) => {
      if (!names.has(id)) throw new Error(`Unknown SVG reference: #${id}`);
      return `${attribute}="#${names.get(id)}"`;
    });
    body = body.replace(/url\(#([^)]+)\)/g, (_, id) => {
      if (!names.has(id)) throw new Error(`Unknown SVG paint reference: #${id}`);
      return `url(#${names.get(id)})`;
    });
  }
  const preserved = svg[1].replace(/\s+(?:role|aria-labelledby|class|width|height)="[^"]*"/g, '');
  return `<svg${preserved} ${attributes} aria-hidden="true" focusable="false">${body}</svg>`;
}

async function inlineRuntimeScreenshots(source) {
  const allowedPaths = new Set([
    './assets/runtime/01-user-trigger.jpg',
    './assets/runtime/02-geometry-frame.jpg',
    './assets/runtime/03-preset-result.jpg',
    './assets/runtime/04-in-situ-overlay.jpg',
    './assets/runtime/05-function-branch.jpg',
  ]);
  if (/<(?:img|source)\b[^>]*\ssrcset\s*=/i.test(source)) {
    throw new Error('Standalone screenshots must not use srcset');
  }
  const imageTags = [...source.matchAll(/<img\b[^>]*>/gi)];
  const encoded = new Map();
  for (const [tag] of imageTags) {
    const attributes = [...tag.matchAll(/\ssrc\s*=\s*(["'])(.*?)\1/gi)];
    const srcCount = [...tag.matchAll(/\ssrc\s*=/gi)].length;
    if (attributes.length !== 1 || srcCount !== 1) {
      throw new Error('Standalone image requires exactly one quoted src');
    }
    const imagePath = attributes[0][2];
    if (/^data:image\/(?:jpeg|png|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(imagePath)) continue;
    if (!allowedPaths.has(imagePath)) {
      throw new Error(`Unapproved standalone image: ${imagePath}`);
    }
    if (!encoded.has(imagePath)) {
      const bytes = await readFile(path.join(root, 'site', imagePath));
      if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff ||
          bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) {
        throw new Error(`Expected complete JPEG screenshot: ${imagePath}`);
      }
      encoded.set(imagePath, `data:image/jpeg;base64,${bytes.toString('base64')}`);
    }
  }
  // Preserve each authored image's size, alternative text and loading attributes.
  return source.replace(/<img\b[^>]*>/gi, (tag) => tag.replace(
    /(\ssrc\s*=\s*)(["'])(.*?)\2/i,
    (attribute, before, quote, imagePath) => encoded.has(imagePath)
      ? `${before}${quote}${encoded.get(imagePath)}${quote}`
      : attribute,
  ));
}

let html = await read('site/showcase.html');
for (const name of ['showcase-base', 'showcase', 'showcase-effects']) {
  const css = await read(`site/${name}.css`);
  if (/<\/style\b/i.test(css)) throw new Error(`${name}.css contains a closing style tag`);
  html = replaceOnce(
    html,
    `<link rel="stylesheet" href="./${name}.css"/>`,
    `<style data-showcase-source="${name}.css">\n${css.trimEnd()}\n</style>`,
    `${name}.css link`,
  );
}
for (const name of ['showcase-compat', 'showcase-scroll-lock', 'showcase-base', 'showcase-motion', 'showcase-effects', 'showcase-demo']) {
  const script = await read(`site/${name}.js`);
  new vm.Script(script, { filename: `site/${name}.js` });
  if (/<\/script\b/i.test(script)) throw new Error(`${name}.js contains a closing script tag`);
  html = replaceOnce(
    html,
    `<script src="./${name}.js" defer></script>`,
    `<script data-showcase-source="${name}.js">\n${script.trimEnd()}\n</script>`,
    `${name}.js script`,
  );
}

html = replaceOnce(
  html,
  '<img src="./assets/breakglass-brand/logo-aperture-fracture.svg" width="32" height="32" alt=""/>',
  inlineSvg(await read('site/assets/breakglass-brand/logo-aperture-fracture.svg'), 'class="nav-logo" width="32" height="32"', 'nav-'),
  'Navigation logo',
);
html = replaceOnce(
  html,
  '<img class="brand-wordmark" src="./assets/breakglass-brand/wordmark-aperture.svg" alt="" width="640" height="104">',
  inlineSvg(await read('site/assets/breakglass-brand/wordmark-aperture.svg'), 'class="brand-wordmark" width="640" height="104"'),
  'Brand wordmark',
);
html = replaceOnce(html, 'href="../extension/demo/index.html"', 'href="./extension/demo/index.html"', 'Root demo link');
html = html.replaceAll('../docs/BreakGlass-constitution.md', 'docs/BreakGlass-constitution.md');
html = await inlineRuntimeScreenshots(html);

if (/<link\b[^>]*\brel=["']stylesheet["']/i.test(html)) throw new Error('External stylesheet remains');
if (/<script\b[^>]*\bsrc\s*=/i.test(html)) throw new Error('External script remains');
const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)];
if (scripts.length !== 6) throw new Error(`Expected six inline scripts, got ${scripts.length}`);
scripts.forEach((script, index) => new vm.Script(script[1], { filename: `展示网站:inline-${index + 1}` }));
// Hash the final inline bytes, using HTML's newline normalization before hashing.
const scriptHashes = scripts.map((script) => `'sha256-${createHash('sha256').update(script[1].replace(/\r\n?/g, '\n')).digest('base64')}'`);
html = replaceOnce(html, "script-src 'self'", `script-src ${scriptHashes.join(' ')}`, 'Standalone script policy');

const original = path.join(root, '展示网站');
const alias = path.join(root, '展示网站.html');
const entry = path.join(root, 'index.html');
await writeFile(original, html, 'utf8');
await writeFile(alias, html, 'utf8');
await writeFile(entry, html, 'utf8');
const [originalBytes, aliasBytes, entryBytes] = await Promise.all([readFile(original), readFile(alias), readFile(entry)]);
if (!originalBytes.equals(aliasBytes) || !originalBytes.equals(entryBytes)) throw new Error('Standalone entries differ');
console.log(`Built 展示网站, 展示网站.html and index.html (${originalBytes.length} bytes each; inline CSS, SVG, JPEG screenshots and ${scripts.length} syntax-checked scripts).`);
