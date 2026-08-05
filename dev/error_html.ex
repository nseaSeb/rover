defmodule RoverDev.ErrorHTML do
  @moduledoc """
  Renders error pages for the playground.

  Without this, Phoenix falls back to a `RoverDev.ErrorView` that does not exist,
  and any 404 — the browser asking for `/favicon.ico` is enough — raises an
  `ArgumentError` in the error handler instead of returning a status page.
  """

  def render(template, _assigns) do
    Phoenix.Controller.status_message_from_template(template)
  end
end
