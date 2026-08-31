defmodule Rover.MixProject do
  use Mix.Project

  @version "0.4.0"
  @source_url "https://github.com/nseaSeb/rover"

  def project do
    [
      app: :rover,
      version: @version,
      elixir: "~> 1.15",
      elixirc_paths: elixirc_paths(Mix.env()),
      start_permanent: Mix.env() == :prod,
      # Required by Phoenix.CodeReloader in the `mix dev` playground; ignored when
      # Rover is built as somebody else's dependency.
      listeners: [Phoenix.CodeReloader],
      deps: deps(),
      aliases: aliases(),
      dialyzer: dialyzer(),
      test_coverage: test_coverage(),
      description: description(),
      package: package(),
      docs: docs(),
      name: "Rover",
      source_url: @source_url
    ]
  end

  def application do
    [extra_applications: [:logger]]
  end

  def cli do
    [preferred_envs: [precommit: :test]]
  end

  defp elixirc_paths(:dev), do: ["lib", "dev"]
  defp elixirc_paths(:test), do: ["lib", "test/support"]
  defp elixirc_paths(_), do: ["lib"]

  defp deps do
    [
      # phoenix_live_view already requires phoenix, so listing it here costs
      # consumers nothing; the dev playground needs it to build an endpoint.
      {:phoenix_live_view, "~> 1.0"},
      {:phoenix, "~> 1.7"},
      {:jason, "~> 1.4"},

      # Dev playground only — never pulled by library consumers.
      {:bandit, "~> 1.5", only: :dev},
      {:phoenix_live_reload, "~> 1.5", only: :dev},

      # Dev / test tooling.
      {:lazy_html, ">= 0.1.0", only: :test},
      {:ex_doc, "~> 0.34", only: :dev, runtime: false},
      {:dialyxir, "~> 1.4", only: [:dev, :test], runtime: false}
    ]
  end

  # The library is annotated end to end with `@spec`; without this, nothing ever
  # checks those annotations against the code. The PLT lives under `_build` so the
  # directory CI already caches carries it too, and so `mix clean` never touches it.
  defp dialyzer do
    [
      plt_local_path: "_build/plts",
      plt_core_path: "_build/plts",
      plt_add_apps: [:ex_unit, :mix],
      # `:missing_return` and `:extra_return` are what catch a `@spec` that has
      # drifted from its function, which is the whole reason for running this.
      flags: [:error_handling, :extra_return, :missing_return, :unknown, :unmatched_returns]
    ]
  end

  # `mix test --cover` fails the run below the threshold, so the number is a floor
  # to ratchet upwards, not a target. Raise it when a release lands above it;
  # never lower it to make a red run green.
  #
  # `test/support` is on the :test elixirc_paths, so its helpers land in the total
  # unless excluded — and a helper is always fully exercised, which would let new
  # test scaffolding raise the number without covering a line of the library.
  defp test_coverage do
    [summary: [threshold: 94], ignore_modules: [Rover.MapCase]]
  end

  defp aliases do
    [
      dev: ["cmd npm --prefix assets install --no-audit --no-fund", "run --no-halt dev.exs"],
      "assets.build": ["cmd npm --prefix assets install", "cmd npm --prefix assets run build"],
      "assets.test": "cmd npm --prefix assets test",
      # Boots `mix dev` through Playwright's webServer and drives a real browser.
      # Deliberately out of `precommit`: too slow for every commit, its place is CI.
      "assets.test.browser": "cmd npm --prefix assets run test:browser",
      precommit: [
        "format",
        "compile --warnings-as-errors",
        "test",
        # Build before testing: `assets/test/bundles.test.js` loads the files in
        # priv/static, so running it first would check the bundles from the last
        # run and let the ones about to be committed through untested.
        "assets.build",
        "assets.test"
      ]
    ]
  end

  defp description do
    "Interactive maps for Phoenix LiveView, powered by OpenLayers. " <>
      "Assign a list of markers, get a live map — no OpenLayers knowledge required."
  end

  defp package do
    [
      licenses: ["MIT"],
      links: %{
        "GitHub" => @source_url,
        "Changelog" => "#{@source_url}/blob/main/CHANGELOG.md",
        "OpenLayers" => "https://openlayers.org/"
      },
      files:
        ~w(lib priv/static assets/js notebooks mix.exs .formatter.exs README.md CHANGELOG.md LICENSE NOTICE.md)
    ]
  end

  defp docs do
    [
      main: "readme",
      source_ref: "v#{@version}",
      extras: [
        "README.md",
        # An explicit filename: the default would be `rover.html`, which collides
        # with the `Rover` module page on any case-insensitive filesystem — and
        # `mix hex.publish` builds the docs locally, so that includes macOS.
        {"notebooks/rover.livemd", [filename: "playground", title: "Playground"]},
        "CHANGELOG.md",
        "NOTICE.md",
        "LICENSE"
      ],
      # `mix docs` runs in :dev, which compiles the playground under dev/. Without
      # this, RoverDev.DemoLive and friends end up in the published API reference.
      filter_modules: ~r/^Elixir\.Rover(\.|$)/,
      groups_for_modules: [
        Components: [Rover.Components],
        Data: [Rover.Marker, Rover.Shape, Rover.Heatmap, Rover.Geo, Rover.Tiles]
      ]
    ]
  end
end
