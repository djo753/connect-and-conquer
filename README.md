# Connect & Chain

A juicy, cartoony **mobile chain-and-prune** prototype. Press-and-hold a buddy,
drag a glowing line to chain more, then let go — the whole pattern fires at once,
slicing every growing threat the line crosses. Survive five minutes.

Built as a vanilla `<canvas>` game that **fills the screen** (no simulated phone).
It's a **plain static site with no build step** — open the file, host it on GitHub
Pages, or wrap it with CapacitorJS. All three work as-is.

This is an implementation of the `Connect & Chain - Prototype.html` design handoff
from Claude Design.

---

## Run it

**Option A — just open it.** Double-click `index.html`. That's it.
(Fonts come from Google Fonts, so they look best with an internet connection.)

**Option B — local server** (nicer for reloads; needed for some mobile features):

```bash
npm run dev      # → http://localhost:5173  (zero-dependency node server)
# or, without node:
python3 -m http.server 5173
```

Then click **Play ▶**.

> Why no Vite/bundler? The game is plain HTML/CSS/JS with classic `<script>` tags
> and relative paths, so it runs from `file://`, GitHub Pages, or any static host
> without compiling. That's what makes "just open it" and Pages work.

## Deploy to GitHub Pages

Push the repo, then in **Settings → Pages → Build and deployment**, choose
**Deploy from a branch**, branch `main`, folder **`/ (root)`**. Done — the site
loads at `https://<you>.github.io/<repo>/`. (`.nojekyll` is included so Pages
serves every file untouched. Relative paths mean the subpath URL just works.)

## How to play

- **Press & hold** a buddy, **drag** across others to chain them, then **release**
  to fire. You can also **close a loop** or **hit your chain cap** to auto-fire.
- The line **slices any threat it crosses**. Threats spawn small, grow, shake,
  then **burst** — each burst costs a life. Survive until the timer hits `0:00`.
- **Gold reward threats** drop a **seed** when sliced.
- Each buddy has **activation pips**; using it in a chain spends one, and at zero
  it's used up. Your **chain cap grows over time**.
- **Drag a seed** from the tray to plant a buddy. **Drag a power-up** onto a buddy
  to arm it: **Blast / Reach / Freeze / Free / Mend / Heart**.

## Tweaks panel (live tuning)

Click the **gear button** (bottom-right) to tune the game while it runs: theme
(**Bloom / Tide / Glow**), spawn gap, grow time, chain cap & growth, activations,
seeds, and juice. Theme/juice/spawn/grow apply live; cap/activations/seeds take
effect on the next run — hit **Restart run with these settings**.

## Project structure

```
connect-and-conquer/
├── index.html          # full-viewport markup, HUD, overlays
├── style.css           # game-shell styles + tweaks-panel styles
├── main.js             # shell glue: HUD, tray drag, theme chrome, tweaks bridge
├── tweaks.js           # standalone in-app tuning panel + gear toggle
├── game/
│   ├── engine.js       # the canvas engine (state, chaining, threats, juice)
│   └── themes.js       # Bloom / Tide / Glow palettes
├── assets/             # images (sample logos from the design bundle)
├── serve.mjs           # zero-dep static dev server (npm run dev)
├── build.mjs           # copies the site → dist/ for Capacitor (npm run build)
└── capacitor.config.json
```

## Adding images

Drop files into `assets/` and reference them by relative URL, e.g.
`new Image().src = 'assets/my-sprite.png'`. The game is currently 100%
canvas-drawn, so swapping a drawn buddy/threat for an image sprite is a localized
change in `game/engine.js` (`drawDot` / `drawThreat`).

## CapacitorJS (going native)

`npm run build` copies the static site into `dist/` (the configured `webDir`).

```bash
npm install @capacitor/ios @capacitor/android
npm run build
npx cap add ios        # needs Xcode
npx cap add android    # needs Android Studio
npm run cap:sync       # builds, then copies dist/ into the native projects
npx cap open ios       # or: npx cap open android
```

> For a fully offline native build, self-host the Fredoka / Nunito fonts in
> `assets/fonts/` and update the `<link>` in `index.html`.

## Implementation notes

- **4 buddies are pre-planted** at the start of each run for an immediate demo
  feel (the original concept starts with 1). Change `startDots` in `main.js`.
- **Power-ups** arrive on a periodic timer plus a starter hand (the concept
  didn't specify a source). See `powerupInterval` in `main.js`.
- **Default theme is Bloom** (matches the `Chain 0/2` HUD baseline). Switch in Tweaks.
- The original React Tweaks panel + design-tool host protocol were not ported;
  the vanilla panel here reproduces the same controls without a framework.
```
