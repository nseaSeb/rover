defmodule Rover.ShapeTest do
  use ExUnit.Case, async: true

  doctest Rover.Shape

  alias Rover.Shape

  defmodule Parcel do
    @moduledoc false
    defstruct [:id, :cadastral_outline, :section]
  end

  @polygon %{
    "type" => "Polygon",
    "coordinates" => [[[4.83, 45.76], [4.84, 45.76], [4.84, 45.77], [4.83, 45.77], [4.83, 45.76]]]
  }

  describe "new!/2" do
    test "builds from the canonical shape" do
      shape = Shape.new!(%{id: "p-1", geometry: @polygon, color: "#16a34a"})

      assert shape.id == "p-1"
      assert shape.geometry == @polygon
      assert shape.color == "#16a34a"
    end

    test "carries a tooltip, falling back to the label on hover in the client" do
      assert Shape.new!(%{id: 1, geometry: @polygon, tooltip: "Parcel AB"}).tooltip == "Parcel AB"
      assert Shape.new!(%{id: 1, geometry: @polygon}).tooltip == nil
    end

    test "editable defaults to false" do
      assert Shape.new!(%{id: 1, geometry: @polygon}).editable == false
    end

    test "editable passes through when true" do
      assert Shape.new!(%{id: 1, geometry: @polygon, editable: true}).editable == true
    end

    test "recognises :geom and :geojson as geometry fields" do
      assert Shape.new!(%{id: 1, geom: @polygon}).geometry == @polygon
      assert Shape.new!(%{id: 1, geojson: @polygon}).geometry == @polygon
    end

    test "maps arbitrary struct fields" do
      parcel = %Parcel{id: 7, cadastral_outline: @polygon, section: "AB"}

      shape = Shape.new!(parcel, geometry: :cadastral_outline, label: :section)

      assert shape.id == 7
      assert shape.geometry == @polygon
      assert shape.label == "AB"
    end

    test "decodes a JSON string, so ST_AsGeoJSON output goes straight in" do
      assert Shape.new!(%{id: 1, geometry: Jason.encode!(@polygon)}).geometry == @polygon
    end

    test "is idempotent" do
      shape = Shape.new!(%{id: 1, geometry: @polygon})
      assert Shape.new!(shape) == shape
    end

    test "accepts a Feature and a FeatureCollection without unwrapping them" do
      feature = %{"type" => "Feature", "properties" => %{}, "geometry" => @polygon}
      collection = %{"type" => "FeatureCollection", "features" => [feature]}

      assert Shape.new!(%{id: 1, geometry: feature}).geometry == feature
      assert Shape.new!(%{id: 2, geometry: collection}).geometry == collection
    end

    test "accepts atom-keyed GeoJSON" do
      geometry = %{type: "Point", coordinates: [4.85, 45.75]}
      assert Shape.new!(%{id: 1, geometry: geometry}).geometry == geometry
    end

    test "requires an id, and says why" do
      error = assert_raise ArgumentError, fn -> Shape.new!(%{geometry: @polygon}) end

      assert error.message =~ "missing an :id"
      assert error.message =~ "stable id"
    end

    test "requires a geometry, and names the fields it looked in" do
      error = assert_raise ArgumentError, fn -> Shape.new!(%{id: 1}) end

      assert error.message =~ "missing a :geometry"
      assert error.message =~ ":geom"
    end

    test "rejects GeoJSON with no type, and names the lon/lat trap" do
      error = assert_raise ArgumentError, fn -> Shape.new!(%{id: 1, geometry: %{"a" => 1}}) end

      assert error.message =~ ~s(no "type")
      assert error.message =~ "[longitude, latitude]"
    end

    test "rejects an unknown GeoJSON type" do
      assert_raise ArgumentError, ~r/unknown GeoJSON type/, fn ->
        Shape.new!(%{id: 1, geometry: %{"type" => "Circle"}})
      end
    end

    test "rejects a bare coordinate list" do
      assert_raise ArgumentError, ~r/invalid shape geometry/, fn ->
        Shape.new!(%{id: 1, geometry: [[4.83, 45.76]]})
      end
    end

    test "rejects a string that is not JSON" do
      assert_raise ArgumentError, ~r/not valid JSON/, fn ->
        Shape.new!(%{id: 1, geometry: "POLYGON((4.83 45.76))"})
      end
    end

    test "rejects a non-map source" do
      assert_raise ArgumentError, ~r/cannot build a Rover.Shape/, fn -> Shape.new!("nope") end
    end
  end

  describe ":rev" do
    test "defaults to a hash of the geometry" do
      assert Shape.new!(%{id: 1, geometry: @polygon}).rev == :erlang.phash2(@polygon)
    end

    test "is stable across calls for the same geometry" do
      assert Shape.new!(%{id: 1, geometry: @polygon}).rev ==
               Shape.new!(%{id: 2, geometry: @polygon}).rev
    end

    test "changes when the geometry changes" do
      other = %{@polygon | "coordinates" => [[[5.0, 46.0]]]}

      refute Shape.new!(%{id: 1, geometry: @polygon}).rev ==
               Shape.new!(%{id: 1, geometry: other}).rev
    end

    test "a caller-supplied revision wins" do
      assert Shape.new!(%{id: 1, geometry: @polygon, rev: "v7"}).rev == "v7"
    end

    test "is computed on the decoded geometry, so a string and a map agree" do
      assert Shape.new!(%{id: 1, geometry: Jason.encode!(@polygon)}).rev ==
               Shape.new!(%{id: 1, geometry: @polygon}).rev
    end
  end

  describe "dump/1" do
    test "drops everything unset" do
      assert Shape.new!(%{id: 1, geometry: @polygon, rev: 3}) |> Shape.dump() ==
               %{id: 1, geometry: @polygon, rev: 3}
    end

    test "keeps fill_opacity: 0, which is a pure outline and not an absent value" do
      assert Shape.new!(%{id: 1, geometry: @polygon, fill_opacity: 0})
             |> Shape.dump()
             |> Map.fetch!(:fill_opacity) == 0
    end

    test "keeps editable only when true" do
      refute Shape.new!(%{id: 1, geometry: @polygon}) |> Shape.dump() |> Map.has_key?(:editable)

      assert Shape.new!(%{id: 1, geometry: @polygon, editable: true})
             |> Shape.dump()
             |> Map.fetch!(:editable)
    end
  end

  describe "coordinates/1" do
    test "flips lon/lat into Rover's latitude-first pairs" do
      assert Shape.coordinates(%{"type" => "Point", "coordinates" => [4.85, 45.75]}) ==
               [{45.75, 4.85}]
    end

    test "walks a Polygon to any depth" do
      coords = Shape.coordinates(@polygon)

      assert length(coords) == 5
      assert {45.76, 4.83} in coords
    end

    test "walks a MultiPolygon" do
      multi = %{"type" => "MultiPolygon", "coordinates" => [@polygon["coordinates"]]}

      assert Shape.coordinates(multi) == Shape.coordinates(@polygon)
    end

    test "unwraps a Feature" do
      feature = %{"type" => "Feature", "properties" => %{}, "geometry" => @polygon}

      assert Shape.coordinates(feature) == Shape.coordinates(@polygon)
    end

    test "unwraps a FeatureCollection" do
      feature = %{"type" => "Feature", "properties" => %{}, "geometry" => @polygon}
      collection = %{"type" => "FeatureCollection", "features" => [feature, feature]}

      assert length(Shape.coordinates(collection)) == 10
    end

    test "unwraps a GeometryCollection" do
      collection = %{
        "type" => "GeometryCollection",
        "geometries" => [%{"type" => "Point", "coordinates" => [4.85, 45.75]}]
      }

      assert Shape.coordinates(collection) == [{45.75, 4.85}]
    end

    test "reads a shape struct" do
      assert Shape.new!(%{id: 1, geometry: @polygon}) |> Shape.coordinates() |> length() == 5
    end

    test "reads a JSON string" do
      assert Shape.coordinates(Jason.encode!(@polygon)) == Shape.coordinates(@polygon)
    end

    test "ignores elevation in a three-element position" do
      assert Shape.coordinates(%{"type" => "Point", "coordinates" => [4.85, 45.75, 210.0]}) ==
               [{45.75, 4.85}]
    end

    test "returns nothing for an empty or malformed geometry" do
      assert Shape.coordinates(%{"type" => "Polygon", "coordinates" => []}) == []
      assert Shape.coordinates(%{"type" => "Feature"}) == []
      assert Shape.coordinates(nil) == []
    end
  end

  describe "new_all!/2" do
    test "normalises a list and drops nils" do
      shapes = Shape.new_all!([%{id: 1, geometry: @polygon}, nil, %{id: 2, geometry: @polygon}])

      assert Enum.map(shapes, & &1.id) == [1, 2]
    end
  end
end
