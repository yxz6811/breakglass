import { spawn } from 'node:child_process';

const PREFIX = 'data:image/jpeg;base64,';

/**
 * 把页面送来的 JPEG data URL 还原成字节。不是 JPEG 时返回 null。
 *
 * @param {unknown} value
 * @returns {Buffer | null}
 */
export function decodeJpegDataUrl(value) {
  if (typeof value !== 'string' || !value.startsWith(PREFIX)) return null;
  const payload = value.slice(PREFIX.length);
  if (!payload || !/^[A-Za-z0-9+/]+={0,2}$/.test(payload)) return null;
  const bytes = Buffer.from(payload, 'base64');
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  return bytes;
}

/**
 * 从帧头（SOF 段）读出 JPEG 的像素宽高，不解码画面。
 *
 * @param {Buffer} bytes
 * @returns {{ width: number, height: number } | null}
 */
export function jpegSize(bytes) {
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      offset += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null;
    const length = bytes.readUInt16BE(offset + 2);
    if (length < 2) return null;
    const isFrameHeader = marker >= 0xc0 && marker <= 0xcf
      && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrameHeader) {
      if (offset + 9 > bytes.length) return null;
      const height = bytes.readUInt16BE(offset + 5);
      const width = bytes.readUInt16BE(offset + 7);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    offset += 2 + length;
  }
  return null;
}

/**
 * 页面按源宽高等比缩小截帧，两个方向的比例应当一致；
 * 截帧时高度取整，所以允许 1 像素的差。
 *
 * @param {{ width: number, height: number }} image JPEG 宽高
 * @param {{ width: number, height: number }} frameSize 源尺寸
 * @returns {boolean}
 */
/**
 * 用本机 ffmpeg 把 JPEG 解成 RGB。没有 ffmpeg 或解码失败时返回 null，调用方改走锚点。
 *
 * @param {Buffer} bytes
 * @param {{ width: number, height: number }} image
 * @returns {Promise<Buffer | null>}
 */
export function decodeJpegRgb(bytes, image) {
  const expected = image.width * image.height * 3;
  return new Promise((resolve) => {
    const child = spawn('ffmpeg', ['-nostdin', '-v', 'error', '-i', 'pipe:0', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1']);
    const out = [];
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    child.stdout.on('data', (chunk) => out.push(chunk));
    child.on('error', () => finish(null));
    child.on('close', (code) => {
      const rgb = Buffer.concat(out);
      finish(code === 0 && rgb.length === expected ? rgb : null);
    });
    child.stdin.on('error', () => {});
    child.stdin.end(bytes);
  });
}

export function sameAspect(image, frameSize) {
  const expectedHeight = frameSize.height * (image.width / frameSize.width);
  return Math.abs(image.height - expectedHeight) <= 1;
}
