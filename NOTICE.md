# Third-party notices

Rover itself is MIT licensed — see [LICENSE](LICENSE).

This file lists the third-party code Rover redistributes. It is kept separate
from `LICENSE` on purpose: licence scanners (GitHub's included) read `LICENSE`
as a single licence text, and anything appended to it makes them report
"Other" instead of MIT.

## OpenLayers

Rover bundles [OpenLayers](https://openlayers.org/) into the JavaScript it
ships, so that applications without an npm toolchain can use the library:

- `priv/static/rover.js`
- `priv/static/rover.min.js`

`priv/static/rover.external.js` does **not** bundle it — that build leaves `ol`
as a peer import for applications that supply their own copy.

OpenLayers is distributed under the **BSD 2-Clause License**,
Copyright 2005-present, OpenLayers Contributors.
Full text: <https://github.com/openlayers/openlayers/blob/main/LICENSE.md>

`priv/static/rover.css` includes OpenLayers' own `ol.css`, under the same
licence.

## Tile providers

Rover ships no map imagery. `Rover.Tiles` presets point at third-party tile
servers, each with its own terms and attribution requirements — which Rover
renders in the map's attribution control. Keeping that attribution visible is
generally a condition of use, not a courtesy.

The OpenStreetMap and CARTO presets target public demo endpoints whose usage
policies forbid production traffic. For anything real, pass `{:xyz, url}` with
tiles you are entitled to serve.

CARTO's basemaps (`:carto_light`, `:carto_dark`, `:carto_voyager`) now need a
free API key; without one the tiles arrive watermarked. CARTO's terms also
require that its attribution, and OpenStreetMap's, stay visible — Rover renders
both. See `Rover.Tiles` for how to configure a key.
