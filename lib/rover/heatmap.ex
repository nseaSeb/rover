defmodule Rover.Heatmap do
  @moduledoc """
  Density, as a heat field rather than as pins.

  Where five hundred markers are a wall of overlapping icons, a heatmap answers a
  different question: *where is there a lot of this?* Deliveries per neighbourhood,
  clients per area, incidents over a season.

      <.map id="deliveries" heatmap={@deliveries} />

  A point needs only a coordinate:

      %{lat: 45.75, lon: 4.85}
      %{lat: 45.75, lon: 4.85, weight: 0.4}

  ## No identity, and why

  `Rover.Marker` and `Rover.Shape` both insist on a stable `:id`, because both are
  reconciled one feature at a time. A heatmap is not: it is an aggregate, and no
  individual point is visible in the result. Requiring an id for every row of a
  density query would be ceremony that buys nothing.

  So heatmaps are diffed the way shapes are — by a revision computed once per
  render on the server. Same list, same `rev`, no work on the client. A changed
  list rebuilds the field, which is what changing a density field means anyway.

  ## Weights

  `:weight` is **relative, from 0 to 1**, and defaults to `1`. OpenLayers saturates
  anything above 1, so raw counts do not work as-is — divide by your maximum:

      max = Enum.max_by(rows, & &1.orders).orders

      <.map
        id="deliveries"
        heatmap={rows}
        heatmap_fields={[weight: fn row -> row.orders / max end]}
      />
  """

  alias Rover.Geo

  @type point :: %{lat: float(), lon: float(), weight: float()}

  @default_mapping [
    weight: [:weight, "weight"]
  ]

  @doc """
  Normalises a list of points. Nil entries, and entries without a usable
  coordinate, are dropped.

  Unlike markers, an unusable point is skipped rather than raised on: a density
  query returning one row with a null coordinate should thin the map, not take the
  page down.

  ## Examples

      iex> Rover.Heatmap.new_all!([%{lat: 45.75, lon: 4.85}])
      [%{lat: 45.75, lon: 4.85, weight: 1.0}]

      iex> Rover.Heatmap.new_all!([%{lat: 45.75, lon: 4.85, weight: 0.25}])
      [%{lat: 45.75, lon: 4.85, weight: 0.25}]

      iex> Rover.Heatmap.new_all!([%{lat: nil, lon: nil}, %{lat: 45.75, lon: 4.85}])
      [%{lat: 45.75, lon: 4.85, weight: 1.0}]
  """
  @spec new_all!(Enumerable.t(), keyword()) :: [point()]
  def new_all!(points, opts \\ []) do
    points
    |> Enum.reject(&is_nil/1)
    |> Enum.flat_map(&normalise(&1, opts))
  end

  @doc """
  The revision of a normalised point list: what the client compares to decide
  whether to rebuild the field.

  ## Examples

      iex> points = Rover.Heatmap.new_all!([%{lat: 45.75, lon: 4.85}])
      iex> Rover.Heatmap.rev(points) == Rover.Heatmap.rev(points)
      true
  """
  @spec rev([point()]) :: integer()
  def rev(points), do: :erlang.phash2(points)

  @doc """
  Normalises the style options into the map the JavaScript runtime reads.

  ## Options

    * `:radius` — point radius in pixels. Defaults to `8`.
    * `:blur` — blur radius in pixels. Defaults to `15`.
    * `:opacity` — layer opacity, 0 to 1. Defaults to `1`.
    * `:gradient` — a list of CSS colours, cold to hot. Defaults to OpenLayers'.

  ## Examples

      iex> Rover.Heatmap.style!([])
      %{radius: 8, blur: 15, opacity: 1}

      iex> Rover.Heatmap.style!(radius: 12, gradient: ["#fff", "#f00"])
      %{radius: 12, blur: 15, opacity: 1, gradient: ["#fff", "#f00"]}
  """
  @spec style!(keyword()) :: map()
  def style!(opts) when is_list(opts) do
    Enum.each(opts, fn {key, _value} ->
      key in [:radius, :blur, :opacity, :gradient] ||
        raise ArgumentError, """
        unknown heatmap style option #{inspect(key)}.

        Expected any of: :radius, :blur, :opacity, :gradient.
        """
    end)

    %{
      radius: Keyword.get(opts, :radius, 8),
      blur: Keyword.get(opts, :blur, 15),
      opacity: Keyword.get(opts, :opacity, 1),
      gradient: Keyword.get(opts, :gradient)
    }
    |> Enum.reject(fn {_key, value} -> is_nil(value) end)
    |> Map.new()
  end

  def style!(other) do
    raise ArgumentError, "expected `heatmap_style` to be a keyword list, got: #{inspect(other)}"
  end

  # -- private ---------------------------------------------------------------

  defp normalise(source, opts) when is_map(source) do
    case Geo.coord(source) do
      {:ok, {lat, lon}} -> [%{lat: lat, lon: lon, weight: weight(source, opts)}]
      :error -> []
    end
  end

  defp normalise(_other, _opts), do: []

  defp weight(source, opts) do
    case read_weight(source, opts) do
      nil ->
        1.0

      value when is_number(value) ->
        value / 1

      other ->
        raise ArgumentError, "expected a number for heatmap :weight, got: #{inspect(other)}"
    end
  end

  defp read_weight(source, opts) do
    case Keyword.fetch(opts, :weight) do
      {:ok, fun} when is_function(fun, 1) ->
        fun.(source)

      # See the note in Rover.Marker: a capture of the wrong arity is an easy
      # mistake to make and used to be swallowed into the default weight.
      {:ok, fun} when is_function(fun) ->
        raise ArgumentError, """
        heatmap :weight accessor must be a 1-arity function, got one of arity \
        #{:erlang.fun_info(fun)[:arity]}.

        If you wrote a capture containing a division, use fn instead:

            fn row -> row.orders / 40 end
        """

      {:ok, key} ->
        Map.get(source, key)

      :error ->
        Enum.find_value(@default_mapping[:weight], &Map.get(source, &1))
    end
  end
end
