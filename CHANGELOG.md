# Changelog

## 1.3.6

- **The reading view itself now has a width and a zoom.** Obsidian's own reading view is not taken
  over — the plugin changes two CSS properties of it: the line width (default **900 px**, the value
  that was asked for, with 760–1200 px and 跟随主题 / follow-the-theme options) and a zoom level
  (60 %–200 %, default 100 %). Your theme files are untouched, and *follow the theme* + 100 % injects
  nothing beyond one \`touch-action\` line.
- **Zoom reflows instead of stretching.** It is applied as CSS \`zoom\` with the sizer's \`max-width\`
  divided by the same factor, so the text gets bigger while the measure on screen stays exactly the
  line width you picked. A screenshot-level stretch would have changed the line length; this does
  not.
- **You operate it: pinch, Ctrl+wheel, or commands.** Pinch inside the reading view on mobile,
  **Ctrl / ⌘ + wheel** on desktop, or the three new commands (阅读视图放大 / 缩小 / 复位到 100 %,
  each showing the new level). Only two-finger pinches and Ctrl+wheel are intercepted — one-finger
  scrolling, taps and the plain wheel remain Obsidian's.
- **A real bug found by the browser harness.** The first implementation listened for pointer events
  and the browser claimed the two-finger gesture for itself: of ten gesture frames only two arrived
  (pointercancel). The fix is to listen for \`touchstart\`/\`touchmove\` and to declare
  \`touch-action: pan-y\` on the reading view — vertical one-finger scrolling still belongs to
  Obsidian, while the two-finger pinch now belongs to the plugin (measured: zoom 1 → 1.86 in one
  pinch).
- New settings group 阅读视图（Obsidian 自带的页面）/ Reading view, with the three settings above.

Verification: `npm run verify:reading` — 17 assertions in a real Chromium against a page that
mimics the reading view (a theme width of 720 px, a long document): follow-the-theme really is
720 px with no width rules injected, 900 px really measures 900 px, zoom 150 % keeps the on-screen
measure at 900 px while paragraphs get 1.5x taller, the clamp holds at 60–200 %, Ctrl+wheel zooms
inside the reading view and is ignored outside it (and after the listener is removed), and on a phone
viewport a real CDP two-finger pinch raises the zoom while the throttling keeps the reflow count
below the frame count.

## 1.3.5

- **The card concept is gone.** Whiteboard mode used to compile the note into a board of cards:
  one card per heading, connectors, folding, a card limit, and a column *or* flow layout. It is now
  what it should have been: **one page, 1280 px wide**, on a surface you pan, zoom and scroll. The
  width setting belongs to the page, not to a card.
- Removed along with it: `src/board-model.ts` (the heading→card compiler), `src/board-layout.ts`
  (tidy tree / single-column geometry), `src/board-render.ts` (card DOM, connectors, focus
  buttons), the five card settings (排版 / 展开层级 / 间距 / 连线 / 数量上限), every card style in
  `styles.css`, and the 43 unit tests that covered them. The verification suite now **asserts the
  absence**: no card class names or card settings in the built bundle, no card modules in the tree,
  and zero card artifacts in the live DOM.
- What is left is the part that made the plugin worth having: one page whose width is a setting
  (1280 px default, A5/A4 presets one slider step away), recompiled every time you enter the mode and
  following the note as you edit, with the same gesture layer as before — drag to pan, pinch to zoom,
  **适配宽度** to pull the whole page into the viewport and then simply scroll down.
- Settings are now: 打开笔记时的默认模式 / default mode and 白板版面宽度 / whiteboard page width.

Verification: `npm run verify:board` (34 assertions) now checks the whiteboard itself — the page
is 1280 px by default (from the shipped settings data), the page mode follows the theme line width
(760 px), changing the width setting really changes the page, one page element exists, the bundle and
the DOM contain **no** card artifacts, wheels scroll to the last paragraph, fit-width puts the whole
page inside the viewport, and the mobile touch gestures keep their anchor invariant.

## 1.3.4

- **The column is 1280 px by default — a desktop web content width.** A5 (560 px) turned out to be
  the wrong default for reading on a screen: long Chinese lines wrapped early and the column felt
  narrow. 1280 px is the width a web page uses, so lines are long, tables have room, and the column
  fills a normal screen — which is what makes reading a purely vertical gesture. The slider still
  names the paper presets (**A5 = 148 mm ≈ 560 px**, A4 ≈ 794 px) and the readout says
  `1280 px · 网页宽 Web` or `560 px · A5 · 148mm` so the choice is obvious either way.
- **适配栏宽 / fit column width** — a new toolbar button that fills the viewport with the column
  width, so on a phone (or a small window) you can see a whole line and then just scroll down. The
  board still opens at 100% (readable), and you decide when to trade size for the whole column.
- Indentation scales with the column: 18 px per level was invisible in a 1280 px column, so it is
  now about 3% of the width (≈ 38 px), still capped at three levels.

Verification: `npm run verify:board` is now **49 assertions** — the default is asserted to be
1280 px with the readout naming it (`网页宽 Web`), A5 is still asserted to be 148 mm ≈ 560 px as a
preset, and the new *fit column width* assertion measures the real DOM: after one tap the widest card
edge lands inside the viewport and the scale is below 1.

## 1.3.3

- **Two layouts for the whiteboard, and the default is the one you read.** The board used to be a
  branch tree only: headings in columns with connectors. On a phone that means hunting for content
  sideways. The default is now **单栏纵向流 / single column** — one A5-wide sheet per section,
  stacked in document order, so **scrolling down is reading down**, with indentation (up to three
  levels) and the left accent bar carrying the hierarchy instead of connectors.
- **分支树 / branch tree** is still there for the other job: seeing the whole outline at a glance.
  Pick it in the settings (设置 → 白板模式 → 白板排版) or flip it from the view toolbar; connectors
  belong to that layout, and the single column draws none (a line inside a one-wide column only
  overlaps the cards).
- Why cards at all, if it reads like a document? Because the board is zoomable when Obsidian's
  reading view is not: each section stays a sheet you can pinch into, tap to bring to the front, and
  the sections still fold by heading depth and by card limit. It is a page you can zoom, not a
  scroll that cannot.

Verification: `npm run verify:board` is now **48 assertions**. The new ones assert the shipped
default layout is `flow` (read from the real settings data, not a number copied into the test),
that every card shares the paper width with `y` strictly increasing in document order, that a
single column draws **zero** connectors, and — the behavioural one — that **scrolling down alone
reaches the last section** (the final card enters the viewport). Switching to branch tree flips the
connector assertions back on (count = parent/child relations, endpoints on the card edges), and
switching back drops them again.

## 1.3.2

- **Cards are paper now: A5 by default (148 mm ≈ 560 px).** The default card width was 320 px, so a
  card held only about twenty Chinese characters per line and the board read like a narrow strip
  rather than a page — reported as "the whiteboard looks tiny". A5 is the width a Chinese book line
  actually uses (30–40 characters), so it is now the default; A6 and A4 are one slider step away and
  the readout shows millimetres and the paper name (`560 px ≈ A5 · 148mm`).
- **The board opens at natural size (100%), not fitted.** Previously it focused the title card —
  which holds a title and a card count and nothing else — so the screen showed one small box in the
  middle. Now it opens at 100% with the root card in the top-left corner: one A5 page at reading
  size. The board still zooms and pans, and 回到全图 / 回到标题卡 are still in the toolbar.
- **Parents are top-aligned with their children, not centred against them.** A tidy tree centres a
  parent against its children band; on a document board that pushes a short title card into the
  middle of the screen and leaves the top half empty — the other half of "it looks tiny". Top
  aligned, the top-left corner is content and you read downward, like paper.
- **The whiteboard is a view: it recompiles every time.** Entering whiteboard mode compiles the
  Markdown again from scratch, reading the live editor text when the note is open in a pane (so
  unsaved edits show up), and it recompiles again when the note changes — a save, or typing in
  another pane, throttled to 400 ms. Nothing is written back, and there is a new
  **重新编译 / recompile** button in the toolbar for a forced refresh.
- Board positions are now keyed by card width: change the paper size and the saved zoom/pan is
  dropped rather than restored onto a board whose geometry no longer matches.

Verification: `npm run verify:board` is now 42 assertions — the new ones assert the shipped
default is A5 (`560 px ≈ A5 · 148mm`, from the real settings data, not a number copied into the
test), that opening lands at scale 1 with content within one margin of the top-left corner, and that
every card's real DOM width equals the configured paper width.

## 1.3.1

- **Fixed: opening a note as a whiteboard showed an empty view.** Obsidian's view lifecycle is
  `onOpen()` and then `setState()`. `onOpen()` reads the configured default mode (page) and
  paints the mode classes on the root element; `setState()` then switches the mode to whiteboard
  because the command asked for it — but nothing repainted the classes. The board was rendered into
  `.zr-board-host`, which `.zr-mode-page .zr-board-host { display: none }` hides, and the visible
  layer was the empty page. Symptom: run **编译成白板 / open as a whiteboard** and see nothing at all
  (setting the default mode to whiteboard worked, because then `onOpen()` painted the right classes).
- The mode classes are now applied **inside the render path** (`renderFile()`), not merely while
  building the UI: whichever layer is about to be filled is made visible first. The rule is written
  down next to the code, because "visibility is not a one-time setup" is exactly the sort of
  invariant that silently rots.
- `npm run verify:board` now **reproduces the bug before asserting the fix** (35 assertions): it
  paints the page classes, renders the board *without* re-aligning them, and asserts that exactly
  **0** cards are visible — then re-renders through the real path and asserts all of them are. A test
  that cannot fail is not a test.
- Board rendering failures are no longer silent: a caught error raises a Notice (and a console
  error) instead of leaving a blank view — on a phone there is no console to open.
- Keyboard shortcuts (`+` `-` `0`) are registered once per view instead of once per UI rebuild,
  so toggling the mode no longer handles the same key twice.

## 1.3.0

- **Whiteboard mode: the note is compiled into a board, instead of being put on one.** The previous
  version rendered the whole note as one tall page inside a zoomable surface. This version adds the
  other reading model: the Markdown itself becomes the board. Every heading turns into a card
  holding that section's content, frontmatter is dropped (it is metadata, not the note), and code
  fences, tables, callouts, quotes, math, images and Mermaid blocks become typed blocks inside their
  card — a `#` inside a code fence is deliberately *not* a heading. Cards are laid out as a tidy
  tree (children in the next column, vertically centred against their parent) with bezier
  connectors from the parent's right edge to the child's left edge, so the outline is visible at a
  glance on a phone and readable after a pinch.
