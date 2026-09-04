import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"

// Everything else in this suite imports `../js/`, and so do the playground
// (`dev/assets/app.js`) and the Playwright suite behind it. Nothing exercises
// what Hex actually ships. The CI `bundles` job only runs `git diff --quiet --
// priv/static`, which proves the bundles match the source, not that they work:
// a pattern esbuild resolves or minifies differently ships green.
//
// This is the smallest guard that closes that gap. It loads the published
// artefacts the way a consumer does and checks the contract they promise.

// The public API. A change here is a change to the README's install snippet and
// to every consumer's import — it should be deliberate, so it is written out
// rather than derived from the source.
const CONTRACT = [
  "DrawLayer",
  "HeatmapLayer",
  "MarkerLayer",
  "Rover",
  "RoverHooks",
  "RoverMap",
  "ShapeLayer",
  "default",
  "extentToBbox",
  "project",
  "unproject",
]

// The two self-contained builds: OpenLayers is inside, so they load from
// anywhere, which is the whole point of the no-npm install path.
const SELF_CONTAINED = ["rover.js", "rover.min.js"]

// Loaded through a data: URL rather than by path, which forces ESM outright.
// Importing priv/static by path makes Node look for the nearest ancestor
// package.json to decide the module type — and there is none inside the repo,
// so it walks out of it. Here that lands on a file in $HOME; on a contributor
// whose home or monorepo root declares `"type": "commonjs"` it would fail with
// `Cannot use import statement outside a module`, in a suite unrelated to
// whatever they were changing. A consumer never meets this — esbuild and Vite
// decide format from the import site, not from a package.json above the file.
const load = (name) => {
  const source = readFileSync(new URL(`../../priv/static/${name}`, import.meta.url))
  return import(`data:text/javascript;base64,${source.toString("base64")}`)
}

for (const name of SELF_CONTAINED) {
  describe(`priv/static/${name}`, () => {
    it("exports exactly the documented surface", async () => {
      const bundle = await load(name)

      assert.deepEqual(Object.keys(bundle).sort(), CONTRACT)
    })

    it("carries a hook with the LiveView callbacks", async () => {
      const { Rover, RoverHooks, default: fallback } = await load(name)

      // Minification renames locals, never object keys — but LiveView looks
      // `mounted` and friends up by name, so a build that mangled them would
      // fail in a consumer's app and nowhere else.
      for (const callback of ["mounted", "updated", "destroyed"]) {
        assert.equal(typeof Rover[callback], "function", `Rover.${callback}`)
      }

      assert.equal(RoverHooks.Rover, Rover)
      assert.equal(fallback.Rover, Rover)
    })

    it("exports coordinate helpers that actually run", async () => {
      const { project, unproject } = await load(name)

      // Round-tripping Lyon proves the module initialised: `project` reaches
      // into OpenLayers' projection registry, which an under-bundled build
      // would leave empty.
      assert.deepEqual(unproject(project(45.75, 4.85)), { lat: 45.75, lon: 4.85 })
    })
  })
}

// rover.external.js leaves `ol` as a peer import, so Node would resolve those
// specifiers from priv/static/ — where there is no node_modules and never will
// be. It is checked as text instead: the export surface, and the fact that the
// peer imports really did stay peer imports.
describe("priv/static/rover.external.js", () => {
  const source = readFileSync(new URL("../../priv/static/rover.external.js", import.meta.url), "utf8")

  it("exports exactly the documented surface", () => {
    const block = source.match(/export \{([^}]*)\};?\s*$/)
    assert.ok(block, "no trailing export block")

    const names = block[1]
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => (entry.includes(" as ") ? entry.split(" as ")[1].trim() : entry))

    assert.deepEqual(names.sort(), CONTRACT)
  })

  it("leaves OpenLayers as a peer import", () => {
    const specifiers = [...source.matchAll(/from "(ol(?:\/[^"]*)?)"/g)].map((match) => match[1])

    // If esbuild ever stopped honouring `external: ["ol", "ol/*"]`, this build
    // would silently become a second copy of the bundled one — same bytes as
    // rover.js, roughly 5x the size it advertises even with ol-mapbox-style's
    // own dependencies (chiefly the MapLibre style spec) bundled in here too.
    assert.ok(specifiers.length > 0, "no bare ol imports survived")
    assert.ok(
      source.length < 450_000,
      `external build is ${source.length} bytes — OpenLayers looks inlined`,
    )
  })
})
