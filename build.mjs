// build.mjs — there is no real "build"; the site is already static. This just
// copies the web files into dist/ so Capacitor (webDir: "dist") gets a clean
// payload without node_modules. GitHub Pages can serve the repo root directly.
import { rm, mkdir, cp } from 'node:fs/promises';

const OUT = 'dist';
const ITEMS = ['index.html', 'style.css', 'main.js', 'tweaks.js', 'game', 'assets', '.nojekyll'];

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
for (const item of ITEMS) {
  await cp(item, `${OUT}/${item}`, { recursive: true }).catch(() => {
    console.warn(`skip (missing): ${item}`);
  });
}
console.log(`Copied static site → ${OUT}/ (use as Capacitor webDir)`);
