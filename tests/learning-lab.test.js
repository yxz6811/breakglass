const test = require('node:test');
const assert = require('node:assert/strict');
test('controlled media server rejects decoded traversal/private files and supports video ranges', async () => {
  const { createLabServer } = await import('../scripts/learning-lab.mjs');
  const server = createLabServer(); await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const url of ['/breakglass-reader/.env.example', '/extension/assets/video/..%2f..%2f..%2fbreakglass-reader/.env.example', '/learning-lab/..%5cbreakglass-reader/.env.example']) {
      assert.equal((await fetch(origin + url)).status, 404);
    }
    assert.equal((await fetch(origin + '/learning-lab/lesson.html')).status, 200);
    const response = await fetch(origin + '/extension/assets/video/geometry/triangle-3-4-5.mp4', { headers: { range: 'bytes=0-15' } });
    assert.equal(response.status, 206); assert.equal((await response.arrayBuffer()).byteLength, 16);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
