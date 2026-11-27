import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import WebTorrent from 'webtorrent';
import { createService } from '../server.mjs';

test('prefetches one episode ahead and refills only after playback advances', { timeout: 60000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'stremio-prefetch-'));
  const seedDir = join(directory, 'seed');
  await mkdir(seedDir);
  const names = ['episode1.mp4', 'episode2.mp4', 'episode3.mp4'];
  for (const name of names) await writeFile(join(seedDir, name), randomBytes(96 * 1024));
  const engine = { dht: false, tracker: false, lsd: false, utp: false, natUpnp: false, natPmp: false };
  const seed = new WebTorrent(engine);
  let service;
  let upstream;
  try {
    const torrent = await new Promise((done, reject) => { seed.once('error', reject); seed.seed(seedDir, { private: true, announce: [], pieceLength: 16384 }, done); });
    upstream = http.createServer((req, res) => {
      const path = new URL(req.url, 'http://localhost').pathname;
      res.setHeader('Content-Type', 'application/json');
      if (path === '/meta/series/tt123.json') {
        res.end(JSON.stringify({ meta: { videos: [3, 1, 2].map(episode => ({ id: `tt123:1:${episode}`, season: 1, episode })) } }));
        return;
      }
      const match = /\/stream\/series\/tt123%3A1%3A([123])\.json/.exec(path);
      if (!match) { res.statusCode = 404; res.end('{}'); return; }
      res.end(JSON.stringify({ streams: [{ name: 'Test', infoHash: torrent.infoHash, fileIdx: torrent.files.findIndex(file => file.name === names[Number(match[1]) - 1]) }] }));
    });
    await new Promise(done => upstream.listen(0, '127.0.0.1', done));
    const source = `http://127.0.0.1:${upstream.address().port}/manifest.json`;
    const stateDir = join(directory, 'state');
    await mkdir(join(stateDir, 'torrents'), { recursive: true });
    await writeFile(join(stateDir, 'torrents', `${torrent.infoHash}.torrent`), torrent.torrentFile);
    const config = { host: '127.0.0.1', port: 0, baseUrl: 'http://127.0.0.1', token: 'test-token', cacheDir: join(directory, 'cache'), stateDir, maxCacheBytes: 2 * 1024 * 1024, minFreeBytes: 0, maintenanceIntervalMs: 50, prefetchEpisodes: 1, metadataSource: source, sources: [{ name: 'Test', manifestUrl: source }] };
    const client = new WebTorrent(engine);
    client.on('torrent', download => download.addPeer(`127.0.0.1:${seed.torrentPort}`));
    service = await createService(config, { client });
    const waitFor = async predicate => {
      const end = Date.now() + 25000;
      while (!predicate()) { assert.ok(Date.now() < end, 'Timed out waiting for prefetch'); await delay(50); }
    };
    const urlFor = async episode => (await service.getStreams('series', `tt123:1:${episode}`)).streams[0].url;
    const first = await urlFor(1);
    const probe = await fetch(first, { headers: { Range: 'bytes=0-0' } });
    await probe.arrayBuffer();
    await waitFor(() => service.listDownloads()[0]?.status === 'complete');
    assert.equal(service.listDownloads().length, 1);
    const playing = await fetch(first);
    await playing.arrayBuffer();
    await waitFor(() => service.listDownloads().length === 2 && service.listDownloads()[1].status === 'complete');
    assert.equal(service.listDownloads()[1].prefetch, true);
    await delay(200);
    assert.equal(service.listDownloads().length, 2);
    const secondUrl = await urlFor(2);
    const control = action => fetch(`${config.baseUrl}/${config.token}/torrents/${torrent.infoHash}/${action}`, { method: 'POST', redirect: 'manual' });
    assert.equal((await control('pause')).status, 303);
    assert.equal(client.torrents.length, 0);
    const secondProbe = await fetch(secondUrl, { headers: { Range: 'bytes=0-0' } });
    await secondProbe.arrayBuffer();
    assert.equal(service.listDownloads()[1].prefetch, true);
    const second = await fetch(secondUrl);
    await second.arrayBuffer();
    // Cached playback can advance the episode, but must not bypass the
    // torrent-wide pause to prefetch the next file in the same pack.
    await delay(200);
    assert.equal(service.listDownloads().length, 2);
    assert.equal(client.torrents.length, 0);
    assert.ok(service.listDownloads().every(job => job.paused));
    assert.equal((await control('resume')).status, 303);
    await waitFor(() => service.listDownloads().length === 3 && service.listDownloads()[2].status === 'complete');
    assert.equal(service.listDownloads()[1].prefetch, false);
    assert.equal(service.listDownloads()[2].prefetch, true);
    await service.close();
    config.prefetchEpisodes = 0;
    const restarted = new WebTorrent(engine);
    restarted.on('torrent', download => download.addPeer(`127.0.0.1:${seed.torrentPort}`));
    service = await createService(config, { client: restarted });
    assert.equal(service.listDownloads().length, 3);
    assert.equal(service.listDownloads()[2].status, 'complete');
    assert.equal(service.listDownloads()[2].prefetch, false);
  } finally {
    await service?.close();
    if (!seed.destroyed) await new Promise(done => seed.destroy(done));
    if (upstream?.listening) await new Promise(done => upstream.close(done));
    await rm(directory, { recursive: true, force: true });
  }
});
