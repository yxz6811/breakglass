import { createWorkspaceIntegrationFixture } from './workspace-integration-fixture.mjs';

if (process.argv.length !== 3 || process.argv[2] !== '--serve') {
  process.stderr.write('HTTP回归：node --test tests/workspace-integration.test.mjs\n隔离浏览器验收：node scripts/verify-workspace-integration.mjs --serve\n');
  process.exitCode = 2;
} else {
  const fixture = await createWorkspaceIntegrationFixture({ port: 18767 });
  process.stdout.write(`Isolated 010 QA: ${fixture.origin}/extension/demo/index.html\nReal temporary learning gateway; no .env, no model, no production data.\n`);
  let closing = false;
  const stop = async () => {
    if (closing) return;
    closing = true;
    await fixture.close();
    process.exitCode = 0;
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}