- **Heights come from the real DOM, twice.** Estimating Chinese text height is guesswork, so the
  board is laid out once from an estimate (the board appears immediately) and again from measured
  `offsetHeight` values. Tables, images and long paragraphs then take exactly the room they need,
  and no card can overlap another.
- **Deep headings fold into their ancestor card.** Chinese notes often run four or five heading
  levels deep, and one column per level turns the board into a thin ribbon: sections deeper than the
  configured depth are folded in as subsections. A card limit folds deeper automatically, so a note
  with hundreds of headings cannot stall a phone, and the root card says how many cards there are.
- **Tap a card title to bring that card to the front**, 回到全图 fits the whole board, 回到标题卡
  returns to the root. Links inside a card keep their normal meaning: only the card head and its
  focus button zoom. The board transition is 240 ms, and it is cancelled the moment a pointer goes
  down so dragging never feels laggy.
- **The settings page is bilingual and searchable.** Every setting now reads 中文 / English — name,
  description and the options of every dropdown — and on Obsidian 1.13+ the page is declared through
  `getSettingDefinitions()`, so settings appear in the **settings search**: typing 双指 or pinch
  jumps straight to the two-finger switch (**双指捏合缩放 / Two-finger pinch zoom**), which is exactly
  what could not be found before. The content lives in one data module (src/settings-spec.ts) and is
  rendered twice — declaratively on 1.13+, imperatively on 1.5.7–1.12 — so older versions get the
  same page. A new 手势速查 / gesture cheat sheet lists every gesture in both languages.
