defmodule Rover.HeatmapTest do
  use ExUnit.Case, async: true

  doctest Rover.Heatmap

  alias Rover.Heatmap

  describe "new_all!/2" do
    test "defaults the weight to 1" do
      assert Heatmap.new_all!([%{lat: 45.75, lon: 4.85}]) == [
               %{lat: 45.75, lon: 4.85, weight: 1.0}
             ]
    end

    test "reads a weight, and the usual coordinate spellings" do
      assert Heatmap.new_all!([%{latitude: 45.75, lng: 4.85, weight: 0.5}]) == [
               %{lat: 45.75, lon: 4.85, weight: 0.5}
             ]
    end

    test "maps a weight from another field, by key or by function" do
      rows = [%{lat: 45.75, lon: 4.85, orders: 20}]

      assert Heatmap.new_all!(rows, weight: :orders) == [
               %{lat: 45.75, lon: 4.85, weight: 20.0}
             ]

      assert Heatmap.new_all!(rows, weight: fn row -> row.orders / 40 end) == [
               %{lat: 45.75, lon: 4.85, weight: 0.5}
             ]
    end

    test "drops points it cannot place rather than raising" do
      # A density query returning one null coordinate should thin the map, not take
      # the page down — unlike a marker, which is a thing the caller named.
      rows = [
        %{lat: nil, lon: nil},
        %{lat: 45.75, lon: 4.85},
        %{lat: 999.0, lon: 4.85},
        nil,
        "nonsense"
      ]

      assert Heatmap.new_all!(rows) == [%{lat: 45.75, lon: 4.85, weight: 1.0}]
    end

    test "rejects a function of the wrong arity instead of silently defaulting" do
      # `mix format` rewrites `&(&1.orders / 40)` as `& &1.orders/40`, which Elixir
      # parses as an arity-40 capture. That used to fall through to Map.get and
      # substitute the default weight — a wrong map with nothing to see.
      wrong = fn _a, _b -> 0.5 end

      assert_raise ArgumentError, ~r/1-arity function, got one of arity 2/, fn ->
        Heatmap.new_all!([%{lat: 45.0, lon: 4.0}], weight: wrong)
      end
    end

    test "rejects a non-numeric weight" do
      assert_raise ArgumentError, ~r/:weight/, fn ->
        Heatmap.new_all!([%{lat: 45.0, lon: 4.0, weight: "heavy"}])
      end
    end

    test "an empty list stays empty" do
      assert Heatmap.new_all!([]) == []
    end
  end

  describe "rev/1" do
    test "is stable for the same points and changes with them" do
      a = Heatmap.new_all!([%{lat: 45.75, lon: 4.85}])
      b = Heatmap.new_all!([%{lat: 45.76, lon: 4.85}])

      assert Heatmap.rev(a) == Heatmap.rev(a)
      refute Heatmap.rev(a) == Heatmap.rev(b)
    end

    test "changes when only a weight changes" do
      a = Heatmap.new_all!([%{lat: 45.75, lon: 4.85, weight: 0.2}])
      b = Heatmap.new_all!([%{lat: 45.75, lon: 4.85, weight: 0.9}])

      refute Heatmap.rev(a) == Heatmap.rev(b)
    end
  end

  describe "style!/1" do
    test "has defaults, and no gradient unless asked" do
      assert Heatmap.style!([]) == %{radius: 8, blur: 15, opacity: 1}
    end

    test "takes each option" do
      style = Heatmap.style!(radius: 12, blur: 20, opacity: 0.7, gradient: ["#000", "#fff"])

      assert style.radius == 12
      assert style.blur == 20
      assert style.opacity == 0.7
      assert style.gradient == ["#000", "#fff"]
    end

    test "rejects an unknown option, and names the ones it knows" do
      error = assert_raise ArgumentError, fn -> Heatmap.style!(colour: "red") end

      assert error.message =~ "unknown heatmap style option"
      assert error.message =~ ":gradient"
    end

    test "rejects a non-keyword" do
      assert_raise ArgumentError, ~r/keyword list/, fn -> Heatmap.style!(%{radius: 8}) end
    end
  end
end
