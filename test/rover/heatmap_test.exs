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

    test "maps the coordinate from other keys, like markers do" do
      rows = [%{x: 45.75, y: 4.85}]

      assert Heatmap.new_all!(rows, lat: :x, lon: :y) == [%{lat: 45.75, lon: 4.85, weight: 1.0}]
    end

    test "mapping one axis still reads the other from its usual key" do
      assert Heatmap.new_all!([%{x: 45.75, lon: 4.85}], lat: :x) == [
               %{lat: 45.75, lon: 4.85, weight: 1.0}
             ]
    end

    test "maps the coordinate off a struct, and by function" do
      rows = [%{point: {45.75, 4.85}}]

      assert Heatmap.new_all!(rows,
               lat: fn row -> elem(row.point, 0) end,
               lon: fn row -> elem(row.point, 1) end
             ) == [%{lat: 45.75, lon: 4.85, weight: 1.0}]
    end

    test "rejects a mapping naming a field it does not have" do
      # `weigth:` used to be ignored, and every point silently weighed 1.
      assert_raise ArgumentError, ~r/unknown heatmap field :weigth/, fn ->
        Heatmap.new_all!([%{lat: 45.0, lon: 4.0, orders: 3}], weigth: :orders)
      end
    end

    test "rejects a mapping written as a bare list of keys" do
      assert_raise ArgumentError,
                   ~r/expected the heatmap field mapping to be a keyword list/,
                   fn ->
                     Heatmap.new_all!([], [:orders])
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
