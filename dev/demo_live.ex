defmodule RoverDev.DemoLive do
  @moduledoc """
  The playground behind `mix dev`.

  It exists to prove one claim: everything below is plain `assign/3` on lists of
  maps. There is no OpenLayers in this file.
  """
  use Phoenix.LiveView, layout: false

  import Rover.Components

  @clients [
    %{id: 1, lat: 45.7640, lon: 4.8357, emoji: "🏠", label: "Atelier", data: %{orders: 3}},
    %{id: 2, lat: 45.7484, lon: 4.8467, emoji: "🏭", label: "Dépôt", data: %{orders: 12}},
    %{
      id: 3,
      lat: 45.7797,
      lon: 4.8000,
      emoji: "🌿",
      label: "Chantier",
      draggable: true,
      data: %{orders: 0}
    }
  ]

  # A parcel outline and a route: the two geometry shapes a real application
  # actually has. Both are plain GeoJSON, longitude first, exactly as a cadastral
  # API or a routing service returns them.
  @parcel %{
    "type" => "Polygon",
    "coordinates" => [
      [
        [4.8280, 45.7690],
        [4.8360, 45.7695],
        [4.8365, 45.7745],
        [4.8285, 45.7740],
        [4.8280, 45.7690]
      ]
    ]
  }

  @route %{
    "type" => "LineString",
    "coordinates" => [
      [4.8357, 45.7640],
      [4.8400, 45.7580],
      [4.8467, 45.7484],
      [4.8300, 45.7450],
      [4.8000, 45.7797]
    ]
  }

  @impl true
  def mount(_params, _session, socket) do
    {:ok,
     assign(socket,
       clients: @clients,
       shapes: shapes(:both),
       tiles: :ign_plan,
       heat: false,
       heat_radius: 14,
       cluster: false,
       crowd: false,
       cluster_log: nil,
       next_id: 4,
       next_drawn_id: 1,
       draw: nil,
       reject_edits: false,
       log: nil
     )}
  end

  # `?shapes=parcel|route|none` picks the initial geometry, which makes the
  # playground scriptable. The browser suite needs it: with both shapes the route's
  # bounding box happens to enclose all three markers, so a fit that saw only the
  # shapes would still look correct. With the parcel alone, two markers fall
  # outside — which is exactly the framing bug worth guarding against, and it can
  # only be reproduced on a fresh mount.
  @impl true
  def handle_params(params, _uri, socket) do
    {:noreply, assign(socket, shapes: shapes(shape_mode(params)))}
  end

  defp shape_mode(%{"shapes" => "parcel"}), do: :parcel_only
  defp shape_mode(%{"shapes" => "route"}), do: :route_only
  defp shape_mode(%{"shapes" => "none"}), do: :none
  defp shape_mode(_params), do: :both

  @impl true
  def render(assigns) do
    ~H"""
    <h1>Rover</h1>
    <p class="subtitle">
      Markers, emoji, GeoJSON outlines and popups — all from lists of maps.
      Click a marker for its popup, click a shape, drag the 🌿, or move the map.
    </p>

    <div class="toolbar">
      <button phx-click="add">Add a marker</button>
      <button phx-click="move">Move the first one</button>
      <button phx-click="recolor">Recolour the parcel</button>
      <button phx-click="reroute">Reroute</button>
      <button phx-click="remove">Remove the last marker</button>
      <button phx-click="cycle_shapes">Shapes: {shape_label(@shapes)}</button>
      <button phx-click="cycle_tiles">Tiles: {@tiles}</button>
      <button phx-click="reset">Reset</button>
      <button phx-click="fly_paris">Fly to Paris</button>
      <button phx-click="fit_first">Fit the first client</button>
      <button phx-click="toggle_heat">Heatmap: {if @heat, do: "on", else: "off"}</button>
      <button phx-click="cycle_heat_radius">Heat radius: {@heat_radius}</button>
      <button phx-click="toggle_crowd">Crowd: {if @crowd, do: "240 markers", else: "off"}</button>
      <button phx-click="toggle_cluster">Cluster: {cluster_label(@cluster)}</button>
      <button phx-click="yard">Two in a yard</button>
      <button phx-click="toggle_edit_reject">
        Edits: {if @reject_edits, do: "rejected", else: "accepted"}
      </button>
      <button phx-click="cycle_draw">Draw: {@draw || "off"}</button>
    </div>

    <.map
      id="clients"
      markers={if @crowd, do: @clients ++ crowd(), else: @clients}
      cluster={@cluster}
      shapes={@shapes}
      heatmap={if @heat, do: heat_points(), else: []}
      heatmap_style={[radius: @heat_radius, blur: 22, opacity: 0.85]}
      tiles={@tiles}
      height="28rem"
      controls={[:zoom, :attribution, :scale_line]}
      on_marker_click="marker_clicked"
      on_cluster_click="cluster_clicked"
      on_shape_click="shape_clicked"
      on_map_click="map_clicked"
      on_move_end="moved"
      on_marker_drag_end="marker_dragged"
      on_shape_edit_end="shape_edited"
      on_draw_end="drew"
    >
      <:popup :let={marker}>
        <strong>{marker.emoji} {marker.label}</strong>
        <%!-- Guarded, because :data is nil unless set — and the crowd markers do not
             set it. Exactly the trap the slot's documentation warns about. --%>
        <div>{marker.data && "#{marker.data.orders} orders"}</div>
        <div>{fmt(marker.lat)}, {fmt(marker.lon)}</div>
        <button data-rover-popup-close>Close</button>
      </:popup>
      <:shape_popup :let={shape}>
        <strong>{shape.label || shape.id}</strong>
        <div>{shape_detail(shape)}</div>
        <button data-rover-popup-close>Close</button>
      </:shape_popup>
    </.map>

    <p class="subtitle">
      A second map, sharing the same markers, with a shape popup and <em>no event handlers at all</em>. Commands name their target, so flying the
      map above must leave this one where it is — and this parcel's popup must open
      without the server being involved.
    </p>

    <.map
      id="mini"
      markers={@clients}
      shapes={[parcel()]}
      tiles={:carto_light}
      height="10rem"
      controls={[:attribution]}
    >
      <:shape_popup :let={shape}>
        <strong>{shape.label}</strong>
        <div>no handler wired</div>
      </:shape_popup>
    </.map>

    <div class="cluster-log">
      <%= if @cluster_log do %>
        {@cluster_log}
      <% else %>
        <span>Cluster clicks land here.</span>
      <% end %>
    </div>

    <div class="log">
      <%= if @log do %>
        {@log}
      <% else %>
        <span>Events from the map land here.</span>
      <% end %>
    </div>
    """
  end

  @impl true
  def handle_event("add", _params, socket) do
    id = socket.assigns.next_id

    client = %{
      id: id,
      lat: 45.76 + (:rand.uniform() - 0.5) * 0.06,
      lon: 4.83 + (:rand.uniform() - 0.5) * 0.08,
      emoji: "📍",
      label: "Client #{id}",
      data: %{orders: :rand.uniform(20)}
    }

    {:noreply,
     socket
     |> assign(clients: socket.assigns.clients ++ [client], next_id: id + 1)
     |> log("added marker #{id} — the other #{length(socket.assigns.clients)} were not touched")}
  end

  def handle_event("move", _params, socket) do
    clients =
      case socket.assigns.clients do
        # Far enough to redefine an edge of the bounding box, which is what makes
        # the derived centre move at all — the centre is the box's centre, so
        # nudging an interior marker changes nothing and demonstrates nothing.
        [first | rest] -> [%{first | lat: first.lat + 0.020, lon: first.lon + 0.012} | rest]
        [] -> []
      end

    {:noreply,
     socket
     |> assign(clients: clients)
     |> log("moved marker 1 — one geometry updated, and the view stayed put")}
  end

  def handle_event("recolor", _params, socket) do
    palette = ["#16a34a", "#e11d48", "#0ea5e9", "#f59e0b", "#7c3aed"]
    color = Enum.random(palette)

    shapes =
      Enum.map(socket.assigns.shapes, fn
        %{id: "parcel"} = shape -> %{shape | color: color, fill_color: color}
        shape -> shape
      end)

    {:noreply,
     socket
     |> assign(shapes: shapes)
     |> log("recoloured the parcel — its style changed, its geometry was not re-read")}
  end

  def handle_event("reroute", _params, socket) do
    jitter = fn [lon, lat] -> [lon + (:rand.uniform() - 0.5) * 0.01, lat] end

    shapes =
      Enum.map(socket.assigns.shapes, fn
        %{id: "route"} = shape ->
          geometry = Map.update!(shape.geometry, "coordinates", &Enum.map(&1, jitter))
          # Map.merge, not %{shape | ...}: shapes here are the plain literals
          # from route(), with no :rev key to update — struct-style update
          # syntax requires the key to already exist and raises otherwise.
          Map.merge(shape, %{geometry: geometry, rev: :erlang.phash2(geometry)})

        shape ->
          shape
      end)

    {:noreply,
     socket
     |> assign(shapes: shapes)
     |> log("rerouted — the route's rev changed so it was rebuilt, the parcel was not")}
  end

  def handle_event("remove", _params, socket) do
    {:noreply,
     socket
     |> assign(clients: Enum.drop(socket.assigns.clients, -1))
     |> log("removed the last marker")}
  end

  def handle_event("cycle_shapes", _params, socket) do
    next =
      case shape_label(socket.assigns.shapes) do
        "both" -> :parcel_only
        "parcel only" -> :route_only
        "route only" -> :none
        _ -> :both
      end

    {:noreply,
     socket
     |> assign(shapes: shapes(next))
     |> log("shapes: #{next} — with no markers left the map would still frame the geometry")}
  end

  def handle_event("toggle_heat", _params, socket) do
    {:noreply,
     socket
     |> assign(heat: !socket.assigns.heat)
     |> log("heatmap #{if socket.assigns.heat, do: "off", else: "on"}")}
  end

  # A style-only change: the payload's `style` moves while `rev` does not, so the
  # client must restyle the layer without rebuilding its 180 features.
  def handle_event("cycle_heat_radius", _params, socket) do
    next = if socket.assigns.heat_radius >= 26, do: 8, else: socket.assigns.heat_radius + 6

    {:noreply,
     socket
     |> assign(heat_radius: next)
     |> log("heat radius #{next} — style only, the points are untouched")}
  end

  # Three states rather than two, because `zoom_on_click: false` behaves differently
  # in a way worth both demonstrating and testing: the view does not move, so nothing
  # recomputes, and dismissing an open popup has to be explicit.
  def handle_event("toggle_cluster", _params, socket) do
    next =
      case socket.assigns.cluster do
        false -> true
        true -> [zoom_on_click: false]
        _ -> false
      end

    {:noreply,
     socket
     |> assign(cluster: next)
     |> log("clustering #{cluster_label(next)}")}
  end

  # Two vans about eleven metres apart, clustered, seen from zoom 18. The resolution
  # there is ~0.42 m/px at this latitude, so they sit ~26px apart — inside the default
  # clustering distance of 40 — and form a group while the view is already past the
  # marker-only zoom cap of 16. That is the only way to reach the case where drilling
  # in used to zoom *out*. Twenty metres, the first guess, is 48px and does not group.
  def handle_event("yard", _params, socket) do
    yard = [
      %{id: "van-a", lat: 45.7640, lon: 4.8357, emoji: "🚚", label: "Van A"},
      %{id: "van-b", lat: 45.76410, lon: 4.8357, emoji: "🚚", label: "Van B"}
    ]

    {:noreply,
     socket
     |> assign(clients: yard, crowd: false, cluster: true, shapes: [])
     |> Rover.fly_to("clients", {45.76405, 4.8357}, zoom: 18, duration: 0)
     |> log("two vans in a yard at zoom 18, clustered")}
  end

  def handle_event("toggle_crowd", _params, socket) do
    {:noreply,
     socket
     |> assign(crowd: !socket.assigns.crowd)
     |> log("crowd #{if socket.assigns.crowd, do: "off", else: "on"} — 240 markers")}
  end

  def handle_event("cycle_tiles", _params, socket) do
    next =
      case socket.assigns.tiles do
        :ign_plan -> :ign_ortho
        :ign_ortho -> :carto_light
        :carto_light -> :carto_dark
        _ -> :ign_plan
      end

    {:noreply, assign(socket, tiles: next)}
  end

  def handle_event("reset", _params, socket) do
    {:noreply,
     socket
     |> assign(clients: @clients, shapes: shapes(:both), next_id: 4)
     |> log("reset")}
  end

  # `fly_to` and `fit_to` are commands, not state: nothing below assigns a centre
  # or a zoom, and the map keeps its declarative framing for everything else.
  def handle_event("fly_paris", _params, socket) do
    {:noreply,
     socket
     |> Rover.fly_to("clients", {48.8566, 2.3522}, zoom: 12)
     |> log("flew to Paris — no assign, no attribute change")}
  end

  def handle_event("fit_first", _params, socket) do
    first = List.first(socket.assigns.clients)

    {:noreply,
     socket
     |> Rover.fit_to("clients", [first], max_zoom: 17)
     |> log("fitted to marker #{first.id} alone, at zoom 17")}
  end

  def handle_event("marker_clicked", %{"id" => id, "lat" => lat, "lon" => lon}, socket) do
    {:noreply, log(socket, "marker #{id} clicked at #{fmt(lat)}, #{fmt(lon)}")}
  end

  # Its own assign rather than the shared log: `on_move_end` writes to that whenever
  # the view settles, and a test racing the two fails for no reason.
  def handle_event("cluster_clicked", %{"count" => count, "ids" => ids}, socket) do
    {:noreply,
     assign(socket,
       cluster_log: "cluster of #{count} — first ids #{inspect(Enum.take(ids, 4))}"
     )}
  end

  def handle_event("shape_clicked", %{"id" => id, "lat" => lat, "lon" => lon}, socket) do
    {:noreply, log(socket, "shape #{id} clicked at #{fmt(lat)}, #{fmt(lon)}")}
  end

  def handle_event("map_clicked", %{"lat" => lat, "lon" => lon}, socket) do
    {:noreply, log(socket, "map clicked at #{fmt(lat)}, #{fmt(lon)}")}
  end

  def handle_event("moved", %{"center" => [lat, lon], "zoom" => zoom}, socket) do
    {:noreply, log(socket, "view centred on #{fmt(lat)}, #{fmt(lon)} at zoom #{zoom}")}
  end

  # The mirror of marker_dragged, one level up. Rejecting is the interesting
  # case: the client already moved the vertex, and a same-content reassign is
  # byte-identical JSON that never even reaches the browser — so what makes
  # the server's true, unedited geometry observable again is bumping :rev
  # alone, geometry left untouched. That is the whole trick behind snapping a
  # rejected edit back, and it is worth seeing land immediately rather than
  # only whenever some other button happens to touch @shapes next.
  def handle_event("shape_edited", %{"id" => id, "geometry" => geometry}, socket) do
    shapes =
      Enum.map(socket.assigns.shapes, fn
        # Map.merge, not %{shape | ...}: these are the plain literals from
        # parcel()/route(), with no :rev key to update in place.
        %{id: ^id} = shape when socket.assigns.reject_edits ->
          Map.merge(shape, %{rev: make_ref() |> :erlang.phash2()})

        %{id: ^id} = shape ->
          Map.merge(shape, %{geometry: geometry, rev: :erlang.phash2(geometry)})

        shape ->
          shape
      end)

    message =
      if socket.assigns.reject_edits,
        do: "shape #{id} edited — rejected, snapping back to the server's geometry",
        else: "shape #{id} edited — and the server now agrees"

    {:noreply, socket |> assign(shapes: shapes) |> log(message)}
  end

  # The mode stays armed until it is turned off, so tracing four parcels takes
  # four gestures and no trips back to the toolbar. Cycling through the three
  # types rather than offering three buttons keeps the toolbar honest about what
  # `Rover.start_drawing/3` actually is: one mode, with a type.
  def handle_event("cycle_draw", _params, socket) do
    next = next_draw(socket.assigns.draw)
    socket = assign(socket, draw: next)

    if next do
      {:noreply,
       socket
       |> Rover.start_drawing("clients", type: next)
       |> log("drawing #{next}s — click to place points, Escape abandons the one in progress")}
    else
      {:noreply, socket |> Rover.stop_drawing("clients") |> log("drawing off")}
    end
  end

  # No id on the payload: the shape did not exist until now, so naming it is the
  # server's job — exactly as it would be for a row about to be inserted.
  def handle_event("drew", %{"type" => type, "geometry" => geometry}, socket) do
    id = "drawn-#{socket.assigns.next_drawn_id}"

    shape = %{
      id: id,
      geometry: geometry,
      color: "#7c3aed",
      fill_color: "#7c3aed",
      fill_opacity: 0.18,
      width: 2,
      label: id,
      rev: :erlang.phash2(geometry),
      # Drawn and then reshaped, which is the pair of features working together.
      editable: true
    }

    {:noreply,
     socket
     |> assign(
       shapes: socket.assigns.shapes ++ [shape],
       next_drawn_id: socket.assigns.next_drawn_id + 1
     )
     |> log("drew #{id} (#{type}) — the sketch became a shape the server owns")}
  end

  def handle_event("toggle_edit_reject", _params, socket) do
    {:noreply, assign(socket, reject_edits: !socket.assigns.reject_edits)}
  end

  def handle_event("marker_dragged", %{"id" => id, "lat" => lat, "lon" => lon}, socket) do
    clients =
      Enum.map(socket.assigns.clients, fn
        %{id: ^id} = client -> %{client | lat: lat, lon: lon}
        client -> client
      end)

    {:noreply,
     socket
     |> assign(clients: clients)
     |> log("marker #{id} dragged to #{fmt(lat)}, #{fmt(lon)} — and the server now agrees")}
  end

  defp next_draw(nil), do: :polygon
  defp next_draw(:polygon), do: :line
  defp next_draw(:line), do: :point
  defp next_draw(:point), do: nil

  defp shapes(:none), do: []

  defp shapes(:parcel_only), do: [parcel()]

  defp shapes(:route_only), do: [route()]

  defp shapes(:both), do: [parcel(), route()]

  defp parcel do
    %{
      id: "parcel",
      geometry: @parcel,
      color: "#16a34a",
      fill_color: "#16a34a",
      fill_opacity: 0.18,
      width: 2,
      label: "AB 214",
      tooltip: "Parcel AB 214 — click for details",
      data: %{section: "AB"},
      editable: true
    }
  end

  defp route do
    %{
      id: "route",
      geometry: @route,
      color: "#2563eb",
      width: 4,
      fill_opacity: 0,
      tooltip: "Delivery route — 5 stops",
      data: %{stops: 5}
    }
  end

  # A crowd dense enough that clustering is the only readable option — which is the
  # condition it exists for. Deterministic, so the demo is the same every time.
  defp crowd do
    for i <- 1..240 do
      angle = i * 2.399963
      radius = :math.sqrt(i / 240) * 0.045

      %{
        id: "crowd-#{i}",
        lat: 45.762 + radius * :math.cos(angle),
        lon: 4.836 + radius * :math.sin(angle) * 1.4,
        emoji: "📍",
        label: "Crowd #{i}"
      }
    end
  end

  # A deterministic cloud around Lyon: a heat field needs a crowd, and a demo needs
  # the same crowd every time.
  defp heat_points do
    for i <- 1..180 do
      angle = i * 0.618 * 2 * :math.pi()
      radius = :math.sqrt(i / 180) * 0.03

      %{
        lat: 45.762 + radius * :math.cos(angle),
        lon: 4.836 + radius * :math.sin(angle) * 1.4,
        weight: 0.25 + 0.75 * (1 - i / 180)
      }
    end
  end

  defp shape_detail(%{data: %{section: section}}), do: "section #{section}"
  defp shape_detail(%{data: %{stops: stops}}), do: "#{stops} stops"
  defp shape_detail(_shape), do: "no detail"

  defp cluster_label(false), do: "off"
  defp cluster_label(true), do: "on"
  defp cluster_label(_opts), do: "on, no zoom"

  # The button cycles the two built-in geometries, so it names those and counts
  # anything drawn separately. Matching on the whole id list raised a
  # CaseClauseError the moment a drawn shape joined it — a render crash, from a
  # label.
  defp shape_label(shapes) do
    {known, drawn} = Enum.split_with(shapes, &(&1.id in ["parcel", "route"]))

    base =
      case known |> Enum.map(& &1.id) |> Enum.sort() do
        ["parcel", "route"] -> "both"
        ["parcel"] -> "parcel only"
        ["route"] -> "route only"
        [] -> "none"
      end

    if drawn == [], do: base, else: "#{base} + #{length(drawn)} drawn"
  end

  defp log(socket, message), do: assign(socket, log: message)

  defp fmt(value) when is_float(value), do: :erlang.float_to_binary(value, decimals: 5)
  defp fmt(value), do: to_string(value)
end
