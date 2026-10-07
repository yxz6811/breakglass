(function (root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BreakGlass = root.BreakGlass || {};
  root.BreakGlass.recognitionContracts = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  const VERSION = '011.1';
  const MAX_BYTES = 4 * 1024 * 1024;
  const RESPONSE_BYTES = 64 * 1024;
  const REQUEST_FIELDS = ['schemaVersion', 'requestId', 'sourceId', 'videoVersion', 'analysisVersion',
    'materialMode', 'kind', 'frameTime', 'frameSize', 'image'];
  const RESPONSE_FIELDS = ['schemaVersion', 'requestId', 'sourceId', 'videoVersion', 'analysisVersion',
    'kind', 'frameTime', 'frameSize', 'jpegSize', 'status', 'candidate', 'evidence', 'limitations'];
  const EVIDENCE_FIELDS = ['formulaBasis', 'mathStatus', 'placementStatus', 'map', 'calibrationBasis',
    'profileVersion', 'promptVersion', 'calibrationVersion'];
  const LIMITATIONS = Object.freeze(['placement_unknown', 'student_confirmation_required', 'no_numeric_basis',
    'ambiguous_object', 'unsupported_object', 'unclear_conditions', 'unverified_formula', 'independent_board_only']);
  const fail = (code) => ({ ok: false, code, message: '识别数据不符合当前有限契约。' });
  const finite = (value) => typeof value === 'number' && Number.isFinite(value);
  function exact(value, fields) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
    return Reflect.ownKeys(value).length === fields.length && fields.every((name) => {
      const entry = Object.getOwnPropertyDescriptor(value, name);
      return entry && entry.enumerable && Object.hasOwn(entry, 'value');
    });
  }
  const identity = (value, max = 128) => typeof value === 'string' && value.length <= max
    && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
  const size = (value) => exact(value, ['width', 'height']) && [value.width, value.height]
    .every((number) => Number.isSafeInteger(number) && number > 0 && number <= 4096);
  const sameSize = (left, right) => size(left) && size(right) && left.width === right.width && left.height === right.height;
  const aspect = (jpeg, frame) => size(jpeg) && size(frame)
    && Math.abs(jpeg.height - frame.height * jpeg.width / frame.width) <= 1;
  function validateMap(value) {
    return exact(value, ['ox', 'oy', 'sx', 'sy']) && [value.ox, value.oy, value.sx, value.sy]
      .every((number) => finite(number) && Math.abs(number) <= 1e6) && value.sx > 0 && value.sy > 0;
  }
  function envelope(value, expected) {
    if (value.schemaVersion !== VERSION || !identity(value.requestId)
      || !/^file-[a-f0-9]{64}$/.test(value.sourceId) || !identity(value.videoVersion, 64)
      || value.analysisVersion !== '1' || !['parabola', 'right-triangle'].includes(value.kind)
      || !finite(value.frameTime) || value.frameTime < 0 || !size(value.frameSize)) return false;
    if (!expected) return true;
    for (const field of ['schemaVersion', 'requestId', 'sourceId', 'videoVersion', 'analysisVersion', 'kind', 'frameTime']) {
      if (Object.hasOwn(expected, field) && value[field] !== expected[field]) return false;
    }
    return (!Object.hasOwn(expected, 'frameSize') || sameSize(value.frameSize, expected.frameSize))
      && (!Object.hasOwn(expected, 'duration') || (finite(expected.duration) && value.frameTime <= expected.duration));
  }
  // Headers are checked before any model call. This does not establish readable mathematical content.
  function jpegSize(image) {
    const prefix = 'data:image/jpeg;base64,';
    if (typeof image !== 'string' || image.length > MAX_BYTES || !image.startsWith(prefix)) return null;
    const encoded = image.slice(prefix.length);
    if (!encoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return null;
    let bytes;
    if (typeof Buffer !== 'undefined') {
      bytes = Buffer.from(encoded, 'base64');
      if (bytes.toString('base64') !== encoded) return null;
    } else {
      if (typeof root.atob !== 'function') return null;
      const binary = root.atob(encoded);
      if (typeof root.btoa === 'function' && root.btoa(binary) !== encoded) return null;
      bytes = Uint8Array.from(binary, (letter) => letter.charCodeAt(0));
    }
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8
      || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) return null;
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset] !== 0xff) return null;
      const marker = bytes[offset + 1];
      if (marker === 0xff) { offset += 1; continue; }
      if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd8) { offset += 2; continue; }
      if (marker === 0xd9 || marker === 0xda) return null;
      const length = bytes[offset + 2] * 256 + bytes[offset + 3];
      if (length < 2 || offset + 2 + length > bytes.length) return null;
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        if (length < 8 || offset + 9 > bytes.length) return null;
        const result = { width: bytes[offset + 7] * 256 + bytes[offset + 8],
          height: bytes[offset + 5] * 256 + bytes[offset + 6] };
        return size(result) && result.width <= 640 ? result : null;
      }
      offset += 2 + length;
    }
    return null;
  }
  function request(value, expected) {
    if (!exact(value, REQUEST_FIELDS) || !envelope(value, expected)
      || !['self-authored', 'licensed'].includes(value.materialMode)) return fail('invalid_request');
    const image = jpegSize(value.image);
    if (!image || !aspect(image, value.frameSize)) return fail('invalid_image');
    return { ok: true, value: { ...value, frameSize: { ...value.frameSize } }, jpegSize: image };
  }
  function snapshot(template, value) {
    const api = typeof require === 'function' ? require('./contracts.js') : root.BreakGlass?.pluginContracts;
    if (template === 'parabola' && (!exact(value, ['a', 'h', 'k']) || Math.abs(value.a) < 1e-6
      || ![value.a, value.h, value.k].every((number) => finite(number) && Math.abs(number) <= 1e6))) return null;
    const checked = api?.validateSnapshot(template, value);
    return checked?.ok ? checked.value : null;
  }
  function response(value, expected) {
    if (!exact(value, RESPONSE_FIELDS) || !envelope(value, expected) || !size(value.jpegSize)
      || value.jpegSize.width > 640 || !aspect(value.jpegSize, value.frameSize)
      || (typeof expected?.image === 'string' && !sameSize(value.jpegSize, jpegSize(expected.image)))
      || !['candidate', 'insufficient', 'unsupported'].includes(value.status)) return fail('invalid_response');
    const evidence = value.evidence;
    if (!exact(evidence, EVIDENCE_FIELDS)
      || !['visible-equation', 'visible-lengths', 'none'].includes(evidence.formulaBasis)
      || !['candidate', 'consistent', 'insufficient'].includes(evidence.mathStatus)
      || !['unknown', 'checked'].includes(evidence.placementStatus)
      || !['none', 'authored-reference'].includes(evidence.calibrationBasis)
      || !['profileVersion', 'promptVersion', 'calibrationVersion'].every((field) => identity(evidence[field], 64)))
      return fail('invalid_evidence');
    if (evidence.placementStatus === 'unknown' && (evidence.map !== null || evidence.calibrationBasis !== 'none'))
      return fail('invalid_evidence');
    if (evidence.placementStatus === 'checked' && (value.kind !== 'parabola' || !validateMap(evidence.map)
      || evidence.calibrationBasis !== 'authored-reference' || evidence.mathStatus !== 'consistent')) return fail('invalid_evidence');
    if (!Array.isArray(value.limitations) || Object.getPrototypeOf(value.limitations) !== Array.prototype
      || value.limitations.length > 8 || Reflect.ownKeys(value.limitations).length !== value.limitations.length + 1)
      return fail('invalid_limitations');
    const seen = new Set();
    for (let index = 0; index < value.limitations.length; index += 1) {
      const entry = Object.getOwnPropertyDescriptor(value.limitations, String(index));
      if (!entry || !entry.enumerable || !Object.hasOwn(entry, 'value') || !LIMITATIONS.includes(entry.value)
        || seen.has(entry.value)) return fail('invalid_limitations');
      seen.add(entry.value);
    }
    let candidate = null;
    if (value.status === 'candidate') {
      if (!exact(value.candidate, ['template', 'snapshot']) || value.candidate.template !== value.kind
        || evidence.mathStatus === 'insufficient'
        || evidence.formulaBasis !== (value.kind === 'parabola' ? 'visible-equation' : 'visible-lengths')) return fail('invalid_candidate');
      const checked = snapshot(value.kind, value.candidate.snapshot);
      if (!checked) return fail('invalid_candidate');
      candidate = { template: value.kind, snapshot: checked };
    } else if (value.candidate !== null || evidence.formulaBasis !== 'none' || evidence.mathStatus !== 'insufficient'
      || evidence.placementStatus !== 'unknown') return fail('invalid_candidate');
    return { ok: true, value: { ...value, frameSize: { ...value.frameSize }, jpegSize: { ...value.jpegSize },
      candidate, evidence: { ...evidence, map: evidence.map === null ? null : { ...evidence.map } }, limitations: [...seen] } };
  }
  const guarded = (fn) => (...args) => { try { return fn(...args); } catch (_) { return fail('invalid_data'); } };
  return { VERSION, MAX_BYTES, RESPONSE_BYTES, LIMITATIONS, validateMap: (value) => {
    try { return validateMap(value); } catch (_) { return false; }
  }, validateRecognitionRequest: guarded(request), validateRecognitionResponse: guarded(response) };
});
