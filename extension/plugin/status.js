const list = document.querySelector('#records');
const status = document.querySelector('#status');
const accountStatus = document.querySelector('#account-status');
const scope = document.querySelector('#record-scope');
const selected = new Set();
let viewEpoch = 0;
async function message(type, rest = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...rest });
  if (!response.ok) throw new Error(response.message || '操作失败。');
  return response;
}
async function accountRefresh() {
  try {
    const response = await message('plugin:account:state');
    accountStatus.textContent = (response.paired ? '当前配对账号：' + response.user.username + '。' : '尚未配对当前网站账号。')
      + '待同步记录 ' + response.queued + ' 条。' + (response.retryRequired ? '需显式重试。' : '') + (response.message || '');
    if (!response.paired && scope.value === 'account') {
      viewEpoch += 1; list.replaceChildren(); selected.clear(); status.textContent = '配对已失效；重新配对并核对账号后查看记录。';
    }
    document.querySelector('#sync-enabled').checked = response.enabled;
    document.querySelector('#sync-enabled').disabled = !response.paired;
    document.querySelector('#disconnect').disabled = !response.paired && !response.queued;
    document.querySelector('#retry-sync').disabled = !response.paired || !response.queued;
    document.querySelector('#import-selected').disabled = !response.paired || scope.value !== 'local';
  } catch (error) { accountStatus.textContent = error.message; }
}
async function refresh() {
  const owner = ++viewEpoch;
  selected.clear();
  try {
    const account = scope.value === 'account';
    const response = await message(account ? 'plugin:account:list' : 'plugin:list');
    if (owner !== viewEpoch) return;
    list.replaceChildren();
    for (const record of response.records) {
      const item = document.createElement('li');
      if (!account) {
        const label = document.createElement('label'); label.className = 'check';
        const checkbox = document.createElement('input'); checkbox.type = 'checkbox';
        checkbox.setAttribute('aria-label', '审核并选择：' + record.title);
        checkbox.addEventListener('change', () => checkbox.checked ? selected.add(record.id) : selected.delete(record.id));
        label.append(checkbox, '选择导入'); item.append(label);
      }
      const title = document.createElement('strong');
      title.textContent = `${record.kind === 'question' ? '我的疑问' : '个人易错标记'} · ${record.title}`;
      const note = document.createElement('p'); note.textContent = record.note || '未添加文字笔记。';
      const source = document.createElement('p');
      source.textContent = `${record.source.title || record.source.id} · 第${record.time.toFixed(1)}秒 · ${record.sourceLabel}`;
      const scene = document.createElement('p');
      scene.textContent = record.template === 'parabola'
        ? `结构快照：y = ${record.snapshot.a}(x − ${record.snapshot.h})² + ${record.snapshot.k}`
        : `结构快照：AB=${record.snapshot.AB}，AC=${record.snapshot.AC}，单位=${record.snapshot.unit}；BC由程序计算。`;
      item.append(title, note, source, scene); list.append(item);
    }
    status.textContent = response.records.length ? `${response.records.length}条${account ? '当前账号' : '本机'}记录；当前仅展示快照，原视频未保存。` : `还没有${account ? '当前账号' : '本机'}记录。`;
  } catch (error) { if (owner === viewEpoch) { list.replaceChildren(); status.textContent = error.message || '无法读取记录。'; } }
  await accountRefresh();
}
document.querySelector('#refresh').addEventListener('click', refresh);
scope.addEventListener('change', refresh);
document.querySelector('#pair-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const button = event.submitter; button.disabled = true;
  const input = document.querySelector('#pair-code');
  const code = input.value.trim(); input.value = '';
  viewEpoch += 1; list.replaceChildren(); selected.clear();
  try { await message('plugin:account:connect', { code, enabled: document.querySelector('#pair-enabled').checked }); await refresh(); }
  catch (error) { await accountRefresh(); accountStatus.textContent += ' ' + error.message; }
  finally { button.disabled = false; }
});
document.querySelector('#sync-enabled').addEventListener('change', async (event) => {
  event.target.disabled = true;
  try { await message('plugin:account:enable', { enabled: event.target.checked }); await accountRefresh(); }
  catch (error) { accountStatus.textContent = error.message; event.target.checked = !event.target.checked; event.target.disabled = false; }
});
document.querySelector('#account-refresh').addEventListener('click', async () => {
  try { await message('plugin:account:list'); await accountRefresh(); }
  catch (error) { await accountRefresh(); accountStatus.textContent += ' ' + error.message; }
});
document.querySelector('#retry-sync').addEventListener('click', async (event) => {
  event.target.disabled = true;
  try { await message('plugin:account:retry'); await accountRefresh(); }
  catch (error) { await accountRefresh(); accountStatus.textContent += ' ' + error.message; }
});
document.querySelector('#disconnect').addEventListener('click', async () => {
  try { await message('plugin:account:disconnect'); scope.value = 'local'; await refresh(); }
  catch (error) { accountStatus.textContent = error.message; }
});
document.querySelector('#import-selected').addEventListener('click', async (event) => {
  if (!selected.size) { status.textContent = '请先逐条审核并勾选本机记录。'; return; }
  event.target.disabled = true;
  try { const response = await message('plugin:account:import', { ids: [...selected] });
    status.textContent = response.syncStatus === 'confirmed' ? '所选记录已由当前账号确认；未来自动同步设置保持原值。' : '尚未全部确认，请查看待同步状态。';
    selected.clear(); list.querySelectorAll('input[type=checkbox]').forEach((input) => { input.checked = false; });
    await accountRefresh();
  } catch (error) { status.textContent = error.message; await accountRefresh(); }
});
document.querySelector('#export').addEventListener('click', async () => {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'plugin:list' });
    if (!response.ok) throw new Error(response.message);
    const payload = { schemaVersion: '1', origin: 'breakglass-plugin',
      aiGeneratedContentPresent: response.records.some((record) => record.origin === 'vision'), records: response.records };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    if (blob.size > 256 * 1024) throw new Error('导出包超过网站导入上限256KiB，请减少记录后再导出。');
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'breakglass-plugin-records.json';
    document.body.append(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status.textContent = '已导出最小数学记录；不包含截图、原视频或密钥。网站导入需要另外审核确认。';
  } catch (error) { status.textContent = error.message || '导出失败，请重试。'; }
});
document.querySelector('#clear').addEventListener('click', async () => {
  const response = await chrome.runtime.sendMessage({ type: 'plugin:clear' });
  if (!response.ok) { status.textContent = response.message; return; }
  await refresh();
  status.textContent = '已清除本机记录和待同步队列，并停止在途视觉会话；账号已确认记录保留。';
});
void refresh();
