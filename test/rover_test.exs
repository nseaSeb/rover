defmodule RoverTest do
  use ExUnit.Case, async: true

  doctest Rover

  alias Rover.Shape

  @polygon %{
    "type" => "Polygon",
    "coordinates" => [[[4.0, 45.0], [5.0, 45.0], [5.0, 46.0], [4.0, 46.0], [4.0, 45.0]]]
  }

  describe "bbox/1" do
    test "encloses markers" do
      markers = [%{id: 1, lat: 45.0, lon: 4.0}, %{id: 2, lat: 46.0, lon: 5.0}]

      assert Rover.bbox(markers) == {45.0, 4.0, 46.0, 5.0}
    end

    test "encloses shapes, whose geometry it has to walk" do
      assert Rover.bbox([%{id: "p", geometry: @polygon}]) == {45.0, 4.0, 46.0, 5.0}
    end

    test "encloses Rover.Shape structs" do
      assert Rover.bbox([Shape.new!(%{id: "p", geometry: @polygon})]) == {45.0, 4.0, 46.0, 5.0}
    end

    test "encloses a mixed list" do
      content = [%{id: 1, lat: 48.85, lon: 2.35}, %{id: "p", geometry: @polygon}]

      assert Rover.bbox(content) == {45.0, 2.35, 48.85, 5.0}
    end

    test "accepts plain coordinates" do
      assert Rover.bbox([{45.0, 4.0}, {46.0, 5.0}]) == {45.0, 4.0, 46.0, 5.0}
    end

    test "passes a box straight through, coerced to floats" do
      assert Rover.bbox({45, 4, 46, 5}) == {45.0, 4.0, 46.0, 5.0}
    end

    test "wraps a single item" do
      assert Rover.bbox(%{id: 1, lat: 45.0, lon: 4.0}) == {45.0, 4.0, 45.0, 4.0}
    end

    test "is nil for nothing to enclose" do
      assert Rover.bbox([]) == nil
      assert Rover.bbox([nil, nil]) == nil
    end

    test "drops geometry it cannot use rather than raising" do
      # ST_AsGeoJSON on an EPSG:3857 column returns metres. Framing is a
      # convenience — it must not take a LiveView down.
      metres = %{"type" => "Point", "coordinates" => [537_000.0, 5_744_000.0]}

      assert Rover.bbox([%{id: "bad", geometry: metres}]) == nil

      assert Rover.bbox([
               %{id: "bad", geometry: metres},
               %{id: 1, lat: 45.0, lon: 4.0}
             ]) == {45.0, 4.0, 45.0, 4.0}
    end

    test "drops markers it cannot use" do
      assert Rover.bbox([%{lat: "nope", lon: "nope"}]) == nil
    end
  end

  describe "fly_to/4" do
    test "pushes a command carrying the map id, so one map moves and not the others" do
      socket = Rover.fly_to(socket(), "clients", {45.75, 4.85}, zoom: 15)

      assert [{"rover:fly_to", payload}] = pushed(socket)
      assert payload.id == "clients"
      assert payload.center == [45.75, 4.85]
      assert payload.zoom == 15
      assert payload.duration == 500
    end

    test "omitting the zoom leaves it alone" do
      [{_event, payload}] = Rover.fly_to(socket(), "m", {45.75, 4.85}) |> pushed()

      assert payload.zoom == nil
    end

    test "takes a duration" do
      [{_event, payload}] = Rover.fly_to(socket(), "m", {45.75, 4.85}, duration: 0) |> pushed()

      assert payload.duration == 0
    end

    test "validates the coordinate like everything else does" do
      assert_raise ArgumentError, ~r/invalid latitude/, fn ->
        Rover.fly_to(socket(), "m", {450.0, 4.85})
      end
    end
  end

  describe "fit_to/4" do
    test "pushes the bounding box of whatever it was given" do
      markers = [%{id: 1, lat: 45.0, lon: 4.0}, %{id: 2, lat: 46.0, lon: 5.0}]

      [{"rover:fit_to", payload}] = Rover.fit_to(socket(), "clients", markers) |> pushed()

      assert payload.id == "clients"
      assert payload.bbox == [45.0, 4.0, 46.0, 5.0]
      assert payload.padding == 48
      assert payload.maxZoom == 16
    end

    test "takes padding, max zoom and duration" do
      [{_event, payload}] =
        Rover.fit_to(socket(), "m", [{45.0, 4.0}], padding: 10, max_zoom: 19, duration: 0)
        |> pushed()

      assert payload.padding == 10
      assert payload.maxZoom == 19
      assert payload.duration == 0
    end

    test "an empty list is a no-op, not an error" do
      socket = socket()

      assert Rover.fit_to(socket, "m", []) == socket
      assert pushed(Rover.fit_to(socket, "m", [])) == []
    end
  end

  describe "start_drawing/3" do
    test "arms the map named, with the GeoJSON type the client draws" do
      socket = Rover.start_drawing(socket(), "parcels", type: :polygon)

      assert [{"rover:start_drawing", payload}] = pushed(socket)
      assert payload.id == "parcels"
      assert payload.type == "Polygon"
    end

    test "defaults to a polygon, which is what drawing a shape usually means" do
      [{_event, payload}] = Rover.start_drawing(socket(), "m") |> pushed()

      assert payload.type == "Polygon"
    end

    test "translates the other two types" do
      assert [{_, %{type: "LineString"}}] =
               Rover.start_drawing(socket(), "m", type: :line) |> pushed()

      assert [{_, %{type: "Point"}}] =
               Rover.start_drawing(socket(), "m", type: :point) |> pushed()
    end

    test "refuses a circle by name, because GeoJSON cannot carry one back" do
      assert_raise ArgumentError, ~r/GeoJSON cannot represent a circle/, fn ->
        Rover.start_drawing(socket(), "m", type: :circle)
      end
    end

    test "refuses an unknown type" do
      assert_raise ArgumentError, ~r/invalid draw type: :blob/, fn ->
        Rover.start_drawing(socket(), "m", type: :blob)
      end
    end
  end

  describe "stop_drawing/2" do
    test "disarms the map named" do
      assert [{"rover:stop_drawing", %{id: "parcels"}}] =
               Rover.stop_drawing(socket(), "parcels") |> pushed()
    end
  end

  # push_event/3 accumulates onto `socket.private.live_temp[:push_events]`, newest
  # first. Reading it back is the cheapest honest way to assert the payload without
  # standing up an endpoint; the round trip to an actual animation is covered by the
  # browser suite.
  defp socket, do: %Phoenix.LiveView.Socket{}

  defp pushed(%{private: private}) do
    private
    |> Map.get(:live_temp, %{})
    |> Map.get(:push_events, [])
    |> Enum.reverse()
    |> Enum.map(fn [event, payload] -> {event, payload} end)
  end
end
