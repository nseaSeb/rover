# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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

[0.2.0]: https://github.com/nseaSeb/rover/releases/tag/v0.2.0
[0.1.0]: https://github.com/nseaSeb/rover/releases/tag/v0.1.0
