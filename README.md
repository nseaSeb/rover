# Rover

**Maps for Phoenix LiveView, powered by [OpenLayers](https://openlayers.org/).**

[![Hex.pm](https://img.shields.io/hexpm/v/rover.svg)](https://hex.pm/packages/rover)
[![Docs](https://img.shields.io/badge/hex-docs-blue.svg)](https://hexdocs.pm/rover)

![Markers with emoji and labels, a parcel outline, a route, and IGN plan tiles, all rendered by the playground](https://raw.githubusercontent.com/nseaSeb/rover/main/.github/readme/playground.png)

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

## Why not just write a hook?

Because you already can, and the first version is genuinely short. Three pins on
a tile layer is a dozen lines of JavaScript and an afternoon.

The afternoon after that is the one to think about. A `phx-hook` has no opinion
about what happens when the list changes, so you write the reconciliation — and
if you write the obvious version, clearing the layer and redrawing it, you also
get the flicker, the interrupted pan and the popup that closes itself. Then the
framing, because someone will open a map with one marker and another with two
hundred. Then `updated()`, or you discover that changing the element's `id` is
the only way to get new data in. Then the coordinate order, once, in the wrong
direction. Then the attribution, which is a licence condition rather than a
detail.

None of that is hard. All of it is work you have done before, and Rover has done
it here, with tests that assert the reconciliation by object identity so it stays
done.

The other half of the bet is the engine underneath. OpenLayers carries
projections, huge vector layers, WMS/WMTS and the rest of the serious GIS
surface — so the day your three pins turn into a cadastral overlay, the ceiling
is somewhere else entirely.

## Installation

```elixir
def deps do
  [{:rover, "~> 0.8"}]
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
| `:anchor` | Where on the image the coordinate sits, as `[x, y]` fractions: `[0.5, 1]` (the default) is a pin's tip, `[0.5, 0.5]` the middle of a dot or badge. |
| `:rotation` | Degrees clockwise, for an `:icon` with a heading. |
| `:opacity` | 0 to 1. |
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
| `on_cluster_click` | `%{"count" =>, "ids" => [id, …], "lat" =>, "lon" =>}` |
| `on_shape_click` | `%{"id" =>, "lat" =>, "lon" =>, "data" =>}` |
| `on_source_shape_click` | `%{"id" =>, "lat" =>, "lon" =>, "data" =>}` |
| `on_map_click` | `%{"lat" =>, "lon" =>}` |
| `on_move_end` | `%{"center" => [lat, lon], "zoom" =>, "bbox" => %{"south" =>, "west" =>, "north" =>, "east" =>}}` |
| `on_marker_drag_end` | `%{"id" =>, "lat" =>, "lon" =>}` |
| `on_shape_edit_end` | `%{"id" =>, "geometry" =>, "properties" =>, "data" =>}` |
| `on_draw_end` | `%{"type" =>, "geometry" =>}` — no `"id"`: the shape does not exist until you make one |

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
`:color`, `:width`, `:fill_color`, `:fill_opacity`, `:label`, `:tooltip`, `:rev`,
`:data`, `:editable`. `:geom` and `:geojson` are read as the geometry too, and
`shape_fields={[geometry: :outline, label: :cadastral_ref]}` maps anything else,
exactly as `marker_fields` does for markers.

Shapes are **the one place Rover is not latitude-first** — GeoJSON is defined as
`[longitude, latitude]` and the standard wins, because geometry is never typed by
hand. See `Rover.Shape` for why.

A map with shapes and no markers frames the geometry, so a parcel page needs no
`center`.

### Letting the user edit a shape's vertices

`editable: true` lets the user drag a shape's vertices directly on the map, the
geometry equivalent of `:draggable` on a marker:

```elixir
%{id: p.id, geometry: p.cadastral_outline, editable: true}
```

```elixir
def handle_event("on_shape_edit_end", %{"id" => id, "geometry" => geometry}, socket) do
  # Persist or reject. Either way, see the :rev note below.
  {:noreply, socket}
end
```

Only a shape backed by a single feature can be edited — a `FeatureCollection` of
several has no one geometry a drag could write back to a single `:geometry`
field, and stays read-only regardless of `:editable`.

`on_shape_edit_end`'s `"geometry"` is always a **bare** geometry — if the
shape's own `:geometry` was a `Feature`, its `"properties"` travel in their own
key instead, `nil` for a shape that was already bare. Wrap them back up
yourself if you merge the result straight into `:geometry`:

```elixir
def handle_event("on_shape_edit_end", %{"id" => id, "geometry" => geometry, "properties" => properties}, socket) do
  geometry = if properties, do: %{"type" => "Feature", "properties" => properties, "geometry" => geometry}, else: geometry
  # ...
end
```

**Rejecting an edit needs an observable `:rev`.** The client already moved the
vertex by the time `on_shape_edit_end` fires; reassigning `:shapes` with the
exact same geometry produces byte-identical JSON, which never reaches the
browser at all — nothing in the rendered output changed, so nothing is sent.
What snaps the shape back to the server's truth is bumping `:rev` (the default
`:erlang.phash2(geometry)` already does this whenever the geometry itself
changes; rejecting an edit means the geometry does *not* change, so `:rev` has
to be bumped some other way, deliberately).

### Letting the user draw a new one

`:editable` reshapes a geometry that already exists. Drawing is the other half,
and it is a **mode** rather than an attribute — there is no shape yet to hang a
flag on, so the server arms the map for a gesture the way `fly_to` moves it:

```elixir
def handle_event("draw_parcel", _params, socket) do
  {:noreply, Rover.start_drawing(socket, "parcels", type: :polygon)}
end
```

```heex
<.map id="parcels" shapes={@parcels} on_draw_end="drew" />
```

```elixir
def handle_event("drew", %{"type" => _type, "geometry" => geometry}, socket) do
  parcel = %{id: System.unique_integer([:positive]), geometry: geometry, editable: true}

  {:noreply,
   socket
   |> assign(parcels: socket.assigns.parcels ++ [parcel])
   |> Rover.stop_drawing("parcels")}
end
```

`on_draw_end` is the one event with no `"id"`: the shape does not exist until
you make one, so naming it is yours to do — the same way it would be for a row
you are about to insert.

Four things worth knowing:

* **The mode stays armed** until `Rover.stop_drawing/2`. A user asked to trace
  four parcels traces four without going back to the toolbar. Drop the
  `stop_drawing` above if that is what you want.
* **Escape abandons the sketch in progress** and leaves the mode armed, the way
  it does in every drawing tool. The server is not told: it armed a mode, and
  the mode is still armed.
* **`:type` is `:polygon`, `:line` or `:point`.** There is no `:circle` —
  OpenLayers can draw one, GeoJSON has no way to represent one, and a shape that
  cannot round-trip through `Rover.Shape` is one the server could never store or
  send back.
* **New points snap to the shapes already on the map**, so a parcel traced
  against its neighbour shares that border instead of leaving a sliver.
* **While the mode is armed the map claims every click.** Not just
  `on_map_click`: markers, shapes and clusters stop answering too, popups
  included, because a click that places a vertex is not a click on the thing
  underneath it. Since the mode persists until you stop it, leaving it armed
  leaves the map's other click behaviour off with it.

A map rendered with `interactive={false}` refuses to arm, and locking one that
is already drawing cancels the mode outright rather than remembering it.

### Geometry the browser fetches for itself

`shapes` puts geometry in an HTML attribute, which is a single dynamic slot:
touching any shape re-serialises all of them. That is right for a parcel
outline or a delivery route. It is wrong for hundreds of kilobytes of cadastre
that never changes and is the same for everybody.

```heex
<.map id="parcels" shape_source={{:url, ~p"/api/parcels.geojson", rev: @parcels_rev}} />
```

`:rev` is appended as a query parameter — a timestamp, a row count, a hash,
anything that differs when the file does. That is what makes each version its
own URL, and what lets the browser keep one for as long as it likes: a changed
file is a changed rev is a different request. Without a `:rev` there is nothing
to tell one version from the next, so the endpoint has to be revalidated on
every mount.
`:style` takes `:color`, `:width`, `:fill_color` and `:fill_opacity` and applies
them to every feature; changing it restyles what is loaded rather than fetching
again.

The endpoint is an ordinary controller. It answers a GET, which
`protect_from_forgery` does not cover, so it must be read-only and must decide
what to return from the session rather than from anything in the URL:

```elixir
def parcels(conn, params) do
  geojson = MyApp.Parcels.feature_collection_for(conn.assigns.current_user)

  # A rev in the URL makes this answer permanent: it can only change by becoming
  # a different URL. Without one, the browser has to ask again every time.
  cache = if params["rev"], do: "private, max-age=31536000, immutable", else: "private, max-age=0"

  conn
  |> put_resp_content_type("application/geo+json")
  |> put_resp_header("cache-control", cache)
  # `private` shuts out shared caches, not the browser's own. Without `vary`,
  # the next person to sign in on this machine is served the last one's
  # geometry from disk, with no request made.
  |> put_resp_header("vary", "cookie")
  |> send_resp(200, Jason.encode!(geojson))
end
```

`params` is read for that decision and for nothing else: what to return is
decided from the session.

What this costs is the server's knowledge of what it sent. These features are
drawn under the shapes it does send, and there are no popups, no keyboard
entries and no `:editable` for them, because all three need a shape the server
can name. Use `shapes` for the geometry you interact with and `shape_source`
for the backdrop.

Clicks reach `on_source_shape_click`, which is a handler of its own and not
`on_shape_click`:

```heex
<.map id="parcels"
      shape_source={{:url, ~p"/api/parcels.geojson", rev: @parcels_rev}}
      shapes={@routes}
      on_shape_click="shape_clicked"
      on_source_shape_click="parcel_clicked"
      on_map_click="map_clicked" />
```

```elixir
def handle_event("parcel_clicked", %{"id" => id}, socket) do
  {:noreply, assign(socket, highlighted_parcel: id)}
end
```

Two handlers rather than one flag in the payload, because without a handler this
geometry has to be scenery. A cadastral backdrop covers the whole viewport; if
`on_shape_click` were reason enough to claim a click on it, the map above would
never see an `on_map_click` anywhere. A `<:shape_popup>` is no reason either —
there is nothing to open for a feature the server has never seen. The payload
carries whatever `id` and properties the file declares; the id is the file's, or
`nil`, and is not a shape to look up among the ones you are holding.

They take part in the framing too, but a document that arrives late claims no
fit of its own. A map with nothing to frame at mount never spent the one fit
every map without a `center` gets, so the document claims that one — it *is* the
fit `:once` promises, just late — unless a `Rover.fly_to/4` or `Rover.fit_to/4`
spent it first, those being decisions about the view that content must not undo.

A map that already framed its markers keeps the view it has. That is what
`:once` means, and what `Rover.fly_to/4` relies on: a flight issued while a
large document is downloading must still be where the user is when it lands. So
a source toggled on over another region arrives where the view already is —
`fit={true}` refits on every change if that is what you want, and
`Rover.fit_to/4` frames on demand.

### Geometry is diffed by revision, not by hashing

Markers hash their coordinate — two numbers. A route is thousands of points, so
shapes carry a `:rev` computed once per render on the server
(`:erlang.phash2(geometry)` by default). Pass your own if you have something
better:

```elixir
%{id: p.id, geometry: p.geom, rev: p.updated_at}
```

Same id and same `:rev` means the client leaves that feature alone.

## Clustering

Hundreds of markers are a wall of overlapping icons. Grouping them is one attribute:

```heex
<.map id="clients" markers={@clients} cluster={true} />
<.map id="clients" markers={@clients} cluster={[distance: 60, zoom_on_click: false]} />
```

A group of one is drawn as its own marker, so nothing looks clustered until it
actually is. Clicking a group zooms into it — without that a cluster is a dead end,
showing you that twelve things are there with no way to reach them — and sends
`on_cluster_click` with the member ids.

Reconciliation is untouched by any of this. `ol/source/Cluster` *wraps* the marker
source rather than replacing it, so the markers are still diffed by id exactly as
before; only what is drawn changes.

Two consequences worth knowing:

* **A grouped marker has no popup.** Its pin is drawn at the group's centre, so a
  popup would point at empty space. An open popup closes when its marker joins a
  group; it does not reopen by itself when you zoom back in.
* **`:draggable` markers cannot be dragged at all while `cluster` is set**, even
  standing alone — every marker is wrapped by a cluster feature once clustering is
  on, and dragging that would move the wrapper rather than the marker.

## Heatmaps

Five hundred markers are a wall of overlapping icons. A heat field answers a
different question — *where is there a lot of this?*

```heex
<.map id="deliveries" heatmap={@rows} heatmap_style={[radius: 12, blur: 20]} />
```

A point needs only a coordinate; `:weight` is relative, 0 to 1, and defaults to 1:

```elixir
%{lat: 45.75, lon: 4.85}
%{lat: 45.75, lon: 4.85, weight: 0.4}
```

`heatmap_fields={[weight: :orders]}` reads the weight from another key, or from a
function of the row — `weight: fn row -> row.orders / 40 end` — when the number
needs scaling into range.

No `:id` here, unlike markers and shapes. A heatmap is an aggregate — no individual
point is visible in the result — so per-point identity would be ceremony that buys
nothing. It is diffed by revision instead, like shapes, which also means a
style-only change restyles the layer without rebuilding the field.

### Labels that get out of each other's way

At density, labels overlap into an unreadable stack. `declutter` hides the ones
that collide instead:

```heex
<.map id="clients" markers={@clients} declutter={true} />
```

Markers and shapes declutter together, so a shape's label yields to a marker's
rather than each layer resolving its own collisions and both being drawn anyway.
Pins, icons, emoji and cluster circles are never hidden — they are what the
labels move out of the way of — and hit-testing, popups and the keyboard index
are unaffected.

Off by default, because it is a trade rather than an improvement: a label that
loses a collision is not drawn at all, so on a dense map labels appear and
disappear as the view moves. Clustering is usually the better answer to the
same problem.

## Popups

A slot, rendered once per marker and shown on click with no server round-trip:

```heex
<.map id="clients" markers={@clients}>
  <:popup :let={marker}>
    <h3>{marker.label}</h3>
    <p>{marker.data && marker.data.address}</p>
    <button data-rover-popup-close>Close</button>
  </:popup>
</.map>
```

Shapes get their own slot, and open where the geometry was clicked rather than at
its centroid — pointing at the middle of a long route would point at nothing the
user did:

```heex
<:shape_popup :let={shape}>
  <h3>{shape.label}</h3>
  <p>{shape.data && shape.data.area} ha</p>
</:shape_popup>
```

Both work with or without `on_marker_click` / `on_shape_click`: the click is
claimed when either the server or a popup wants it, and by neither when the shape
is scenery — a filled outline with no handler and no popup must not swallow
`on_map_click` across its whole interior.

Closed by `data-rover-popup-close`, by clicking the map, or by Escape. Because the
markup comes from HEEx it is escaped by construction — no interpolating customer
names into popup HTML.

Deliberately not an `ol/Overlay`: an Overlay moves your node into the map
viewport, which lives inside `phx-update="ignore"`, and LiveView would then be
patching markup it no longer owns. Rover leaves the nodes where HEEx put them and
positions them itself. The cost is one DOM node per marker — fine for dozens,
which is why clustering rather than popups is the answer to hundreds.

## Keyboard and screen readers

A map is a canvas, and a canvas has no DOM: without help, everything on a Rover
map is unreachable to anyone not holding a mouse. Three things close that, and
they are on by default.

**The map takes focus.** It carries `tabindex="0"` and `role="application"`, so
Tab reaches it and the arrow keys pan it, `+` and `-` zoom it. OpenLayers has
shipped `KeyboardPan` and `KeyboardZoom` all along; nothing could focus the map,
so nothing could reach them.

**Every marker and shape gets a button.** Rover renders one visually-hidden
button per feature — the only DOM a keyboard or a screen reader can reach a
painted marker through. Each shows itself when it takes focus, and pressing it
does exactly what clicking the marker does: the same event to your LiveView, the
same popup opened. The list is rendered only when something is listening, so a
map that is pure scenery does not grow a tab stop per pin.

**Popups are dialogs, and they manage focus.** Each is `role="dialog"`, named
after its marker. A popup opened from the keyboard takes focus and hands it back
to the button on close; a popup opened by a mouse click does neither, because a
pointer user's attention is already where they clicked.

Name your maps — the accessible name defaults to the word `Map`, which is enough
for one map on a page and not enough for two:

```heex
<.map id="clients" label="Client sites" markers={@clients} on_marker_click="select" />
```

A button is named by the marker's `:label`, falling back to its `:tooltip`, then
to `Marker <id>` — poor, but addressable, which no name at all is not.

## Framing, zoom limits and controls

A map given no `center` frames its content — markers, shapes and heat points
together — the first time it appears, and `fit` says what happens after that:

```heex
<.map id="fleet" markers={@vehicles} fit={true} fit_padding={80} />
```

| `fit` | Meaning |
|---|---|
| `:once` | Frame the content once, then leave the view alone. The default when no `center` is given. |
| `true` (or `:always`) | Refit on every change to the content. |
| `false` | Never fit. The default when `center` is given — the view is yours. |

`fit_padding` is the number of pixels kept clear around a fitted view, 48 by
default. `zoom` is the initial zoom; `min_zoom` and `max_zoom` bound what the
user can reach, and a basemap's own ceiling still applies on top.

`controls` picks the buttons: any of `:zoom`, `:attribution`, `:scale_line`,
`:full_screen`, `:rotate`, defaulting to `[:zoom, :attribution]`. The attribution
is rendered whenever there is a basemap, listed or not — every preset's provider
requires it — so only `tiles={:none}` renders without it.

`interactions` picks the gestures, all of them by default. A map in the flow of
a page usually wants the wheel left to the page, and no way to leave the map
crooked:

```heex
<.map id="m" interactions={[:drag_pan, :pinch_zoom, :double_click_zoom, :keyboard_pan, :keyboard_zoom]} />
```

The full list is `:drag_pan`, `:mouse_wheel_zoom`, `:double_click_zoom`,
`:pinch_zoom`, `:keyboard_pan`, `:keyboard_zoom`, `:drag_rotate`, `:pinch_rotate`
and `:drag_zoom`. `interactions={[]}` is not `interactive={false}` — the map
keeps its tooltips, clicks and cursor, it just stops moving under the pointer —
and dragging a marker, reshaping a shape or drawing are not gestures on this list.

## Moving the view without owning it

`center` and `zoom` are attributes, which is right when the view *is* a property of
what you are rendering. It is the wrong tool for "the user clicked a row, take me
there": passing `center` costs you the automatic framing, so you trade the default
behaviour for one gesture and hold the view in assigns from then on.

For that, send a command instead:

```elixir
def handle_event("select_client", %{"id" => id}, socket) do
  client = Enum.find(socket.assigns.clients, &(&1.id == id))

  {:noreply, Rover.fly_to(socket, "clients", {client.lat, client.lon}, zoom: 15)}
end
```

Nothing is assigned, no attribute changes, and the map keeps its declarative
framing for everything else. `Rover.fit_to/4` is the "show me these" counterpart
and takes markers, shapes, coordinates or a `{south, west, north, east}` box:

```elixir
{:noreply, Rover.fit_to(socket, "fleet", vehicles_on_shift, max_zoom: 15)}
```

Both name the map's DOM id, because a LiveView can hold several maps and an event
reaches all of them.

## Coordinates are always `{lat, lon}`

The order you say out loud. OpenLayers works in
`[x, y]` — that is, `[lon, lat]` projected to Web Mercator — and Rover does that
flip once, in JavaScript, where you never see it.

`Rover.Geo` is strict about it on purpose: a latitude of `145.75` raises rather
than quietly drawing your marker in the middle of the Pacific.

## Basemaps

```heex
<.map id="m" tiles={:carto_dark} ... />
<.map id="m" tiles={:carto_dark_vector} ... />
<.map id="m" tiles={{:xyz, "https://tiles.example.com/{z}/{x}/{y}.png", attributions: "© Example"}} ... />
<.map id="m" tiles={{:vector, "https://api.maptiler.com/maps/streets/style.json?key=YOUR_KEY"}} ... />
<.map id="m" tiles={:none} ... />
```

Raster presets: `:osm`, `:osm_hot`, `:carto_light`, `:carto_dark`,
`:carto_voyager`, `:opentopomap`, `:esri_world_imagery`, `:ign_plan`,
`:ign_ortho`. Vector presets: `:carto_light_vector`, `:carto_dark_vector`,
`:carto_voyager_vector`.

Vector tiles are sharper at any zoom or pixel density and stay on a fresher
data cadence than their raster counterparts — see
[Carto's basemaps FAQ](https://docs.carto.com/faqs/carto-basemaps) for the full
comparison. New code should reach for a vector preset; the raster ones keep
working exactly as they do today for anything already built on them.

For a WMTS service whose grid is its own — not the Web Mercator one every
basemap here shares — name the capabilities document and the layer to read from
it:

```heex
<.map
  id="ortho"
  tiles={{:wmts, "https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetCapabilities&VERSION=1.0.0",
          layer: "ORTHOIMAGERY.ORTHOPHOTOS", matrix_set: "PM", format: "image/jpeg"}}
/>
```

Rover fetches that document, reads the tile grid out of it, and builds an
`ol/source/WMTS` from what it says. `:layer` is required — a capabilities
document describes several — and `:matrix_set`, `:format`, `:attributions` and
`:max_zoom` are optional. The map renders immediately and the tiles appear once
the document has been read, the same way a vector basemap does.

One limit worth knowing before you reach for it: OpenLayers carries Web
Mercator and WGS 84 and nothing else, so a matrix set in Lambert-93 or the
British National Grid needs its projection registered with `proj4` before the
map is built. Rover says so by name rather than letting it fail as a blank map.

The `:ign_*` presets below do *not* take this path: the Géoportail's KVP
endpoint puts the tile coordinates in the query string, and its two layers are
on the grid the map already uses, so a plain XYZ source reads them without the
round-trip. `{:wmts, ...}` is for the services where that shortcut does not
apply.

The two IGN presets serve the French [Géoportail](https://www.geoportail.gouv.fr/)
— the reference plan and the aerial orthophotography. Unlike the demo endpoints
below they are meant for production use.

Each one carries the attribution its provider requires, and Rover renders it.
The OSM and Carto presets point at **public demo servers with usage policies
that forbid production traffic** — for anything real, point `{:xyz, …}` (or,
for a vector style, `{:vector, …}`) at tiles you are entitled to use.

Carto now requires an API key on all six of its presets, raster and vector
alike. Without one the tiles still load — they are served with
`API KEY REQUIRED` stamped diagonally across every one, so the symptom is a
legible map wearing a watermark rather than a blank map or an error in the
console. The key is free, issued by return email with no queue and no Carto
account, and covers 5 million tile requests a month across their raster and
vector services. Attribution must stay visible, which Rover renders for you.
Request one at <https://carto.com/basemaps/apikey/>, then:

```elixir
# config.exs — applies to every carto_* preset
config :rover, Rover.Tiles, carto_api_key: "YOUR_KEY"
```

```heex
<%!-- or per call, which overrides the configured default --%>
<.map id="m" tiles={{:carto_dark, key: "YOUR_KEY"}} ... />
<.map id="m" tiles={{:carto_dark_vector, key: "YOUR_KEY"}} ... />
```

Carto also says the raster (PNG) service is being retired in favour of vector
tiles, and that they are considering freezing its data updates. No date is
published — prefer a `carto_*_vector` preset for anything new.

### Layers over the basemap

One basemap is often not the picture: a cadastral overlay wants the plan under
it, orthophotography wants roads and labels over it. `layers` stacks tile
layers between the basemap and everything else:

```heex
<.map
  id="parcels"
  tiles={:ign_plan}
  layers={[
    {:tiles, {:xyz, @cadastre_url, attributions: "© DGFiP"}, opacity: 0.6, min_zoom: 12},
    {:tiles, :ign_ortho, visible: @ortho?, id: "ortho"}
  ]}
/>
```

Each entry is `{:tiles, spec}` or `{:tiles, spec, opts}`, where `spec` is
anything the `tiles` attribute itself accepts — a preset, `{:xyz, url}`, or a
vector style. Options: `:opacity`, `:visible`, `:min_zoom`, `:max_zoom`, `:id`.

They are drawn in list order, all of them beneath the heatmap, the shapes and
the markers. That is the point rather than a limitation: a layer here is part
of the backdrop you are assembling, and putting tiles over your own data would
hide it.

Layers are reconciled like everything else. Changing an opacity or hiding a
layer keeps the tiles the browser already fetched; only a layer whose `spec`
actually changed is rebuilt. Give a layer an `:id` and it survives a change of
position in the list — without one, its position *is* its identity, because two
entries of the same tiles are otherwise indistinguishable.

Every layer's attribution is collected alongside the basemap's, which is why
the attribution control is rendered whenever a map has any layer at all.

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

## Dark mode and theming

`rover.css` follows `prefers-color-scheme` on its own, and also a theme the page
sets itself: `data-theme="dark"` or a `.dark` class on any ancestor — the root,
in a Tailwind application — switches a map to dark whatever the OS prefers, and
`data-theme="light"` or `.light` holds it light on a dark OS.

Every colour is a custom property on `.rover-map`, so an application restyles a
map without overriding a rule:

```css
.rover-map {
  --rover-popup-bg: #fffbeb;
  --rover-link: #b45309;
}
```

The full list is at the top of `rover.css`. The basemap is not part of this —
tiles are content, and already an attribute — so a page with a toggle pairs
the two itself:

```heex
<.map id="m" tiles={if @dark, do: :carto_dark_vector, else: :carto_light_vector} />
```

## Reaching OpenLayers when you need it

`<.map>` is a floor, not a ceiling. The bundle also exports the pieces:

```js
import { RoverMap, MarkerLayer, ShapeLayer, project, unproject } from "../../deps/rover/priv/static/rover.js"
```

The live instance is also on the element that owns it, which is the fastest way to
answer "why is my marker not there?" from a console:

```js
const map = document.getElementById("clients")._rover
map.map.getView().getZoom()
map.markerLayer.markerById(42)
map.contentExtent
```

### Bring your own OpenLayers

If you already build with `npm` and want to own the `ol` version:

```js
// assets/package.json: "ol": "^10.0.0"
import { RoverHooks } from "../../deps/rover/priv/static/rover.external.js"
```

This one needs a build change, and without it esbuild stops with `Could not
resolve "ol/Map.js"` — once for each of the twenty-seven `ol` specifiers the
peer build leaves bare. esbuild resolves a bare import by walking up from the
file that wrote it, which here is `deps/rover/priv/static/`, where there is no
`node_modules` and never will be. Phoenix's generated `NODE_PATH` points at
`deps` alone, so your `ol` is never on the search path.

In your existing `config :esbuild` block in `config/config.exs`, replace the
`env:` key — leave `args:` and `cd:` exactly as they are:

```elixir
env: %{
  "NODE_PATH" =>
    Enum.join(
      [Path.expand("../deps", __DIR__), Path.expand("../assets/node_modules", __DIR__)],
      if(match?({:win32, _}, :os.type()), do: ";", else: ":")
    )
}
```

The default build needs none of this — OpenLayers is already inside `rover.js`.

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
mix test --cover      # the suite, plus the coverage floor CI enforces
mix dialyzer          # checks the @specs; the first run builds the PLT
mix assets.test.browser   # the browser suite, in a real Chromium
bin/ci                # every check CI runs, in a container, on your working tree
```

`mix precommit` stays fast on purpose, so the two slow checks — Dialyzer and the
browser suite — live in CI and in `bin/ci` rather than in front of every commit.

The browser suite is small on purpose. Everything below the component — the
canvas, the popup DOM, the tile URLs the browser actually requests — lives where
ExUnit and `node --test` cannot look, and every rendering bug this library has
shipped was in there. It stands guard over those paths and nothing else. Each
scenario has been watched to fail with its bug reintroduced.

The playground (`dev/demo_live.ex`) is the reference for the intended
experience: a list of maps, buttons that add / move / recolour / remove markers,
and a log of the events coming back. There is no OpenLayers in that file.

## Status

Markers, GeoJSON shapes, emoji, popups, clustering, heatmaps, drawing and
editing geometry, decluttering, keyboard access, imperative view control, tile
layers over the basemap, WMTS sources, geometry loaded by URL and the French
Géoportail are complete and tested.

Still open: arbitrary HTML markers. Everything a marker can be drawn as today is
drawn into the canvas — a pin, an icon, an emoji — which is what makes a thousand
of them cheap and a keyboard able to reach them. Markup per marker is a different
trade, and the DOM it would need sits inside `phx-update="ignore"`, where the
popups already go to some length not to put anything LiveView owns.

Issues and PRs welcome.

## Coming from a Leaflet hook

Most of the migration is deleting JavaScript. The mapping:

| In your hook | In Rover |
|---|---|
| `L.map` + `setView` | `<.map center={{lat, lon}} zoom={12}>` |
| `L.tileLayer(url, …)` | `tiles={:osm}` or `{:xyz, url, attributions: …}` |
| `L.marker` + `L.divIcon` with an emoji | a marker's `:emoji` |
| `L.marker` + an image icon | a marker's `:icon` |
| `bindPopup(html)` | the `<:popup>` slot — and HEEx escapes it for you |
| `bindTooltip` / `title` | a marker's `:tooltip` |
| `L.geoJSON(geometry, style)` | `shapes` with `:color`, `:width`, `:fill_opacity` |
| `featureGroup().getBounds()` + `fitBounds` | automatic, over markers and shapes together |
| `L.Draw` / `leaflet-draw` | `Rover.start_drawing/3` and `on_draw_end` |
| `handleEvent` + `push_event` to feed the map | `assign/3`; the data rides on attributes |
| a versioned element `id` to force a remount | not needed — Rover has an `updated()` |

Three things that catch people:

1. **Every marker needs a stable `:id`.** Hook code usually builds anonymous
   marker maps, because Leaflet has no use for an identity. Rover diffs on it, so
   without one you get remove-and-add instead of an update — the flicker you were
   trying to leave behind. Ids are almost always right there in the record you
   are mapping over.
2. **`height` is an inline style, and beats your class.** If you size maps with
   `class="h-96"` or a flex parent, pass `height={nil}`.
3. **Stroke opacity has no named field.** Leaflet's `opacity: 0.8` on a line
   becomes `color: "rgba(37, 99, 235, 0.8)"`; `:fill_opacity` covers the fill.

## Licence

MIT — see [LICENSE](LICENSE).

Rover redistributes OpenLayers (BSD 2-Clause) inside its JavaScript bundle;
third-party notices are in [NOTICE.md](NOTICE.md).
