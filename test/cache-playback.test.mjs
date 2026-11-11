import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { tmpdir } from 'node:os';
import { createService } from '../server.mjs';

const configFor = directory => ({ host: '127.0.0.1', port: 0, baseUrl: 'http://127.0.0.1', token: 'test-token', language: 'pt-BR', cacheDir: join(directory, 'cache'), stateDir: join(directory, 'state'), maxCacheBytes: 64 * 1024 * 1024, minFreeBytes: 0, maintenanceIntervalMs: 1000000, prefetchEpisodes: 0 });
const jobFor = (config, infoHash, fileIdx, filename, length, extra = {}) => ({ infoHash, fileIdx, filename, path: join(config.cacheDir, infoHash, filename), length, status: 'complete', lastAccess: 1, type: 'movie', id: 'tt123', sourceId: 'source', ...extra });
const fakeClient = () => {
  const calls = { add: 0, remove: 0 };
  return {
    calls,
    on() {},
    add() { calls.add++; throw new Error('WebTorrent must not load a validated cache file'); },
    remove(torrent, options, done) { calls.remove++; done?.(); },
    destroy(done) { done?.(); },
  };
};

class FakeFile {
  constructor({ name, data, done = true }) {
    this.name = name;
    this.path = name;
    this.data = data;
    this.length = data.length;
    this.done = done;
    this.downloaded = done ? data.length : 0;
    this.type = 'video/mp4';
  }
  select() {}
  deselect() {}
  once() {}
  createReadStream({ start = 0, end = this.length - 1 } = {}) {
    return Readable.from([this.data.subarray(start, end + 1)]);
  }
}

class FakeTorrent extends EventEmitter {
  constructor(hash, files) {
    super();
    this.infoHash = hash;
    this.files = files;
    this.ready = true;
    this.destroyed = false;
    this.numPeers = 1;
    this.downloadSpeed = 0;
    this.torrentFile = Buffer.from(hash);
  }
}

class FakeClient extends EventEmitter {
  constructor({ buildTorrent, removeDelayMs = 0 }) {
    super();
    this.buildTorrent = buildTorrent;
    this.removeDelayMs = removeDelayMs;
    this.added = [];
    this.torrents = [];
    this.removeStarted = new Promise(resolve => { this.markRemoveStarted = resolve; });
  }
  add(id) {
    const text = Buffer.isBuffer(id) ? id.toString() : String(id);
    const hash = /([a-f0-9]{40})/i.exec(text)?.[1]?.toLowerCase();
    const torrent = this.buildTorrent(hash);
    if (!torrent) throw new Error(`unexpected torrent ${hash}`);
    this.added.push(hash);
    this.torrents.push(torrent);
    return torrent;
  }
  remove(torrent, options, done) {
    this.markRemoveStarted?.(torrent);
    this.markRemoveStarted = null;
    const finish = () => {
      torrent.destroyed = true;
      this.torrents = this.torrents.filter(item => item !== torrent);
      done?.();
    };
    if (this.removeDelayMs) setTimeout(finish, this.removeDelayMs);
    else finish();
  }
  destroy(done) { done?.(); }
}
const prepare = async (config, jobs) => {
  await mkdir(config.stateDir, { recursive: true });
  await writeFile(join(config.stateDir, 'downloads.json'), JSON.stringify(jobs));
};
const cleanup = async (service, directory) => {
  try { await service?.close(); }
  finally { await rm(directory, { recursive: true, force: true }); }
};

