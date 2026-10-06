(function (root) {
  'use strict';
  function createUI({ client, document: doc = document }) {
    const get = (id) => doc.getElementById(id);
    let owner = -1; let timer = null; let disposed = false; let busy = false;
    function clear() { clearInterval(timer); timer = null; get('pairing-code').textContent = ''; }
    function update(state) {
      if (disposed) return;
      if (state.generation !== owner) {
        owner = state.generation; clear(); busy = false;
        get('pairing-status').textContent = state.user ? '生成一次性配对码后，在插件账户设置中输入。' : '先登录，再由你主动连接插件。';
      }
      ['create-pairing', 'revoke-pairings'].forEach((id) => { get(id).disabled = !state.user || busy; });
    }
    async function generate() {
      if (busy || disposed || !client.snapshot().user) return;
      busy = true; clear(); const captured = client.snapshot(); update(captured);
      try {
        const value = await client.createPluginPairing();
        if (disposed || captured.generation !== client.snapshot().generation) return;
        if (!/^[A-Za-z0-9_-]{22}$/.test(value.code) || !Number.isFinite(value.expiresAt)
          || value.user?.id !== captured.user.id) throw new Error('配对响应不属于当前账户。');
        get('pairing-code').textContent = value.code;
        const tick = () => {
          if (disposed || captured.generation !== client.snapshot().generation || Date.now() >= value.expiresAt) {
            clear(); get('pairing-status').textContent = '配对码已过期或账户已变化，请重新生成。'; return;
          }
          get('pairing-status').textContent = `仅用于 ${captured.user.username}；一次性使用，${Math.ceil((value.expiresAt - Date.now()) / 1000)} 秒后失效。不要把它保存到学习记录。`;
        };
        tick(); if (get('pairing-code').textContent) timer = setInterval(tick, 1000);
      } catch (error) { if (!disposed && captured.generation === client.snapshot().generation) get('pairing-status').textContent = error.message; }
      finally { if (!disposed && captured.generation === client.snapshot().generation) { busy = false; update(client.snapshot()); } }
    }
    async function revoke() {
      if (busy || disposed || !client.snapshot().user) return;
      busy = true; clear(); const captured = client.snapshot(); update(captured);
      try {
        await client.revokePluginPairings();
        if (!disposed && captured.generation === client.snapshot().generation) get('pairing-status').textContent = '服务已确认撤销此账户的全部插件连接与未使用配对码；插件的本机记录保留。';
      } catch (error) { if (!disposed && captured.generation === client.snapshot().generation) get('pairing-status').textContent = `撤销未确认：${error.message}`; }
      finally { if (!disposed && captured.generation === client.snapshot().generation) { busy = false; update(client.snapshot()); } }
    }
    get('create-pairing').addEventListener('click', generate); get('revoke-pairings').addEventListener('click', revoke);
    return { update, destroy() { disposed = true; clear(); get('create-pairing').removeEventListener('click', generate); get('revoke-pairings').removeEventListener('click', revoke); } };
  }
  root.BreakGlass.webPairing = { createUI };
})(globalThis);
