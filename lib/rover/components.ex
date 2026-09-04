defmodule Rover.Components do
  @moduledoc """
  The `<.map>` component.

      import Rover.Components

      <.map id="clients" center={{45.75, 4.85}} zoom={12} markers={@clients} />

  That is the whole API for the common case. Everything below is about the less
  common ones.

  ## How updates reach the map

  Rover renders your markers into a `data-rover-markers` attribute. When you
  `assign/3` a new list, LiveView diffs the attribute and sends only that
  attribute down the wire; the JavaScript runtime then diffs the list *by marker
  id* and touches only the OpenLayers features that actually changed. Adding one
  marker to a list of five hundred adds one feature — it does not rebuild the
  layer, and it does not interrupt a pan, a zoom or an open popup.

  This is why `Rover.Marker` insists on a stable `:id`.

  ## Events

  Each `on_*` attribute takes the name of an event your LiveView handles:

      <.map id="clients" markers={@clients} on_marker_click="select_client" />

      def handle_event("select_client", %{"id" => id}, socket) do
        {:noreply, assign(socket, selected: id)}
      end

  | Attribute | Payload |
  |---|---|
  | `on_marker_click` | `%{"id" => id, "lat" => lat, "lon" => lon, "data" => data}` |
  | `on_cluster_click` | `%{"count" => n, "ids" => [id, …], "lat" => lat, "lon" => lon}` |
  | `on_shape_click` | `%{"id" => id, "lat" => lat, "lon" => lon, "data" => data}` |
  | `on_map_click` | `%{"lat" => lat, "lon" => lon}` |
  | `on_move_end` | `%{"center" => [lat, lon], "zoom" => zoom, "bbox" => %{"south" =>, "west" =>, "north" =>, "east" =>}}` |
  | `on_marker_drag_end` | `%{"id" => id, "lat" => lat, "lon" => lon}` |
  | `on_shape_edit_end` | `%{"id" => id, "geometry" => geojson_geometry, "properties" => geojson_properties, "data" => data}` |
  | `on_draw_end` | `%{"type" => type, "geometry" => geojson_geometry}` |

  Inside a `Phoenix.LiveComponent`, route the events to yourself with
  `target={@myself}`.

  `on_draw_end` is the one with no `:id`, because the shape it describes does not
  exist yet — see `Rover.start_drawing/3`, which is what arms the map to send it.

  > #### Viewports can straddle the antimeridian {: .warning}
  >
  > Longitudes are wrapped into `-180..180`, so a user looking at Fiji or New
  > Zealand gets a `bbox` where `west` is greater than `east`. When that happens
  > the map adds `"crosses_antimeridian" => true`, because the obvious query —
  > `where: m.lon >= ^west and m.lon <= ^east` — matches nothing for those
  > users. Split the range in two when you see the flag.

  ## Controlled view, uncontrolled panning

  `center` and `zoom` are applied when they *change on the server*. A user
  panning the map does not push new values back unless you ask for them with
  `on_move_end`, and a re-render triggered by something unrelated will not yank
  the view back to where it started. Assign a new `center` and the map animates
  to it.

  When you give no `center` at all, Rover derives a starting frame from the
  markers. That derived value is explicitly *not* treated as an instruction —
  otherwise moving one marker would shift the centroid and drag the view along
  with it on every update.

  ## Framing versus refitting

  Two separate things:

  * **The first frame.** With no `center`, "put my markers on screen" is the
    whole instruction, so the map always fits the markers once when it appears.
    The client does it, because only the client knows the viewport size.
  * **Refitting.** `fit` governs what happens *afterwards*. `false` leaves the
    view alone, `:once` does nothing more, `true` refits on every change.
  """

  use Phoenix.Component

  alias Rover.Geo
  alias Rover.Heatmap
  alias Rover.Marker
  alias Rover.Shape
  alias Rover.Tiles

  @default_center {0.0, 0.0}
  @default_zoom 2
  @centered_zoom 12

  @doc """
  Renders an interactive map.

  ## Examples

  Three markers around Lyon, clickable:

      <.map
        id="clients"
        center={{45.75, 4.85}}
        zoom={12}
        markers={@clients}
        on_marker_click="select_client"
      />

  Fit the view to whatever is on the map instead of choosing a center:

      <.map id="fleet" markers={@vehicles} fit={true} tiles={:carto_dark} height="60vh" />

  Read markers out of an Ecto schema that names its fields differently:

      <.map
        id="stores"
        markers={@stores}
        marker_fields={[lat: :latitude, lon: :longitude, label: :trade_name]}
      />
  """

  attr :id, :string,
    required: true,
    doc: "DOM id. Required — the map is a stateful hook and LiveView needs to track it."

  attr :center, :any,
    default: nil,
    doc: """
    The `{lat, lon}` the view is centred on. Defaults to the centre of `markers`
    when they are given, and to `{0.0, 0.0}` otherwise.
    """

  attr :zoom, :any, default: nil, doc: "Zoom level, roughly 0 (world) to 20 (building)."
  attr :min_zoom, :any, default: nil, doc: "Lowest zoom the user can reach."
  attr :max_zoom, :any, default: nil, doc: "Highest zoom the user can reach."

  attr :markers, :list,
    default: [],
    doc: "Anything `Rover.Marker.new!/2` accepts: maps, structs, `Rover.Marker`s."

  attr :marker_fields, :list,
    default: [],
    doc: "Field mapping passed to `Rover.Marker.new!/2`, e.g. `[lat: :latitude]`."

  attr :shapes, :list,
    default: [],
    doc: "Anything `Rover.Shape.new!/2` accepts. GeoJSON geometries — see `Rover.Shape`."

  attr :shape_fields, :list,
    default: [],
    doc: "Field mapping passed to `Rover.Shape.new!/2`, e.g. `[geometry: :outline]`."

  attr :cluster, :any,
    default: false,
    doc: """
    Groups nearby markers into counted circles, which is the answer to hundreds of
    them. `true` for the defaults, or a keyword list:

      * `:distance` — how close, in pixels, two markers must be to group. Default `40`.
      * `:min_distance` — minimum gap between two groups, in pixels. Default `20`.
      * `:zoom_on_click` — zoom into a group when it is clicked. Default `true`.

    Clicking a group also sends `on_cluster_click`. A group of one is drawn as its
    own marker, so nothing looks clustered until it actually is.

    Two consequences worth knowing: a marker that has been grouped has no popup —
    the popup would point at the group's centre rather than at the marker — and
    `:draggable` markers cannot be dragged at all while `:cluster` is set, even
    standing alone. Every marker is wrapped by a cluster feature once clustering
    is on, a lone one included, and dragging that would move the wrapper rather
    than the marker.
    """

  attr :on_cluster_click, :string,
    default: nil,
    doc: """
    Receives `%{"count" => n, "ids" => [id, …], "lat" => lat, "lon" => lon}` when a
    group is clicked. Note `"ids"` and `"count"` rather than a single `"id"` — a
    group is not a marker.
    """

  attr :heatmap, :list,
    default: [],
    doc: """
    Points for a density field — see `Rover.Heatmap`. No `:id` needed: a heatmap is
    an aggregate, so it is diffed by revision rather than feature by feature.
    """

  attr :heatmap_fields, :list,
    default: [],
    doc: "Field mapping for the heatmap, e.g. `[weight: fn r -> r.orders / 40 end]`."

  attr :heatmap_style, :list,
    default: [],
    doc: "Any of `:radius`, `:blur`, `:opacity`, `:gradient`. See `Rover.Heatmap.style!/1`."

  attr :tiles, :any,
    default: :osm,
    doc: "A `Rover.Tiles` preset, `{:xyz, url}`, `{:vector, style_url}`, or `:none`."

  attr :fit, :any,
    default: nil,
    doc: """
    Controls *re*fitting as markers change: `true` refits on every change,
    `:once` or `false` do not. Defaults to `:once` when no `center` is given,
    `false` otherwise. Note that a map given no `center` always fits once when it
    first appears, whatever `fit` says — see "Framing versus refitting".
    """

  attr :fit_padding, :integer, default: 48, doc: "Pixels kept clear around a fitted view."

  attr :controls, :list,
    default: [:zoom, :attribution],
    doc: "Any of `:zoom`, `:attribution`, `:scale_line`, `:full_screen`, `:rotate`."

  attr :interactive, :boolean,
    default: true,
    doc: """
    When false the map becomes a picture: no panning, zooming, dragging,
    tooltips, cursor changes or click events, and the zoom, fullscreen and rotate
    controls are withheld. The attribution stays — it is a licence obligation,
    not an interaction — and so does the scale line if you asked for one.
    """

  attr :on_marker_click, :string, default: nil
  attr :on_shape_click, :string, default: nil
  attr :on_map_click, :string, default: nil
  attr :on_move_end, :string, default: nil
  attr :on_marker_drag_end, :string, default: nil
  attr :on_shape_edit_end, :string, default: nil

  attr :on_draw_end, :string,
    default: nil,
    doc: """
    Receives `%{"type" => type, "geometry" => geometry}` when the user finishes
    drawing a new shape, which they can only do while `Rover.start_drawing/3` has
    armed this map. No `:id`: identity is yours to assign when you turn the
    geometry into a shape.
    """

  attr :target, :any,
    default: nil,
    doc: "`@myself` to route events to the enclosing `Phoenix.LiveComponent`."

  # `:any`, not `:string`: the documented escape hatch is `height={nil}`, and a
  # literal nil against a `:string` attr is a compile warning — an error in any
  # project building with --warnings-as-errors. `:class` is `:any` for the same
  # reason.
  attr :height, :any,
    default: "24rem",
    doc: """
    CSS height, applied as an inline style. Pass `nil` to emit no style at all and
    size the map from your own CSS — a Tailwind class, a flex parent, a container
    query. Note that an inline style beats a class, so `class="h-96"` needs
    `height={nil}` to take effect.
    """

  attr :label, :string,
    default: "Map",
    doc: """
    The map's accessible name, announced by a screen reader and read out when the
    map takes keyboard focus. The default says only that this is a map; say which
    map — `label="Delivery points"` — when there is more than one on a page, or
    when the map is the page.
    """

  attr :class, :any, default: nil, doc: "Extra classes on the map container."
  attr :rest, :global

  slot :popup,
    doc: """
    Rendered once per marker and shown when that marker is clicked, with no server
    round-trip. Receives the `Rover.Marker` via `:let`.

        <.map id="clients" markers={@clients}>
          <:popup :let={marker}>
            <h3>{marker.label}</h3>
            <p>{marker.data && marker.data.address}</p>
            <button data-rover-popup-close>Close</button>
          </:popup>
        </.map>

    `:data` is `nil` unless you set it, hence the guard.

    Any element carrying `data-rover-popup-close` closes it; so do a click on the
    map and the Escape key. Because every marker's popup is rendered up front,
    this costs one DOM node per marker — fine for dozens, which is why clustering
    rather than popups is the answer to hundreds.
    """

  slot :shape_popup,
    doc: """
    The same, for shapes. Receives the `Rover.Shape` via `:let`, and opens where the
    geometry was clicked rather than at its centroid — pointing at the middle of a
    long route or a large parcel would point at nothing the user did.

        <.map id="parcels" shapes={@parcels}>
          <:shape_popup :let={shape}>
            <h3>{shape.label}</h3>
            <p>{shape.data && shape.data.area} ha</p>
          </:shape_popup>
        </.map>

    Works with or without `on_shape_click`: the click is claimed when either the
    server or a popup wants it, and by neither when the shape is scenery.
    """

  @spec map(map()) :: Phoenix.LiveView.Rendered.t()
  def map(assigns) do
    markers = Marker.new_all!(assigns.markers, assigns.marker_fields)
    shapes = Shape.new_all!(assigns.shapes, assigns.shape_fields)
    heat = Heatmap.new_all!(assigns.heatmap, assigns.heatmap_fields)

    assigns =
      assigns
      |> assign(:markers_json, encode_markers(markers))
      |> assign(:shapes_json, encode_shapes(shapes))
      |> assign(:heatmap_json, encode_heatmap(heat, assigns.heatmap_style))
      |> assign(:config_json, encode_config(assigns, markers, shapes, heat))
      |> assign(:popup_markers, if(assigns.popup == [], do: [], else: markers))
      |> assign(:popup_shapes, if(assigns.shape_popup == [], do: [], else: shapes))
      |> assign(:index, index(assigns, markers, shapes))

    ~H"""
    <div
      id={@id}
      class={classes(@class)}
      phx-hook="Rover"
      data-rover={@config_json}
      data-rover-markers={@markers_json}
      data-rover-shapes={@shapes_json}
      data-rover-heatmap={@heatmap_json}
      {@rest}
      {height_style(@height)}
    >
      <%!-- `role="application"` because the arrow keys belong to the map once it
           has focus: they pan it rather than scrolling the page, which is exactly
           what the role tells a screen reader to expect. The tabindex is what
           makes that focus possible at all — without it OpenLayers' keyboard pan
           and zoom are present and unreachable — so a locked map does not get
           one. --%>
      <div
        id={"#{@id}-canvas"}
        class="rover-map__canvas"
        phx-update="ignore"
        role="application"
        aria-label={@label}
        tabindex={if @interactive, do: "0"}
      >
      </div>
      <%!-- Markers and shapes are painted into a canvas: there is nothing for a
           keyboard or a screen reader to reach. This list is that missing DOM —
           one button per feature, each hidden until it takes focus, each
           activating the same click the pointer would. Rendered only when
           something is actually listening, so a map that is scenery does not
           grow a list of buttons that do nothing. --%>
      <ul :if={@index != []} class="rover-map__index" aria-label={"#{@label} contents"}>
        <li :for={item <- @index}>
          <button type="button" data-rover-focus={item.key}>{item.label}</button>
        </li>
      </ul>
      <%!-- Keys are namespaced: a marker and a shape may carry the same id, and two
           nodes answering to one selector means one of them silently wins. --%>
      <div
        :for={marker <- @popup_markers}
        id={"#{@id}-popup-marker-#{marker.id}"}
        class="rover-popup"
        data-rover-popup-for={"marker:#{marker.id}"}
        role="dialog"
        aria-label={index_label(marker, "Marker")}
        tabindex="-1"
        hidden
      >
        {render_slot(@popup, marker)}
      </div>
      <div
        :for={shape <- @popup_shapes}
        id={"#{@id}-popup-shape-#{shape.id}"}
        class="rover-popup"
        data-rover-popup-for={"shape:#{shape.id}"}
        role="dialog"
        aria-label={index_label(shape, "Shape")}
        tabindex="-1"
        hidden
      >
        {render_slot(@shape_popup, shape)}
      </div>
    </div>
    """
  end

  # As a dynamic attribute rather than `style={...}`: HEEx renders a nil value as
  # `style=""`, and an empty inline style still wins over a class in the cascade,
  # so `height={nil}` has to leave the attribute out altogether. Placed after
  # `{@rest}` because HEEx keeps the first of two identical attribute names, and a
  # caller who passes their own `style` should win.
  defp height_style(nil), do: %{}
  defp height_style(height), do: %{"style" => "height: #{height};"}

  # A list containing `nil` renders as a trailing space, which then shows up in
  # every consumer's DOM. Filter before handing it to HEEx.
  defp classes(extra) do
    ["rover-map", extra]
    |> List.flatten()
    |> Enum.reject(&(&1 in [nil, false, ""]))
  end

  # -- accessibility ---------------------------------------------------------

  # One entry per feature a click can do something with. A marker or shape that
  # neither opens a popup nor reaches the server is scenery: listing it would put
  # a button in the tab order that does nothing when pressed.
  defp index(%{interactive: false}, _markers, _shapes), do: []

  defp index(assigns, markers, shapes) do
    markers = if actionable?(assigns.popup, assigns.on_marker_click), do: markers, else: []
    shapes = if actionable?(assigns.shape_popup, assigns.on_shape_click), do: shapes, else: []

    Enum.map(markers, &%{key: "marker:#{&1.id}", label: index_label(&1, "Marker")}) ++
      Enum.map(shapes, &%{key: "shape:#{&1.id}", label: index_label(&1, "Shape")})
  end

  defp actionable?(slot, event), do: slot != [] or not is_nil(event)

  # The name the user already gave it, and its id only as a last resort — "Marker
  # 41" is poor, but it is addressable, which no label at all is not.
  defp index_label(item, kind) do
    item.label || item.tooltip || "#{kind} #{item.id}"
  end

  # -- config ----------------------------------------------------------------

  defp encode_markers(markers) do
    markers
    |> Enum.map(&Marker.dump/1)
    |> Jason.encode!()
  end

  defp encode_shapes(shapes) do
    shapes
    |> Enum.map(&Shape.dump/1)
    |> Jason.encode!()
  end

  # Nothing at all when there is no heat field, so the attribute is absent rather
  # than an empty payload every map has to carry.
  defp encode_heatmap([], _style), do: nil

  defp encode_heatmap(points, style) do
    Jason.encode!(%{points: points, rev: Heatmap.rev(points), style: Heatmap.style!(style)})
  end

  defp encode_config(assigns, markers, shapes, heat) do
    {lat, lon} = resolve_center(assigns.center, markers, shapes, heat)

    %{
      center: [lat, lon],
      # A center Rover computed from the markers is a starting frame, not an
      # instruction: it shifts whenever any marker moves. Tell the client, so it
      # does not re-animate the view on every marker update.
      derivedCenter: is_nil(assigns.center) || nil,
      zoom: assigns.zoom || default_zoom(assigns.center),
      minZoom: assigns.min_zoom,
      maxZoom: assigns.max_zoom,
      tiles: encode_tiles(assigns.tiles),
      fit: encode_fit(assigns.fit, assigns.center),
      fitPadding: assigns.fit_padding,
      cluster: encode_cluster(assigns.cluster),
      controls: encode_controls(assigns.controls),
      interactive: assigns.interactive,
      # Read back by the client to keep the canvas's `aria-label` and `tabindex`
      # in step: the element is `phx-update="ignore"`, and LiveView merges only
      # `data-*` attributes onto one of those.
      label: assigns.label,
      target: encode_target(assigns.target),
      events:
        drop_nils(%{
          markerClick: assigns.on_marker_click,
          clusterClick: assigns.on_cluster_click,
          shapeClick: assigns.on_shape_click,
          mapClick: assigns.on_map_click,
          moveEnd: assigns.on_move_end,
          markerDragEnd: assigns.on_marker_drag_end,
          shapeEditEnd: assigns.on_shape_edit_end,
          drawEnd: assigns.on_draw_end
        })
    }
    |> drop_nils()
    |> Jason.encode!()
  end

  # A map with one parcel outline and no pin on it still has to know where to
  # look, so the derived centre covers shapes as well as markers.
  defp resolve_center(nil, markers, shapes, heat) do
    case Geo.bbox(content_coordinates(markers, shapes, heat)) do
      nil -> @default_center
      {south, west, north, east} -> {(south + north) / 2, (west + east) / 2}
    end
  end

  defp resolve_center(center, _markers, _shapes, _heat), do: Geo.coord!(center)

  defp content_coordinates(markers, shapes, heat) do
    Enum.map(markers, &{&1.lat, &1.lon}) ++
      Enum.map(heat, &{&1.lat, &1.lon}) ++
      shape_coordinates(shapes)
  end

  # Marker coordinates are validated on the way in, so they are known good.
  # Geometry is not: it arrives from PostGIS, a cadastral API, a routing service,
  # and `ST_AsGeoJSON` on an EPSG:3857 column returns metres. Deriving a centre is
  # a convenience, so an unusable coordinate is skipped rather than allowed to
  # raise — taking a whole LiveView down at render time over a framing hint is the
  # wrong trade. The client is deliberately just as forgiving about reading it.
  defp shape_coordinates(shapes) do
    shapes
    |> Enum.flat_map(&Shape.coordinates/1)
    |> Enum.filter(&match?({:ok, _}, Geo.coord(&1)))
  end

  # Without an explicit center we fit to the content anyway, so this zoom is only
  # the starting point of that animation. With a center and no zoom, "the world"
  # is never what anyone meant — a city-level zoom is the useful default.
  defp default_zoom(nil), do: @default_zoom
  defp default_zoom(_center), do: @centered_zoom

  defp encode_tiles(tiles) do
    case Tiles.resolve!(tiles) do
      nil ->
        nil

      %{type: :vector} = resolved ->
        %{
          type: "vector",
          styleUrl: resolved.style_url,
          attributions: resolved.attributions,
          maxZoom: resolved.max_zoom
        }

      resolved ->
        %{
          type: "raster",
          url: resolved.url,
          attributions: resolved.attributions,
          maxZoom: resolved.max_zoom
        }
    end
  end

  defp encode_fit(nil, nil), do: "once"
  defp encode_fit(nil, _center), do: false
  defp encode_fit(:once, _center), do: "once"
  defp encode_fit(true, _center), do: "always"
  defp encode_fit(:always, _center), do: "always"
  defp encode_fit(false, _center), do: false

  defp encode_fit(other, _center) do
    raise ArgumentError,
          "invalid fit: #{inspect(other)}. Expected `:once`, `true`, `false` or `nil`."
  end

  @cluster_options [:distance, :min_distance, :zoom_on_click]

  defp encode_cluster(false), do: nil
  defp encode_cluster(nil), do: nil
  defp encode_cluster(true), do: encode_cluster([])

  defp encode_cluster(opts) when is_list(opts) do
    Keyword.keyword?(opts) ||
      raise ArgumentError, """
      invalid cluster: #{inspect(opts)}.

      Expected `true`, `false`, or a keyword list — `cluster={[distance: 60]}`, not
      `cluster={[:distance]}`.
      """

    Enum.each(opts, fn {key, _value} ->
      key in @cluster_options ||
        raise ArgumentError, """
        unknown cluster option #{inspect(key)}.

        Expected any of: #{Enum.map_join(@cluster_options, ", ", &inspect/1)}.
        """
    end)

    %{
      distance: Keyword.get(opts, :distance, 40),
      minDistance: Keyword.get(opts, :min_distance, 20),
      zoomOnClick: Keyword.get(opts, :zoom_on_click, true)
    }
  end

  defp encode_cluster(other) do
    raise ArgumentError, """
    invalid cluster: #{inspect(other)}.

    Expected `true`, `false`, or a keyword list of #{Enum.map_join(@cluster_options, ", ", &inspect/1)}.
    """
  end

  @known_controls [:zoom, :attribution, :scale_line, :full_screen, :rotate]

  defp encode_controls(controls) when is_list(controls) do
    Enum.each(controls, fn control ->
      control in @known_controls ||
        raise ArgumentError, """
        unknown map control #{inspect(control)}.

        Expected any of: #{Enum.map_join(@known_controls, ", ", &inspect/1)}.
        """
    end)

    Map.new(@known_controls, fn control -> {camelize(control), control in controls} end)
  end

  defp encode_controls(other) do
    raise ArgumentError, "expected `controls` to be a list, got: #{inspect(other)}"
  end

  defp encode_target(nil), do: nil
  defp encode_target(target), do: to_string(target)

  defp camelize(atom) do
    [first | rest] = atom |> Atom.to_string() |> String.split("_")
    Enum.join([first | Enum.map(rest, &String.capitalize/1)])
  end

  defp drop_nils(map) do
    map
    |> Enum.reject(fn {_key, value} -> is_nil(value) end)
    |> Map.new()
  end
end
