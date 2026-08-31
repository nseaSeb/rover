# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Drawing new shapes**: `Rover.start_drawing/3`, `Rover.stop_drawing/2` and
  `on_draw_end`. The other half of 0.4.0's `:editable`, which could only reshape
  a geometry that already existed. Deliberately a mode rather than an attribute —
  there is no shape yet to hang a per-item flag on, and an always-armed
  `ol/interaction/Draw` would swallow every ordinary map and shape click — so it
  is a one-shot command in the shape of `fly_to/4`. `on_draw_end` is the only
  event with no `"id"`: the shape does not exist until the server makes one, so
  identity is the server's to assign.

  The sketch is drawn into a **separate scratch source**, never into
  `ShapeLayer`'s own. A feature `Draw` put there would be absent from the
  `entries` map `reconcile/1` tracks, so the server's echo of the new shape would
  render a second feature beside it and the polygon would appear twice. The
  scratch layer is cleared by the same call that applies a new `:shapes` list, so
  the handover is invisible on the accepted path and is the cleanup on the
  abandoned one.

  `:type` is `:polygon`, `:line` or `:point`. There is no `:circle`: OpenLayers
  draws one, GeoJSON cannot represent one, and it could never round-trip through
  `Rover.Shape`. Escape abandons the sketch in progress and leaves the mode
  armed; new points snap to the shapes already on the map; a map with
  `interactive={false}` refuses to arm, and locking one mid-draw cancels the
  mode rather than remembering it.

  While the mode is armed the map does not report clicks or tooltips of its own:
  a click that places a vertex is not a click on the map, and reporting it would
  fire `on_map_click` once per corner — dismissing any open popup each time,
  since the popup layer listens for exactly that.
- **Dialyzer in CI**, and `mix dialyzer` locally. The public API is annotated
  with `@spec` end to end and nothing ever checked those annotations against the
  code. The PLT is written to `_build/plts`, so the `_build` cache CI already
  keeps carries it; `:missing_return` and `:extra_return` are on, because a
  `@spec` that has drifted from its function is the thing worth catching.
- **A coverage floor.** `mix test --cover` now fails below the threshold declared
  in `mix.exs`, and the lint row of the CI matrix runs it. The floor is a
  ratchet: raise it when a release lands above it, never lower it to make a red
  run green.

### Removed

- A `Rover.Shape` fallback clause that could not be reached — every caller of the
  private `get/2` is already inside an `is_map/1` guard. Dialyzer's first find.
## [0.4.0] - 2026-08-12

### Added

- **`:editable` on shapes**, and `on_shape_edit_end`. Lets the user drag a
  shape's vertices directly on the map — the geometry equivalent of
  `:draggable` on a marker, built the same way: an `ol/interaction/Modify`
  filtered to editable single-feature shapes, and the same "forget the cached
  identity so a same-valued server payload still reapplies" fix `:draggable`
  needed, ported from a geometry hash to the `:rev` shapes are actually diffed
  by. A `FeatureCollection` shape (more than one underlying feature) stays
  read-only — there is no single geometry a drag could write back to.
  `on_shape_edit_end`'s geometry is always bare; a `Feature`-wrapped shape's
  `properties` travel in their own key on the payload instead, so merging the
  result back into `:geometry` does not silently lose them.

### Fixed

- The installation example still read `{:rover, "~> 0.3"}` in both the README
  and the `Rover` moduledoc.

## [0.3.2] - 2026-08-10

### Added

- **A smoke test over the bundles in `priv/static`** (`assets/test/bundles.test.js`).
  Nothing exercised what Hex actually ships: the playground and the browser suite
  both import `assets/js/index.js`, and the CI `bundles` job only runs
  `git diff --quiet -- priv/static`, which proves the artefacts match the source
  and not that they load. The new test loads `rover.js` and `rover.min.js` and
  checks the export surface, the hook's LiveView callbacks and a `project` /
  `unproject` round trip; `rover.external.js` cannot be imported from
  `priv/static` — it leaves `ol` as a peer import and there is no `node_modules`
  above it — so it is checked as text instead.
