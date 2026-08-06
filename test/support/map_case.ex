defmodule Rover.MapCase do
  @moduledoc false

  use ExUnit.CaseTemplate

  import Phoenix.LiveViewTest, only: [render_component: 2]

  using do
    quote do
      import Phoenix.LiveViewTest, only: [render_component: 2]
      import Rover.MapCase
    end
  end

  @doc """
  Renders `<.map>` with `assigns` and returns the parsed document.
  """
  def render_map(assigns) do
    component = &Rover.Components.map/1
    assigns = Keyword.put_new(assigns, :id, "map")

    component
    |> render_component(assigns)
    |> LazyHTML.from_fragment()
  end

  @doc """
  The decoded `data-rover` configuration of a rendered map.
  """
  def config(document), do: decode(document, "data-rover")

  @doc """
  The decoded `data-rover-markers` list of a rendered map.
  """
  def markers(document), do: decode(document, "data-rover-markers")

  @doc """
  The decoded `data-rover-shapes` list of a rendered map.
  """
  def shapes(document), do: decode(document, "data-rover-shapes")

  @doc """
  The decoded `data-rover-heatmap` payload, or nil when the attribute is absent.
  """
  def heatmap(document) do
    case attribute(document, "data-rover-heatmap") do
      nil -> nil
      json -> Jason.decode!(json)
    end
  end

  @doc """
  The popup nodes of a rendered map, in document order.
  """
  def popups(document) do
    document
    |> LazyHTML.query("[data-rover-popup-for]")
    |> LazyHTML.attribute("data-rover-popup-for")
  end

  @doc """
  The raw value of an attribute on the map container.
  """
  def attribute(document, name) do
    document
    |> LazyHTML.query("[phx-hook='Rover']")
    |> LazyHTML.attribute(name)
    |> List.first()
  end

  defp decode(document, name) do
    document |> attribute(name) |> Jason.decode!()
  end
end
