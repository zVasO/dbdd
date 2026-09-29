# App icon sources

- `icon.svg`: the 1024 × 1024 master ("Verre liquide · Prisme": three
  isometric glass slabs stacked like a database, the top one tinted with
  Loom's orange accent).
- `icon-small.svg`: the same icon simplified for 32 px and below (no glow,
  more opaque glass), so small sizes stay crisp instead of being downscaled.
- `icon.png`, `small-16.png`, `small-24.png`, `small-32.png`: renders of the
  two SVGs at those sizes, transparent outside the squircle.

To regenerate every bundled size, from `apps/desktop`:

```sh
pnpm tauri icon src-tauri/icons/source/icon.png
python3 src-tauri/icons/source/inject_small_sizes.py
```

After editing an SVG, re-render its PNGs first (any SVG renderer; they were
made with headless Chromium at the exact pixel size).
