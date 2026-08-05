# Rover

**Maps for Phoenix LiveView, powered by [OpenLayers](https://openlayers.org/).**

[![Hex.pm](https://img.shields.io/hexpm/v/rover.svg)](https://hex.pm/packages/rover)
[![Docs](https://img.shields.io/badge/hex-docs-blue.svg)](https://hexdocs.pm/rover)

OpenLayers is a serious mapping engine. It is also ten concepts deep before you
can put three pins on a map: `Map`, `View`, `Layer`, `Source`, `Feature`,
`Geometry`, `Style`, `Overlay`, `Interaction`, `Control`.

Rover keeps the engine and removes the ceremony.

```heex
<.map id="clients" center={{45.75, 4.85}} zoom={12} markers={@clients} />
```

```elixir
assign(socket,
  clients: [
    %{id: 1, lat: 45.76, lon: 4.83, label: "Atelier"},
    %{id: 2, lat: 45.74, lon: 4.86, label: "Dépôt"}
  ]
)
```

That is the whole thing. Assign a list of maps, get a map. Assign a different
list, and Rover updates only the markers that actually changed.

## Why not just use Leaflet?

Leaflet is easy and OpenLayers is capable, and most Elixir apps end up picking
easy. Rover is a bet that you should not have to choose: the ergonomics of a
Leaflet wrapper, on top of the engine that handles projections, huge vector
layers, WMS/WMTS, and the rest of the serious GIS surface — so the day your
"three pins" turn into a cadastral overlay, you are not rewriting.

## Installation

```elixir
def deps do
  [{:rover, "~> 0.1"}]
end
```

Rover ships a prebuilt JavaScript bundle with OpenLayers already inside it, so a
stock `mix phx.new` application — no `npm`, no `node_modules`, no
`package.json` — works as-is.

In `assets/js/app.js`:

```js
import { RoverHooks } from "../../deps/rover/priv/static/rover.js"

const liveSocket = new LiveSocket("/live", Socket, {
  params: { _csrf_token: csrfToken },
  hooks: { ...RoverHooks }
})
```

In `assets/css/app.css`:

```css
@import "../../deps/rover/priv/static/rover.css";
```

And in the `html_helpers` block of your `lib/my_app_web.ex`:

```elixir
import Rover.Components
```

## Markers

A marker is anything with an id and a coordinate. Plain maps, structs, Ecto
schemas:

```elixir
%{id: 1, lat: 45.75, lon: 4.85, label: "Atelier"}
```

| Field | Meaning |
|---|---|
| `:id` | **Required.** Stable identity used to diff the map. |
| `:lat` / `:lon` | **Required.** Also accepted: `:latitude`/`:longitude`, `:lng`. |
| `:label` | Text drawn next to the marker. Falls back to `:name` or `:title`. |
| `:color` | Colour of the default pin, e.g. `"#e11d48"`. |
| `:icon` | URL of an image to use instead of the pin. |
| `:scale` | Size multiplier. |
| `:tooltip` | Shown on hover. Defaults to the label. |
| `:draggable` | Lets the user move it — see `on_marker_drag_end`. |
| `:data` | Any map; echoed back verbatim in events. |

If your schema names things differently, say so once:

```heex
<.map
  id="stores"
  markers={@stores}
  marker_fields={[lat: :latitude, lon: :longitude, label: :trade_name]}
/>
```

## Events

```heex
<.map id="clients" markers={@clients} on_marker_click="select_client" />
```

```elixir
def handle_event("select_client", %{"id" => id}, socket) do
  {:noreply, assign(socket, selected: id)}
end
```

| Attribute | Payload |
|---|---|
| `on_marker_click` | `%{"id" =>, "lat" =>, "lon" =>, "data" =>}` |
| `on_map_click` | `%{"lat" =>, "lon" =>}` |
| `on_move_end` | `%{"center" => [lat, lon], "zoom" =>, "bbox" => %{"south" =>, "west" =>, "north" =>, "east" =>}}` |
| `on_marker_drag_end` | `%{"id" =>, "lat" =>, "lon" =>}` |

Inside a `Phoenix.LiveComponent`, add `target={@myself}`.

## Coordinates are always `{lat, lon}`

The order you say out loud, and the order Leaflet uses. OpenLayers works in
`[x, y]` — that is, `[lon, lat]` projected to Web Mercator — and Rover does that
flip once, in JavaScript, where you never see it.

`Rover.Geo` is strict about it on purpose: a latitude of `145.75` raises rather
than quietly drawing your marker in the middle of the Pacific.

## Basemaps

```heex
<.map id="m" tiles={:carto_dark} ... />
<.map id="m" tiles={{:xyz, "https://tiles.example.com/{z}/{x}/{y}.png", attributions: "© Example"}} ... />
<.map id="m" tiles={:none} ... />
```

Presets: `:osm`, `:osm_hot`, `:carto_light`, `:carto_dark`, `:carto_voyager`,
`:opentopomap`, `:esri_world_imagery`.

Each one carries the attribution its provider requires, and Rover renders it.
The OSM and Carto presets point at **public demo servers with usage policies
that forbid production traffic** — for anything real, point `{:xyz, …}` at tiles
you are entitled to use.

## What "only update what changed" actually means

The map is rendered as two attributes: `data-rover` (the view) and
`data-rover-markers` (the list). LiveView already diffs attributes, so changing
only your markers sends only your markers.

On the client, Rover diffs that list *by marker id* and splits the work in two:
a marker that moved has its geometry mutated in place; a marker that was
recoloured gets a new style and keeps its geometry. Everything else is left
untouched — same `Feature` object, same `Style` object, shared between every
marker that looks alike.

Adding one marker to a list of five hundred adds one feature. It does not
rebuild the layer, interrupt a pan, or close an open tooltip. There are tests
asserting exactly this, by object identity, in `assets/test/markers.test.js`.

## Reaching OpenLayers when you need it

`<.map>` is a floor, not a ceiling. The bundle also exports the pieces:

```js
import { RoverMap, MarkerLayer, project, unproject } from "../../deps/rover/priv/static/rover.js"
```

### Bring your own OpenLayers

If you already build with `npm` and want to own the `ol` version:

```js
// package.json: "ol": "^10.0.0"
import { RoverHooks } from "../../deps/rover/priv/static/rover.external.js"
```

## Development

```sh
mix deps.get
mix assets.build      # npm install + esbuild the bundles
mix dev               # playground on http://localhost:4020
mix precommit         # format, compile --warnings-as-errors, both test suites
```

The playground (`dev/demo_live.ex`) is the reference for the intended
experience: a list of maps, buttons that add / move / recolour / remove markers,
and a log of the events coming back. There is no OpenLayers in that file.

## Status

Early. The marker path is complete and tested; polygons, lines, clustering,
GeoJSON layers, popups-as-slots and drawing interactions are the obvious next
steps. Issues and PRs welcome.

## Licence

MIT. Rover bundles OpenLayers, which is BSD 2-Clause — see [LICENSE](LICENSE).
