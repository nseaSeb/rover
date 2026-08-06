defmodule Rover.Tiles do
  @moduledoc """
  Named basemaps, and the escape hatch to any XYZ tile server.

  Pass one to `Rover.Components.map/1`:

      <.map id="m" tiles={:carto_light} ... />
      <.map id="m" tiles={{:xyz, "https://tiles.example.com/{z}/{x}/{y}.png"}} ... />
      <.map id="m" tiles={{:xyz, url, attributions: "© Example", max_zoom: 18}} ... />

  Every preset carries the attribution its provider requires, and Rover renders
  it in the map's attribution control. Removing it is usually a licence
  violation — OpenStreetMap tiles in particular are free, but not unconditional.
  Both OSM and Carto presets point at public demo servers with usage policies
  that forbid heavy traffic; for anything beyond development, point `{:xyz, …}`
  at tiles you are entitled to use.

  ## France

  `:ign_plan` and `:ign_ortho` serve the French Géoportail — the reference plan
  and the aerial orthophotography, both open data and both intended for
  production use, which is what sets them apart from the demo endpoints above.
  `:ign_ortho` over a field is a different conversation with a grower than a road
  map is.

      <.map id="parcels" tiles={:ign_ortho} shapes={@parcels} />
  """

  @osm_attribution ~s(© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors)
  @carto_attribution @osm_attribution <>
                       ~s(, © <a href="https://carto.com/attributions">CARTO</a>)
  @ign_attribution ~s(© <a href="https://www.ign.fr">IGN-F/Géoportail</a>)

  # France's Géoportail speaks WMTS, but its KVP endpoint takes the tile
  # coordinates as query parameters — and OpenLayers substitutes {z}/{x}/{y}
  # anywhere in the URL, query string included, so a plain XYZ source reads it
  # without a WMTS capabilities round-trip. Note TILEROW is {y} and TILECOL is
  # {x}: getting that pair backwards yields a map that loads and is wrong.
  @ign_wmts "https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0" <>
              "&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}"

  @presets %{
    osm: %{
      url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      attributions: @osm_attribution,
      max_zoom: 19
    },
    osm_hot: %{
      url: "https://tile.openstreetmap.fr/hot/{z}/{x}/{y}.png",
      attributions: @osm_attribution <> ", Tiles style by Humanitarian OSM Team",
      max_zoom: 20
    },
    carto_light: %{
      url: "https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
      attributions: @carto_attribution,
      max_zoom: 20
    },
    carto_dark: %{
      url: "https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
      attributions: @carto_attribution,
      max_zoom: 20
    },
    carto_voyager: %{
      url: "https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
      attributions: @carto_attribution,
      max_zoom: 20
    },
    opentopomap: %{
      url: "https://{a-c}.tile.opentopomap.org/{z}/{x}/{y}.png",
      attributions: @osm_attribution <> ", © <a href=\"https://opentopomap.org\">OpenTopoMap</a>",
      max_zoom: 17
    },
    esri_world_imagery: %{
      url:
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      attributions: "Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
      max_zoom: 19
    },
    # The two IGN layers do not agree on a format: the plan is PNG, the
    # orthophotos are JPEG, and asking for the wrong one gets you an
    # `InvalidParameterValue` XML document where a tile should be. Both stop at
    # zoom 19 — 20 is a 404.
    ign_plan: %{
      url: @ign_wmts <> "&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&FORMAT=image/png",
      attributions: @ign_attribution,
      max_zoom: 19
    },
    ign_ortho: %{
      url: @ign_wmts <> "&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&FORMAT=image/jpeg",
      attributions: @ign_attribution,
      max_zoom: 19
    }
  }

  @type preset ::
          :osm
          | :osm_hot
          | :carto_light
          | :carto_dark
          | :carto_voyager
          | :opentopomap
          | :esri_world_imagery
          | :ign_plan
          | :ign_ortho

  @type t :: preset() | :none | {:xyz, String.t()} | {:xyz, String.t(), keyword()}

  @doc """
  The list of available preset names.

  ## Examples

      iex> :carto_dark in Rover.Tiles.presets()
      true
  """
  @spec presets() :: [preset()]
  def presets, do: @presets |> Map.keys() |> Enum.sort()

  @doc """
  Resolves a tile specification into the map handed to the JavaScript runtime.

  Returns `nil` for `:none`, which renders a map with no basemap at all — useful
  when you only want the vector layers, or supply your own background.

  ## Examples

      iex> Rover.Tiles.resolve!(:osm).max_zoom
      19

      iex> Rover.Tiles.resolve!({:xyz, "https://x/{z}/{x}/{y}.png", attributions: "© Me"})
      %{attributions: "© Me", max_zoom: 19, url: "https://x/{z}/{x}/{y}.png"}

      iex> Rover.Tiles.resolve!(:none)
      nil
  """
  @spec resolve!(t()) :: map() | nil
  def resolve!(:none), do: nil
  def resolve!(nil), do: nil

  def resolve!(name) when is_atom(name) do
    case Map.fetch(@presets, name) do
      {:ok, tiles} ->
        tiles

      :error ->
        raise ArgumentError, """
        unknown tile preset #{inspect(name)}.

        Known presets: #{Enum.map_join(presets(), ", ", &inspect/1)}, or :none.
        For any other tile server, pass an explicit URL template:

            tiles={{:xyz, "https://tiles.example.com/{z}/{x}/{y}.png", attributions: "© Example"}}
        """
    end
  end

  def resolve!({:xyz, url}), do: resolve!({:xyz, url, []})

  def resolve!({:xyz, url, opts}) when is_binary(url) and is_list(opts) do
    %{
      url: url,
      attributions: Keyword.get(opts, :attributions),
      max_zoom: Keyword.get(opts, :max_zoom, 19)
    }
  end

  def resolve!(other) do
    raise ArgumentError, """
    invalid tiles: #{inspect(other)}.

    Expected a preset name (#{Enum.map_join(presets(), ", ", &inspect/1)}), `:none`,
    or `{:xyz, url}` / `{:xyz, url, opts}`.
    """
  end
end
