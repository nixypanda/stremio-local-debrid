import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { createService } from '../server.mjs';
import text from '../messages.json' with { type: 'json' };

test('manifest, dashboard, guide, errors and stream labels are English-only', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'stremio-ui-'));
  const upstream = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ streams: [{ infoHash: 'a'.repeat(40), fileIdx: 0, name: 'Upstream', title: '<file>' }] }));
  });
  await new Promise(done => upstream.listen(0, '127.0.0.1', done));
  const client = new EventEmitter();
  client.torrents = [];
  client.destroy = done => done();
  client.add = () => assert.fail('Listing sources must not start a torrent.');
  const config = { host: '127.0.0.1', port: 0, baseUrl: 'http://127.0.0.1', token: 'synthetic-public-test-token', language: 'pt-BR', cacheDir: join(directory, 'cache'), stateDir: join(directory, 'state'), maxCacheBytes: 2 ** 30, minFreeBytes: 0, sources: [{ manifestUrl: `http://127.0.0.1:${upstream.address().port}/manifest.json` }] };
  const service = await createService(config, { client });
  const base = `${config.baseUrl}/${config.token}`;
  try {
    const manifestResponse = await fetch(`${base}/manifest.json?lang=ja-JP`, { headers: { 'Accept-Language': 'pt-BR' } });
    const manifest = await manifestResponse.json();
    assert.equal(manifest.id, 'local.stremio.cache');
    assert.equal(manifest.name, text.name);
    assert.equal(manifest.description, text.description);
    assert.equal(manifestResponse.headers.get('access-control-allow-origin'), '*');
    const dashboard = await (await fetch(`${base}/configure`)).text();
    assert.ok(dashboard.includes('lang="en"'));
    assert.ok(dashboard.includes(`stremio://${new URL(config.baseUrl).host}/${config.token}/manifest.json`));
    assert.doesNotMatch(dashboard, /<select|name="lang"|dir="rtl"/);
    const guide = await (await fetch(`${base}/guide`)).text();
    assert.ok(guide.includes('npm run setup -- --no-service'));
    assert.doesNotMatch(guide, /--lang/);
    const method = await fetch(`${base}/manifest.json`, { method: 'POST' });
    assert.equal(method.status, 405);
    assert.equal((await method.json()).error, text.errors.invalidMethod);
    const streams = await (await fetch(`${base}/stream/movie/tt123.json`)).json();
    assert.equal(streams.streams.length, 1);
    assert.equal(streams.streams[0].name, `${text.name} ↓\nUpstream`);
    for (const path of ['/pt-BR/manifest.json', '/en-US/manifest.json', '/pt-BR/guide']) assert.equal((await fetch(base + path)).status, 404);
    assert.equal((await fetch(`${config.baseUrl}/wrong-token/manifest.json`)).status, 404);
    assert.equal((await fetch(`${base}/assets/../config.json`)).status, 404);
    assert.equal((await fetch(`${base}/manifest.json`, { method: 'OPTIONS' })).status, 204);
    assert.equal(service.listDownloads().length, 0);
  } finally {
    await service.close();
    await new Promise(done => upstream.close(done));
    await rm(directory, { recursive: true, force: true });
  }
});

test('English portal validates private URLs without fetching translation files or adding a language prefix', async () => {
  const script = await readFile(new URL('../public/assets/portal.js', import.meta.url), 'utf8');
  const elements = Object.fromEntries(['prepare', 'error', 'result', 'address', 'output', 'install'].map(id => [id, {}]));
  let click;
  elements.prepare.addEventListener = (event, handler) => { click = handler; };
  runInNewContext(script, { URL, document: { querySelector: selector => elements[selector.slice(1)] } });
  const address = 'https://cache.example/synthetic-private-token-for-test/manifest.json';
  elements.address.value = address;
  click();
  assert.equal(elements.output.value, address);
  assert.equal(elements.install.href, address.replace('https:', 'stremio:'));
  assert.equal(elements.result.hidden, false);
  for (const invalid of [address.replace('/manifest', '/pt-BR/manifest'), address + '?lang=ja-JP', 'javascript:alert(1)']) {
    elements.address.value = invalid;
    click();
    assert.equal(elements.error.hidden, false);
    assert.equal(elements.error.textContent, text.invalidUrl);
    assert.equal(elements.result.hidden, true);
  }
});
