defmodule Rover.Marker do
  @moduledoc """
  A point on the map.

  You rarely build one by hand. `Rover.Components.map/1` runs every entry of its
  `markers` list through `new!/1`, so plain maps and your own Ecto schemas work
  as-is provided they carry an id and a coordinate:

      %{id: 1, lat: 45.75, lon: 4.85, label: "Lyon"}
      %Client{id: 1, latitude: 45.75, longitude: 4.85, name: "Lyon"}

  For the second form, tell Rover which fields to read:

      Rover.Marker.new!(client, lat: :latitude, lon: :longitude, label: :name)

  ## Fields

  | Field | Type | Meaning |
  |---|---|---|
  | `:id` | term | **Required.** Stable identity used to diff the map. |
  | `:lat` / `:lon` | float | **Required.** See `Rover.Geo`. |
  | `:label` | string | Text drawn next to the marker. |
  | `:color` | string | CSS colour of the default pin, e.g. `"#e11d48"`. |
  | `:emoji` | string | An emoji drawn in place of the pin, e.g. `"🏠"`. |
  | `:icon` | string | URL of an image to use instead of the default pin. |
  | `:scale` | float | Size multiplier applied to the pin or icon. |
  | `:anchor` | `[x, y]` | Where on the image the coordinate sits, as fractions of its size: `[0.5, 1]` (bottom centre, the default) for a pin, `[0.5, 0.5]` for a dot or a badge. Pin or `:icon` only. |
  | `:rotation` | float | Degrees clockwise, for an `:icon` that has a heading — a vehicle, an arrow. Pin or `:icon` only. |
  | `:opacity` | float | 0 to 1. Pin or `:icon` only. |
  | `:tooltip` | string | Shown on hover. Defaults to `:label`. |
  | `:draggable` | boolean | Lets the user move the marker (see `on_marker_drag_end`). |
  | `:data` | map | Echoed back verbatim in marker events. |

  The identity is `:id`. Changing anything else updates that marker in place;
  changing the id removes one marker and adds another.

  > #### Ids travel through JSON {: .warning}
  >
  > Integers and strings round-trip unchanged, so an event handler matching on
  > `%{"id" => 1}` works. **Atoms do not**: `:depot` is delivered back as
  > `"depot"`, and a handler matching `id == :depot` will never fire. Use
  > integers or strings for ids you intend to match on.
  """

  alias Rover.Geo

  @type id :: String.t() | integer() | atom()

  @type t :: %__MODULE__{
          id: id(),
          lat: float(),
          lon: float(),
          label: String.t() | nil,
          color: String.t() | nil,
          emoji: String.t() | nil,
          icon: String.t() | nil,
          scale: float() | nil,
          anchor: [float()] | nil,
          rotation: float() | nil,
          opacity: float() | nil,
          tooltip: String.t() | nil,
          draggable: boolean(),
          data: map() | nil
        }

  @enforce_keys [:id, :lat, :lon]
  defstruct [
    :id,
    :lat,
    :lon,
    :label,
    :color,
    :emoji,
    :icon,
    :scale,
    :anchor,
    :rotation,
    :opacity,
    :tooltip,
    :data,
    draggable: false
  ]

  @default_mapping [
    id: [:id, "id"],
    label: [:label, :name, :title, "label", "name", "title"],
    color: [:color, "color"],
    emoji: [:emoji, "emoji"],
    icon: [:icon, "icon"],
    scale: [:scale, "scale"],
    anchor: [:anchor, "anchor"],
    rotation: [:rotation, "rotation"],
    opacity: [:opacity, "opacity"],
    tooltip: [:tooltip, "tooltip"],
    draggable: [:draggable, "draggable"],
    data: [:data, "data"]
  ]

  @doc """
  Normalises `source` into a `#{inspect(__MODULE__)}`.

  `opts` maps Rover fields onto keys of `source`, for schemas that name things
  differently. Every option takes a key (atom or string) or a 1-arity function.

  ## Examples

      iex> Rover.Marker.new!(%{id: 1, lat: 45.75, lon: 4.85, name: "Lyon"}) |> Rover.Marker.dump()
      %{id: 1, lat: 45.75, lon: 4.85, label: "Lyon"}

      iex> Rover.Marker.new!(%{ref: "a", lat: 45.75, lng: 4.85}, id: :ref).id
      "a"

      iex> Rover.Marker.new!(%{id: 1, lat: 45.75, lon: 4.85}, label: fn m -> "client " <> to_string(m.id) end).label
      "client 1"
  """
  @spec new!(t() | map(), keyword()) :: t()
  def new!(source, opts \\ [])

  def new!(%__MODULE__{} = marker, _opts) do
    {lat, lon} = Geo.coord!({marker.lat, marker.lon})
    %{marker | lat: lat, lon: lon}
  end

  def new!(source, opts) when is_map(source) do
    validate_mapping!(opts)
    {lat, lon} = coord_from(source, opts)

    %__MODULE__{
      id: require_id!(extract(source, :id, opts), source),
      lat: lat,
      lon: lon,
      label: source |> extract(:label, opts) |> to_string_or_nil(),
      color: source |> extract(:color, opts) |> to_string_or_nil(),
      emoji: source |> extract(:emoji, opts) |> to_string_or_nil(),
      icon: source |> extract(:icon, opts) |> to_string_or_nil(),
      scale: source |> extract(:scale, opts) |> to_float_or_nil(),
      anchor: source |> extract(:anchor, opts) |> to_anchor_or_nil(),
      rotation: source |> extract(:rotation, opts) |> to_float_or_nil(:rotation),
      opacity: source |> extract(:opacity, opts) |> to_opacity_or_nil(),
      tooltip: source |> extract(:tooltip, opts) |> to_string_or_nil(),
      draggable: extract(source, :draggable, opts) == true,
      data: extract(source, :data, opts)
    }
  end

  def new!(other, _opts) do
    raise ArgumentError, """
    cannot build a Rover.Marker from #{inspect(other)}.

    Expected a map or struct carrying an id and a coordinate, for example:

        %{id: 1, lat: 45.75, lon: 4.85, label: "Lyon"}
    """
  end

  @doc """
  Normalises a list of markers. Nil entries are dropped.
  """
  @spec new_all!(Enumerable.t(), keyword()) :: [t()]
  def new_all!(markers, opts \\ []) do
    # Checked here as well as per marker, so an empty list still rejects a bad
    # mapping — a typo should not wait for the first row to be reported.
    validate_mapping!(opts)

    markers
    |> Enum.reject(&is_nil/1)
    |> Enum.map(&new!(&1, opts))
  end

  @doc """
  Renders a marker as the compact map handed to the JavaScript runtime.

  `nil` fields are dropped so that the payload sent over the wire stays small.

  ## Examples

      iex> Rover.Marker.new!(%{id: 1, lat: 45.75, lon: 4.85}) |> Rover.Marker.dump()
      %{id: 1, lat: 45.75, lon: 4.85}
  """
  @spec dump(t()) :: map()
  def dump(%__MODULE__{} = marker) do
    marker
    |> Map.from_struct()
    |> Enum.reject(fn
      {:draggable, false} -> true
      {_key, value} -> is_nil(value)
    end)
    |> Map.new()
  end

  # -- private ---------------------------------------------------------------

  @fields [:lat, :lon | Keyword.keys(@default_mapping)]

  @mapping_example "marker_fields={[lat: :latitude, lon: :longitude, label: :trade_name]}"

  defp validate_mapping!(opts) do
    Rover.Mapping.validate!(opts, @fields, "marker", @mapping_example)
  end

  defp coord_from(source, opts) do
    overrides =
      Map.new([:lat, :lon], fn field -> {field, Keyword.get(opts, field)} end)
      |> Enum.reject(fn {_field, accessor} -> is_nil(accessor) end)
      |> Map.new(fn {field, accessor} -> {field, read(source, accessor)} end)

    case map_size(overrides) do
      0 ->
        Geo.coord!(source)

      2 ->
        Geo.coord!({overrides.lat, overrides.lon})

      # Mapping one axis must not stop the other being read from its usual key:
      # `lat: :latitude` on a `%{latitude: _, lon: _}` should still find `:lon`.
      1 ->
        Geo.coord!(Map.merge(plain(source), overrides))
    end
  end

  defp plain(source) when is_struct(source), do: Map.from_struct(source)
  defp plain(source), do: source

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
    marker is missing an :id — #{inspect(source, limit: 5)}

    Rover uses the id to tell markers apart between renders, so that moving
    one marker does not tear down and rebuild the others.

    Give each marker a stable id, or point Rover at the field that holds it:

        Rover.Marker.new!(client, id: :uuid)
    """
  end

  defp require_id!(id, _source), do: id

  defp to_string_or_nil(nil), do: nil
  defp to_string_or_nil(value) when is_binary(value), do: value
  defp to_string_or_nil(value), do: to_string(value)

  defp to_float_or_nil(value, field \\ :scale)
  defp to_float_or_nil(nil, _field), do: nil
  defp to_float_or_nil(value, _field) when is_number(value), do: value / 1

  defp to_float_or_nil(value, field) do
    raise ArgumentError, "expected a number for marker #{inspect(field)}, got: #{inspect(value)}"
  end

  defp to_opacity_or_nil(nil), do: nil
  defp to_opacity_or_nil(value) when is_number(value) and value >= 0 and value <= 1, do: value / 1

  defp to_opacity_or_nil(value) do
    raise ArgumentError,
          "expected a number from 0 to 1 for marker :opacity, got: #{inspect(value)}"
  end

  # Fractions of the image, both axes, so `[0.5, 1]` is the bottom centre
  # whatever the image's size — the one form that survives a change of icon.
  defp to_anchor_or_nil(nil), do: nil

  defp to_anchor_or_nil([x, y])
       when is_number(x) and is_number(y) and x >= 0 and x <= 1 and y >= 0 and y <= 1 do
    [x / 1, y / 1]
  end

  defp to_anchor_or_nil(value) do
    raise ArgumentError, """
    expected marker :anchor to be [x, y], two fractions from 0 to 1, got: #{inspect(value)}.

    [0.5, 1] is the bottom centre of the image, where a pin's tip is; [0.5, 0.5] its middle.
    """
  end
end