test('complete cached jobs stream directly with strict range and HEAD behavior', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'stremio-cache-direct-'));
  const config = configFor(directory);
  const hash = 'a'.repeat(40);
  const media = randomBytes(512 * 1024 + 31);
  const cacheFile = join(config.cacheDir, hash, 'movie.mp4');
  await mkdir(dirname(cacheFile), { recursive: true });
  await writeFile(cacheFile, media);
  await prepare(config, [jobFor(config, hash, 2, 'movie.mp4', media.length)]);
  const client = fakeClient();
  let service;
  try {
    service = await createService(config, { client });
    const url = service.playURL({ infoHash: hash, fileIdx: 2, filename: 'movie.mp4', type: 'movie', id: 'tt123' });
    const forged = await fetch(url.replace(/\/play\/[^/]+/, '/play/forged.invalid'));
    assert.equal(forged.status, 403);

    const head = await fetch(url, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get('content-length'), String(media.length));
    assert.equal(head.headers.get('accept-ranges'), 'bytes');
    assert.equal(head.body, null);

    const rangedHead = await fetch(url, { method: 'HEAD', headers: { Range: 'bytes=10-19' } });
    assert.equal(rangedHead.status, 206);
    assert.equal(rangedHead.headers.get('content-range'), `bytes 10-19/${media.length}`);
    assert.equal(rangedHead.headers.get('content-length'), '10');

    const ranged = await fetch(url, { headers: { Range: 'bytes=100-199' } });
    assert.equal(ranged.status, 206);
    assert.equal(ranged.headers.get('content-range'), `bytes 100-199/${media.length}`);
    assert.equal(ranged.headers.get('content-type'), 'video/mp4');
    assert.deepEqual(Buffer.from(await ranged.arrayBuffer()), media.subarray(100, 200));

    const suffix = await fetch(url, { headers: { Range: 'bytes=-32' } });
    assert.equal(suffix.status, 206);
    assert.deepEqual(Buffer.from(await suffix.arrayBuffer()), media.subarray(media.length - 32));

    const invalid = await fetch(url, { headers: { Range: `bytes=${media.length}-` } });
    assert.equal(invalid.status, 416);
    assert.equal(invalid.headers.get('content-range'), `bytes */${media.length}`);
    const malformed = await fetch(url, { headers: { Range: 'bytes=0-1,2-3' } });
    assert.equal(malformed.status, 416);

    const complete = await fetch(url);
    assert.equal(complete.status, 200);
    assert.equal(complete.headers.get('content-length'), String(media.length));
    assert.equal(complete.headers.get('content-disposition'), "inline; filename*=UTF-8''movie.mp4");
    assert.deepEqual(Buffer.from(await complete.arrayBuffer()), media);
    assert.equal(client.calls.add, 0);

    const stored = JSON.parse(await readFile(join(config.stateDir, 'downloads.json'), 'utf8'));
    assert.equal(stored[0].status, 'complete');
    assert.equal(stored[0].mimeType, 'video/mp4');
    assert.ok(stored[0].lastAccess > 1);
    assert.equal(service.listDownloads()[0].status, 'complete');
  } finally {
    await cleanup(service, directory);
  }
});

test('explicit fileIdx maps to its cached job while ambiguous untargeted descriptors fall back', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'stremio-cache-select-'));
  const config = configFor(directory);
  const hash = 'b'.repeat(40);
  const first = randomBytes(128 * 1024 + 5);
  const second = randomBytes(256 * 1024 + 7);
  await mkdir(join(config.cacheDir, hash), { recursive: true });
  await writeFile(join(config.cacheDir, hash, 'first.mp4'), first);
  await writeFile(join(config.cacheDir, hash, 'second.mp4'), second);
  await prepare(config, [
    jobFor(config, hash, 0, 'first.mp4', first.length),
    jobFor(config, hash, 1, 'second.mp4', second.length),
  ]);
  const client = fakeClient();
  let service;
  try {
    service = await createService(config, { client });
    const selected = await fetch(service.playURL({ infoHash: hash, fileIdx: 1, filename: 'second.mp4', type: 'movie', id: 'tt123' }), { headers: { Range: 'bytes=0-15' } });
    assert.equal(selected.status, 206);
    assert.deepEqual(Buffer.from(await selected.arrayBuffer()), second.subarray(0, 16));
    assert.equal(client.calls.add, 0);

    const untargeted = await fetch(service.playURL({ infoHash: hash, filename: 'second.mp4', type: 'movie', id: 'tt123' }));
    assert.equal(untargeted.status, 502);
    await untargeted.arrayBuffer();
    assert.equal(client.calls.add, 1);
  } finally {
    await cleanup(service, directory);
  }
});

test('untargeted descriptors keep the original largest-video selection when a larger file is uncached', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'stremio-cache-largest-'));
  const config = configFor(directory);
  const hash = 'c'.repeat(40);
  const smaller = randomBytes(32 * 1024 + 3);
  const larger = randomBytes(96 * 1024 + 7);
  await mkdir(join(config.cacheDir, hash), { recursive: true });
  await writeFile(join(config.cacheDir, hash, 'smaller.mp4'), smaller);
  await prepare(config, [jobFor(config, hash, 0, 'smaller.mp4', smaller.length)]);
  const client = new FakeClient({
    buildTorrent: requested => requested === hash
      ? new FakeTorrent(hash, [
        new FakeFile({ name: 'smaller.mp4', data: smaller }),
        new FakeFile({ name: 'larger.mp4', data: larger, done: false }),
      ])
      : null,
  });
  let service;
  try {
    service = await createService(config, { client });
    const response = await fetch(service.playURL({ infoHash: hash, filename: 'larger.mp4', type: 'movie', id: 'tt123' }), { headers: { Range: 'bytes=0-15' } });
    assert.equal(response.status, 206);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), larger.subarray(0, 16));
    assert.ok(client.added.includes(hash), 'untargeted descriptors must use WebTorrent selection');
    assert.ok(service.listDownloads().some(job => job.filename === 'larger.mp4'));
  } finally {
    await cleanup(service, directory);
  }
});

