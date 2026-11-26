import { mkdir, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const xml = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]);
const systemdQuote = value => `"${String(value).replaceAll('%', '%%').replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;

export function runtimeDirectory(platform = process.platform, home = homedir(), environment = process.env) {
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'stremio-local-debrid');
  if (platform === 'linux') return join(environment.XDG_DATA_HOME || join(home, '.local', 'share'), 'stremio-local-debrid');
  throw new Error(`Automatic startup is unsupported on ${platform}.`);
}

export async function stopStartup(runtime, options = {}) {
  const platform = options.platform || process.platform;
  const home = options.home || homedir();
  const environment = options.environment || process.env;
  const execute = options.execute || ((file, args) => execFileSync(file, args, { stdio: 'pipe' }));
  if (platform === 'darwin') {
    const service = `gui/${options.uid ?? process.getuid()}/local.stremio.cache`;
    try { execute('launchctl', ['print', service]); } catch { return; }
    execute('launchctl', ['bootout', service]);
    for (let attempt = 0; attempt < 50; attempt++) {
      try { execute('launchctl', ['print', service]); } catch { return; }
      await delay(200);
    }
    throw new Error('The existing LaunchAgent did not unload.');
  } else if (platform === 'linux') {
    const unit = join(environment.XDG_CONFIG_HOME || join(home, '.config'), 'systemd', 'user', 'stremio-local-debrid.service');
    try { await stat(unit); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    execute('systemctl', ['--user', 'stop', 'stremio-local-debrid.service']);
  } else {
    throw new Error(`Automatic startup is unsupported on ${platform}.`);
  }
}

export async function installStartup(runtime, options = {}) {
  const platform = options.platform || process.platform;
  const home = options.home || homedir();
  const environment = options.environment || process.env;
  const execute = options.execute || ((file, args) => execFileSync(file, args, { stdio: 'pipe' }));
  const node = options.node || process.execPath;
  const server = join(runtime, 'server.mjs');
  if (platform === 'darwin') {
    const directory = join(home, 'Library', 'LaunchAgents');
    await mkdir(directory, { recursive: true });
    const plist = join(directory, 'local.stremio.cache.plist');
    await writeFile(plist, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>local.stremio.cache</string>
<key>ProgramArguments</key><array><string>${xml(node)}</string><string>${xml(server)}</string></array>
<key>WorkingDirectory</key><string>${xml(runtime)}</string>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>ThrottleInterval</key><integer>10</integer>
<key>StandardOutPath</key><string>${xml(join(runtime, 'state', 'service.log'))}</string>
<key>StandardErrorPath</key><string>${xml(join(runtime, 'state', 'service-error.log'))}</string>
</dict></plist>\n`);
    const domain = `gui/${options.uid ?? process.getuid()}`;
    let registered = false;
    try { execute('launchctl', ['print', `${domain}/local.stremio.cache`]); registered = true; } catch {}
    if (!registered) {
      for (let attempt = 0; attempt < 4; attempt++) {
        try { execute('launchctl', ['bootstrap', domain, plist]); break; }
        catch (error) { if (attempt === 3) throw error; await delay(1000); }
      }
    }
    execute('launchctl', ['kickstart', ...(registered ? ['-k'] : []), `${domain}/local.stremio.cache`]);
    return plist;
  }
  if (platform === 'linux') {
    const directory = join(environment.XDG_CONFIG_HOME || join(home, '.config'), 'systemd', 'user');
    await mkdir(directory, { recursive: true });
    const unit = join(directory, 'stremio-local-debrid.service');
    await writeFile(unit, `[Unit]
Description=Stremio Local Debrid
After=network-online.target

[Service]
Type=simple
WorkingDirectory=${String(runtime).replaceAll('%', '%%')}
ExecStart=${systemdQuote(node)} ${systemdQuote(server)}
Restart=always
RestartSec=10
UMask=0077
TimeoutStopSec=30

[Install]
WantedBy=default.target
`);
    execute('systemctl', ['--user', 'daemon-reload']);
    execute('systemctl', ['--user', 'enable', 'stremio-local-debrid.service']);
    execute('systemctl', ['--user', 'restart', 'stremio-local-debrid.service']);
    return unit;
  }
  throw new Error(`Automatic startup is unsupported on ${platform}.`);
}
