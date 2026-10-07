import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createDemoWorkspaceServer } from './demo-workspace.mjs';
import { createLearningSiteServer } from './learning-site.mjs';
import { loadSettings } from '../breakglass-reader/src/settings.mjs';

// Test factories only. Production CLI targets/origins are never reconfigured.
export async function createWorkspaceIntegrationFixture({ port = 0 } = {}) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'breakglass-workspace-integration-'));
  const upstreams = [];
  const servers = [];
  let origin;
  const listen = async (server, selectedPort = 0) => {
    servers.push(server);
    server.listen(selectedPort, '127.0.0.1');
    await once(server, 'listening');
    return server.address().port;
  };
  const close = async () => {
    for (const server of [...servers].reverse()) {
      server.closeAllConnections();
      if (server.listening) await new Promise((resolve) => server.close(resolve));
    }
    const absolute = path.resolve(dataDir);
    assert.equal(path.dirname(absolute), path.resolve(os.tmpdir()));
    assert.ok(path.basename(absolute).startsWith('breakglass-workspace-integration-'));
    await fs.rm(absolute, { recursive: true, force: true });
  };
  try {
    const reader = http.createServer((request, response) => {
      response.writeHead(503, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ code: 'unconfigured_test_reader', error: '隔离验收不连接真实模型。' }));
    });
    const readerPort = await listen(reader);
    let gatewayPort;
    const workspace = createDemoWorkspaceServer({ env: {}, publicOrigin: () => origin,
      httpRequest: (options, callback) => {
        assert.equal(options.hostname, '127.0.0.1');
        assert.ok([4174, 8787].includes(options.port));
        upstreams.push({ method: options.method, path: options.path, targetPort: options.port });
        return http.request({ ...options, port: options.port === 4174 ? gatewayPort : readerPort }, callback);
      } });
    const workspacePort = await listen(workspace, port);
    origin = `http://127.0.0.1:${workspacePort}`;
    const gateway = createLearningSiteServer({ settings: loadSettings({}), allowedOrigins: [origin], dataDir,
      fetchImpl: async () => { throw new Error('Isolated regression must never call a model supplier.'); } });
    gatewayPort = await listen(gateway);
    return { origin, workspace, gateway, dataDir, upstreams, close };
  } catch (error) { await close(); throw error; }
}

export function createIntegrationClient(origin) {
  let cookie = '';
  let csrf = '';
  let epoch = 0;
  const send = async (method, route, body, overrides = {}) => {
    const response = await fetch(origin + route, { method,
      headers: { origin, ...(cookie ? { cookie } : {}), ...(csrf ? { 'x-breakglass-csrf': csrf } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...overrides },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    const value = await response.json();
    if (value.csrfToken) csrf = value.csrfToken;
    if (Number.isSafeInteger(value.epoch)) epoch = value.epoch;
    return { status: response.status, value, headers: response.headers };
  };
  return { send, register: (username) => send('POST', '/api/account/register', {
    username, password: 'isolated-regression-password' }),
  get epoch() { return epoch; } };
}
