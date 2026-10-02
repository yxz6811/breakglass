import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/**
 * 载入扩展自己的 reading.js。服务回点前用页面同一套规则自检，
 * 避免两边各写一份校验、日后对不上。
 *
 * @param {string} extensionDir BreakGlass 扩展目录
 * @returns {{ validateLessonReading: Function, sampleTimes: Function }}
 */
export function loadPageRules(extensionDir) {
  const file = path.join(extensionDir, 'src', 'lesson', 'reading.js');
  if (!fs.existsSync(file)) {
    throw new Error(`找不到 ${file}。用 BREAKGLASS_EXTENSION_DIR 指向 BreakGlass 的 extension 目录。`);
  }
  const rules = require(file);
  if (!rules || typeof rules.validateLessonReading !== 'function') {
    throw new Error(`${file} 里没有 validateLessonReading。`);
  }
  return rules;
}