- **Two-finger pinch is now a setting, with a sensitivity slider.** Turning it off leaves two fingers
  panning with their midpoint (handy when an IME or stylus emits a phantom second pointer); the
  slider scales the pinch ratio between 0.5x and 2x.
- **The zoom button on images and diagrams moved to the top-left corner by default.** The top-right
  corner is where Obsidian puts its own 编辑源文件 / edit source and more-options controls, and the
  button used to cover them (reported from a real phone). The corner is a setting, so anyone who
  preferred the old position can put it back — and both placement paths (persistent inline button and
  hover singleton) follow it.
- New settings: 打开笔记时的默认模式 / default mode (page or whiteboard), 卡片宽度 / card width,
  卡片展开层级 / outline depth, 卡片间距 / card spacing, 显示连线 / connectors, 卡片数量上限 /
  card limit, 放大按钮的位置 / zoom button corner.
- Zoom and position are now remembered **per mode** (page and whiteboard have different sizes, so
  sharing one transform made them fight). Whiteboard positions use the same `data.json`, with a
  `#board` suffix.
- Whiteboard mode is reachable from the command palette, the ribbon icon, the view toolbar, and the
  file-list context menu (编译成白板 / open as a whiteboard) — the last one so a phone user can go
  straight from the file list into a board without opening the note first.

