defmodule Rover.Geo do
  @moduledoc """
  Coordinate handling for Rover.

  Rover speaks **`{latitude, longitude}`** everywhere — the order humans use when
  they read a coordinate out loud, and the order Leaflet uses. OpenLayers works
  internally in `[x, y]` (i.e. `[longitude, latitude]`) projected to Web
  Mercator; that flip happens once, in the JavaScript runtime, and never leaks
  into your application code.

  Mixing the two up is the single most common OpenLayers bug, so this module is
  deliberately strict: latitudes outside `-90..90` and longitudes outside
  `-180..180` raise instead of silently placing your marker in the ocean.

      iex> Rover.Geo.coord!({45.75, 4.85})
      {45.75, 4.85}

      iex> Rover.Geo.coord!(%{lat: 45.75, lng: 4.85})
      {45.75, 4.85}
  """

  @type lat :: float()
  @type lon :: float()

  @typedoc "A latitude/longitude pair, in that order."
  @type coord :: {lat(), lon()}

  @typedoc """
  Anything Rover accepts as a coordinate: a `{lat, lon}` tuple, or a map with
  `:lat`/`:latitude` and `:lon`/`:lng`/`:longitude` keys (atom or string).
  """
  @type coordish :: coord() | map()

  @typedoc "A bounding box, as `{south, west, north, east}`."
  @type bbox :: {lat(), lon(), lat(), lon()}

  @earth_radius_m 6_371_008.8

  @lat_keys [:lat, :latitude, "lat", "latitude"]
  @lon_keys [:lon, :lng, :long, :longitude, "lon", "lng", "long", "longitude"]

  @doc """
  Normalises `value` into a `{lat, lon}` tuple of floats.

  Raises `ArgumentError` when the shape is unrecognised or the values are out of
  range.

  ## Examples

      iex> Rover.Geo.coord!({45.75, 4.85})
      {45.75, 4.85}

      iex> Rover.Geo.coord!(%{"latitude" => 48, "longitude" => 2})
      {48.0, 2.0}

  A latitude of `145.75` is not a latitude, so Rover rejects it rather than
  quietly drawing your marker somewhere impossible:

      iex> Rover.Geo.coord(%{lat: 145.75, lon: 4.85})
      :error

  """
  @spec coord!(coordish()) :: coord()
  def coord!({lat, lon}) when is_number(lat) and is_number(lon) do
    {validate_lat!(lat), validate_lon!(lon)}
  end

  def coord!(map) when is_map(map) do
    with {:ok, lat} <- fetch_any(map, @lat_keys),
         {:ok, lon} <- fetch_any(map, @lon_keys) do
      {validate_lat!(lat), validate_lon!(lon)}
    else
      :error ->
        raise ArgumentError, """
        could not read a coordinate from #{inspect(map, limit: 5)}.

        Rover expects a `{latitude, longitude}` tuple, or a map carrying both a
        latitude key (:lat or :latitude) and a longitude key (:lon, :lng or
        :longitude).
        """
    end
  end

  def coord!(other) do
    raise ArgumentError, """
    invalid coordinate: #{inspect(other)}.

    Expected a `{latitude, longitude}` tuple such as `{45.75, 4.85}`, or a map
    such as `%{lat: 45.75, lon: 4.85}`.
    """
  end

  @doc """
  Same as `coord!/1` but returns `{:ok, coord}` or `:error`.
  """
  @spec coord(coordish()) :: {:ok, coord()} | :error
  def coord(value) do
    {:ok, coord!(value)}
  rescue
    ArgumentError -> :error
  end

  @doc """
  Returns the bounding box `{south, west, north, east}` enclosing `coords`.

  Returns `nil` for an empty list. Note that this is a plain min/max box: it does
  not handle geometries straddling the antimeridian.

  ## Examples

      iex> Rover.Geo.bbox([{45.0, 4.0}, {46.0, 5.0}])
      {45.0, 4.0, 46.0, 5.0}

      iex> Rover.Geo.bbox([])
      nil
  """
  @spec bbox([coordish()]) :: bbox() | nil
  def bbox([]), do: nil

  def bbox(coords) when is_list(coords) do
    coords
    |> Enum.map(&coord!/1)
    |> Enum.reduce(nil, fn
      {lat, lon}, nil -> {lat, lon, lat, lon}
      {lat, lon}, {s, w, n, e} -> {min(s, lat), min(w, lon), max(n, lat), max(e, lon)}
    end)
  end

  @doc """
  Great-circle distance between two coordinates, in metres (haversine).

  ## Examples

      iex> Rover.Geo.distance({45.75, 4.85}, {48.85, 2.35}) |> round()
      392834
  """
  @spec distance(coordish(), coordish()) :: float()
  def distance(a, b) do
    {lat1, lon1} = coord!(a)
    {lat2, lon2} = coord!(b)

    phi1 = deg_to_rad(lat1)
    phi2 = deg_to_rad(lat2)
    dphi = deg_to_rad(lat2 - lat1)
    dlambda = deg_to_rad(lon2 - lon1)

    h =
      :math.sin(dphi / 2) ** 2 +
        :math.cos(phi1) * :math.cos(phi2) * :math.sin(dlambda / 2) ** 2

    2 * @earth_radius_m * :math.asin(min(1.0, :math.sqrt(h)))
  end

  @doc """
  Renders a coordinate as the `[lon, lat]` pair OpenLayers expects.

  You should not need this — the JavaScript runtime handles the flip — but it is
  public so that `Rover.Geo` stays useful when you drop down to raw GeoJSON.

      iex> Rover.Geo.to_lon_lat({45.75, 4.85})
      [4.85, 45.75]
  """
  @spec to_lon_lat(coordish()) :: [float()]
  def to_lon_lat(value) do
    {lat, lon} = coord!(value)
    [lon, lat]
  end

  # -- private ---------------------------------------------------------------

  defp fetch_any(map, keys) do
    Enum.reduce_while(keys, :error, fn key, acc ->
      case Map.fetch(map, key) do
        {:ok, value} when is_number(value) -> {:halt, {:ok, value}}
        _ -> {:cont, acc}
      end
    end)
  end

  defp validate_lat!(lat) when lat >= -90 and lat <= 90, do: lat / 1

  defp validate_lat!(lat) do
    raise ArgumentError, """
    invalid latitude #{inspect(lat)} — expected a number between -90 and 90.
    Rover always takes coordinates as {latitude, longitude}, not {x, y}.
    """
  end

  defp validate_lon!(lon) when lon >= -180 and lon <= 180, do: lon / 1

  defp validate_lon!(lon) do
    raise ArgumentError, """
    invalid longitude #{inspect(lon)} — expected a number between -180 and 180.
    Rover always takes coordinates as {latitude, longitude}, not {x, y}.
    """
  end

  defp deg_to_rad(deg), do: deg * :math.pi() / 180
end
