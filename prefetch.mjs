export function seriesId(videoId) {
  const match = /^(tt\d+):\d+:\d+$/.exec(videoId);
  return match?.[1] || null;
}

export function followingEpisodes(meta, currentId, limit) {
  if (!Array.isArray(meta?.videos)) return [];
  const numbered = meta.videos.filter(video => typeof video.id === 'string' && Number.isSafeInteger(video.season) && video.season > 0 && Number.isSafeInteger(video.episode) && video.episode > 0);
  const ids = new Set();
  const positions = new Set();
  for (const video of numbered) {
    const position = `${video.season}:${video.episode}`;
    if (ids.has(video.id) || positions.has(position)) return [];
    ids.add(video.id);
    positions.add(position);
  }
  numbered.sort((a, b) => a.season - b.season || a.episode - b.episode);
  const index = numbered.findIndex(video => video.id === currentId);
  return index < 0 ? [] : numbered.slice(index + 1, index + 1 + limit).map(video => video.id);
}

export function meaningfulPlayback(method, range, size) {
  return method === 'GET' && range.end - range.start + 1 >= Math.min(size, 64 * 1024);
}

export function protectedEpisode(job, playback, ahead) {
  return !!playback && job.type === playback.type && (job.id === playback.id || ahead.includes(job.id));
}

export function evictionEligible(related, entry, playback, ahead, mode, now = Date.now()) {
  if (entry?.readers || entry?.pendingRequests) return false;
  const speculative = mode === 'playback' && related.every(job => job.status === 'complete' && job.prefetch);
  if (entry && now - entry.lastAccess < 60000 && !speculative) return false;
  return !related.some(job => job.status !== 'complete' || mode !== 'playback' && protectedEpisode(job, playback, ahead));
}
