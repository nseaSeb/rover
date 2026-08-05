defmodule RoverDev.Endpoint do
  @moduledoc false
  use Phoenix.Endpoint, otp_app: :rover

  @session_options [
    store: :cookie,
    key: "_rover_dev_key",
    signing_salt: "rover-dev-salt",
    same_site: "Lax"
  ]

  socket "/live", Phoenix.LiveView.Socket, websocket: [connect_info: [session: @session_options]]

  plug Plug.Static,
    at: "/assets",
    from: Path.expand("static", __DIR__),
    gzip: false

  plug Phoenix.LiveReloader
  plug Phoenix.CodeReloader

  plug Plug.Session, @session_options
  plug RoverDev.Router
end
