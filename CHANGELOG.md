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