Verification: `npm test` now has 84 unit tests, including the board compiler (fenced code,
frontmatter, table detection, heading level jumps, folding) and a contract test that fails if any
setting is missing its Chinese or English half. `npm run verify:board` is new: 32 assertions in a
real Chromium, asserting the geometry from the DOM — cards never overlap, every card is inside the
board bounds, every connector lands on its cards' edges, the measured height equals the layout
height (the second pass working), Ctrl+wheel keeps its anchor, a drag keeps panning without
zooming, and a click on a card title really centres that card — on a desktop viewport and with real
CDP touch events on a phone viewport. `npm run verify:gestures` grew the zoom-button corner
assertions (default top-left, the top-right edit zone stays clear, and switching the setting moves
the button back).

## 1.2.4

- **Wider diagram boxes: boxes now follow the text, the way PlantUML lays them out.** Mermaid caps a
  label at `flowchart.wrappingWidth = 200`, so a long Chinese label folds into four or five narrow
  lines — a 46-character label rendered as a 215 by 143 box. Raising the cap to 460 gives 478 by 98
  with two lines. This is a *rendering* parameter, not styling, so it cannot live in the theme: a
  theme is CSS, and CSS cannot reach the layout engine. The plugin does it instead, and the theme
  stays as it is.
- **The host's own settings survive.** `mermaid.initialize()` *replaces* nested config objects
  rather than merging them — passing `{ flowchart: { wrappingWidth: 460 } }` on its own drops
  Obsidian's `flowchart.useMaxWidth: false` **and** `themeVariables.fontFamily:
  var(--font-mermaid)`, which sends Chinese back to Mermaid's default `"trebuchet ms"`. The plugin
  reads the live config first (`mermaid.mermaidAPI.getConfig()`), deep-merges its parameters on top
  and hands the whole thing back, so `useMaxWidth`, `securityLevel` and the theme font are
  untouched.
- **Mermaid loads lazily**, so `window.mermaid` often does not exist yet when the plugin starts. It
  retries (every 500 ms, up to 30 s) and re-checks on `layout-change`. Diagrams already on screen
  pick the new layout up the next time they render.
- Settings: **Wider diagram boxes** (on by default) and **Max label width** (240–800 px, default 460).

Verification: `npm run verify:layout` — 17 assertions against real Mermaid and the real theme,
driven through the plugin's own code (`window.DiagramLayout`), not a copy of it: the long label goes
4 lines → 2, the box 215 px → 478 px, the host's `useMaxWidth` / `fontFamily` / `securityLevel`
stay exactly as they were, and installing twice is a no-op. Plus 6 unit tests for the merge itself.

## 1.2.3

- **The viewer keeps the diagram's ancestor semantics.** Moving only the `<svg>` into the viewer
  dropped the `.mermaid` class from its ancestry — and every text style a theme (or Obsidian's own
  `app.css`) declares for diagrams hangs off that class: `.mermaid svg text`, `.nodeLabel`,
  `.label`, `.labelText` — font size, colour, line height. Without it, the HTML labels Mermaid
  renders inside `foreignObject` fell back to Mermaid's inline font size, and because those labels
  are sized by their own `<span>`, they overflowed their boxes and overlapped each other. The
  holder now carries the class. It is only a semantic marker; the appearance still comes from the
  theme.
- **The pinned size is the rendered size, not `getBBox()`.** The two are not the same thing: a
  theme that fits a diagram to the text column renders it at, say, 80%, while `getBBox()` reports
  the diagram's own user units. Pinning the latter meant the viewer silently scaled the diagram back
  to 100%, so every label reflowed and overflowed — the *"放大后编成鬼样子"* screenshot.
  `getBoundingClientRect()` now supplies the pinned pixels, and `getBBox()` is kept only for the
  "original size" readout.

Verification: new `tools/verify-diagram-labels.mjs` (`npm run verify:labels`), wired into
`npm run check`. It builds a real page, loads the built theme and the plugin's `styles.css`,
renders an actual Mermaid flowchart whose labels contain `<br/>` line breaks, measures the label
boxes in user coordinates, opens the viewer, neutralises the canvas transform and measures again.
**9 assertions, all passing.** It was confirmed to fail (8/9, "搬移后没有标签明显溢出外框") when the
companion theme fix is reverted, so the guard actually fires.

Companion change in the theme (1.2.4): the label resets are no longer scoped to
`.markdown-rendered`, and the in-diagram text carries its own `font-family` and text metrics.

## 1.2.2

- **The viewer shares the note's background colour** (`--background-primary`). Some parts of a
  diagram are opaque by design — an edge label carries a backing rectangle so the connector line
  does not cut through its text — and on a differently coloured surface those rectangles read as
  bright patches. With the same background, a diagram in the viewer looks exactly like the diagram
  in the note, only bigger.
- The canvas layer itself stays transparent; only the viewport carries the colour.
- Verified with two new assertions (70 in total, all real events): the viewport's computed
  background equals `--background-primary`, and the canvas computes to `rgba(0, 0, 0, 0)`.

Companion change in the theme (1.2.3): diagram nodes are now drawn as coloured outlines with a
transparent interior, so a box has colour where it should (the stroke) and no fill inside.

## 1.2.1

- **The zoom button is always visible now** (default), instead of appearing only while the pointer
  is over an image. Hunting for a button that disappears the moment you move towards it was the
  wrong interaction. It sits in the top right corner of every image and diagram, at 42% opacity so
  it does not shout, and goes fully opaque when you point at it. The old hover behaviour is still
  available: turn off *Always show the zoom button* in the settings. On touch devices the button is
  hidden entirely, because a tap already opens the viewer.

Panels are wrapped rather than repositioned: each image gets a small wrapper that carries the
button, so it scrolls and reflows with the image — no scroll or resize listeners, nothing to get
out of sync. The wrapper is removed when the plugin unloads.

Three things the harness caught while building this, all of them invisible in code review:

- Wrapping an SVG in an `inline-block` wrapper collapses a `width="100%"` SVG to zero width,
  because its size then depends on the wrapper and the wrapper on its content. Diagrams are
  therefore hosted by their existing container (only `position: relative` is added), and only
  images get wrapped.
- Applying the wrapper class to a chart container has the same effect, so the two concerns are now
  two classes: `.zr-zoom-host` (positioning only) and `.zr-zoom-host-wrap` (the image wrapper).
- A button appended *inside* an `<svg>` is not rendered at all — its box is 0 by 0 and clicks do
  nothing. The host is now always an HTML element, climbing out of the SVG namespace if needed.

Verification: **68 assertions**, all driven by real events — the button is visible without hovering,
measured inside the image's top right corner, clicking it opens the viewer, clicking the image does
not, the viewer content computes to no background, border or shadow, three common SVG shapes each
open and zoom to 35x, and switching the setting back to hover mode restores the old behaviour.

## 1.2.0

- **The zoom entry point is now a small button in the top right corner of an image** (and of a
  diagram), shown only while the pointer is over it. Clicking the image itself keeps its usual
  meaning, which is the calmer interaction for reading: the button appears when you want it and
  stays out of the way otherwise. On touch devices — where there is no hover — a tap still opens
  the viewer.
- New setting **Open the viewer by clicking images too** (off by default) for anyone who prefers
  the direct click on desktop.
- **Nothing is decorated in the viewer.** An image is shown as it is; a diagram keeps its
  transparent background with solid lines and text, exactly as it looks in the note — no card
  surface, no border, no shadow, no rounded corners. What you zoom into is what you saw.

- **Zooming in is no longer capped at 8x.** The default limit is now 64x (settings allow up to
  256x), because reading the small print of a 4K screenshot regularly needed more than 8x. The
  corner button is also clamped into the visible area now, so it stays clickable on diagrams that
  are wider than the window.
- **SVGs drawn by other plugins zoom too.** The button and the viewer used to look only for
  `.mermaid svg`; now any reasonably large `<svg>` in the rendered note is picked up
  (Excalidraw embeds, chart blocks, plain `<svg>` in a note), while icons — callout icons, button
  icons, inline symbols — are excluded by size and by their container.

Fixed, and this one is why "other SVGs" could not be zoomed at all: the viewer measured a diagram
*after* moving it into the overlay, where `getBBox()` and `getBoundingClientRect()` both return
zero on an element that is not in the document. With no measured size, the fit scale was garbage
and the diagram's own size depended on its container. It now measures and pins the pixel size
first, then moves the node.

Verification grew from 43 to **65 assertions**, all driven by real events: the button is absent
until the pointer is over an image, sits 6px inside the image's top right corner (measured against
the image's own bounding box), opens the viewer when clicked, does not open it when the image
itself is clicked, both the image and the diagram inside the viewer compute to
`background: rgba(0, 0, 0, 0)`, `border: 0`, `box-shadow: none`, and three SVG shapes that
plugins commonly produce (viewBox only, `width="100%"`, fixed pixels) each open, get their size
pinned, and keep zooming to 35x.

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