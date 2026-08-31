defmodule Rover do
  @moduledoc """
  Maps for Phoenix LiveView, powered by [OpenLayers](https://openlayers.org/).

  OpenLayers is a serious mapping engine — projections, tile pyramids, vector
  layers, styling, interactions. It is also a lot to learn before you can put
  three pins on a map. Rover keeps the engine and hides the ceremony:

      <.map id="clients" center={{45.75, 4.85}} zoom={12} markers={@clients} />

      assign(socket,
        clients: [
          %{id: 1, lat: 45.76, lon: 4.83, label: "Atelier"},
          %{id: 2, lat: 45.74, lon: 4.86, label: "Dépôt"}
        ]
      )

  No `Feature`, no `VectorSource`, no `Style`. Assign a list, get a map. Assign a
  different list, and only the markers that changed are touched.

  Geometries work the same way, from GeoJSON:

      <.map id="parcel" shapes={@parcels} tiles={:ign_ortho} />

  ## Installation

  Add the dependency:

      def deps do
        [{:rover, "~> 0.4"}]
      end

  Register the hook in `assets/js/app.js`. Rover ships a prebuilt bundle with
  OpenLayers already inside, so there is nothing to install with `npm`:

      import { RoverHooks } from "../../deps/rover/priv/static/rover.js"

      const liveSocket = new LiveSocket("/live", Socket, {
        params: { _csrf_token: csrfToken },
        hooks: { ...RoverHooks }
      })

  Import the stylesheet in `assets/css/app.css`:

      @import "../../deps/rover/priv/static/rover.css";

  And import the component where you need it — typically once, in the
  `html_helpers` block of your `*_web.ex`:

      import Rover.Components

  ## Where to go next

  * `Rover.Components` — the `<.map>` component, its attributes, its events and
    the `<:popup>` slot.
  * `Rover.Marker` — what counts as a marker, and how to map your own schemas.
  * `Rover.Shape` — GeoJSON outlines, routes and zones.
  * `Rover.Heatmap` — density as a heat field rather than as pins.
  * `Rover.Tiles` — basemaps, including the French Géoportail, and the
    attribution you are required to keep.
  * `Rover.Geo` — coordinates, bounding boxes, distances.

  ## Bring your own OpenLayers

  If your app already builds JavaScript with `npm` and you want to control the
  OpenLayers version, import the peer build instead and add `ol` yourself:

      // assets/package.json: "ol": "^10.0.0"
      import { RoverHooks } from "../../deps/rover/priv/static/rover.external.js"

  This one needs a build change, and without it esbuild stops with `Could not
  resolve "ol/Map.js"` — once for each of the twenty-seven `ol` specifiers the
  peer build leaves bare. esbuild resolves a bare import by walking up from the
  file that wrote it, which here is `deps/rover/priv/static/`, where there is no
  `node_modules` and never will be. Phoenix's generated `NODE_PATH` points at
  `deps` alone, so your `ol` is never on the search path.

  In your existing `config :esbuild` block in `config/config.exs`, replace the
  `env:` key — leave `args:` and `cd:` exactly as they are:

      env: %{
        "NODE_PATH" =>
          Enum.join(
            [Path.expand("../deps", __DIR__), Path.expand("../assets/node_modules", __DIR__)],
            if(match?({:win32, _}, :os.type()), do: ";", else: ":")
          )
      }

  The default build needs none of this — OpenLayers is already inside
  `rover.js`.

  Rover is tested against the version it bundles; the peer build is offered for
  applications that need to share a single OpenLayers instance with their own
  code.
  """

  alias Rover.Geo
  alias Rover.Shape

  @doc """
  Moves a map's view, without making the view part of your state.

  `center` and `zoom` are attributes, which is right when the view *is* a property
  of what you are rendering. It is the wrong tool for "the user clicked a row, take
  me there": passing `center` costs you the automatic framing — `fit` falls back to
  `false` and the centre stops being derived — so you trade the default behaviour
  for one gesture, and you have to keep the view in assigns from then on.

  This is a one-shot command instead. Nothing is assigned, no attribute changes,
  and the map keeps its declarative framing for everything else.

      def handle_event("select_client", %{"id" => id}, socket) do
        client = Enum.find(socket.assigns.clients, &(&1.id == id))

        {:noreply, Rover.fly_to(socket, "clients", {client.lat, client.lon}, zoom: 15)}
      end

  ## Options

    * `:zoom` — where to end up. Omit to keep the current zoom.
    * `:duration` — animation length in milliseconds. Defaults to `500`.
      `0` jumps.

  The first argument to identify is the map's DOM `id`, because a LiveView can
  hold several maps and an event reaches all of them.
  """
  @spec fly_to(Phoenix.LiveView.Socket.t(), String.t(), Geo.coordish(), keyword()) ::
          Phoenix.LiveView.Socket.t()
  def fly_to(socket, id, center, opts \\ []) do
    {lat, lon} = Geo.coord!(center)

    Phoenix.LiveView.push_event(socket, "rover:fly_to", %{
      id: id,
      center: [lat, lon],
      zoom: Keyword.get(opts, :zoom),
      duration: Keyword.get(opts, :duration, 500)
    })
  end

  @doc """
  Frames a map's view around some content, without making the view part of your
  state.

  The counterpart to `fly_to/4` for "show me these": pass markers, shapes,
  coordinates, or a `{south, west, north, east}` bounding box, and the client fits
  the view to it — using the viewport size, which only the client knows.

      {:noreply, Rover.fit_to(socket, "fleet", vehicles_on_shift)}

  ## Options

    * `:padding` — pixels kept clear around the content. Defaults to `48`.
    * `:max_zoom` — how far in the fit may go. Defaults to `16`, which stops a
      single point from filling the screen.
    * `:duration` — animation length in milliseconds. Defaults to `500`.

  Returns the socket untouched when there is nothing to frame, so
  `fit_to(socket, "fleet", [])` is a no-op rather than an error.
  """
  @spec fit_to(Phoenix.LiveView.Socket.t(), String.t(), term(), keyword()) ::
          Phoenix.LiveView.Socket.t()
  def fit_to(socket, id, content, opts \\ []) do
    case bbox(content) do
      nil ->
        socket

      {south, west, north, east} ->
        Phoenix.LiveView.push_event(socket, "rover:fit_to", %{
          id: id,
          bbox: [south, west, north, east],
          padding: Keyword.get(opts, :padding, 48),
          maxZoom: Keyword.get(opts, :max_zoom, 16),
          duration: Keyword.get(opts, :duration, 500)
        })
    end
  end

  @draw_types %{point: "Point", line: "LineString", polygon: "Polygon"}

  @doc """
  Arms the map for drawing, so the user can put a new shape on it.

  `:editable` lets a user reshape a geometry that already exists. This is the
  other half: there is nothing to attach a per-item flag to yet, so drawing is a
  one-shot command like `fly_to/4` rather than an attribute — a mode the server
  turns on for a gesture and turns off again.

      def handle_event("draw_parcel", _params, socket) do
        {:noreply, Rover.start_drawing(socket, "parcels", type: :polygon)}
      end

  The finished geometry arrives on `on_draw_end`, with no `:id` — the shape does
  not exist yet, and identity is yours to assign:

      def handle_event("drew", %{"geometry" => geometry}, socket) do
        parcel = %{id: System.unique_integer([:positive]), geometry: geometry}

        {:noreply,
         socket
         |> assign(parcels: socket.assigns.parcels ++ [parcel])
         |> Rover.stop_drawing("parcels")}
      end

  The mode stays armed until `stop_drawing/2`, so a user asked to trace four
  parcels traces four without touching the toolbar again. Escape abandons the
  sketch in progress and leaves the mode armed, the way it does in every drawing
  tool.

  While it is armed the map claims every click — `on_marker_click`,
  `on_shape_click`, `on_cluster_click` and `on_map_click` all stop firing, and
  popups stop opening. A click that places a vertex is not a click on whatever
  sits under it. Because the mode persists, leaving it armed leaves the map's
  other click behaviour off with it.

  ## Options

    * `:type` — `:polygon` (the default), `:line` or `:point`.

  There is no `:circle`. OpenLayers can draw one, GeoJSON has no way to represent
  one, and a shape that cannot round-trip through `Rover.Shape` would be a
  geometry the server could never store or send back.

  A map rendered with `interactive={false}` refuses to arm: it is a picture, and
  drawing is the largest interaction there is.
  """
  @spec start_drawing(Phoenix.LiveView.Socket.t(), String.t(), keyword()) ::
          Phoenix.LiveView.Socket.t()
  def start_drawing(socket, id, opts \\ []) do
    type = Keyword.get(opts, :type, :polygon)

    Phoenix.LiveView.push_event(socket, "rover:start_drawing", %{id: id, type: draw_type!(type)})
  end

  @doc """
  Disarms a map armed by `start_drawing/3`, and discards any unfinished sketch.

  Calling it on a map that is not drawing does nothing.
  """
  @spec stop_drawing(Phoenix.LiveView.Socket.t(), String.t()) :: Phoenix.LiveView.Socket.t()
  def stop_drawing(socket, id) do
    Phoenix.LiveView.push_event(socket, "rover:stop_drawing", %{id: id})
  end

  defp draw_type!(type) do
    case Map.fetch(@draw_types, type) do
      {:ok, geojson_type} ->
        geojson_type

      :error ->
        raise ArgumentError, """
        invalid draw type: #{inspect(type)}.

        Expected one of: #{Enum.map_join(Map.keys(@draw_types), ", ", &inspect/1)}.

        Note that :circle is not among them — GeoJSON cannot represent a circle,
        so a drawn one could never round-trip through Rover.Shape.
        """
    end
  end

  @doc """
  The bounding box of anything `fit_to/4` accepts, as `{south, west, north, east}`.

  Markers, shapes, plain coordinates, a mixed list, or a box passed through
  unchanged. `nil` when there is nothing to enclose.

  ## Examples

      iex> Rover.bbox([%{id: 1, lat: 45.0, lon: 4.0}, %{id: 2, lat: 46.0, lon: 5.0}])
      {45.0, 4.0, 46.0, 5.0}

      iex> Rover.bbox({45.0, 4.0, 46.0, 5.0})
      {45.0, 4.0, 46.0, 5.0}

      iex> Rover.bbox([])
      nil
  """
  @spec bbox(term()) :: Geo.bbox() | nil
  def bbox({south, west, north, east})
      when is_number(south) and is_number(west) and is_number(north) and is_number(east) do
    {south / 1, west / 1, north / 1, east / 1}
  end

  def bbox(content) when is_list(content) do
    content
    |> Enum.reject(&is_nil/1)
    |> Enum.flat_map(&coordinates/1)
    |> Geo.bbox()
  end

  def bbox(one), do: bbox([one])

  # A shape carries a geometry; anything else is expected to carry a coordinate.
  # Unusable coordinates are dropped rather than raised on, for the same reason
  # `<.map>` does it: framing is a convenience, and third-party geometry arrives in
  # whatever projection it arrives in.
  defp coordinates(%Shape{} = shape), do: Shape.coordinates(shape) |> Enum.filter(&valid?/1)

  defp coordinates(%{geometry: _} = shape),
    do: shape |> Shape.new!() |> Shape.coordinates() |> Enum.filter(&valid?/1)

  defp coordinates(other) do
    case Geo.coord(other) do
      {:ok, coord} -> [coord]
      :error -> []
    end
  end

  defp valid?(coord), do: match?({:ok, _}, Geo.coord(coord))
end
