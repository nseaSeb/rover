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

- `LICENSE` is now the MIT text alone; the OpenLayers notice moved to
  `NOTICE.md`. Appending to `LICENSE` made licence scanners report "Other"
  instead of MIT.
- `<.map>` no longer emits a trailing space in `class` when none was given.
