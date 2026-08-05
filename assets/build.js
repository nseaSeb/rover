import { build, context } from "esbuild"
import { mkdirSync } from "node:fs"

const watch = process.argv.includes("--watch")

mkdirSync("../priv/static", { recursive: true })
mkdirSync("../dev/static", { recursive: true })

const shared = {
  bundle: true,
  format: "esm",
  target: ["es2020"],
  logLevel: "info",
}

const targets = [
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
  // The dev playground (`mix dev`). Never shipped in the Hex package.
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
