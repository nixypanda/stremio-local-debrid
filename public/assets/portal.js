document.querySelector('#prepare').addEventListener('click', () => {
  const error = document.querySelector('#error');
  const result = document.querySelector('#result');
  try {
    const url = new URL(document.querySelector('#address').value.trim());
    const parts = url.pathname.split('/').filter(Boolean);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || parts.at(-1) !== 'manifest.json' || !/^[a-zA-Z0-9_-]{24,128}$/.test(parts[0]) || parts.length !== 2) throw new Error('invalid');
    document.querySelector('#output').value = url.href;
    document.querySelector('#install').href = url.href.replace(/^https?:/, 'stremio:');
    error.hidden = true;
    result.hidden = false;
  } catch {
    error.textContent = 'Enter an HTTP or HTTPS addon address ending in /manifest.json.';
    error.hidden = false;
    result.hidden = true;
  }
});
