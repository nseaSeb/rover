defmodule Rover.TilesTest do
  use ExUnit.Case, async: true

  doctest Rover.Tiles

  alias Rover.Tiles

  test "every preset carries a url and an attribution" do
    for preset <- Tiles.presets() do
      resolved = Tiles.resolve!(preset)

      assert is_binary(resolved.url), "#{preset} has no url"
      assert resolved.url =~ "{z}"

      assert is_binary(resolved.attributions) and resolved.attributions != "",
             "#{preset} ships without an attribution, which is a licensing problem"
    end
  end

  test ":none means no basemap" do
    assert Tiles.resolve!(:none) == nil
  end

  test "an unknown preset lists the known ones" do
    error = assert_raise ArgumentError, fn -> Tiles.resolve!(:google_maps) end

    assert error.message =~ "unknown tile preset"
    assert error.message =~ ":carto_light"
  end

  test "xyz tiles default to zoom 19 and no attribution" do
    assert Tiles.resolve!({:xyz, "https://x/{z}/{x}/{y}.png"}) == %{
             url: "https://x/{z}/{x}/{y}.png",
             attributions: nil,
             max_zoom: 19
           }
  end

  test "xyz tiles take options" do
    resolved =
      Tiles.resolve!({:xyz, "https://x/{z}/{x}/{y}.png", max_zoom: 14, attributions: "©"})

    assert resolved.max_zoom == 14
    assert resolved.attributions == "©"
  end

  test "rejects anything else" do
    assert_raise ArgumentError, ~r/invalid tiles/, fn -> Tiles.resolve!("https://x") end
  end
end
