defmodule Rover.ComponentsTest do
  use Rover.MapCase, async: true

  @lyon [
    %{id: 1, lat: 45.76, lon: 4.83, label: "Atelier"},
    %{id: 2, lat: 45.74, lon: 4.86, label: "Dépôt"}
  ]

  describe "the shape of the rendered markup" do
    test "renders a hook container with an ignored canvas inside it" do
      document = render_map(id: "clients", markers: @lyon)

      assert attribute(document, "id") == "clients"
      assert attribute(document, "phx-hook") == "Rover"

      # The container is patched normally so that its data attributes reach the
      # hook; only the canvas — where OpenLayers builds its own DOM — is ignored.
      canvas = LazyHTML.query(document, ".rover-map__canvas")
      assert LazyHTML.attribute(canvas, "phx-update") == ["ignore"]
      assert LazyHTML.attribute(canvas, "id") == ["clients-canvas"]
    end

    test "keeps configuration and markers in separate attributes" do
      # This is what lets LiveView send only the markers when only the markers
      # changed, instead of re-sending the whole map description.
      document = render_map(markers: @lyon)

      assert is_binary(attribute(document, "data-rover"))
      assert is_binary(attribute(document, "data-rover-markers"))
    end

    test "applies height and extra classes" do
      document = render_map(height: "60vh", class: "shadow-lg")

      assert attribute(document, "style") =~ "height: 60vh;"
      assert attribute(document, "class") == "rover-map shadow-lg"
    end

    test "emits no stray whitespace when no class was given" do
      assert attribute(render_map([]), "class") == "rover-map"
    end

    test "accepts a class list" do
      document = render_map(class: ["shadow-lg", nil, "rounded-none"])
      assert attribute(document, "class") == "rover-map shadow-lg rounded-none"
    end

    test "passes global attributes through" do
      document = render_map(markers: @lyon, "aria-label": "Client map")
      assert attribute(document, "aria-label") == "Client map"
    end
  end

  describe "markers" do
    test "are serialised in order with their id preserved" do
      assert [first, second] = markers(render_map(markers: @lyon))

      assert first["id"] == 1
      assert first["lat"] == 45.76
      assert first["lon"] == 4.83
      assert first["label"] == "Atelier"
      assert second["id"] == 2
    end

    test "omit everything that was not set" do
      [marker] = markers(render_map(markers: [%{id: 1, lat: 45.0, lon: 4.0}]))

      assert marker == %{"id" => 1, "lat" => 45.0, "lon" => 4.0}
    end

    test "accept a field mapping for foreign schemas" do
      stores = [%{id: "a", latitude: 45.0, longitude: 4.0, trade_name: "Chez Paul"}]

      [marker] =
        markers(
          render_map(
            markers: stores,
            marker_fields: [lat: :latitude, lon: :longitude, label: :trade_name]
          )
        )

      assert marker["label"] == "Chez Paul"
      assert marker["lat"] == 45.0
    end

    test "default to an empty list" do
      assert markers(render_map([])) == []
    end
  end

  describe "the view" do
    test "uses the center it was given" do
      config = config(render_map(center: {45.75, 4.85}, zoom: 12))

      assert config["center"] == [45.75, 4.85]
      assert config["zoom"] == 12
    end

    test "centres on the markers when no center is given" do
      config = config(render_map(markers: @lyon))

      assert [lat, lon] = config["center"]
      assert_in_delta lat, 45.75, 0.0001
      assert_in_delta lon, 4.845, 0.0001
    end

    test "falls back to the whole world with neither center nor markers" do
      config = config(render_map([]))

      assert config["center"] == [0.0, 0.0]
      assert config["zoom"] == 2
    end

    test "defaults to a city zoom when a center is given without one" do
      assert config(render_map(center: {45.75, 4.85}))["zoom"] == 12
    end

    test "passes zoom bounds through" do
      config = config(render_map(min_zoom: 5, max_zoom: 18))

      assert config["minZoom"] == 5
      assert config["maxZoom"] == 18
    end

    test "rejects an impossible center" do
      assert_raise ArgumentError, ~r/invalid latitude/, fn ->
        render_map(center: {450.0, 4.85})
      end
    end
  end

  describe "fit" do
    test "fits once when the caller did not choose a center" do
      assert config(render_map(markers: @lyon))["fit"] == "once"
    end

    test "does not fit when the caller chose a center" do
      assert config(render_map(markers: @lyon, center: {45.75, 4.85}))["fit"] == false
    end

    test "an explicit fit wins over the default either way" do
      assert config(render_map(markers: @lyon, center: {45.75, 4.85}, fit: true))["fit"] ==
               "always"

      assert config(render_map(markers: @lyon, fit: false))["fit"] == false
      assert config(render_map(markers: @lyon, fit: :once))["fit"] == "once"
    end

    test "carries the padding" do
      assert config(render_map(fit: true, fit_padding: 100))["fitPadding"] == 100
    end

    test "rejects anything else" do
      assert_raise ArgumentError, ~r/invalid fit/, fn -> render_map(fit: :sometimes) end
    end
  end

  describe "tiles" do
    test "default to OpenStreetMap, attribution included" do
      tiles = config(render_map([]))["tiles"]

      assert tiles["url"] =~ "tile.openstreetmap.org"
      assert tiles["attributions"] =~ "OpenStreetMap"
      assert tiles["maxZoom"] == 19
    end

    test "accept a preset" do
      assert config(render_map(tiles: :carto_dark))["tiles"]["url"] =~ "cartocdn"
    end

    test "accept an arbitrary tile server" do
      tiles = config(render_map(tiles: {:xyz, "https://x/{z}/{x}/{y}.png"}))["tiles"]

      assert tiles["url"] == "https://x/{z}/{x}/{y}.png"
    end

    test ":none leaves the config without any basemap" do
      refute Map.has_key?(config(render_map(tiles: :none)), "tiles")
    end
  end

  describe "controls" do
    test "default to zoom and attribution" do
      controls = config(render_map([]))["controls"]

      assert controls["zoom"]
      assert controls["attribution"]
      refute controls["scaleLine"]
      refute controls["fullScreen"]
      refute controls["rotate"]
    end

    test "are opt-in and camelised for the client" do
      controls = config(render_map(controls: [:scale_line, :full_screen]))["controls"]

      assert controls["scaleLine"]
      assert controls["fullScreen"]
      refute controls["zoom"]
    end

    test "reject an unknown control" do
      assert_raise ArgumentError, ~r/unknown map control/, fn ->
        render_map(controls: [:minimap])
      end
    end
  end

  describe "events" do
    test "are absent unless requested" do
      assert config(render_map([]))["events"] == %{}
    end

    test "carry the handler names the LiveView will receive" do
      events =
        config(
          render_map(
            on_marker_click: "select",
            on_map_click: "place",
            on_move_end: "moved",
            on_marker_drag_end: "dragged"
          )
        )["events"]

      assert events == %{
               "markerClick" => "select",
               "mapClick" => "place",
               "moveEnd" => "moved",
               "markerDragEnd" => "dragged"
             }
    end

    test "route to a live component when given a target" do
      assert config(render_map(target: 3, on_marker_click: "select"))["target"] == "3"
    end
  end

  test "interactivity can be turned off" do
    assert config(render_map(interactive: false))["interactive"] == false
  end
end
