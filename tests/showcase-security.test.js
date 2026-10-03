const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

// Inspect the shipped frontend documents, within docs/BreakGlass-constitution.md.
// Hash authorization is checked here; browser enforcement is verified separately.
const root = path.join(__dirname, '..');
const entries = ['展示网站', '展示网站.html', 'index.html'];
const documents = entries.map(name => ({
  name,
  bytes: fs.readFileSync(path.join(root, name))
}));
const source = fs.readFileSync(path.join(root, 'site/showcase.html'), 'utf8');

function policyOf(html) {
  const tags = [...html.matchAll(/<meta\b[^>]*http-equiv="Content-Security-Policy"[^>]*>/gi)];
  assert.equal(tags.length, 1, 'exactly one enforcing CSP is required');
  const value = tags[0][0].match(/\bcontent="([^"]*)"/i);
  assert.ok(value, 'CSP must have a policy value');
  const directives = new Map();
  for (const part of value[1].split(';')) {
    const [name, ...tokens] = part.trim().split(/\s+/);
    if (!name) continue;
    assert.ok(!directives.has(name), `duplicate directive: ${name}`);
    directives.set(name, tokens);
  }
  return { index: tags[0].index, directives };
}

function inlineScripts(html) {
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)];
  scripts.forEach(script => assert.doesNotMatch(script[1], /\bsrc\s*=/i));
  return scripts.map(script => script[2]);
}

function hashForBrowser(text) {
  // The HTML parser normalizes CRLF and CR before checking inline script hashes.
  const normalized = text.replace(/\r\n?/g, '\n');
  return `'sha256-${createHash('sha256').update(normalized, 'utf8').digest('base64')}'`;
}

test('all standalone entry points ship identical protected document bytes', () => {
  documents.slice(1).forEach(document => {
    assert.ok(documents[0].bytes.equals(document.bytes), `${document.name} differs`);
  });
});

for (const document of documents) {
  test(`${document.name}: only the six shipped inline scripts are authorized`, () => {
    const html = document.bytes.toString('utf8');
    const scripts = inlineScripts(html);
    const whitelist = policyOf(html).directives.get('script-src');
    assert.equal(scripts.length, 6);
    assert.equal(whitelist.length, 6);
    assert.equal(new Set(whitelist).size, 6);
    whitelist.forEach(token => assert.match(token, /^'sha256-[A-Za-z0-9+/]{43}='$/));
    assert.deepEqual([...whitelist].sort(), scripts.map(hashForBrowser).sort());
    assert.ok(!whitelist.some(token => ["'self'", "'unsafe-inline'", "'unsafe-eval'", '*'].includes(token)));
  });
}

test('a modified or newly injected script has no hash authorization', () => {
  const html = documents[0].bytes.toString('utf8');
  const scripts = inlineScripts(html);
  const whitelist = new Set(policyOf(html).directives.get('script-src'));
  for (const script of scripts) {
    assert.ok(!whitelist.has(hashForBrowser(`${script}\nwindow.untrusted = true;`)));
  }
  assert.ok(!whitelist.has(hashForBrowser('window.untrusted = true;')));
});

test('line-ending conversion preserves browser script authorization', () => {
  const html = documents[0].bytes.toString('utf8');
  const whitelist = new Set(policyOf(html).directives.get('script-src'));
  for (const script of inlineScripts(html)) {
    const lf = script.replace(/\r\n?/g, '\n');
    assert.ok(whitelist.has(hashForBrowser(lf)));
    assert.ok(whitelist.has(hashForBrowser(lf.replace(/\n/g, '\r\n'))));
  }
});

test('source and built pages apply CSP and referrer protection before resources', () => {
  for (const html of [source, ...documents.map(document => document.bytes.toString('utf8'))]) {
    const { index, directives } = policyOf(html);
    const resource = html.search(/<(?:script|style|link|img|iframe|object|embed)\b/i);
    assert.ok(resource > index, 'CSP must be parsed before any resource');
    const referrer = html.match(/<meta\b[^>]*\bname="referrer"\s+content="no-referrer"\s*\/?\s*>/i);
    assert.ok(referrer, 'navigation must omit the referring page URL');
    assert.ok(referrer.index < resource);
    for (const name of ['default-src', 'connect-src', 'object-src', 'base-uri', 'form-action', 'frame-src', 'worker-src', 'media-src', 'script-src-attr']) {
      assert.deepEqual(directives.get(name), ["'none'"], `${name} must stay restricted`);
    }
    assert.deepEqual(directives.get('style-src'), ["'self'", "'unsafe-inline'"], 'authored styles and motion updates remain allowed');
    assert.ok(!directives.has('frame-ancestors'), 'frame-ancestors must not be falsely advertised through meta');
    assert.doesNotMatch(html, /<meta\b[^>]*http-equiv="(?:X-Frame-Options|Strict-Transport-Security|X-Content-Type-Options)"/i);
  }
  assert.deepEqual(policyOf(source).directives.get('script-src'), ["'self'"]);
});