- Elixir 1.16.3 in the CI matrix. It sits inside the `~> 1.15` requirement and
  was the one version in range that nothing tested.

### Fixed

- **The bring-your-own-OpenLayers instructions did not build.** Following them
  as written stops esbuild with `Could not resolve "ol/Map.js"`, once per each
  of the twenty-seven `ol` specifiers the peer build leaves bare. esbuild
  resolves a bare import by walking up from the file that wrote it —
  `deps/rover/priv/static/`, where no `node_modules` exists — and Phoenix's
  generated `NODE_PATH` covers `deps` only, never `assets/node_modules`. Both
  the README and the `Rover` moduledoc now carry the `config/config.exs` change
  that puts `ol` on the search path. Reproduced against esbuild 0.25.12 with
  Phoenix's own `cd` and `NODE_PATH`, and confirmed fixed the same way.
- **The installation example in the `Rover` moduledoc still read
  `{:rover, "~> 0.2"}`.** 0.3.1 fixed the README copy and missed this one, which
  is the snippet HexDocs renders on the module page.
- `mix precommit` ran `assets.test` before `assets.build`, so the new bundle
  smoke test would have checked the artefacts from the previous run and let the
  ones about to be committed through untested.
- The changelog had no link definitions for `[0.3.0]` and `[0.3.1]`, so both
  headings rendered as literal brackets.
- The comment explaining why `setContent` fits once was attached to
  `setHeatmap`, the method above it.

## [0.3.1] - 2026-08-08

### Fixed

- **The Livebook (`notebooks/rover.livemd`) failed at section 5** with `assign/2
  imported from both Kino.JS.Live.Context and Phoenix.Component, call is
  ambiguous`. Section 4 imported `Phoenix.Component` at the top level of its
  cell to get `~H`; Livebook threads a cell's top-level imports into every
  later cell, so it collided with `Kino.JS.Live.Context`'s own `assign/2` in
  `RoverKino`. The import now lives inside its own module, scoped to the cell
  that needs it.
- The installation example in the README still read `{:rover, "~> 0.2"}`, one
  series behind what it was installing. The same copy in the `Rover` moduledoc
  was missed; see Unreleased.

## [0.3.0] - 2026-08-07

### Added

- **Clustering** — `cluster={true}`, or a keyword list of `:distance`,
  `:min_distance` and `:zoom_on_click`. A group of one is drawn as its own marker;
  clicking a group zooms into it and sends `on_cluster_click` with the member ids.
  Reconciliation is untouched, because `ol/source/Cluster` wraps the marker source
  rather than replacing it — the markers are still diffed by id, only the drawing
  changes. A grouped marker has no popup (its pin sits at the group's centre, so a
  popup would point at empty space) and cannot be dragged.
- **`Rover.Heatmap` and the `heatmap` attribute** — density as a heat field. No
  `:id` required, unlike markers and shapes: a heatmap is an aggregate, so per-point
  identity buys nothing. Diffed by revision instead, which also means a style-only
  change restyles the layer without rebuilding the field. Tunable with
  `heatmap_style`: `:radius`, `:blur`, `:opacity`, `:gradient`.
- **A `<:shape_popup>` slot**, anchored where the geometry was clicked rather than at
  its centroid. Popup keys are now namespaced (`marker:1`, `shape:1`), because a
  marker and a shape may legitimately share an id and two nodes answering one
  selector means one of them silently wins.
- **`:tooltip` on shapes**, shown at the pointer on hover, falling back to `:label`.
- A shape claims a click when **either** the server or a popup wants it. Keying it on
  the configured event alone meant a `<:shape_popup>` could never open without an
  `on_shape_click` handler — while marker popups need no server at all. A shape with
  neither still claims nothing, so scenery does not swallow `on_map_click`.
- **`Rover.fly_to/4` and `Rover.fit_to/4`** — imperative view control, for when the
  view is a gesture rather than state. `center` and `zoom` are attributes, so using
  them for "the user clicked a row, take me there" costs you the automatic framing
  and forces the view into your assigns. These are commands: nothing is assigned,
  no attribute changes, and the map keeps its declarative framing for everything
  else. `Rover.bbox/1` is public alongside them, and takes markers, shapes, plain
  coordinates or a box.
