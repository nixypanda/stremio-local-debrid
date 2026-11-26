import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { prepareHeadless } from '../scripts/prepare-headless.mjs';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'stremio-headless-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, settings: { stateDir: join(directory, 'state'), cacheDir: join(directory, 'cache'), baseUrl: 'https://cache.example/', host: '127.0.0.1', port: 7810, sources: [] } };
}

test('headless configuration preserves identity, updates settings and keeps URLs private', async t => {
  const { settings } = await fixture(t);
  const first = await prepareHeadless(settings);
  assert.match(first.token, /^[a-f0-9]{48}$/);
  const second = await prepareHeadless({ ...settings, prefetchEpisodes: 2 });
  assert.equal(second.token, first.token);
  assert.equal(second.prefetchEpisodes, 2);
  assert.equal(await readFile(join(settings.stateDir, 'addon-url.txt'), 'utf8'), `https://cache.example/${first.token}/manifest.json\n`);
  assert.deepEqual(JSON.parse(await readFile(join(settings.stateDir, 'config.json'), 'utf8')), second);
  if (process.platform !== 'win32') {
    for (const name of ['token', 'config.json', 'addon-url.txt', 'status-url.txt']) assert.equal((await stat(join(settings.stateDir, name))).mode & 0o777, 0o600);
  }
});

test('headless configuration accepts an external token and rejects empty secrets', async t => {
  const { directory, settings } = await fixture(t);
  const tokenFile = join(directory, 'secret');
  await writeFile(tokenFile, 'existing-secret\n');
  assert.equal((await prepareHeadless(settings, tokenFile)).token, 'existing-secret');
  await writeFile(tokenFile, '\n');
  await assert.rejects(prepareHeadless(settings, tokenFile), /Token must/);
});

test('real server starts from an external config without modifying the application directory', { timeout: 15000 }, async t => {
  const { directory, settings } = await fixture(t);
  const configFile = join(directory, 'private-config.json');
  await writeFile(configFile, JSON.stringify({ ...settings, port: 0, token: 'external-secret', autoDiscoverAddons: false }));
  const child = spawn(process.execPath, [fileURLToPath(new URL('../server.mjs', import.meta.url))], {
    cwd: directory,
    env: { ...process.env, STREMIO_LOCAL_DEBRID_CONFIG: configFile },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      await exited;
    }
  });
  let errors = '';
  child.stderr.on('data', data => { errors += data; });
  const address = await new Promise((done, reject) => {
    let output = '';
    child.on('error', reject);
    child.on('exit', code => reject(new Error(`Server exited ${code}: ${errors}`)));
    child.stdout.on('data', data => {
      output += data;
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) done(match[0]);
    });
  });
  const response = await fetch(`${address}/external-secret/manifest.json`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).id, 'local.stremio.cache');
});

test('locked dependencies do not import native WebRTC', async () => {
  const lock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'));
  for (const name of Object.keys(lock.packages)) assert.doesNotMatch(name, /node_modules\/(webrtc-polyfill|node-datachannel)$/);
});
