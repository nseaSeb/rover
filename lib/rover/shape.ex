defmodule Rover.Shape do
  @moduledoc """
  A geometry on the map: an outline, a route, a zone.

  Where `Rover.Marker` takes a coordinate, a shape takes **GeoJSON**:

      %{
        id: "parcel-42",
        geometry: %{"type" => "Polygon", "coordinates" => [[[4.83, 45.76], ...]]},
        color: "#16a34a"
      }

  > #### Shapes are the one place Rover is not latitude-first {: .info}
  >
  > Everywhere else — markers, `center`, event payloads — Rover speaks
  > `{latitude, longitude}`, because that is the order people say out loud.
  > GeoJSON is defined the other way round, `[longitude, latitude]`
  > ([RFC 7946 §3.1.1](https://www.rfc-editor.org/rfc/rfc7946#section-3.1.1)),
  > and here the standard wins.
  >
  > The reason is that shape data is almost never typed by hand. It arrives from
  > `ST_AsGeoJSON`, from a cadastral API, from a routing service — already
  > conformant. Inventing a latitude-first geometry format would mean converting
  > on the way in and on the way out, and would cut Rover off from every tool
  > that already speaks GeoJSON.

  ## What `:geometry` accepts

  Anything `ol/format/GeoJSON` can read, which is to say any of:

  * a bare geometry — `Point`, `LineString`, `Polygon`, `MultiPolygon`, …
  * a `Feature`
  * a `FeatureCollection`

  With atom or string keys, or as an undecoded JSON string — so the output of
  `Ecto.Adapters.SQL.query(repo, "select ST_AsGeoJSON(geom) …")` goes straight in.

  ## Fields

  | Field | Type | Meaning |
  |---|---|---|
  | `:id` | term | **Required.** Stable identity used to diff the map. |
  | `:geometry` | map / string | **Required.** GeoJSON, as above. |
  | `:color` | string | Stroke colour. |
  | `:width` | number | Stroke width in pixels. |
  | `:fill_color` | string | Fill colour. Defaults to `:color`. |
  | `:fill_opacity` | float | `0.0`–`1.0`. Applied to the fill only. |
  | `:label` | string | Text drawn at the centre of the geometry. |
  | `:tooltip` | string | Shown on hover, at the pointer. Defaults to `:label`. |
  | `:rev` | term | Revision. See below. |
  | `:data` | map | Echoed back verbatim in shape events. |
  | `:editable` | boolean | Lets the user drag its vertices — see `on_shape_edit_end`. Only for a shape backed by a single feature; a `FeatureCollection` of several is not editable. |

  ## Why there is a `:rev`

  Markers are diffed by hashing their coordinate — two numbers, free. A route can
  be thousands of points, and re-hashing it on the client on every update is
  exactly the cost the reconciler exists to avoid.

  So the revision is computed **once per render, on the server**:
  `:erlang.phash2(geometry)` by default. If you already have something cheaper
  and more meaningful — a `updated_at`, a database revision, a version column —
  pass it as `:rev` and Rover will trust it instead:

      %{id: p.id, geometry: p.geom, rev: p.updated_at}

  Two shapes with the same id and the same `:rev` are assumed to have the same
  geometry, and the client leaves the feature alone.
  """

  @type id :: String.t() | integer() | atom()

  @type t :: %__MODULE__{
          id: id(),
          geometry: map(),
          color: String.t() | nil,
          width: number() | nil,
          fill_color: String.t() | nil,
          fill_opacity: float() | nil,
          label: String.t() | nil,
          tooltip: String.t() | nil,
          rev: term(),
          data: map() | nil,
          editable: boolean()
        }

  @enforce_keys [:id, :geometry]
  defstruct [
    :id,
    :geometry,
    :color,
    :width,
    :fill_color,
    :fill_opacity,
    :label,
    :tooltip,
    :rev,
    :data,
    editable: false
  ]

  @default_mapping [
    id: [:id, "id"],
    geometry: [:geometry, :geom, :geojson, "geometry", "geom", "geojson"],
    color: [:color, "color"],
    width: [:width, "width"],
    fill_color: [:fill_color, "fill_color", "fillColor"],
    fill_opacity: [:fill_opacity, "fill_opacity", "fillOpacity"],
    label: [:label, :name, :title, "label", "name", "title"],
    tooltip: [:tooltip, "tooltip"],
    rev: [:rev, "rev"],
    data: [:data, "data"],
    editable: [:editable, "editable"]
  ]

  @geometry_types ~w(
    Point MultiPoint LineString MultiLineString Polygon MultiPolygon
    GeometryCollection Feature FeatureCollection
  )

  @doc """
  Normalises `source` into a `#{inspect(__MODULE__)}`.

  `opts` maps Rover fields onto keys of `source`, exactly as
  `Rover.Marker.new!/2` does. Every option takes a key (atom or string) or a
  1-arity function.

  ## Examples

      iex> shape = Rover.Shape.new!(%{id: 1, geometry: %{"type" => "Point", "coordinates" => [4.85, 45.75]}})
      iex> shape.geometry["type"]
      "Point"

      iex> Rover.Shape.new!(%{ref: "a", geom: ~s({"type":"Point","coordinates":[4.85,45.75]})}, id: :ref).id
      "a"
  """
  @spec new!(t() | map(), keyword()) :: t()
  def new!(source, opts \\ [])

  def new!(%__MODULE__{} = shape, _opts) do
    geometry = validate_geometry!(shape.geometry, shape)
    %{shape | geometry: geometry, rev: shape.rev || default_rev(geometry)}
  end

  def new!(source, opts) when is_map(source) do
    geometry =
      source
      |> extract(:geometry, opts)
      |> require_geometry!(source)
      |> validate_geometry!(source)

    %__MODULE__{
      id: require_id!(extract(source, :id, opts), source),
      geometry: geometry,
      color: source |> extract(:color, opts) |> to_string_or_nil(),
      width: extract(source, :width, opts),
      fill_color: source |> extract(:fill_color, opts) |> to_string_or_nil(),
      fill_opacity: extract(source, :fill_opacity, opts),
      label: source |> extract(:label, opts) |> to_string_or_nil(),
      tooltip: source |> extract(:tooltip, opts) |> to_string_or_nil(),
      rev: extract(source, :rev, opts) || default_rev(geometry),
      data: extract(source, :data, opts),
      editable: extract(source, :editable, opts) == true
    }
  end

  def new!(other, _opts) do
    raise ArgumentError, """
    cannot build a Rover.Shape from #{inspect(other)}.

    Expected a map or struct carrying an id and a GeoJSON geometry, for example:

        %{id: 1, geometry: %{"type" => "Point", "coordinates" => [4.85, 45.75]}}
    """
  end

  @doc """
  Normalises a list of shapes. Nil entries are dropped.
  """
  @spec new_all!(Enumerable.t(), keyword()) :: [t()]
  def new_all!(shapes, opts \\ []) do
    shapes
    |> Enum.reject(&is_nil/1)
    |> Enum.map(&new!(&1, opts))
  end

  @doc """
  Renders a shape as the compact map handed to the JavaScript runtime.

  `nil` fields are dropped, so a shape that only sets a colour does not ship
  seven nulls alongside it.

  ## Examples

      iex> shape = Rover.Shape.new!(%{id: 1, geometry: %{"type" => "Point", "coordinates" => [4.85, 45.75]}, rev: 7})
      iex> Rover.Shape.dump(shape) |> Map.keys() |> Enum.sort()
      [:geometry, :id, :rev]
  """
  @spec dump(t()) :: map()
  def dump(%__MODULE__{} = shape) do
    shape
    |> Map.from_struct()
    |> Enum.reject(fn
      {:editable, false} -> true
      {_key, value} -> is_nil(value)
    end)
    |> Map.new()
  end

  @doc """
  Every coordinate in a geometry, as `{lat, lon}` pairs.

  This is what lets a map with shapes and no markers still find its centre. It
  walks any nesting depth, so a `MultiPolygon` with holes and a `Point` are the
  same call.

  ## Examples

      iex> Rover.Shape.coordinates(%{"type" => "LineString", "coordinates" => [[4.85, 45.75], [2.35, 48.85]]})
      [{45.75, 4.85}, {48.85, 2.35}]

      iex> Rover.Shape.coordinates(%{"type" => "Point", "coordinates" => [4.85, 45.75]})
      [{45.75, 4.85}]
  """
  @spec coordinates(t() | map() | String.t()) :: [{float(), float()}]
  def coordinates(%__MODULE__{geometry: geometry}), do: coordinates(geometry)

  def coordinates(geometry) when is_binary(geometry) do
    geometry |> decode!() |> coordinates()
  end

  def coordinates(geometry) when is_map(geometry) do
    case type_of(geometry) do
      "Feature" ->
        geometry |> get("geometry") |> coordinates_or_empty()

      "FeatureCollection" ->
        geometry |> get("features") |> List.wrap() |> Enum.flat_map(&coordinates_or_empty/1)

      "GeometryCollection" ->
        geometry |> get("geometries") |> List.wrap() |> Enum.flat_map(&coordinates_or_empty/1)

      _ ->
        geometry |> get("coordinates") |> walk()
    end
  end

  def coordinates(_other), do: []

  # -- private ---------------------------------------------------------------

  defp coordinates_or_empty(nil), do: []
  defp coordinates_or_empty(geometry), do: coordinates(geometry)

  # GeoJSON positions are [lon, lat] and may be nested to any depth. A list whose
  # first element is a number is a position; anything else is a list of them.
  defp walk([lon, lat | _rest]) when is_number(lon) and is_number(lat), do: [{lat / 1, lon / 1}]
  defp walk(list) when is_list(list), do: Enum.flat_map(list, &walk/1)
  defp walk(_other), do: []

  defp default_rev(geometry), do: :erlang.phash2(geometry)

  defp validate_geometry!(geometry, source) when is_binary(geometry) do
    geometry |> decode!(source) |> validate_geometry!(source)
  end

  defp validate_geometry!(geometry, source) when is_map(geometry) do
    case type_of(geometry) do
      type when type in @geometry_types ->
        geometry

      nil ->
        raise ArgumentError, """
        shape geometry has no "type" — #{inspect(geometry, limit: 5)}

        Rover expects GeoJSON (RFC 7946): a map with a "type" and, for a bare
        geometry, "coordinates". Remember that GeoJSON positions are
        [longitude, latitude] — the opposite of the {lat, lon} Rover uses for
        markers and centres.

            %{"type" => "Polygon", "coordinates" => [[[4.83, 45.76], ...]]}

        Source: #{inspect(source, limit: 3)}
        """

      other ->
        raise ArgumentError, """
        unknown GeoJSON type #{inspect(other)}.

        Expected one of: #{Enum.join(@geometry_types, ", ")}.
        """
    end
  end

  defp validate_geometry!(other, source) do
    raise ArgumentError, """
    invalid shape geometry: #{inspect(other, limit: 5)}

    Expected GeoJSON as a map or a JSON string, not a bare coordinate list.
    Source: #{inspect(source, limit: 3)}
    """
  end

  defp decode!(json, source \\ nil) do
    case Jason.decode(json) do
      {:ok, decoded} ->
        decoded

      {:error, _} ->
        raise ArgumentError, """
        shape geometry is a string but not valid JSON.

        #{inspect(String.slice(json, 0, 120))}#{if source, do: "\n\nSource: #{inspect(source, limit: 3)}", else: ""}
        """
    end
  end

  defp type_of(geometry), do: get(geometry, "type")

  defp get(map, key) when is_map(map) do
    case Map.fetch(map, key) do
      {:ok, value} -> value
      :error -> Map.get(map, String.to_existing_atom(key))
    end
  rescue
    ArgumentError -> nil
  end

  defp extract(source, field, opts) do
    case Keyword.fetch(opts, field) do
      {:ok, accessor} -> read(source, accessor)
      :error -> source |> fetch_any(Keyword.fetch!(@default_mapping, field)) |> unwrap()
    end
  end

  defp read(source, fun) when is_function(fun, 1), do: fun.(source)
  # A function of any other arity can only be a mistake, and the mistake is easy to
  # make: `mix format` rewrites `&(&1.orders / 40)` as `& &1.orders/40`, which Elixir
  # parses as a capture of arity 40. Falling through to `Map.get(source, fun)` would
  # return nil and quietly substitute the default — a wrong map with no error.
  defp read(_source, fun) when is_function(fun) do
    raise ArgumentError, """
    field accessor must be a 1-arity function, got one of arity #{:erlang.fun_info(fun)[:arity]}.

    If you wrote a capture containing a division, wrap it or use fn:

        fn row -> row.orders / 40 end
    """
  end

  defp read(source, key), do: Map.get(source, key)

  defp fetch_any(source, keys) do
    Enum.reduce_while(keys, :error, fn key, acc ->
      case Map.fetch(source, key) do
        {:ok, nil} -> {:cont, acc}
        {:ok, value} -> {:halt, {:ok, value}}
        :error -> {:cont, acc}
      end
    end)
  end

  defp unwrap({:ok, value}), do: value
  defp unwrap(:error), do: nil

  defp require_id!(nil, source) do
    raise ArgumentError, """
    shape is missing an :id — #{inspect(source, limit: 5)}

    Rover uses the id to tell shapes apart between renders, so that updating one
    outline does not tear down and rebuild the others.

    Give each shape a stable id, or point Rover at the field that holds it:

        Rover.Shape.new!(parcel, id: :uuid)
    """
  end

  defp require_id!(id, _source), do: id

  defp require_geometry!(nil, source) do
    raise ArgumentError, """
    shape is missing a :geometry — #{inspect(source, limit: 5)}

    Rover looks for :geometry, :geom or :geojson. If your field is named
    something else, say so:

        Rover.Shape.new!(parcel, geometry: :cadastral_outline)
    """
  end

  defp require_geometry!(geometry, _source), do: geometry

  defp to_string_or_nil(nil), do: nil
  defp to_string_or_nil(value) when is_binary(value), do: value
  defp to_string_or_nil(value), do: to_string(value)
end