- **A browser suite.** Five Playwright scenarios against the `mix dev` playground,
  guarding the paths where every rendering bug this library has shipped actually
  lived: the tile URLs the browser requests, the popup DOM, and the view after an
  update. Runs in CI, and via `mix assets.test.browser`. Deliberately out of
  `mix precommit` — it needs a server and a browser.
- The map instance is exposed on its own element as `el._rover`. The browser suite
  needs it (a marker is drawn in a canvas and has no DOM node, so a coordinate has
  to be turned into a pixel through the map itself), and it is the fastest way to
  answer "why is my marker not there?" from a console.
- `?shapes=parcel|route|none` on the playground picks the initial geometry, so the
  framing bug's conditions can be reproduced on a fresh mount.

### Fixed

- Clustering, from review, before it ever shipped:
  - Every discarded `ol/source/Cluster` stayed subscribed to the marker source, so
    each toggle of `cluster` left another live clusterer re-clustering the whole set
    on every update, in a source nothing draws.
  - Clicking a group above zoom 16 **zoomed out**. `View#fit` treats `maxZoom` as a
    resolution floor, so it clamps both ways: the drill-in now uses the basemap's own
    ceiling and refuses to move the view backwards at all.
  - A `:draggable` marker alone in a group was still draggable, and the drag moved the
    throwaway feature `Cluster` allocates — the marker's own geometry untouched, the
    event reporting coordinates for something that is not the marker, and the pin
    snapping back on the next recompute. Nothing is draggable while clustering, which
    is what the documentation already claimed.
  - The `Cluster` wrapper dropped `wrapX: false`, so groups repeated across world
    copies.
  - A cluster click did not dismiss an open popup, which mattered with
    `zoom_on_click: false` where nothing else moves.
  - A non-keyword list — `cluster={[:distance]}` — raised a match error instead of the
    friendly message every other option in the component produces.
  - `on_cluster_click` was in neither event table and had no docs, so the only place
    its payload was written down was the playground.
  - Reconciling a batch of moved or restyled markers reclustered the **entire**
    marker set once per feature touched rather than once for the batch —
    `ol/source/Cluster` recomputes on every `change` event from the source it
    wraps, and every `setCoordinates`/`setStyle` call fires one. A fleet of five
    hundred with fifty vehicles moving in one update paid for fifty full passes,
    not one, on exactly the workload clustering exists to make affordable.
- Field accessors of the wrong arity now raise instead of being read as a map key
  and silently substituting the default. `mix format` rewrites
  `&(&1.orders / 40)` as `& &1.orders/40`, which Elixir parses as an arity-40
  capture — so the mistake is easy to make and used to produce a quietly wrong map.
  Applies to `Rover.Marker`, `Rover.Shape` and `Rover.Heatmap`.
- **Live reload never worked in the playground.** The endpoint declared
  `plug Phoenix.LiveReloader` but not the socket it connects to, so the browser
  retried a 404 forever while the esbuild watcher rebuilt bundles nobody loaded.
  Found by the browser suite on its first run, by refusing to tolerate a console
  error.
- The playground had no PubSub, so the live-reload channel raised on every join.

- **`height={nil}` is now legal, and actually works.** `attr :height, :string`
  rejected the `nil` its own documentation recommended — a compile warning, so an
  error in any project building with `--warnings-as-errors`. It is `:any` now, like
  `:class`. The attribute is also genuinely omitted rather than rendered as
  `style=""`, because an empty inline style still beats a class in the cascade: a
  map sized by `class="h-96"` or by a flex parent could not be sized at all.
  A `style` you pass yourself now takes precedence over `height`.

### Changed

- The README's opening argument no longer rests on a comparison with another
  library. It answers the question a Phoenix developer actually faces — "why not
  just write a hook?" — and Leaflet's name has moved to a **Coming from a Leaflet
  hook** section, where it is a migration table rather than a benchmark. That
  section also names the three things that catch people: markers need a stable
  `:id`, `height` beats your class, and stroke opacity goes through `rgba()`.

## [0.2.0] - 2026-08-06

