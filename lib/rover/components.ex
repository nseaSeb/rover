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
  | `on_map_click` | `%{"lat" => lat, "lon" => lon}` |
  | `on_move_end` | `%{"center" => [lat, lon], "zoom" => zoom, "bbox" => %{"south" =>, "west" =>, "north" =>, "east" =>}}` |
  | `on_marker_drag_end` | `%{"id" => id, "lat" => lat, "lon" => lon}` |

  Inside a `Phoenix.LiveComponent`, route the events to yourself with
  `target={@myself}`.

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

  attr :tiles, :any, default: :osm, doc: "A `Rover.Tiles` preset, `{:xyz, url}`, or `:none`."

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

  attr :target, :any,
    default: nil,
    doc: "`@myself` to route events to the enclosing `Phoenix.LiveComponent`."

  attr :height, :string, default: "24rem", doc: "CSS height. Set to nil to style it yourself."
  attr :class, :any, default: nil, doc: "Extra classes on the map container."
  attr :rest, :global

  slot :popup,
    doc: """
    Rendered once per marker and shown when that marker is clicked, with no server
    round-trip. Receives the `Rover.Marker` via `:let`.

        <.map id="clients" markers={@clients}>
          <:popup :let={marker}>
            <h3>{marker.label}</h3>
            <p>{marker.data.address}</p>
            <button data-rover-popup-close>Close</button>
          </:popup>
        </.map>

    Any element carrying `data-rover-popup-close` closes it; so do a click on the
    map and the Escape key. Because every marker's popup is rendered up front,
    this costs one DOM node per marker — fine for dozens, which is why clustering
    rather than popups is the answer to hundreds.
    """

  @spec map(map()) :: Phoenix.LiveView.Rendered.t()
  def map(assigns) do
    markers = Marker.new_all!(assigns.markers, assigns.marker_fields)
    shapes = Shape.new_all!(assigns.shapes, assigns.shape_fields)

    assigns =
      assigns
      |> assign(:markers_json, encode_markers(markers))
      |> assign(:shapes_json, encode_shapes(shapes))
      |> assign(:config_json, encode_config(assigns, markers, shapes))
      |> assign(:popup_markers, if(assigns.popup == [], do: [], else: markers))

    ~H"""
    <div
      id={@id}
      class={classes(@class)}
      style={@height && "height: #{@height};"}
      phx-hook="Rover"
      data-rover={@config_json}
      data-rover-markers={@markers_json}
      data-rover-shapes={@shapes_json}
      {@rest}
    >
      <div id={"#{@id}-canvas"} class="rover-map__canvas" phx-update="ignore"></div>
      <div
        :for={marker <- @popup_markers}
        id={"#{@id}-popup-#{marker.id}"}
        class="rover-popup"
        data-rover-popup-for={marker.id}
        hidden
      >
        {render_slot(@popup, marker)}
      </div>
    </div>
    """
  end

  # A list containing `nil` renders as a trailing space, which then shows up in
  # every consumer's DOM. Filter before handing it to HEEx.
  defp classes(extra) do
    ["rover-map", extra]
    |> List.flatten()
    |> Enum.reject(&(&1 in [nil, false, ""]))
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

  defp encode_config(assigns, markers, shapes) do
    {lat, lon} = resolve_center(assigns.center, markers, shapes)

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
      controls: encode_controls(assigns.controls),
      interactive: assigns.interactive,
      target: encode_target(assigns.target),
      events:
        drop_nils(%{
          markerClick: assigns.on_marker_click,
          shapeClick: assigns.on_shape_click,
          mapClick: assigns.on_map_click,
          moveEnd: assigns.on_move_end,
          markerDragEnd: assigns.on_marker_drag_end
        })
    }
    |> drop_nils()
    |> Jason.encode!()
  end

  # A map with one parcel outline and no pin on it still has to know where to
  # look, so the derived centre covers shapes as well as markers.
  defp resolve_center(nil, markers, shapes) do
    case Geo.bbox(content_coordinates(markers, shapes)) do
      nil -> @default_center
      {south, west, north, east} -> {(south + north) / 2, (west + east) / 2}
    end
  end

  defp resolve_center(center, _markers, _shapes), do: Geo.coord!(center)

  defp content_coordinates(markers, shapes) do
    Enum.map(markers, &{&1.lat, &1.lon}) ++ Enum.flat_map(shapes, &Shape.coordinates/1)
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

      resolved ->
        %{url: resolved.url, attributions: resolved.attributions, maxZoom: resolved.max_zoom}
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
