# Changelog

## 1.0.0

First release.

- New view that renders the active note on a pan-and-zoom board.
- Mobile: one-finger pan, two-finger pinch zoom, double-tap to toggle 100% and 200%.
- Desktop: drag to pan, Ctrl or Cmd and wheel to zoom at the pointer, plain wheel to pan,
  double-click to toggle, and `+` / `-` / `0` shortcuts.
- Toolbar: zoom out, current zoom level (click to reset), zoom in, fit width.
- Zoom and position are remembered per note, in the plugin's own `data.json`.
- The note column follows the theme's `--file-line-width` and never exceeds the viewport on a
  phone, so 100% is one screen wide and zooming only magnifies.
- Verified with 24 assertions driven by real events in Chromium (wheel, Ctrl and wheel, drag,
  pinch, double-tap) plus vitest suites for the zoom math and the repository contract.