test('old cached jobs keep accurate media types for common video containers', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'stremio-cache-types-'));
  const config = configFor(directory);
  const types = { mkv: 'video/x-matroska', m4v: 'video/x-m4v', avi: 'video/x-msvideo', m2ts: 'video/mp2t' };
  const jobs = [];
  for (const [index, extension] of Object.keys(types).entries()) {
    const hash = String(index + 4).repeat(40);
    const media = randomBytes(128);
    const filename = `movie.${extension}`;
    await mkdir(join(config.cacheDir, hash), { recursive: true });
    await writeFile(join(config.cacheDir, hash, filename), media);
    jobs.push(jobFor(config, hash, 0, filename, media.length));
  }
  await prepare(config, jobs);
  const client = fakeClient();
  let service;
  try {
    service = await createService(config, { client });
    for (const [index, [extension, type]] of Object.entries(types).entries()) {
      const hash = String(index + 4).repeat(40);
      const response = await fetch(service.playURL({ infoHash: hash, fileIdx: 0, filename: `movie.${extension}`, type: 'movie', id: 'tt123' }), { method: 'HEAD' });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-type'), type);
    }
    assert.equal(client.calls.add, 0);
  } finally {
    await cleanup(service, directory);
  }
});

test('missing, truncated, incomplete and unsafe cache files fall back to the torrent path', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'stremio-cache-fallback-'));
  const config = configFor(directory);
  const cases = [];
  const addCase = async (hash, filename, length, mutate) => {
    await mkdir(join(config.cacheDir, hash), { recursive: true });
    const job = jobFor(config, hash, 0, filename, length);
    await mutate(job);
    cases.push(job);
  };
  await addCase('d'.repeat(40), 'missing.mp4', 1024, async () => {});
  await addCase('e'.repeat(40), 'truncated.mp4', 4096, async job => {
    await writeFile(job.path, Buffer.alloc(2048));
  });
  const outside = join(directory, 'outside.mp4');
  await writeFile(outside, randomBytes(4096));
  await addCase('f'.repeat(40), 'outside.mp4', 4096, async job => { job.path = outside; });
  if (process.platform !== 'win32') {
    const target = join(directory, 'symlink-target.mp4');
    await writeFile(target, randomBytes(4096));
    await addCase('1'.repeat(40), 'link.mp4', 4096, async job => {
      await symlink(target, job.path);
    });
  }
  await addCase('2'.repeat(40), 'not-incomplete.mp4', 4096, async job => {
    job.status = 'error';
    await writeFile(job.path, randomBytes(4096));
  });
  await prepare(config, cases);
  const client = fakeClient();
  let service;
  try {
    service = await createService(config, { client });
    for (const job of cases) {
      const response = await fetch(service.playURL({ infoHash: job.infoHash, fileIdx: job.fileIdx, filename: job.filename, type: 'movie', id: 'tt123' }), { headers: { Range: 'bytes=0-0' } });
      assert.equal(response.status, 502, `${job.filename} should not be served directly`);
      await response.arrayBuffer();
    }
    assert.equal(client.calls.add, cases.length);
  } finally {
    await cleanup(service, directory);
  }
});

