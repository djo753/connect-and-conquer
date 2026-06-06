# Connect & Chain

A juicy, cartoony **mobile chain-and-prune** prototype. Press-and-hold a buddy,
drag a glowing line to chain more, then let go — the whole pattern fires at once,
slicing every growing threat the line crosses. Survive five minutes.

Built as a vanilla `<canvas>` game inside a phone frame, bundled with **Vite** and
structured so it can be wrapped natively with **CapacitorJS** later.

This is a faithful implementation of the `Connect & Chain - Prototype.html` design
handoff from Claude Design (the original lived as a single HTML file with a
window-global engine + a React tweaks island; here it's split into ES modules,
and the tweaks panel was rewritten in dependency-free vanilla JS).

---

## Quick start

```bash
npm install
npm run dev      # http://localhost:5173 (also exposed on your LAN for phone testing)
```

Then click **Play ▶**.

```bash
npm run build    # production build → dist/
npm run preview  # serve the production build locally
```

---

## How to play

- **Press & hold** a buddy, **drag** across other buddies to chain them, then
  **release** to fire. You can also **close a loop** (drag back onto an earlier
  buddy) or **hit your chain cap** to auto-fire.
- The line **slices any threat it crosses**. Threats spawn small, grow, shake,
  then **burst** — each burst costs a life. Survive until the timer hits `0:00`.
- **Gold reward threats** drop a **seed** when sliced.
- Each buddy has **activation pips** (3 by default). Every time a buddy is used
  in a chain it spends one; at zero it's used up and disappears.
- Your **chain cap grows over time** (`Chain N/M` in the HUD).
- **Drag a seed** from the tray onto the field to **plant** a new buddy.
- **Drag a power-up** onto a buddy to **arm** it. Power-ups: **Blast** (clears a
  radius), **Reach** (+2 chain length), **Freeze** (stops growth ~4s),
  **Free** (spends no activation), **Mend** (refills your weakest buddy),
  **Heart** (restores a life).

## Tweaks panel (live tuning)

Click the **gear button** (bottom-right) to open the **Tweaks** panel and tune the
game while it runs:

- **World** — swap theme: **Bloom** (garden) · **Tide** (reef) · **Glow** (cosmos)
- **Threats** — spawn gap, grow time
- **Chaining** — start cap, how fast the cap grows
- **Dots** — activations per buddy, starting seeds
- **Feel** — juice (particles / shake / glow / slow-mo intensity)

Theme + juice + spawn/grow apply live. Chain cap, activations, and seed count take
effect on the next run — hit **Restart run with these settings**.

---

## Project structure

```
connect-and-conquer/
├── index.html              # phone-frame markup, HUD, overlays (Vite entry)
├── vite.config.js          # base:'./' so the build works in a native WebView
├── capacitor.config.json   # appId / appName / webDir:'dist'
├── public/
│   └── assets/             # static images, copied to dist verbatim
│       ├── vc-logo-black.png   # sample images from the design bundle (unused;
│       └── vc-logo-white.png   # here to demonstrate the asset pipeline)
└── src/
    ├── main.js             # shell glue: scaling, HUD, tray drag, theme chrome, tweaks bridge
    ├── style.css           # game shell styles + tweaks panel styles
    ├── tweaks.js           # standalone in-app tuning panel + gear toggle
    └── game/
        ├── engine.js       # the canvas game engine (state, chaining, threats, juice)
        └── themes.js       # Bloom / Tide / Glow palettes + style descriptors
```

## Adding images

Drop files into `public/assets/` and reference them at runtime by URL, e.g.
`new Image().src = 'assets/my-sprite.png'` (relative paths work both in the dev
server and inside a Capacitor WebView). Vite copies `public/` to the build root
untouched. The game is currently 100% canvas-drawn, so swapping a drawn buddy or
threat for an image sprite is a localized change in `src/game/engine.js`
(`drawDot` / `drawThreat`).

## CapacitorJS (when you're ready to go native)

The web build is already Capacitor-shaped (`webDir: dist`, relative asset paths).
To wrap it:

```bash
npm install @capacitor/ios @capacitor/android
npm run build
npx cap add ios        # needs Xcode
npx cap add android    # needs Android Studio
npm run cap:sync       # copies dist/ into the native projects
npx cap open ios       # or: npx cap open android
```

After each web change: `npm run build && npm run cap:sync`.

> Note: the fonts (Fredoka / Nunito) load from Google Fonts. For a fully offline
> native build, self-host them in `public/assets/fonts/` and update the `@font-face`
> / `<link>` in `index.html`.

---

## Implementation notes / decisions

These mirror the design author's notes in the handoff chat:

- **4 buddies are pre-planted** at the start of each run so the chaining feel is
  immediate in a demo (the original game concept starts with 1). Change
  `startDots` in `src/main.js`.
- **Power-ups** currently arrive on a periodic timer plus a starter hand, since
  the concept didn't specify their source (drops? shop?). See `powerupInterval`
  in `src/main.js` and `grantPowerup` in the engine.
- **Default theme is Bloom** (the recommended hero theme; the start-screen seed
  and `Chain 0/2` HUD both reflect this baseline). Switch any time in Tweaks.
- The original React Tweaks panel and design-tool host protocol were **not**
  ported — they relied on a CDN React+Babel runtime and a parent-window
  messaging bridge that only exist inside Claude Design. The vanilla panel here
  reproduces the same controls and styling.
```
