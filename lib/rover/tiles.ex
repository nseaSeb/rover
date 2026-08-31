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

  ## Carto API keys

  Carto's basemaps now need an API key. Without one the tiles still load — they
  arrive with `API KEY REQUIRED` stamped diagonally across every one, so the
  symptom is a legible map wearing a watermark rather than a blank map or an
  error in the console. That is worth knowing before you go looking for a 401
  that never comes.

  The key is free: Carto issue it by return email, with no approval queue and no
  Carto account, and it covers 5 million tile requests a month across their
  raster and vector services. Their terms require the CARTO and OpenStreetMap
  attribution to stay visible, which Rover renders for you. Request one at
  <https://carto.com/basemaps/apikey/>.

  Configure a default for the whole app:

      config :rover, Rover.Tiles, carto_api_key: "YOUR_KEY"

  or pass one per call, which overrides the configured default:

      <.map id="m" tiles={{:carto_dark, key: "YOUR_KEY"}} ... />

  Carto also say the raster (PNG) service is being retired in favour of vector
  tiles, and that they are considering freezing its data updates — the
  cartography would stay where it is while vector keeps moving. No date is
  published for either. Rover's map renders basemaps through OpenLayers' raster
  `XYZ` source today, so the presets here stay on raster until Rover grows a
  vector tile layer; the key you request now covers both services, so nothing is
  wasted when it does.

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

  @type t ::
          preset()
          | {preset(), keyword()}
          | :none
          | {:xyz, String.t()}
          | {:xyz, String.t(), keyword()}

  @carto_presets [:carto_light, :carto_dark, :carto_voyager]

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

  def resolve!(name) when is_atom(name), do: resolve!({name, []})

  def resolve!({name, opts}) when is_atom(name) and is_list(opts) do
    case Map.fetch(@presets, name) do
      {:ok, tiles} ->
        key = Keyword.get(opts, :key, default_key(name))
        apply_key(tiles, key)

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
    `{preset, opts}`, or `{:xyz, url}` / `{:xyz, url, opts}`.
    """
  end

  # Only the Carto presets have a configured default — every other preset's
  # `key` stays nil unless a caller passes one explicitly, so pointing this at
  # an unkeyed provider is a no-op rather than a broken URL.
  defp default_key(name) when name in @carto_presets do
    :rover |> Application.get_env(__MODULE__, []) |> Keyword.get(:carto_api_key)
  end

  defp default_key(_name), do: nil

  defp apply_key(tiles, nil), do: tiles

  defp apply_key(tiles, key) when is_binary(key) do
    separator = if String.contains?(tiles.url, "?"), do: "&", else: "?"
    %{tiles | url: tiles.url <> separator <> "key=" <> URI.encode_www_form(key)}
  end
end
