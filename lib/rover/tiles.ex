defmodule Rover.Tiles do
  @moduledoc """
  Named basemaps, and the escape hatches to any raster or vector tile server.

  Pass one to `Rover.Components.map/1`:

      <.map id="m" tiles={:carto_light} ... />
      <.map id="m" tiles={{:xyz, "https://tiles.example.com/{z}/{x}/{y}.png"}} ... />
      <.map id="m" tiles={{:xyz, url, attributions: "© Example", max_zoom: 18}} ... />
      <.map id="m" tiles={:carto_light_vector} ... />
      <.map id="m" tiles={{:vector, "https://example.com/style.json"}} ... />

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

  Carto is retiring these raster endpoints in favor of vector tiles (MapLibre-
  style GL JSON served as MVT); `:carto_light`, `:carto_dark`, and
  `:carto_voyager` keep working for existing configurations, but a new caller
  should reach for their vector counterparts instead:

      <.map id="m" tiles={:carto_light_vector} ... />

  `:carto_light_vector`, `:carto_dark_vector`, and `:carto_voyager_vector` take
  the same `carto_api_key` configuration and per-call `key:` opt described
  above. For any other MapLibre-compatible style (Mapbox, MapTiler,
  self-hosted), pass its style URL directly:

      <.map id="m" tiles={{:vector, "https://api.maptiler.com/maps/streets/style.json?key=YOUR_KEY"}} ... />

  Raster stays fully supported — it is not being removed — but it is the
  deprecated path for the three Carto presets above.

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
    },
    carto_light_vector: %{
      style_url: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
      attributions: @carto_attribution
    },
    carto_dark_vector: %{
      style_url: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
      attributions: @carto_attribution
    },
    carto_voyager_vector: %{
      style_url: "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json",
      attributions: @carto_attribution
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
          | :carto_light_vector
          | :carto_dark_vector
          | :carto_voyager_vector

  @type t ::
          preset()
          | {preset(), keyword()}
          | :none
          | {:xyz, String.t()}
          | {:xyz, String.t(), keyword()}
          | {:vector, String.t()}
          | {:vector, String.t(), keyword()}

  @raster_presets [
    :osm,
    :osm_hot,
    :carto_light,
    :carto_dark,
    :carto_voyager,
    :opentopomap,
    :esri_world_imagery,
    :ign_plan,
    :ign_ortho
  ]

  @vector_presets [
    :carto_light_vector,
    :carto_dark_vector,
    :carto_voyager_vector
  ]

  @carto_presets [
    :carto_light,
    :carto_dark,
    :carto_voyager,
    :carto_light_vector,
    :carto_dark_vector,
    :carto_voyager_vector
  ]

  # No pixelation ceiling applies to vector tiles the way it does to raster —
  # they overzoom crisply past their source data's native zoom — so this exists
  # only so `fitMaxZoom/2` and the view's zoom ceiling have a number to work
  # with, not because 24 is a real limit being enforced anywhere.
  @vector_max_zoom 24

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
      %{type: :raster, attributions: "© Me", max_zoom: 19, url: "https://x/{z}/{x}/{y}.png"}

      iex> Rover.Tiles.resolve!(:carto_light_vector).type
      :vector

      iex> Rover.Tiles.resolve!({:vector, "https://example.com/style.json"})
      %{type: :vector, attributions: nil, max_zoom: 24, style_url: "https://example.com/style.json"}

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
        tiles |> tag_type(name) |> apply_key(key)

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
      type: :raster,
      url: url,
      attributions: Keyword.get(opts, :attributions),
      max_zoom: Keyword.get(opts, :max_zoom, 19)
    }
  end

  def resolve!({:vector, style_url}), do: resolve!({:vector, style_url, []})

  def resolve!({:vector, style_url, opts}) when is_binary(style_url) and is_list(opts) do
    %{
      type: :vector,
      style_url: style_url,
      attributions: Keyword.get(opts, :attributions),
      max_zoom: Keyword.get(opts, :max_zoom, @vector_max_zoom)
    }
  end

  def resolve!(other) do
    raise ArgumentError, """
    invalid tiles: #{inspect(other)}.

    Expected a preset name (#{Enum.map_join(presets(), ", ", &inspect/1)}), `:none`,
    `{preset, opts}`, `{:xyz, url}` / `{:xyz, url, opts}`, or
    `{:vector, style_url}` / `{:vector, style_url, opts}`.
    """
  end

  defp tag_type(tiles, name) when name in @raster_presets, do: Map.put(tiles, :type, :raster)

  defp tag_type(tiles, name) when name in @vector_presets do
    tiles |> Map.put_new(:max_zoom, @vector_max_zoom) |> Map.put(:type, :vector)
  end

  # Only the Carto presets have a configured default — every other preset's
  # `key` stays nil unless a caller passes one explicitly, so pointing this at
  # an unkeyed provider is a no-op rather than a broken URL.
  defp default_key(name) when name in @carto_presets do
    :rover |> Application.get_env(__MODULE__, []) |> Keyword.get(:carto_api_key)
  end

  defp default_key(_name), do: nil

  defp apply_key(tiles, nil), do: tiles

  defp apply_key(%{style_url: style_url} = tiles, key) when is_binary(key) do
    %{tiles | style_url: inject_key(style_url, key)}
  end

  defp apply_key(%{url: url} = tiles, key) when is_binary(key) do
    %{tiles | url: inject_key(url, key)}
  end

  defp inject_key(url, key) do
    separator = if String.contains?(url, "?"), do: "&", else: "?"
    url <> separator <> "key=" <> URI.encode_www_form(key)
  end
end
