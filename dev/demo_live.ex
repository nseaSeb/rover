defmodule RoverDev.DemoLive do
  @moduledoc """
  The playground behind `mix dev`.

  It exists to prove one claim: everything below is plain `assign/3` on a list of
  maps. There is no OpenLayers in this file.
  """
  use Phoenix.LiveView, layout: false

  import Rover.Components

  @clients [
    %{id: 1, lat: 45.7640, lon: 4.8357, label: "Atelier", color: "#e11d48"},
    %{id: 2, lat: 45.7484, lon: 4.8467, label: "Dépôt", color: "#0ea5e9"},
    %{id: 3, lat: 45.7797, lon: 4.8000, label: "Chantier", color: "#16a34a", draggable: true}
  ]

  @impl true
  def mount(_params, _session, socket) do
    {:ok,
     socket
     |> assign(clients: @clients, tiles: :carto_light, next_id: 4, log: nil)}
  end

  @impl true
  def render(assigns) do
    ~H"""
    <h1>Rover</h1>
    <p class="subtitle">
      Three markers, a list of maps, and no OpenLayers in sight.
      Click a marker, drag the green one, or move the map.
    </p>

    <div class="toolbar">
      <button phx-click="add">Add a marker</button>
      <button phx-click="move">Move the first one</button>
      <button phx-click="recolor">Recolour</button>
      <button phx-click="remove">Remove the last</button>
      <button phx-click="reset">Reset</button>
      <button phx-click="toggle_tiles">
        Tiles: {@tiles}
      </button>
    </div>

    <.map
      id="clients"
      markers={@clients}
      tiles={@tiles}
      fit={:once}
      height="26rem"
      controls={[:zoom, :attribution, :scale_line]}
      on_marker_click="marker_clicked"
      on_map_click="map_clicked"
      on_move_end="moved"
      on_marker_drag_end="marker_dragged"
    />

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
      lat: 45.75 + (:rand.uniform() - 0.5) * 0.08,
      lon: 4.84 + (:rand.uniform() - 0.5) * 0.10,
      label: "Client #{id}",
      color: "#7c3aed"
    }

    {:noreply,
     socket
     |> assign(clients: socket.assigns.clients ++ [client], next_id: id + 1)
     |> log("added marker #{id} — the other #{length(socket.assigns.clients)} were not touched")}
  end

  def handle_event("move", _params, socket) do
    clients =
      case socket.assigns.clients do
        [first | rest] ->
          [%{first | lat: first.lat + 0.006, lon: first.lon + 0.004} | rest]

        [] ->
          []
      end

    {:noreply, socket |> assign(clients: clients) |> log("moved marker 1 — one geometry updated")}
  end

  def handle_event("recolor", _params, socket) do
    palette = ["#e11d48", "#0ea5e9", "#16a34a", "#f59e0b", "#7c3aed"]

    clients =
      Enum.map(socket.assigns.clients, fn client ->
        %{client | color: Enum.random(palette)}
      end)

    {:noreply,
     socket |> assign(clients: clients) |> log("recoloured — styles changed, geometries did not")}
  end

  def handle_event("remove", _params, socket) do
    clients = Enum.drop(socket.assigns.clients, -1)
    {:noreply, socket |> assign(clients: clients) |> log("removed the last marker")}
  end

  def handle_event("reset", _params, socket) do
    {:noreply, socket |> assign(clients: @clients, next_id: 4) |> log("reset")}
  end

  def handle_event("toggle_tiles", _params, socket) do
    tiles = if socket.assigns.tiles == :carto_light, do: :carto_dark, else: :carto_light
    {:noreply, assign(socket, tiles: tiles)}
  end

  def handle_event("marker_clicked", %{"id" => id, "lat" => lat, "lon" => lon}, socket) do
    {:noreply, log(socket, "marker #{id} clicked at #{fmt(lat)}, #{fmt(lon)}")}
  end

  def handle_event("map_clicked", %{"lat" => lat, "lon" => lon}, socket) do
    {:noreply, log(socket, "map clicked at #{fmt(lat)}, #{fmt(lon)}")}
  end

  def handle_event("moved", %{"center" => [lat, lon], "zoom" => zoom}, socket) do
    {:noreply, log(socket, "view centred on #{fmt(lat)}, #{fmt(lon)} at zoom #{zoom}")}
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

  defp log(socket, message) do
    assign(socket, log: message)
  end

  defp fmt(value) when is_float(value), do: :erlang.float_to_binary(value, decimals: 5)
  defp fmt(value), do: to_string(value)
end
