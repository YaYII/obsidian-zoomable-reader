# Changelog

## 1.1.0

- **Image and diagram viewer.** Click an image in a note to open it full screen, zoomed to fit;
  zoom with the wheel (Ctrl or Cmd and wheel), the toolbar buttons, `+` / `-` / `0`, or a pinch on
  mobile; drag to pan; double-click toggles 100% and the fit scale. `Esc`, the close button or a
  click on the empty background closes it.
- The toolbar shows the image's real pixel size next to the size you are currently looking at
  (for example `1600 x 900 px → 852 x 479 px`), so you always know how far in you are.
- **Diagrams open in the same viewer.** Clicking a Mermaid diagram moves it into the viewer and
  puts it back afterwards, which keeps the theme's `#id`-scoped styling intact instead of
  re-rendering a copy.
- Three new settings: click images to open a zoomable viewer, click diagrams to open a zoomable
  viewer, and fit to window when the viewer opens.
- Verified with 43 assertions driven by real events in Chromium, including this release's new
  ones: opening by a real click, fit scale, toolbar zoom, wheel zoom with the anchor invariant,
  drag panning, `Esc`, background-click close, diagram move-and-restore, and a mobile pass
  (touch to open, pinch to zoom, overlay fully removed on close).

Fixed along the way, both found by that harness rather than by reading code:

- The pan flag used to be cleared on `pointerup`, so the `click` that ends a drag was treated as a
  click on empty space and closed the viewer. It now survives until the click is consumed.
- The viewer used Obsidian's `addClass` helper, which does not exist in a plain browser; the
  overlay ended up in the DOM while the module thought it had never opened, so every control was
  dead. It now uses standard `classList` and only attaches to the DOM once fully built.

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