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
  | `:icon` | string | URL of an image to use instead of the default pin. |
  | `:scale` | float | Size multiplier applied to the pin or icon. |
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
          icon: String.t() | nil,
          scale: float() | nil,
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
    :icon,
    :scale,
    :tooltip,
    :data,
    draggable: false
  ]

  @default_mapping [
    id: [:id, "id"],
    label: [:label, :name, :title, "label", "name", "title"],
    color: [:color, "color"],
    icon: [:icon, "icon"],
    scale: [:scale, "scale"],
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
    {lat, lon} = coord_from(source, opts)

    %__MODULE__{
      id: require_id!(extract(source, :id, opts), source),
      lat: lat,
      lon: lon,
      label: source |> extract(:label, opts) |> to_string_or_nil(),
      color: source |> extract(:color, opts) |> to_string_or_nil(),
      icon: source |> extract(:icon, opts) |> to_string_or_nil(),
      scale: source |> extract(:scale, opts) |> to_float_or_nil(),
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

  defp to_float_or_nil(nil), do: nil
  defp to_float_or_nil(value) when is_number(value), do: value / 1

  defp to_float_or_nil(value) do
    raise ArgumentError, "expected a number for marker :scale, got: #{inspect(value)}"
  end
end