Everything the README called "the obvious next steps", minus clustering.

### Added

- **`Rover.Shape` and the `shapes` attribute** — GeoJSON geometries: outlines,
  routes, zones. A bare geometry, a `Feature` or a `FeatureCollection`; atom or
  string keys; or an undecoded JSON string, so `ST_AsGeoJSON` output goes straight
  in. Styled with `:color`, `:width`, `:fill_color`, `:fill_opacity` and `:label`.
- Shapes travel in their own `data-rover-shapes` attribute, so a marker that moved
  does not re-serialise a cadastral outline that did not.
- Geometry is diffed by a **server-computed `:rev`** (`:erlang.phash2/1` by
  default, or your own `updated_at`), never by hashing coordinates on the client. A
  route is thousands of points; hashing it per update is the cost the reconciler
  exists to avoid.
- A map with shapes and no markers now frames the geometry. Previously it centred
  on `{0.0, 0.0}` — a parcel page showed the Gulf of Guinea.
- **`:emoji` on markers**, drawn as canvas text rather than a DOM overlay, so it
  keeps the shared style cache, hit testing and reconciliation by identity that a
  pin has.
- **A `<:popup>` slot**, rendered once per marker and shown on click with no server
  round-trip. Closed by `data-rover-popup-close`, a map click, or Escape.
  Deliberately not an `ol/Overlay`: an Overlay reparents its node into the map
  viewport, which lives inside `phx-update="ignore"`, and LiveView would then be
  patching markup it no longer owns. Rover positions server-rendered nodes that
  never leave the outer element.
- **`:ign_plan` and `:ign_ortho`** — the French Géoportail's reference plan and
  aerial orthophotography, both intended for production use rather than the demo
  endpoints the OSM and Carto presets point at.
- `on_shape_click`, with markers winning ties: a pin inside its own parcel outline
  answers the click.

### Fixed

- **Markers were excluded from the initial framing whenever shapes were present.**
  The mount path loaded shapes, fitted, then loaded markers — and the second fit
  declined, because the first had already happened and `fit` defaults to `:once`.
  A map with both therefore framed the shapes alone, and any marker outside their
  bounding box was off-screen for good. Both layers are now loaded before a single
  fit. This was the release's headline combination, so it is worth being blunt: it
  was broken.
- The zoom cap that keeps a lone marker from filling the screen had been removed
  for any non-degenerate extent, so two markers twenty metres apart zoomed past
  what the basemap can render. The cap now follows the tile source's own ceiling,
  and only marker-only extents stop earlier.
- A click inside a shape no longer swallows `on_map_click` when `on_shape_click`
  was never wired. Shapes are filled by default, so their whole interior is
  hit-testable — a click-to-place-a-marker map with zone outlines silently stopped
  working anywhere inside a zone.
- An open popup survives a LiveView patch. `hidden` is static in the template, so
  every re-render of the marker comprehension restored it and the popup vanished
  while the client still believed it was open.
- A popup follows the pin during a drag, instead of hanging back at the
  coordinate the server last sent.
- A popup near the top edge flips below its marker rather than being clipped away
  by the container's hidden overflow.
- Geometry in the wrong projection — `ST_AsGeoJSON` on an EPSG:3857 column returns
  metres — no longer raises while deriving the map's centre. Framing is a
  convenience; taking a LiveView down at render time over it was the wrong trade.

### Changed

- `mix dev` takes `PORT`, and the playground now exercises shapes, emoji, popups
  and the IGN layers.
- Fitting spans markers and shapes together, and the zoom cap that keeps a lone
  marker from filling the screen no longer applies to a polygon — capping a small
  parcel left it a speck in the middle of a region.

### Bundle size

`priv/static/rover.min.js` grows from 333,765 to 360,062 bytes (98,910 → 104,868
gzipped): the `ol/format/GeoJSON` reader and the extent helpers. The peer build
`rover.external.js` grows from 17,246 to 27,319 bytes (5,364 → 7,789 gzipped) —
shapes and popups are Rover's own code, so leaving `ol` external does not exclude
them.

## [0.1.0] - 2026-08-05

### Added

