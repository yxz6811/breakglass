const test = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { MAX_BYTES, validateFile, validateMetadata, createImporter } = require('../learning-site/import');
class Video {
  constructor() { this.listeners = new Map(); this.duration = 12; this.videoWidth = 640; this.videoHeight = 360; this.src = ''; }
  addEventListener(type, fn) { const set = this.listeners.get(type) || new Set(); set.add(fn); this.listeners.set(type, set); }
  removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
  removeAttribute() { this.src = ''; } pause() {} load() {}
  dispatch(type) { for (const fn of [...(this.listeners.get(type) || [])]) fn(); }
}
test('actual format/size/duration/dimensions have explicit first-version bounds', () => {
  assert.equal(validateFile({ size: MAX_BYTES, name: 'lesson.mp4', type: 'video/mp4' }), true);
  assert.throws(() => validateFile({ size: MAX_BYTES + 1, name: 'lesson.mp4', type: 'video/mp4' }), /64MiB/);
  assert.throws(() => validateFile({ size: 1, name: 'lesson.mp3', type: 'audio/mpeg' }), /MP4/);
  assert.throws(() => validateMetadata({ duration: 601, width: 640, height: 360 }), /600/);
  assert.throws(() => validateMetadata({ duration: 10, width: 1921, height: 1080 }), /1920/);
});
test('cancel/source switch revokes old URLs; full SHA binds identity and repeated same File hashes once', async () => {
  const video = new Video(); const revoked = []; let urls = 0; let reads = 0;
  const url = { createObjectURL: () => `blob:local-${++urls}`, revokeObjectURL: (value) => revoked.push(value) };
  const file = { name: 'lesson.mp4', size: 3, type: 'video/mp4', arrayBuffer: async () => { reads += 1; return new Uint8Array([1, 2, 3]).buffer; } };
  const importer = createImporter({ video, url, subtle: webcrypto.subtle });
  const first = importer.choose(file); video.dispatch('loadedmetadata'); const selected = await first;
  assert.match(selected.source.id, /^file-[a-f0-9]{64}$/); assert.equal(selected.source.materialMode, 'permission-pending');
  const second = importer.choose(file); video.dispatch('loadedmetadata'); assert.equal((await second).source.id, selected.source.id);
  assert.equal(reads, 1); assert.deepEqual(revoked, ['blob:local-1']);
  const cancelled = importer.choose(file); importer.reset(); assert.equal(await cancelled, null);
  assert.ok(revoked.includes('blob:local-3')); assert.equal(importer.current(), null);
});
test('decoding failures release media and do not become ready or claim cloud upload', async () => {
  const video = new Video(); const statuses = []; let revoked = false;
  const importer = createImporter({ video, url: { createObjectURL: () => 'blob:bad', revokeObjectURL: () => { revoked = true; } }, subtle: webcrypto.subtle, onChange: (value) => statuses.push(value) });
  const failing = importer.choose({ name: 'bad.webm', size: 3, type: 'video/webm', arrayBuffer: async () => new ArrayBuffer(3) });
  video.dispatch('error'); await assert.rejects(failing, /无法解码/);
  assert.equal(revoked, true); assert.equal(statuses.some((item) => item.state === 'ready'), false);
});

test('only exact packaged parabola bytes retain the original high resolution without granting AI permission', async () => {
  const bytes = fs.readFileSync(path.join(__dirname, '../extension/assets/video/breakglass-demo-9s.mp4'));
  async function choose(content, dimensions = {}) {
    const video = new Video(); Object.assign(video, { duration: 9.383333, videoWidth: 3024, videoHeight: 1898 }, dimensions);
    const statuses = []; const revoked = [];
    const importer = createImporter({ video, url: { createObjectURL: () => 'blob:fixture', revokeObjectURL: (value) => revoked.push(value) }, subtle: webcrypto.subtle, onChange: (value) => statuses.push(value) });
    const file = { name: 'breakglass-demo-9s.mp4', type: 'video/mp4', size: content.length,
      arrayBuffer: async () => content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength) };
    const pending = importer.choose(file); video.dispatch('loadedmetadata');
    return { pending, importer, statuses, revoked, video };
  }
  const valid = await choose(bytes); const selected = await valid.pending;
  assert.equal(selected.source.id, 'file-10cdba752936a87778e5c82635ef0afbef2ff4071080251cf272ce8810a911f1');
  assert.equal(selected.width, 3024); assert.equal(selected.height, 1898);
  assert.equal(selected.source.materialMode, 'permission-pending');
  assert.equal(valid.statuses.filter((item) => item.state === 'ready').length, 1);
  // The file name alone is insufficient; altered bytes cannot receive the exception.
  const impostor = await choose(Buffer.concat([bytes, Buffer.from([0])]));
  await assert.rejects(impostor.pending, /1920/); assert.equal(impostor.importer.current(), null);
  assert.equal(impostor.statuses.some((item) => item.state === 'ready'), false); assert.deepEqual(impostor.revoked, ['blob:fixture']);
  const wrongSize = await choose(bytes, { videoWidth: 3025 }); await assert.rejects(wrongSize.pending, /1920/);
  const tooLong = await choose(bytes, { duration: 11 }); await assert.rejects(tooLong.pending, /1920/);
  assert.throws(() => validateMetadata({ duration: 9.383333, width: 3024, height: 1898 }), /1920/);
});