test('an active direct read protects the whole cached torrent from maintenance eviction', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'stremio-cache-eviction-'));
  const config = configFor(directory);
  const hash = '3'.repeat(40);
  const first = randomBytes(1024 * 1024);
  const second = randomBytes(64 * 1024);
  await mkdir(join(config.cacheDir, hash), { recursive: true });
  await writeFile(join(config.cacheDir, hash, 'playing.mp4'), first);
  await writeFile(join(config.cacheDir, hash, 'other.mp4'), second);
  await prepare(config, [
    jobFor(config, hash, 0, 'playing.mp4', first.length),
    jobFor(config, hash, 1, 'other.mp4', second.length),
  ]);
  const client = fakeClient();
  let service;
  let controller;
  try {
    service = await createService(config, { client });
    controller = new AbortController();
    const response = await fetch(service.playURL({ infoHash: hash, fileIdx: 0, filename: 'playing.mp4', type: 'movie', id: 'tt123' }), { signal: controller.signal });
    assert.equal(response.status, 200);
    const reader = response.body.getReader();
    const chunk = await reader.read();
    assert.equal(chunk.done, false);

    config.minFreeBytes = Number.MAX_SAFE_INTEGER;
    await service.maintenance();
    assert.deepEqual(await readFile(join(config.cacheDir, hash, 'playing.mp4')), first);
    assert.deepEqual(await readFile(join(config.cacheDir, hash, 'other.mp4')), second);
    assert.equal(service.listDownloads().length, 2);

    controller.abort();
    await reader.cancel().catch(() => {});
  } finally {
    await cleanup(service, directory);
  }
});

test('a direct reader opened during delayed torrent removal aborts eviction and clears the stale entry', { timeout: 30000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'stremio-cache-race-'));
  const dataA = randomBytes(8 * 1024 * 1024);
  const dataB = randomBytes(64 * 1024);
  const hashA = '5'.repeat(40);
  const hashB = '6'.repeat(40);
  const config = { ...configFor(directory), maxCacheBytes: dataA.length + dataB.length - 1024, prefetchEpisodes: 1 };
  await mkdir(join(config.cacheDir, hashA), { recursive: true });
  await writeFile(join(config.cacheDir, hashA, 'cached.mp4'), dataA);
  await prepare(config, [jobFor(config, hashA, 0, 'cached.mp4', dataA.length, { type: 'series', id: 'tt123:1:2', prefetch: true, prefetchParentId: 'tt123:1:1' })]);
  await writeFile(join(config.stateDir, 'playback.json'), JSON.stringify({ type: 'series', id: 'tt123:1:1' }));
  const client = new FakeClient({
    removeDelayMs: 250,
    buildTorrent: requested => requested === hashA
      ? new FakeTorrent(hashA, [new FakeFile({ name: 'cached.mp4', data: dataA })])
      : requested === hashB
        ? new FakeTorrent(hashB, [new FakeFile({ name: 'download.mp4', data: dataB, done: false })])
        : null,
  });
  let service;
  let controller;
  try {
    service = await createService(config, { client });
    const directURL = service.playURL({ infoHash: hashA, fileIdx: 0, filename: 'cached.mp4', type: 'series', id: 'tt123:1:2' });
    const untargetedURL = service.playURL({ infoHash: hashA, filename: 'cached.mp4', type: 'series', id: 'tt123:1:2' });
    const downloadURL = service.playURL({ infoHash: hashB, fileIdx: 0, filename: 'download.mp4', type: 'movie', id: 'ttB' });

    // Prime a WebTorrent entry so eviction has to perform an async remove.
    const head = await fetch(untargetedURL, { method: 'HEAD' });
    assert.equal(head.status, 200);
    await head.arrayBuffer();
    await delay(50);

    const blocked = fetch(downloadURL);
    await Promise.race([client.removeStarted, delay(5000, undefined, { ref: false }).then(() => { throw new Error('eviction never started'); })]);

    controller = new AbortController();
    const active = await fetch(directURL, { signal: controller.signal });
    assert.equal(active.status, 200);
    const reader = active.body.getReader();
    const first = await reader.read();
    assert.ok(first.value?.byteLength > 0);

    const blockedResponse = await blocked;
    assert.equal(blockedResponse.status, 507);
    await blockedResponse.arrayBuffer();

    const chunks = [first.value];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    assert.deepEqual(Buffer.concat(chunks), dataA);
    assert.deepEqual(await readFile(join(config.cacheDir, hashA, 'cached.mp4')), dataA);
    assert.ok(service.listDownloads().some(job => job.filename === 'cached.mp4' && job.status === 'complete'));

    const before = client.added.filter(hash => hash === hashA).length;
    const again = await fetch(untargetedURL, { method: 'HEAD' });
    assert.equal(again.status, 200);
    await again.arrayBuffer();
    assert.equal(client.added.filter(hash => hash === hashA).length, before + 1, 'aborted eviction must not leave a destroyed entry');
  } finally {
    controller?.abort();
    await cleanup(service, directory);
  }
});
