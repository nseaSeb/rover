defmodule Rover.MarkerTest do
  use ExUnit.Case, async: true

  doctest Rover.Marker

  alias Rover.Marker

  defmodule Client do
    @moduledoc false
    defstruct [:id, :latitude, :longitude, :trade_name]
  end

  describe "new!/2" do
    test "builds from the canonical shape" do
      marker = Marker.new!(%{id: 1, lat: 45.75, lon: 4.85, label: "Lyon"})

      assert marker.id == 1
      assert marker.lat == 45.75
      assert marker.lon == 4.85
      assert marker.label == "Lyon"
      assert marker.draggable == false
    end

    test "is idempotent on an existing marker" do
      marker = Marker.new!(%{id: 1, lat: 45.75, lon: 4.85})
      assert Marker.new!(marker) == marker
    end

    test "falls back to :name and :title for the label" do
      assert Marker.new!(%{id: 1, lat: 45.0, lon: 4.0, name: "Atelier"}).label == "Atelier"
      assert Marker.new!(%{id: 1, lat: 45.0, lon: 4.0, title: "Dépôt"}).label == "Dépôt"
    end

    test "maps arbitrary struct fields" do
      client = %Client{id: 7, latitude: 45.75, longitude: 4.85, trade_name: "Chez Paul"}

      marker = Marker.new!(client, lat: :latitude, lon: :longitude, label: :trade_name)

      assert marker.id == 7
      assert marker.lat == 45.75
      assert marker.label == "Chez Paul"
    end

    test "reads a struct without a mapping when it uses recognised names" do
      client = %Client{id: 7, latitude: 45.75, longitude: 4.85}
      assert Marker.new!(client).lat == 45.75
    end

    test "mapping one axis still reads the other from its usual key" do
      # The options are documented as independent, so mapping :lat must not
      # silently break the lookup for :lon.
      marker = Marker.new!(%{id: 1, latitude: 45.75, lon: 4.85}, lat: :latitude)

      assert marker.lat == 45.75
      assert marker.lon == 4.85
    end

    test "mapping only the longitude works the same way" do
      marker = Marker.new!(%{id: 1, lat: 45.75, x: 4.85}, lon: :x)

      assert marker.lat == 45.75
      assert marker.lon == 4.85
    end

    test "mapping one axis of a struct still reads the other" do
      client = %Client{id: 7, latitude: 45.75, longitude: 4.85}
      assert Marker.new!(client, lat: :latitude).lon == 4.85
    end

    test "accepts functions as accessors" do
      marker =
        Marker.new!(%{id: 3, lat: 45.0, lon: 4.0},
          label: fn m -> "client " <> to_string(m.id) end
        )

      assert marker.label == "client 3"
    end

    test "stringifies labels that are not binaries" do
      assert Marker.new!(%{id: 1, lat: 45.0, lon: 4.0, label: 42}).label == "42"
    end

    test "requires an id, and says why" do
      error =
        assert_raise ArgumentError, fn -> Marker.new!(%{lat: 45.75, lon: 4.85}) end

      assert error.message =~ "missing an :id"
      assert error.message =~ "stable id"
    end

    test "propagates coordinate validation" do
      assert_raise ArgumentError, ~r/invalid latitude/, fn ->
        Marker.new!(%{id: 1, lat: 91.0, lon: 4.85})
      end
    end

    test "rejects a non-map source" do
      assert_raise ArgumentError, ~r/cannot build a Rover.Marker/, fn -> Marker.new!("nope") end
    end

    test "rejects a non-numeric scale" do
      assert_raise ArgumentError, ~r/:scale/, fn ->
        Marker.new!(%{id: 1, lat: 45.0, lon: 4.0, scale: "big"})
      end
    end
  end

  describe "new_all!/2" do
    test "normalises a list and drops nils" do
      markers =
        Marker.new_all!([%{id: 1, lat: 45.0, lon: 4.0}, nil, %{id: 2, lat: 46.0, lon: 5.0}])

      assert Enum.map(markers, & &1.id) == [1, 2]
    end
  end

  describe "dump/1" do
    test "drops nils so the payload stays small" do
      dumped = Marker.new!(%{id: 1, lat: 45.75, lon: 4.85}) |> Marker.dump()

      assert dumped == %{id: 1, lat: 45.75, lon: 4.85}
    end

    test "keeps draggable only when true" do
      refute Map.has_key?(Marker.new!(%{id: 1, lat: 45.0, lon: 4.0}) |> Marker.dump(), :draggable)

      assert Marker.new!(%{id: 1, lat: 45.0, lon: 4.0, draggable: true})
             |> Marker.dump()
             |> Map.fetch!(:draggable)
    end

    test "carries :data through untouched" do
      dumped =
        Marker.new!(%{id: 1, lat: 45.0, lon: 4.0, data: %{status: "late"}}) |> Marker.dump()

      assert dumped.data == %{status: "late"}
    end
  end
end
