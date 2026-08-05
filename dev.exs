# Rover's development playground.
#
#     mix dev
#
# Starts a minimal Phoenix endpoint on http://localhost:4020 serving a single
# LiveView that exercises the library. Nothing in here ships in the Hex package.

require Logger
Logger.configure(level: :debug)

assets = Path.expand("assets", __DIR__)

Application.put_env(:rover, RoverDev.Endpoint,
  url: [host: "localhost"],
  http: [ip: {127, 0, 0, 1}, port: 4020],
  adapter: Bandit.PhoenixAdapter,
  server: true,
  secret_key_base: String.duplicate("rover", 13),
  live_view: [signing_salt: "rover-dev-salt"],
  code_reloader: true,
  debug_errors: true,
  check_origin: false,
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

{:ok, _} =
  Supervisor.start_link([RoverDev.Endpoint], strategy: :one_for_one, name: RoverDev.Supervisor)

Logger.info("Rover playground running at http://localhost:4020")
