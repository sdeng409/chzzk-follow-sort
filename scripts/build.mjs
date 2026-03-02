import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { build, context } from 'esbuild';

const rootDir = process.cwd();
const outDir = path.join(rootDir, 'dist');
const watchMode = process.argv.includes('--watch');

const buildOptions = {
  entryPoints: [path.join(rootDir, 'src', 'contentScript.ts')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['chrome114'],
  outfile: path.join(outDir, 'contentScript.js'),
};

await mkdir(outDir, { recursive: true });
await cp(path.join(rootDir, 'public', 'manifest.json'), path.join(outDir, 'manifest.json'));

if (watchMode) {
  const ctx = await context(buildOptions);
  await ctx.watch();
} else {
  await build(buildOptions);
}
