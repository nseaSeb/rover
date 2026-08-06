# Rover's development playground.
#
#     mix dev
#
# Starts a minimal Phoenix endpoint on http://localhost:4020 serving a single
# LiveView that exercises the library. Nothing in here ships in the Hex package.

require Logger
Logger.configure(level: :debug)

assets = Path.expand("assets", __DIR__)

# `PORT=4021 mix dev` when 4020 is taken — by a stale playground, or a second one
# you want to run alongside.
port = String.to_integer(System.get_env("PORT") || "4020")

Application.put_env(:rover, RoverDev.Endpoint,
  url: [host: "localhost"],
  http: [ip: {127, 0, 0, 1}, port: port],
  adapter: Bandit.PhoenixAdapter,
  server: true,
  secret_key_base: String.duplicate("rover", 13),
  live_view: [signing_salt: "rover-dev-salt"],
  code_reloader: true,
  pubsub_server: RoverDev.PubSub,
  debug_errors: true,
  check_origin: false,
  render_errors: [formats: [html: RoverDev.ErrorHTML], layout: false],
  watchers: [
    node: ["build.js", "--watch", cd: assets]
  ],
  live_reload: [
    patterns: [
      ~r"dev/static/.*(js|css)$",
      ~r"dev/.*\.ex$",
      ~r"lib/rover/.*\.ex$"
    ]
  ]
)

# The live-reload channel needs PubSub. Without it every reload attempt raised
# inside the channel — invisible until the browser suite refused to tolerate it.
{:ok, _} =
  Supervisor.start_link(
    [{Phoenix.PubSub, name: RoverDev.PubSub}, RoverDev.Endpoint],
    strategy: :one_for_one,
    name: RoverDev.Supervisor
  )

Logger.info("Rover playground running at http://localhost:#{port}")

# `Supervisor.start_link/2` links to the process that calls it — here, the one
# evaluating this script. Let that process finish and the link takes the endpoint
# down with it: `--no-halt` keeps the VM alive, so you get a server that logs
# "Running ... at 127.0.0.1:4020" and then refuses every connection. Sleeping
# keeps the owning process, and therefore the endpoint, alive.
Process.sleep(:infinity)
