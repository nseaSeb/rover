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

  ## Controlled view, uncontrolled panning

  `center` and `zoom` are applied when they *change on the server*. A user
  panning the map does not push new values back unless you ask for them with
  `on_move_end`, and a re-render triggered by something unrelated will not yank
  the view back to where it started. Assign a new `center` and the map animates
  to it.
  """

  use Phoenix.Component

  alias Rover.Geo
  alias Rover.Marker
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

  attr :tiles, :any, default: :osm, doc: "A `Rover.Tiles` preset, `{:xyz, url}`, or `:none`."

  attr :fit, :any,
    default: nil,
    doc: """
    `:once` fits the view to the markers when the map first appears, `true` refits
    on every change, `false` never does. Defaults to `:once` when no `center` is
    given, `false` otherwise.
    """

  attr :fit_padding, :integer, default: 48, doc: "Pixels kept clear around a fitted view."

  attr :controls, :list,
    default: [:zoom, :attribution],
    doc: "Any of `:zoom`, `:attribution`, `:scale_line`, `:full_screen`, `:rotate`."

  attr :interactive, :boolean,
    default: true,
    doc: "When false, the map ignores pans, zooms and clicks entirely."

  attr :on_marker_click, :string, default: nil
  attr :on_map_click, :string, default: nil
  attr :on_move_end, :string, default: nil
  attr :on_marker_drag_end, :string, default: nil

  attr :target, :any,
    default: nil,
    doc: "`@myself` to route events to the enclosing `Phoenix.LiveComponent`."

  attr :height, :string, default: "24rem", doc: "CSS height. Set to nil to style it yourself."
  attr :class, :any, default: nil, doc: "Extra classes on the map container."
  attr :rest, :global

  @spec map(map()) :: Phoenix.LiveView.Rendered.t()
  def map(assigns) do
    markers = Marker.new_all!(assigns.markers, assigns.marker_fields)

    assigns =
      assigns
      |> assign(:markers_json, encode_markers(markers))
      |> assign(:config_json, encode_config(assigns, markers))

    ~H"""
    <div
      id={@id}
      class={["rover-map", @class]}
      style={@height && "height: #{@height};"}
      phx-hook="Rover"
      data-rover={@config_json}
      data-rover-markers={@markers_json}
      {@rest}
    >
      <div id={"#{@id}-canvas"} class="rover-map__canvas" phx-update="ignore"></div>
    </div>
    """
  end

  # -- config ----------------------------------------------------------------

  defp encode_markers(markers) do
    markers
    |> Enum.map(&Marker.dump/1)
    |> Jason.encode!()
  end

  defp encode_config(assigns, markers) do
    {lat, lon} = resolve_center(assigns.center, markers)

    %{
      center: [lat, lon],
      zoom: assigns.zoom || default_zoom(assigns.center, markers),
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
          mapClick: assigns.on_map_click,
          moveEnd: assigns.on_move_end,
          markerDragEnd: assigns.on_marker_drag_end
        })
    }
    |> drop_nils()
    |> Jason.encode!()
  end

  defp resolve_center(nil, []), do: @default_center

  defp resolve_center(nil, markers) do
    {south, west, north, east} = Geo.bbox(markers)
    {(south + north) / 2, (west + east) / 2}
  end

  defp resolve_center(center, _markers), do: Geo.coord!(center)

  # Without an explicit center we fit to the markers anyway, so this zoom is only
  # the starting point of that animation. With a center and no zoom, "the world"
  # is never what anyone meant — a city-level zoom is the useful default.
  defp default_zoom(nil, []), do: @default_zoom
  defp default_zoom(nil, _markers), do: @default_zoom
  defp default_zoom(_center, _markers), do: @centered_zoom

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
