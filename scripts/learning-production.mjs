import path from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { inspectRelease, releaseArguments, supplierRuntimeFingerprint } from './learning-release.mjs';
import { createLearningSiteServer } from './learning-site.mjs';
import { loadSettings } from '../breakglass-reader/src/settings.mjs';
import { loadAudioSettings } from './learning-audio.mjs';

/** An explicit loopback reverse-proxy runner, never an automatic deployment. */
export async function startProduction({ manifestPath, env = process.env, now = Date.now, createServer = createLearningSiteServer } = {}) {
  let settings; let audioSettings; let expectedFingerprint;
  try { settings = loadSettings(env); audioSettings = loadAudioSettings(env); expectedFingerprint = supplierRuntimeFingerprint(settings, audioSettings); }
  catch { return { report: { ready: false, runtimeMatches: false, code: 'supplier_runtime_config_invalid', actualCloudDeploymentVerified: false }, server: null }; }
  const inspected = await inspectRelease(manifestPath || env.BREAKGLASS_RELEASE_MANIFEST, { edgeSecret: env.BREAKGLASS_EDGE_SECRET, now,
    expectedFingerprint });
  if (!inspected.report.ready || !inspected.policy) return { report: inspected.report, server: null };
  let server;
  try {
    const rawPort = env.BREAKGLASS_PRODUCTION_PORT || '4175';
    if (!/^\d{1,5}$/.test(rawPort) || Number(rawPort) < 1 || Number(rawPort) > 65535) throw new Error('invalid_port');
    server = createServer({ settings, audioSettings, dataDir: inspected.dataDir,
      allowedOrigins: [inspected.policy.publicOrigin], releasePolicy: inspected.policy });
    server.listen(Number(rawPort), '127.0.0.1'); await once(server, 'listening');
    return { report: { ...inspected.report, listening: true, bindHost: '127.0.0.1', port: Number(rawPort), actualCloudDeploymentVerified: false }, server };
  } catch {
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    return { report: { ...inspected.report, ready: false, checks: [...inspected.report.checks,
      { name: 'runtime', status: 'blocked', code: 'production_start_failed' }], actualCloudDeploymentVerified: false }, server: null };
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { report } = await startProduction({ manifestPath: releaseArguments(process.argv.slice(2), process.env) });
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    if (!report.ready) process.exitCode = 2;
  } catch { process.stdout.write(JSON.stringify({ ready: false, code: 'invalid_release_arguments', actualCloudDeploymentVerified: false }) + '\n'); process.exitCode = 2; }
}
