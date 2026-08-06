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
  [{:rover, "~> 0.2"}]
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
| `:emoji` | An emoji drawn in place of the pin, e.g. `"🏠"`. |
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
| `on_shape_click` | `%{"id" =>, "lat" =>, "lon" =>, "data" =>}` |
| `on_map_click` | `%{"lat" =>, "lon" =>}` |
| `on_move_end` | `%{"center" => [lat, lon], "zoom" =>, "bbox" => %{"south" =>, "west" =>, "north" =>, "east" =>}}` |
| `on_marker_drag_end` | `%{"id" =>, "lat" =>, "lon" =>}` |

Inside a `Phoenix.LiveComponent`, add `target={@myself}`.

## Shapes

Outlines, routes and zones come in as **GeoJSON**:

```heex
<.map id="parcel" shapes={@parcels} tiles={:ign_ortho} />
```

```elixir
assign(socket,
  parcels: [
    %{id: p.id, geometry: p.cadastral_outline, color: "#16a34a", fill_opacity: 0.2}
  ]
)
```

A bare geometry, a `Feature` or a `FeatureCollection`; atom or string keys; or an
undecoded JSON string, so `ST_AsGeoJSON` output goes straight in. Fields:
`:color`, `:width`, `:fill_color`, `:fill_opacity`, `:label`, `:rev`, `:data`.

Shapes are **the one place Rover is not latitude-first** — GeoJSON is defined as
`[longitude, latitude]` and the standard wins, because geometry is never typed by
hand. See `Rover.Shape` for why.

A map with shapes and no markers frames the geometry, so a parcel page needs no
`center`.

### Geometry is diffed by revision, not by hashing

Markers hash their coordinate — two numbers. A route is thousands of points, so
shapes carry a `:rev` computed once per render on the server
(`:erlang.phash2(geometry)` by default). Pass your own if you have something
better:

```elixir
%{id: p.id, geometry: p.geom, rev: p.updated_at}
```

Same id and same `:rev` means the client leaves that feature alone.

## Popups

A slot, rendered once per marker and shown on click with no server round-trip:

```heex
<.map id="clients" markers={@clients}>
  <:popup :let={marker}>
    <h3>{marker.label}</h3>
    <p>{marker.data.address}</p>
    <button data-rover-popup-close>Close</button>
  </:popup>
</.map>
```

Closed by `data-rover-popup-close`, by clicking the map, or by Escape. Because the
markup comes from HEEx it is escaped by construction — no interpolating customer
names into popup HTML.

Deliberately not an `ol/Overlay`: an Overlay moves your node into the map
viewport, which lives inside `phx-update="ignore"`, and LiveView would then be
patching markup it no longer owns. Rover leaves the nodes where HEEx put them and
positions them itself. The cost is one DOM node per marker — fine for dozens,
which is why clustering rather than popups is the answer to hundreds.

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
`:opentopomap`, `:esri_world_imagery`, `:ign_plan`, `:ign_ortho`.

The two IGN presets serve the French [Géoportail](https://www.geoportail.gouv.fr/)
— the reference plan and the aerial orthophotography. Unlike the demo endpoints
below they are meant for production use.

Each one carries the attribution its provider requires, and Rover renders it.
The OSM and Carto presets point at **public demo servers with usage policies
that forbid production traffic** — for anything real, point `{:xyz, …}` at tiles
you are entitled to use.

## What "only update what changed" actually means

The map is rendered as three attributes: `data-rover` (the view),
`data-rover-markers` and `data-rover-shapes`. LiveView already diffs attributes,
so changing only your markers sends only your markers — a cadastral outline that
did not move is not re-serialised because a delivery van did.

On the client, Rover diffs that list *by marker id* and splits the work in two:
a marker that moved has its geometry mutated in place; a marker that was
recoloured gets a new style and keeps its geometry. Everything else is left
untouched — same `Feature` object, same `Style` object, shared between every
marker that looks alike.

Adding one marker to a list of five hundred adds one feature. It does not
rebuild the layer, interrupt a pan, or close an open tooltip. Shapes work the
same way, keyed by id and compared by `:rev`. There are tests asserting exactly
this, by object identity, in `assets/test/markers.test.js` and
`assets/test/shapes.test.js`.

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

## Try it without installing anything

[![Run in Livebook](https://livebook.dev/badge/v1/blue.svg)](https://livebook.dev/run?url=https%3A%2F%2Fgithub.com%2FnseaSeb%2Frover%2Fblob%2Fmain%2Fnotebooks%2Frover.livemd)

[`notebooks/rover.livemd`](notebooks/rover.livemd) walks each layer separately —
coordinates, markers, basemaps, and the exact JSON that crosses the wire — then
feeds that real payload to Rover's own bundle to render a live map inside the
notebook. It is the fastest way to see what a given `<.map>` actually sends.

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

Markers, GeoJSON shapes, emoji, popups and the French Géoportail are complete and
tested. Still open: clustering, arbitrary HTML markers, drawing interactions,
real `ol/source/WMTS` sources, and loading geometry by URL rather than by
attribute.

That last one is the honest limit of the current transport. An HTML attribute is a
single dynamic slot, so any change re-serialises the whole payload. That is right
for a cadastral outline or a delivery route; it is wrong for hundreds of kilobytes
of static geometry. When it bites, the answer is an `ol/source/Vector` with a URL
and a revision — not a bigger attribute.

Issues and PRs welcome.

## Licence

MIT — see [LICENSE](LICENSE).

Rover redistributes OpenLayers (BSD 2-Clause) inside its JavaScript bundle;
third-party notices are in [NOTICE.md](NOTICE.md).
