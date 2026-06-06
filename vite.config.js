import { defineConfig } from 'vite';

// base: './' keeps emitted asset URLs relative, so the same build works both
// when served from a web root and from inside Capacitor's native webview
// (capacitor://localhost / https://localhost). `cap sync` copies dist/ verbatim.
export default defineConfig({
  base: './',
  server: {
    host: true, // expose on the LAN so you can test on a real phone
    port: 5173,
  },
  build: {
    outDir: 'dist',
    target: 'es2018', // safe for older mobile WebViews
  },
});
