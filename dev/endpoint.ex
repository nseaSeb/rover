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

  # `plug Phoenix.LiveReloader` injects the client script, but the socket it
  # connects to has to be declared separately. Without this the browser retried a
  # 404 forever and live reload silently never worked: the esbuild watcher rebuilt
  # the bundle and the page never noticed. The browser suite found it on its first
  # run, by refusing to tolerate console errors.
  socket "/phoenix/live_reload/socket", Phoenix.LiveReloader.Socket

  plug Plug.Static,
    at: "/assets",
    from: Path.expand("static", __DIR__),
    gzip: false

  plug Phoenix.LiveReloader
  plug Phoenix.CodeReloader

  plug Plug.Session, @session_options
  plug RoverDev.Router
end
