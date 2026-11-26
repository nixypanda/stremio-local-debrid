import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, chmod, rename } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Materialize public declarative settings and a private runtime token without
// writing secrets into the package or requiring the interactive installer.
export async function prepareHeadless(settings, tokenFile) {
  const { stateDir, cacheDir } = settings;
  if (!stateDir || !cacheDir || !settings.baseUrl) throw new Error('stateDir, cacheDir and baseUrl are required');
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  await mkdir(cacheDir, { recursive: true, mode: 0o700 });
  const persistentToken = join(stateDir, 'token');
  if (!tokenFile) {
    try { await writeFile(persistentToken, randomBytes(24).toString('hex') + '\n', { flag: 'wx', mode: 0o600 }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    await chmod(persistentToken, 0o600);
    tokenFile = persistentToken;
  }
  const token = (await readFile(tokenFile, 'utf8')).trim();
  if (!/^[A-Za-z0-9_-]+$/.test(token)) throw new Error('Token must be nonempty and URL-safe');
  const baseUrl = settings.baseUrl.replace(/\/+$/, '');
  const config = { ...settings, baseUrl, token };
  const files = {
    'config.json': JSON.stringify(config, null, 2) + '\n',
    'addon-url.txt': `${baseUrl}/${token}/manifest.json\n`,
    'status-url.txt': `${baseUrl}/${token}/\n`,
  };
  for (const [name, content] of Object.entries(files)) {
    const path = join(stateDir, name);
    await writeFile(`${path}.tmp`, content, { mode: 0o600 });
    await chmod(`${path}.tmp`, 0o600);
    await rename(`${path}.tmp`, path);
  }
  return config;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await prepareHeadless(JSON.parse(await readFile(process.argv[2], 'utf8')), process.argv[3]);
}
