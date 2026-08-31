defmodule Rover.ComponentsTest do
  use Rover.MapCase, async: true

  defmodule PopupHost do
    @moduledoc false
    use Phoenix.Component

    import Rover.Components

    def render_popups(assigns) do
      assigns = Map.new(assigns)

      host(assigns)
      |> Phoenix.HTML.Safe.to_iodata()
      |> IO.iodata_to_binary()
      |> LazyHTML.from_fragment()
    end

    def host(assigns) do
      ~H"""
      <.map id="clients" markers={@markers}>
        <:popup :let={marker}>
          <span class="popup-label">{marker.label}</span>
          <button data-rover-popup-close>x</button>
        </:popup>
      </.map>
      """
    end

    def render_both(assigns) do
      assigns = Map.new(assigns)

      both(assigns)
      |> Phoenix.HTML.Safe.to_iodata()
      |> IO.iodata_to_binary()
      |> LazyHTML.from_fragment()
    end

    # A marker and a shape deliberately sharing id 1, which is the collision the
    # namespaced keys exist for.
    def both(assigns) do
      ~H"""
      <.map id="clients" markers={@markers} shapes={@shapes}>
        <:popup :let={marker}>
          <span class="marker-popup">{marker.label}</span>
        </:popup>
        <:shape_popup :let={shape}>
          <span class="shape-popup">{shape.label}</span>
        </:shape_popup>
      </.map>
      """
    end
  end

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

    test "height={nil} emits no style, leaving the size to the caller's CSS" do
      # The documented escape hatch. It has to be a legal literal: an inline style
      # beats a Tailwind class, so a map sized by `class` or by a flex parent needs
      # this, and `attr :height, :string` made it a compile warning.
      document = render_map(height: nil, class: "h-96")

      # Absent, not empty: `style=""` is still an inline style, and an inline style
      # beats a class even when it says nothing.
      assert attribute(document, "style") == nil
      assert attribute(document, "class") == "rover-map h-96"
    end

    test "a caller's own style wins over the height" do
      document = render_map(height: "24rem", style: "height: 40vh; border: 0;")

      assert attribute(document, "style") == "height: 40vh; border: 0;"
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

    test "marks a center it derived, so the client does not treat it as an order" do
      # The centroid shifts whenever any marker moves. Without this flag the
      # client read every marker update as "the server wants a new view" and
      # animated to the derived centre at the derived zoom — a world view.
      assert config(render_map(markers: @lyon))["derivedCenter"] == true
    end

    test "does not mark a center the caller chose" do
      refute Map.has_key?(config(render_map(center: {45.75, 4.85})), "derivedCenter")
    end

    test "a moving marker does not change the caller's center" do
      moved = [%{id: 1, lat: 45.90, lon: 4.83}, %{id: 2, lat: 45.74, lon: 4.86}]

      before = config(render_map(markers: @lyon, center: {45.75, 4.85}))
      after_move = config(render_map(markers: moved, center: {45.75, 4.85}))

      assert before["center"] == after_move["center"]
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

  describe "shapes" do
    @polygon %{
      "type" => "Polygon",
      "coordinates" => [
        [[4.83, 45.76], [4.84, 45.76], [4.84, 45.77], [4.83, 45.77], [4.83, 45.76]]
      ]
    }

    test "travel in their own attribute, so a marker change does not resend them" do
      document = render_map(markers: @lyon, shapes: [%{id: "p", geometry: @polygon}])

      assert is_binary(attribute(document, "data-rover-shapes"))
      assert is_binary(attribute(document, "data-rover-markers"))
      refute attribute(document, "data-rover-shapes") == attribute(document, "data-rover-markers")
    end

    test "default to an empty list" do
      assert shapes(render_map([])) == []
    end

    test "are serialised with a revision the client can compare" do
      [shape] = shapes(render_map(shapes: [%{id: "p", geometry: @polygon}]))

      assert shape["id"] == "p"
      assert shape["geometry"] == @polygon
      assert shape["rev"] == :erlang.phash2(@polygon)
    end

    test "omit everything that was not set" do
      [shape] = shapes(render_map(shapes: [%{id: "p", geometry: @polygon}]))

      assert Map.keys(shape) |> Enum.sort() == ["geometry", "id", "rev"]
    end

    test "carry their styling" do
      [shape] =
        shapes(
          render_map(
            shapes: [
              %{id: "p", geometry: @polygon, color: "#16a34a", width: 3, fill_opacity: 0.2}
            ]
          )
        )

      assert shape["color"] == "#16a34a"
      assert shape["width"] == 3
      assert shape["fill_opacity"] == 0.2
    end

    test "accept a field mapping for foreign schemas" do
      [shape] =
        shapes(
          render_map(
            shapes: [%{ref: "p", outline: @polygon}],
            shape_fields: [id: :ref, geometry: :outline]
          )
        )

      assert shape["id"] == "p"
      assert shape["geometry"] == @polygon
    end

    test "an on_shape_click handler reaches the client" do
      assert config(render_map(on_shape_click: "pick_parcel"))["events"]["shapeClick"] ==
               "pick_parcel"
    end

    test "no shapeClick key when it was not asked for" do
      refute Map.has_key?(config(render_map(markers: @lyon))["events"], "shapeClick")
    end

    test "carry :editable only when true" do
      [shape] = shapes(render_map(shapes: [%{id: "p", geometry: @polygon}]))
      refute Map.has_key?(shape, "editable")

      [shape] =
        shapes(render_map(shapes: [%{id: "p", geometry: @polygon, editable: true}]))

      assert shape["editable"] == true
    end

    test "an on_shape_edit_end handler reaches the client" do
      assert config(render_map(on_shape_edit_end: "shape_edited"))["events"]["shapeEditEnd"] ==
               "shape_edited"
    end

    test "no shapeEditEnd key when it was not asked for" do
      refute Map.has_key?(config(render_map(markers: @lyon))["events"], "shapeEditEnd")
    end
  end

  describe "drawing" do
    test "an on_draw_end handler reaches the client" do
      assert config(render_map(on_draw_end: "drew"))["events"]["drawEnd"] == "drew"
    end

    test "no drawEnd key when it was not asked for" do
      refute Map.has_key?(config(render_map(markers: @lyon))["events"], "drawEnd")
    end
  end

  describe "clustering" do
    test "is off unless asked for" do
      refute Map.has_key?(config(render_map(markers: @lyon)), "cluster")
    end

    test "true takes the defaults" do
      cluster = config(render_map(markers: @lyon, cluster: true))["cluster"]

      assert cluster == %{"distance" => 40, "minDistance" => 20, "zoomOnClick" => true}
    end

    test "takes each option, camelised for the client" do
      cluster =
        config(
          render_map(
            markers: @lyon,
            cluster: [distance: 80, min_distance: 5, zoom_on_click: false]
          )
        )["cluster"]

      assert cluster == %{"distance" => 80, "minDistance" => 5, "zoomOnClick" => false}
    end

    test "false is the same as absent" do
      refute Map.has_key?(config(render_map(markers: @lyon, cluster: false)), "cluster")
    end

    test "rejects an unknown option, and names the ones it knows" do
      error =
        assert_raise ArgumentError, fn -> render_map(markers: @lyon, cluster: [radius: 3]) end

      assert error.message =~ "unknown cluster option"
      assert error.message =~ ":min_distance"
    end

    test "rejects anything that is not a boolean or a keyword list" do
      assert_raise ArgumentError, ~r/invalid cluster/, fn ->
        render_map(markers: @lyon, cluster: "yes")
      end
    end

    test "a list that is not a keyword list gets the same friendly error" do
      # It used to reach `Enum.each(opts, fn {key, _} -> ...)` and die with a match
      # error instead of the message every other encoder here produces.
      for bad <- [[:distance], [:distance, 40], [{:distance, 40}, :zoom_on_click]] do
        error = assert_raise ArgumentError, fn -> render_map(markers: @lyon, cluster: bad) end

        assert error.message =~ "invalid cluster"
        assert error.message =~ "keyword list"
      end
    end

    test "an on_cluster_click handler reaches the client" do
      events = config(render_map(markers: @lyon, on_cluster_click: "drill_in"))["events"]

      assert events["clusterClick"] == "drill_in"
    end

    test "no clusterClick key when it was not asked for" do
      refute Map.has_key?(config(render_map(markers: @lyon))["events"], "clusterClick")
    end
  end

  describe "the heatmap" do
    @points [%{lat: 45.76, lon: 4.83}, %{lat: 45.74, lon: 4.86, weight: 0.5}]

    test "is absent entirely when there is none" do
      assert heatmap(render_map(markers: @lyon)) == nil
      assert attribute(render_map(markers: @lyon), "data-rover-heatmap") == nil
    end

    test "travels with a revision the client compares" do
      payload = heatmap(render_map(heatmap: @points))

      assert length(payload["points"]) == 2
      assert is_integer(payload["rev"])
      assert payload["style"] == %{"radius" => 8, "blur" => 15, "opacity" => 1}
    end

    test "the revision is stable across renders of the same points" do
      assert heatmap(render_map(heatmap: @points))["rev"] ==
               heatmap(render_map(heatmap: @points))["rev"]
    end

    test "the revision moves when a weight moves" do
      other = [%{lat: 45.76, lon: 4.83}, %{lat: 45.74, lon: 4.86, weight: 0.9}]

      refute heatmap(render_map(heatmap: @points))["rev"] ==
               heatmap(render_map(heatmap: other))["rev"]
    end

    test "carries its style" do
      style = heatmap(render_map(heatmap: @points, heatmap_style: [radius: 14, blur: 4]))["style"]

      assert style["radius"] == 14
      assert style["blur"] == 4
    end

    test "accepts a field mapping for the weight" do
      rows = [%{lat: 45.0, lon: 4.0, orders: 10}]

      [point] =
        heatmap(render_map(heatmap: rows, heatmap_fields: [weight: fn r -> r.orders / 20 end]))[
          "points"
        ]

      assert point["weight"] == 0.5
    end

    test "frames a map that has nothing but a heat field" do
      config = config(render_map(heatmap: @points))

      assert [lat, lon] = config["center"]
      assert_in_delta lat, 45.75, 0.0001
      assert_in_delta lon, 4.845, 0.0001
      assert config["derivedCenter"] == true
    end
  end

  describe "centering on shapes" do
    @outline %{
      "type" => "Polygon",
      "coordinates" => [
        [[4.80, 45.70], [4.90, 45.70], [4.90, 45.80], [4.80, 45.80], [4.80, 45.70]]
      ]
    }

    test "a map with one shape and no marker still finds its centre" do
      # The parcel page: a cadastral outline, no pin. This used to land on
      # {0.0, 0.0} — the Gulf of Guinea — with the parcel nowhere in sight.
      config = config(render_map(shapes: [%{id: "p", geometry: @outline}]))

      assert [lat, lon] = config["center"]
      assert_in_delta lat, 45.75, 0.0001
      assert_in_delta lon, 4.85, 0.0001
      assert config["derivedCenter"] == true
    end

    test "the derived centre spans markers and shapes together" do
      config =
        config(
          render_map(
            markers: [%{id: 1, lat: 48.85, lon: 2.35}],
            shapes: [%{id: "p", geometry: @outline}]
          )
        )

      assert [lat, lon] = config["center"]
      assert_in_delta lat, (45.70 + 48.85) / 2, 0.0001
      assert_in_delta lon, (2.35 + 4.90) / 2, 0.0001
    end

    test "an explicit centre still wins over both" do
      config =
        config(render_map(shapes: [%{id: "p", geometry: @outline}], center: {43.3, 5.4}))

      assert config["center"] == [43.3, 5.4]
      refute Map.has_key?(config, "derivedCenter")
    end

    test "still falls back to the world with neither" do
      assert config(render_map([]))["center"] == [0.0, 0.0]
    end

    test "geometry in the wrong projection does not take the render down" do
      # ST_AsGeoJSON on an EPSG:3857 column returns metres. Deriving a centre is a
      # convenience; raising over it would kill the whole LiveView at render time.
      metres = %{"type" => "Point", "coordinates" => [537_000.0, 5_744_000.0]}

      config = config(render_map(shapes: [%{id: "p", geometry: metres}]))

      assert config["center"] == [0.0, 0.0]
      assert [shape] = shapes(render_map(shapes: [%{id: "p", geometry: metres}]))
      assert shape["geometry"] == metres
    end

    test "usable coordinates still frame when one shape is unusable" do
      metres = %{"type" => "Point", "coordinates" => [537_000.0, 5_744_000.0]}
      degrees = %{"type" => "Point", "coordinates" => [4.85, 45.75]}

      config =
        config(
          render_map(shapes: [%{id: "bad", geometry: metres}, %{id: "ok", geometry: degrees}])
        )

      assert [lat, lon] = config["center"]
      assert_in_delta lat, 45.75, 0.0001
      assert_in_delta lon, 4.85, 0.0001
    end
  end

  describe "emoji markers" do
    test "reach the client" do
      [marker] = markers(render_map(markers: [%{id: 1, lat: 45.0, lon: 4.0, emoji: "🏠"}]))

      assert marker["emoji"] == "🏠"
    end

    test "are absent unless set" do
      [marker] = markers(render_map(markers: [%{id: 1, lat: 45.0, lon: 4.0}]))

      refute Map.has_key?(marker, "emoji")
    end
  end

  describe "the popup slot" do
    test "renders nothing at all when no slot was given" do
      assert popups(render_map(markers: @lyon)) == []
    end

    test "renders one hidden node per marker, keyed by marker id" do
      document = PopupHost.render_popups(markers: @lyon)

      assert popups(document) == ["marker:1", "marker:2"]

      nodes = LazyHTML.query(document, "[data-rover-popup-for]")
      # `hidden` is a boolean attribute, so its rendered value is the empty string.
      assert LazyHTML.attribute(nodes, "hidden") == ["", ""]
      assert LazyHTML.attribute(nodes, "class") == ["rover-popup", "rover-popup"]
    end

    test "the slot receives the normalised marker" do
      document = PopupHost.render_popups(markers: @lyon)

      assert LazyHTML.query(document, ".popup-label") |> LazyHTML.text() == "AtelierDépôt"
    end

    test "a marker and a shape sharing an id get distinct popup nodes" do
      document =
        PopupHost.render_both(
          markers: [%{id: 1, lat: 45.0, lon: 4.0, label: "Marker one"}],
          shapes: [
            %{
              id: 1,
              label: "Shape one",
              geometry: %{"type" => "Point", "coordinates" => [4.0, 45.0]}
            }
          ]
        )

      # Without the namespace both nodes answer to the same selector and one of them
      # silently wins, so clicking the marker could open the shape's card.
      assert popups(document) == ["marker:1", "shape:1"]

      assert LazyHTML.query(document, ".marker-popup") |> LazyHTML.text() == "Marker one"
      assert LazyHTML.query(document, ".shape-popup") |> LazyHTML.text() == "Shape one"
    end

    test "no shape popup nodes without the slot" do
      document =
        render_map(
          markers: @lyon,
          shapes: [%{id: "p", geometry: %{"type" => "Point", "coordinates" => [4.0, 45.0]}}]
        )

      assert popups(document) == []
    end

    test "popups live outside the ignored canvas, where LiveView can patch them" do
      # An ol/Overlay would reparent these under the canvas. That subtree is
      # phx-update="ignore", and patching a node LiveView no longer controls is
      # how this breaks in ways nobody can reproduce.
      document = PopupHost.render_popups(markers: @lyon)

      assert LazyHTML.query(document, ".rover-map__canvas [data-rover-popup-for]")
             |> LazyHTML.attribute("data-rover-popup-for") == []

      assert LazyHTML.query(document, ".rover-map > [data-rover-popup-for]")
             |> LazyHTML.attribute("data-rover-popup-for") == ["marker:1", "marker:2"]
    end
  end

  test "interactivity can be turned off" do
    assert config(render_map(interactive: false))["interactive"] == false
  end
end
