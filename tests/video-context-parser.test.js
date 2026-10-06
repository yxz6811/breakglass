const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const api = require('../extension/src/plugin/video-context');

test('author VTT and SRT are parsed with actual text and exact seconds, including UTF8/BOM/CRLF', () => {
  const author = fs.readFileSync(path.join(__dirname, '../extension/assets/video/geometry/triangle-3-4-5.zh.vtt'), 'utf8');
  const vtt = api.parseTextCues(author);
  assert.equal(vtt.ok, true); assert.equal(vtt.format, 'vtt'); assert.equal(vtt.cues.length, 3);
  assert.deepEqual(vtt.cues.map(({ start, end }) => [start, end]), [[0, 4], [4.001, 8], [8.001, 12]]);
  assert.match(vtt.cues[0].text, /作者提供/);
  const srt = api.parseTextCues('\uFEFF1\r\n00:00:01,250 --> 00:00:03,500\r\n直角与边\r\n另一行\r\n', { format: 'srt' });
  assert.deepEqual(srt, { ok: true, format: 'srt', cues: [{ start: 1.25, end: 3.5, text: '直角与边\n另一行' }] });
});

test('parser fails closed for byte/count limits, invalid timestamp grammar, ordering, controls, URLs and markup', () => {
  const cases = ['WEBVTT\n\n00:00.000 --> 00:01.000\nx\u0000',
    'WEBVTT\n\n00:60.000 --> 01:01.000\nx', 'WEBVTT\n\n00:01.000 --> 00:01.000\nx',
    'WEBVTT\n\n00:00.000 --> 10:00.001\nx', 'WEBVTT\n\n00:01.000 --> 00:02.000\nx\n\n00:00.000 --> 00:01.000\ny',
    'WEBVTT\n\n00:00.000 --> 00:01.000 align:center\nx',
    'WEBVTT\n\n00:00.000 --> 00:01.000\nhttps://example.invalid',
    'WEBVTT\n\n00:00.000 --> 00:01.000\n<script>fetch(secret)</script>',
    'WEBVTT\n\n00:00.000 --> 00:01.000\n' + 'x'.repeat(501),
    '1\n00:00.000 --> 00:01.000\nx', 'WEBVTT\n\nSTYLE\n::cue { color:red; }', '中'.repeat(22000)];
  for (const text of cases) assert.equal(api.parseTextCues(text).ok, false);
  assert.equal(api.parseTextCues('WEBVTT\n', { format: 'srt' }).ok, false);
  assert.deepEqual(api.parseTextCues('WEBVTT\n').cues, []);
});

test('window selection applies explicit bounded offset, preserves partial overlap and rejects overflow rather than truncating', () => {
  const cues = [{ start: 1, end: 4, text: '第一段' }, { start: 5, end: 8, text: '第二段' }];
  assert.deepEqual(api.selectCueWindow(cues, 3, 5), { ok: true, cues });
  assert.deepEqual(api.selectCueWindow(cues, 6.1, 7, 2), { ok: true, cues: [{ start: 7, end: 10, text: '第二段' }] });
  assert.equal(api.selectCueWindow(cues, 0, 31).ok, false);
  assert.equal(api.selectCueWindow(cues, 0, 2, -2).code, 'invalid_offset');
  assert.equal(api.selectCueWindow(cues, 0, 1, 31).ok, false);
  const crowded = Array.from({ length: 13 }, (_, index) => ({ start: index, end: index + 0.5, text: '片段' }));
  assert.equal(api.selectCueWindow(crowded, 0, 13).code, 'context_limit');
});

test('sampling is evenly spaced, finite, ordered and bounded to the requested short window', () => {
  assert.deepEqual(api.samplingTimes(2, 8), { ok: true, times: [2, 4, 6, 8] });
  assert.deepEqual(api.samplingTimes(2, 2), { ok: true, times: [2] });
  for (const values of [[0, 31, 4], [-1, 1, 4], [1, 0, 4], [0, Infinity, 4], [0, 1, 9], [0, 1, 1.5]]) {
    assert.equal(api.samplingTimes(...values).ok, false);
  }
});
