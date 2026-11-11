import test from 'node:test';
import assert from 'node:assert/strict';
import { evictionEligible, followingEpisodes, meaningfulPlayback, protectedEpisode, seriesId } from '../prefetch.mjs';

test('episode order comes from exact metadata IDs, skips specials and crosses seasons', () => {
  const meta = { videos: [
    { id: 'special', season: 0, episode: 1 },
    { id: 'third', season: 2, episode: 1 },
    { id: 'first', season: 1, episode: 2 },
    { id: 'second', season: 1, episode: 4 }
  ] };
  assert.deepEqual(followingEpisodes(meta, 'first', 3), ['second', 'third']);
  assert.deepEqual(followingEpisodes(meta, 'special', 3), []);
  assert.deepEqual(followingEpisodes(meta, 'third', 3), []);
  assert.deepEqual(followingEpisodes({ videos: [...meta.videos, { id: 'duplicate', season: 1, episode: 4 }] }, 'first', 3), []);
  assert.equal(seriesId('tt123:1:2'), 'tt123');
  assert.equal(seriesId('custom:1:2'), null);
});

test('small player probes do not count as playback', () => {
  assert.equal(meaningfulPlayback('GET', { start: 0, end: 0 }, 100000), false);
  assert.equal(meaningfulPlayback('HEAD', { start: 0, end: 99999 }, 100000), false);
  assert.equal(meaningfulPlayback('GET', { start: 0, end: 99999 }, 100000), true);
});

test('cache protection includes every episode in the active ahead window', () => {
  const playback = { type: 'series', id: 'tt123:1:1' };
  const ahead = ['tt123:1:2', 'tt123:1:3'];
  assert.equal(protectedEpisode({ type: 'series', id: 'tt123:1:1' }, playback, ahead), true);
  assert.equal(protectedEpisode({ type: 'series', id: 'tt123:1:2' }, playback, ahead), true);
  assert.equal(protectedEpisode({ type: 'series', id: 'tt123:1:3' }, playback, ahead), true);
  assert.equal(protectedEpisode({ type: 'series', id: 'tt123:1:4' }, playback, ahead), false);
});

test('foreground admission can reclaim recent speculative cache while prefetch cannot', () => {
  const playback = { type: 'series', id: 'tt123:1:1' };
  const ahead = ['tt123:1:2', 'tt123:1:3'];
  const related = [{ type: 'series', id: 'tt123:1:2', status: 'complete', prefetch: true }];
  const entry = { readers: 0, lastAccess: 1000 };
  assert.equal(evictionEligible(related, entry, playback, ahead, 'prefetch', 2000), false);
  assert.equal(evictionEligible(related, entry, playback, ahead, 'playback', 2000), true);
  assert.equal(evictionEligible(related, { readers: 1, lastAccess: 1000 }, playback, ahead, 'playback', 2000), false);
  assert.equal(evictionEligible(related, { pendingRequests: 1, readers: 0, lastAccess: 1000 }, playback, ahead, 'playback', 2000), false);
  assert.equal(evictionEligible([{ ...related[0], prefetch: false }], entry, playback, ahead, 'playback', 2000), false);
  assert.equal(evictionEligible([{ ...related[0], status: 'downloading' }], entry, playback, ahead, 'playback', 2000), false);
});
