import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Resvg } from '@resvg/resvg-js';
import toIco from 'to-ico';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const root = path.resolve(__dirname, '..');
const svgPath = path.join(root, 'assets', 'mediclens-icon.svg');
const publicDir = path.join(root, 'public');

async function renderPng(size) {
  const svg = await fs.readFile(svgPath, 'utf8');
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: size },
  });
  return Buffer.from(resvg.render().asPng());
}

async function writeFile(outPath, buffer) {
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, buffer);
}

async function main() {
  const [logo192, logo512] = await Promise.all([renderPng(192), renderPng(512)]);

  await Promise.all([
    writeFile(path.join(publicDir, 'logo192.png'), logo192),
    writeFile(path.join(publicDir, 'logo512.png'), logo512),
  ]);

  const [p16, p32, p48, p64] = await Promise.all([
    renderPng(16),
    renderPng(32),
    renderPng(48),
    renderPng(64),
  ]);

  const ico = await toIco([p16, p32, p48, p64]);
  await writeFile(path.join(publicDir, 'favicon.ico'), ico);

  // eslint-disable-next-line no-console
  console.log('Generated:', 'public/favicon.ico', 'public/logo192.png', 'public/logo512.png');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
