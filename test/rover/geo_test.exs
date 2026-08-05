defmodule Rover.GeoTest do
  use ExUnit.Case, async: true

  doctest Rover.Geo

  alias Rover.Geo

  describe "coord!/1" do
    test "accepts a {lat, lon} tuple" do
      assert Geo.coord!({45.75, 4.85}) == {45.75, 4.85}
    end

    test "coerces integers to floats" do
      assert Geo.coord!({48, 2}) == {48.0, 2.0}
    end

    test "accepts the common map spellings, atom and string keyed" do
      for source <- [
            %{lat: 45.75, lon: 4.85},
            %{lat: 45.75, lng: 4.85},
            %{latitude: 45.75, longitude: 4.85},
            %{"lat" => 45.75, "lon" => 4.85},
            %{"latitude" => 45.75, "lng" => 4.85}
          ] do
        assert Geo.coord!(source) == {45.75, 4.85}
      end
    end

    test "reads a coordinate off a struct" do
      assert Geo.coord!(%Rover.Marker{id: 1, lat: 45.75, lon: 4.85}) == {45.75, 4.85}
    end

    test "rejects a latitude that is out of range" do
      assert_raise ArgumentError, ~r/invalid latitude/, fn -> Geo.coord!({145.75, 4.85}) end
    end

    test "rejects a longitude that is out of range" do
      assert_raise ArgumentError, ~r/invalid longitude/, fn -> Geo.coord!({45.75, 204.85}) end
    end

    test "the error names the {lat, lon} convention, because that is the actual bug" do
      error = assert_raise ArgumentError, fn -> Geo.coord!({145.75, 4.85}) end
      assert error.message =~ "{latitude, longitude}"
    end

    test "rejects a map with only one half of a coordinate" do
      assert_raise ArgumentError, ~r/could not read a coordinate/, fn ->
        Geo.coord!(%{lat: 45.75})
      end
    end

    test "rejects nonsense" do
      assert_raise ArgumentError, ~r/invalid coordinate/, fn -> Geo.coord!("45.75,4.85") end
    end
  end

  describe "coord/1" do
    test "returns :error instead of raising" do
      assert Geo.coord({45.75, 4.85}) == {:ok, {45.75, 4.85}}
      assert Geo.coord({145.75, 4.85}) == :error
      assert Geo.coord(nil) == :error
    end
  end

  describe "bbox/1" do
    test "returns nil for an empty list" do
      assert Geo.bbox([]) == nil
    end

    test "degenerates to a point for a single coordinate" do
      assert Geo.bbox([{45.0, 4.0}]) == {45.0, 4.0, 45.0, 4.0}
    end

    test "encloses every coordinate" do
      assert Geo.bbox([{45.0, 4.0}, {46.0, 3.0}, {44.5, 5.5}]) == {44.5, 3.0, 46.0, 5.5}
    end

    test "works across the equator and the prime meridian" do
      assert Geo.bbox([{-10.0, -20.0}, {10.0, 20.0}]) == {-10.0, -20.0, 10.0, 20.0}
    end
  end

  describe "distance/2" do
    test "is zero for the same point" do
      assert Geo.distance({45.75, 4.85}, {45.75, 4.85}) == 0.0
    end

    test "matches a known distance" do
      # Lyon to Paris is ~393 km as the crow flies.
      assert_in_delta Geo.distance({45.75, 4.85}, {48.85, 2.35}), 392_834, 200
    end

    test "is symmetric" do
      a = {45.75, 4.85}
      b = {48.85, 2.35}
      assert_in_delta Geo.distance(a, b), Geo.distance(b, a), 0.001
    end
  end

  describe "to_lon_lat/1" do
    test "flips into the order OpenLayers wants" do
      assert Geo.to_lon_lat({45.75, 4.85}) == [4.85, 45.75]
    end
  end
end
