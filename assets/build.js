import { build, context } from "esbuild"
import { existsSync, mkdirSync } from "node:fs"

const watch = process.argv.includes("--watch")

// The playground bundle imports Phoenix and LiveView out of ../deps, so it can
// only be built once `mix deps.get` has run. CI builds the library bundles
// without an Elixir toolchain, and a fresh clone may reach for `npm run build`
// before fetching deps — in both cases, skip it rather than fail.
const playground =
  existsSync("../deps/phoenix/priv/static/phoenix.mjs") &&
  existsSync("../deps/phoenix_live_view/priv/static/phoenix_live_view.esm.js")

mkdirSync("../priv/static", { recursive: true })
if (playground) mkdirSync("../dev/static", { recursive: true })

const shared = {
  bundle: true,
  format: "esm",
  target: ["es2020"],
  logLevel: "info",
}

const libraryTargets = [
  // The bundle library consumers import. OpenLayers is inlined so that a plain
  // `phx.new` application — which has no npm, no node_modules and no
  // package.json — can use Rover with a single import line.
  {
    ...shared,
    entryPoints: ["js/index.js"],
    outfile: "../priv/static/rover.js",
    sourcemap: false,
  },
  {
    ...shared,
    entryPoints: ["js/index.js"],
    outfile: "../priv/static/rover.min.js",
    minify: true,
  },
  // The same runtime with OpenLayers left as a peer import, for applications
  // that already build with npm and want to own the `ol` version.
  {
    ...shared,
    entryPoints: ["js/index.js"],
    outfile: "../priv/static/rover.external.js",
    external: ["ol", "ol/*"],
  },
  {
    ...shared,
    entryPoints: ["css/rover.css"],
    outfile: "../priv/static/rover.css",
    loader: { ".png": "dataurl", ".svg": "dataurl" },
  },
]

// The dev playground (`mix dev`). Never shipped in the Hex package.
const playgroundTargets = [
  {
    ...shared,
    entryPoints: ["../dev/assets/app.js"],
    outfile: "../dev/static/app.js",
    sourcemap: true,
  },
  {
    ...shared,
    entryPoints: ["../dev/assets/app.css"],
    outfile: "../dev/static/app.css",
  },
]

const targets = playground ? [...libraryTargets, ...playgroundTargets] : libraryTargets

if (!playground) {
  console.log("[rover] ../deps not populated — building the library bundles only.")
}

if (watch) {
  await Promise.all(
    targets.map(async (target) => {
      const ctx = await context(target)
      await ctx.watch()
    })
  )
  console.log("[rover] watching…")
} else {
  await Promise.all(targets.map((target) => build(target)))
}
