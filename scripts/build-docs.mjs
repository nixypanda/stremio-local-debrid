import { mkdir, readFile, writeFile } from 'node:fs/promises';
import text from '../messages.json' with { type: 'json' };

await mkdir('docs', { recursive: true });
await mkdir('public/configure', { recursive: true });
let guide = `# Stremio Local Debrid — Installation guide\n\n${text.description}\n\n`;
for (const [key, section] of Object.entries(text.guide)) {
  guide += `## ${section.title}\n\n${section.body}\n\n`;
  if (key === 'setup') guide += '```sh\ngit clone https://github.com/origami-ltd/stremio-local-debrid.git\ncd stremio-local-debrid\nnpm ci\nnpm run setup\n```\n\n```sh\nnpm run setup -- --no-service\nnpm start\n```\n\n';
}
guide += '[Origami · GitHub](https://github.com/origami-ltd/stremio-local-debrid) · [MIT-PoU](../LICENSE.md)\n';
await writeFile('docs/GUIDE.md', guide);
const portal = await readFile('public/index.html', 'utf8');
await writeFile('public/configure/index.html', portal.replaceAll('./assets/', '../assets/'));
console.log('Built English installation guide and portal.');
