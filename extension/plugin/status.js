const list = document.querySelector('#records');
const status = document.querySelector('#status');
async function refresh() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'plugin:list' });
    if (!response.ok) throw new Error(response.message);
    list.replaceChildren();
    for (const record of response.records) {
      const item = document.createElement('li');
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
    status.textContent = response.records.length ? `${response.records.length}条本机记录；当前仅展示快照，原视频未保存。` : '还没有本机记录。';
  } catch (error) { status.textContent = error.message || '无法读取本机记录。'; }
}
document.querySelector('#refresh').addEventListener('click', refresh);
document.querySelector('#clear').addEventListener('click', async () => {
  const response = await chrome.runtime.sendMessage({ type: 'plugin:clear' });
  if (!response.ok) { status.textContent = response.message; return; }
  await refresh();
  status.textContent = '已清除记录并使在途会话失效。';
});
void refresh();
