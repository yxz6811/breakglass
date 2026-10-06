import { loadSettings } from './settings.mjs';
import { loadPageRules } from './page-rules.mjs';
import { createReaderServer } from './server.mjs';

const settings = loadSettings(process.env);
const pageRules = loadPageRules(settings.extensionDir);

/**
 * 一行一条 JSON。调用方只会传编号、计数、原因代码和耗时。
 *
 * @param {object} entry
 */
function log(entry) {
  console.log(JSON.stringify({ at: new Date().toISOString(), ...entry }));
}

const server = createReaderServer({ settings, pageRules, log });
server.listen(settings.port, settings.host, () => {
  const configured = settings.models.length > 0;
  console.log(`阅读服务：http://${settings.host}:${settings.port}/read`);
  if (configured) {
    const labels = settings.models.map((item) => {
      const host = URL.canParse(item.baseUrl) ? new URL(item.baseUrl).host : '地址写错了';
      return `${item.model}（${host}）`;
    });
    console.log(`模型池：${labels.join(' → ')}`);
  } else {
    console.log('还没配置模型：READER_BASE_URL、READER_API_KEY、READER_MODEL 缺一不可。现在请求会得到 503。');
  }
});
