import assert from "node:assert/strict"
import { beforeEach, describe, it } from "node:test"

import { UrlShapeLayer } from "../js/url_shapes.js"

const url = "https://example.com/parcels.geojson"

const collection = (...ids) => ({
  type: "FeatureCollection",
  features: ids.map((id) => ({
    type: "Feature",
    id,
    properties: { name: `field ${id}` },
    geometry: { type: "Point", coordinates: [4.85, 45.75] },
  })),
})

// Everything the loader queues after a response lands: a `text()` of its own,
// then the `.then` that adds the features. Resolving a microtask twice does not
// reach the end of that chain, and a test that stops short of it reads as a
// feature that never loaded.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

/**
 * A stand-in for the network that hands back control of when each response
 * lands — which is the only way to write down what should happen when two are
 * in flight at once.
 */
function stubFetch() {
  const calls = []

  globalThis.fetch = (requested) => {
    let settle

    const promise = new Promise((resolve) => {
      settle = resolve
    })

    calls.push({
      url: requested,
      respond: (body, ok = true) =>
        settle({ ok, status: ok ? 200 : 404, statusText: "", text: async () => JSON.stringify(body) }),
    })

    return promise
  }

  return calls
}

describe("UrlShapeLayer.reconcile", () => {
  let calls

  beforeEach(() => {
    calls = stubFetch()
  })

  it("fetches the document it was given", async () => {
    const layer = new UrlShapeLayer()
    layer.reconcile({ url })

    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, url)

    calls[0].respond(collection("F-01", "F-02"))
    await flush()

    assert.equal(layer.source.getFeatures().length, 2)
  })

  it("sits under the shapes the server sends", () => {
    // Geometry loaded in bulk is backdrop for the shapes an application manages.
    assert.equal(new UrlShapeLayer().layer.getZIndex(), 4)
  })

  it("carries the rev as a query parameter, so no cache answers the old question", () => {
    new UrlShapeLayer().reconcile({ url, rev: 7 })

    assert.equal(calls[0].url, `${url}?rev=7`)
  })

  it("keeps a query string the url already had", () => {
    new UrlShapeLayer().reconcile({ url: `${url}?commune=69123`, rev: "a b" })

    assert.equal(calls[0].url, `${url}?commune=69123&rev=a%20b`)
  })

  it("refetches when the rev changes", () => {
    const layer = new UrlShapeLayer()
    layer.reconcile({ url, rev: 1 })
    layer.reconcile({ url, rev: 2 })

    assert.deepEqual(
      calls.map((call) => call.url),
      [`${url}?rev=1`, `${url}?rev=2`]
    )
  })

  it("restyles without refetching", () => {
    const layer = new UrlShapeLayer()
    layer.reconcile({ url, rev: 1, style: { color: "#111111" } })
    layer.reconcile({ url, rev: 1, style: { color: "#16a34a" } })

    assert.equal(calls.length, 1, "a colour change re-requested the whole document")
    assert.equal(layer.layer.getStyle().getStroke().getColor(), "#16a34a")
  })

  it("does nothing at all when the spec is unchanged", () => {
    const layer = new UrlShapeLayer()
    layer.reconcile({ url, rev: 1 })
    layer.reconcile({ url, rev: 1 })

    assert.equal(calls.length, 1)
  })

  // The regression this class keeps a request counter for. A rev bumped while a
  // large document is still arriving leaves two responses racing, and
  // OpenLayers indexes features by id: a stale response landing first takes the
  // ids, and the fresh features are then dropped as duplicates — the old
  // document left on the map, under the new url, until somebody bumps again.
  it("ignores a stale response that lands after a newer request went out", async () => {
    const layer = new UrlShapeLayer()
    layer.reconcile({ url, rev: 1 })
    layer.reconcile({ url, rev: 2 })

    calls[1].respond(collection("fresh"))
    await flush()

    calls[0].respond(collection("stale"))
    await flush()

    assert.deepEqual(
      layer.source.getFeatures().map((feature) => feature.getId()),
      ["fresh"]
    )
  })

  it("ignores a response to a document nobody is asking for any more", async () => {
    const layer = new UrlShapeLayer()
    layer.reconcile({ url })
    layer.reconcile(null)

    calls[0].respond(collection("F-01"))
    await flush()

    assert.equal(layer.source.getFeatures().length, 0)
  })

  it("says which document failed, rather than leaving an empty layer to explain itself", async () => {
    const errors = []
    const original = console.error
    console.error = (...args) => errors.push(args.join(" "))

    try {
      new UrlShapeLayer().reconcile({ url })
      calls[0].respond({}, false)
      await flush()
    } finally {
      console.error = original
    }

    assert.match(errors.join("\n"), /could not load https:\/\/example\.com\/parcels\.geojson/)
  })

  it("calls back only for a load that landed, so a caller can frame it", async () => {
    let loads = 0
    const layer = new UrlShapeLayer({ onLoad: () => loads++ })
    layer.reconcile({ url })

    calls[0].respond(collection("F-01"))
    await flush()

    assert.equal(loads, 1)
  })

  it("has no extent until something has loaded", () => {
    const layer = new UrlShapeLayer()
    layer.reconcile({ url })

    assert.equal(layer.extent, null)
  })
})

describe("UrlShapeLayer.shapeFor", () => {
  const featureLike = (id, properties) => ({
    getId: () => id,
    getProperties: () => ({ geometry: {}, ...properties }),
  })

  it("reports the id and properties the file declares", () => {
    const shape = new UrlShapeLayer().shapeFor(featureLike("AB214", { section: "AB" }))

    assert.deepEqual(shape, { id: "AB214", data: { section: "AB" } })
  })

  it("reports nothing rather than undefined for a file that declares neither", () => {
    // GeoJSON is under no obligation to carry an id, and `undefined` reaching
    // the server is worse than null.
    const shape = new UrlShapeLayer().shapeFor(featureLike(undefined, {}))

    assert.deepEqual(shape, { id: null, data: null })
  })

  it("is null for no feature at all, so a miss reads like every other miss", () => {
    assert.equal(new UrlShapeLayer().shapeFor(null), null)
  })
})