- `<.map>` function component: declarative map with `center`, `zoom`, `markers`.
- `Rover.Marker` — normalises plain maps, structs and Ecto schemas into markers.
- `Rover.Geo` — strict `{lat, lon}` handling, bounding boxes, distance.
- `Rover.Tiles` — named tile presets (`:osm`, `:carto_light`, `:carto_dark`, …)
  plus arbitrary XYZ URLs.
- JavaScript runtime bundling OpenLayers, exposed as the `Rover` LiveView hook,
  with keyed marker reconciliation (only changed features touch the map).
- Events pushed back to LiveView: marker click, map click, move end, marker drag.
- `notebooks/rover.livemd` — a Livebook that exercises each layer and renders a
  live map from Rover's own bundle.
- GitHub Actions CI: Elixir 1.15–1.19, the Node test suite, and a check that the
  committed `priv/static` bundles match `assets/js`.

### Fixed

- **`mix dev` now actually serves.** `Supervisor.start_link/2` links to the
  process that calls it — the one evaluating `dev.exs`. That process finished, the
  link took the endpoint down with it, and `--no-halt` kept the VM alive: the
  playground logged "Running ... at 127.0.0.1:4020" and then refused every
  connection.
- `listeners: [Phoenix.CodeReloader]` added, which Phoenix 1.8 requires for code
  reloading; without it every request logged a warning and a stacktrace.
- Any 404 in the playground — the browser asking for `/favicon.ico` was enough —
  raised in Phoenix's error handler, because no error view was configured. The
  playground now renders status pages, and the layout carries an inline favicon so
  the request is not made at all.
- `PORT=4021 mix dev` runs the playground on another port.
- **The map no longer jumps to a world view when a marker moves.** With no
  `center`, Rover derives one from the markers — a value that shifts whenever any
  marker does. The client read each shift as an instruction and animated to the
  derived centre at the derived zoom, landing on zoom 2 with no way back. The
  derived centre is now flagged and excluded from view-change detection.
- A map given no `center` now always frames its markers once when it appears,
  even with `fit={false}` — previously that combination rendered the whole world.
- `setConfig` re-applies `controls` and `interactive`. Toggling either after
  mount used to reach the client and do nothing.
- `interactive={false}` now withholds the zoom, fullscreen and rotate controls
  and stops emitting click events, tooltips and cursor changes. Attribution and
  the scale line stay. Previously the +/- buttons still moved the view and clicks
  still pushed events.
- `on_move_end` flags a `bbox` that straddles the antimeridian with
  `"crosses_antimeridian" => true`, instead of silently returning `west > east`
  to a viewport-query that then matches nothing.
- A partial `marker_fields` mapping (`[lat: :latitude]`) no longer breaks reading
  the other axis from its usual key.
- A marker dragged on the client is put back if the server does not accept the
  move; the stale geometry hash used to make the correcting payload look
  unchanged.
- `RoverMap` supplies a default view instead of throwing when handed an
  incomplete config, which makes the malformed-payload fallback real.
- The style cache is bounded, so volatile labels cannot accumulate styles for the
  lifetime of a long-lived LiveView session.
- `LICENSE` is now the MIT text alone; the OpenLayers notice moved to
  `NOTICE.md`. Appending to `LICENSE` made licence scanners report "Other"
  instead of MIT.
- `<.map>` no longer emits a trailing space in `class` when none was given.

### Documented

- Marker ids round-trip through JSON: integers and strings survive, atoms come
  back as strings and will not match.
- `fit` governs *re*fitting; the initial framing is separate.

[Unreleased]: https://github.com/nseaSeb/rover/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/nseaSeb/rover/releases/tag/v0.4.0
[0.3.2]: https://github.com/nseaSeb/rover/releases/tag/v0.3.2
[0.3.1]: https://github.com/nseaSeb/rover/releases/tag/v0.3.1
[0.3.0]: https://github.com/nseaSeb/rover/releases/tag/v0.3.0
[0.2.0]: https://github.com/nseaSeb/rover/releases/tag/v0.2.0
[0.1.0]: https://github.com/nseaSeb/rover/releases/tag/v0.1.0
