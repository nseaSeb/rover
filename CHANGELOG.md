# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
