import text from './messages.json' with { type: 'json' };

export const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const repository = 'https://github.com/origami-ltd/stremio-local-debrid';
const header = (config, title) => {
  const base = `${config.baseUrl}/${config.token}`;
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(title)}</title><link rel="icon" href="${base}/assets/logo.png"><link rel="stylesheet" href="${base}/assets/style.css"><header><h1>${escapeHtml(title)}</h1></header>`;
};
const footer = () => `<footer><a href="${repository}">Origami · Stremio Local Debrid</a> · <a href="${repository}/blob/main/LICENSE.md">MIT-PoU</a> · <a href="${repository}/issues">GitHub</a></footer></html>`;

export function renderDashboard(config, downloads, sources, bytes, error) {
  const t = text;
  const base = `${config.baseUrl}/${config.token}`;
  const addonURL = `${base}/manifest.json`;
  const controls = download => download.infoHash ? `<form method="post" action="${escapeHtml(base)}/torrents/${escapeHtml(download.infoHash)}/${download.paused ? 'resume' : 'pause'}"><button type="submit">${download.paused ? t.resume : t.pause}</button></form>` : '';
  const statusLabel = download => download.status === 'complete' ? t.cached : download.status === 'error' ? t.errors[download.error] || download.error : ({ paused: t.paused, metadata: t.metadata, verifying: t.verifying, downloading: t.downloading })[download.status] || t.downloading;
  return `${header(config, t.name)}${error ? `<p role="alert">${escapeHtml(error)}</p>` : ''}<p>${escapeHtml(t.description)}</p><p><a class="button" href="${escapeHtml(addonURL.replace(/^https?:/, 'stremio:'))}">${t.install}</a> · <a href="${base}/guide">${t.documentation}</a></p><label for="addon">${t.addonUrl}</label><input id="addon" readonly value="${escapeHtml(addonURL)}"><p class="muted">${(bytes / 2 ** 30).toFixed(1)} / ${(config.maxCacheBytes / 2 ** 30).toFixed(0)} GiB</p><p class="muted">${t.pauseHelp}</p><table><tr><th>${t.file}</th><th>${t.status}</th><th>${t.progress}</th><th>${t.actions}</th></tr>${downloads.map(download => `<tr><td>${escapeHtml(download.filename)}</td><td>${escapeHtml(statusLabel(download))}</td><td>${(download.progress * 100).toFixed(1)}%</td><td>${controls(download)}</td></tr>`).join('')}</table>${downloads.length ? '' : `<p class="muted">${t.empty}</p>`}<h2>${t.sources}</h2><ul>${sources.sources.map(source => `<li>${escapeHtml(source.name)}</li>`).join('')}</ul>${footer()}`;
}

export function renderGuide(config) {
  const t = text;
  return `${header(config, t.documentation)}<p><a href="${config.baseUrl}/${config.token}/">${t.name}</a></p>${Object.entries(t.guide).map(([key, section]) => `<section><h2>${escapeHtml(section.title)}</h2><p>${escapeHtml(section.body)}</p>${key === 'setup' ? '<pre><code>git clone https://github.com/origami-ltd/stremio-local-debrid.git\ncd stremio-local-debrid\nnpm ci\nnpm run setup</code></pre><pre><code>npm run setup -- --no-service\nnpm start</code></pre>' : ''}</section>`).join('')}${footer()}`;
}
