import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { UrlShapeLayer } from "../js/url_shapes.js"

const url = "https://example.com/parcels.geojson"

// The claim this layer exists for: a document is fetched when it changes, and
// not otherwise. Re-requesting hundreds of kilobytes because a colour moved
// would undo the reason for loading geometry this way at all.
describe("UrlShapeLayer.reconcile", () => {
  it("points the source at the document it was given", () => {
    const layer = new UrlShapeLayer()
    layer.reconcile({ url })

    assert.equal(layer.source.getUrl(), url)
  })

  it("sits under the shapes the server sends", () => {
    // Geometry loaded in bulk is backdrop for the shapes an application manages.
    assert.equal(new UrlShapeLayer().layer.getZIndex(), 4)
  })

  it("carries the rev as a query parameter, so no cache answers the old question", () => {
    const layer = new UrlShapeLayer()
    layer.reconcile({ url, rev: 7 })

    assert.equal(layer.source.getUrl(), `${url}?rev=7`)
  })

  it("keeps a query string the url already had", () => {
    const layer = new UrlShapeLayer()
    layer.reconcile({ url: `${url}?commune=69123`, rev: "a b" })

    assert.equal(layer.source.getUrl(), `${url}?commune=69123&rev=a%20b`)
  })

  it("refetches when the rev changes", () => {
    const layer = new UrlShapeLayer()
    layer.reconcile({ url, rev: 1 })

    let refreshed = 0
    layer.source.refresh = () => refreshed++

    layer.reconcile({ url, rev: 2 })

    assert.equal(refreshed, 1)
    assert.equal(layer.source.getUrl(), `${url}?rev=2`)
  })

  it("restyles without refetching", () => {
    const layer = new UrlShapeLayer()
    layer.reconcile({ url, rev: 1, style: { color: "#111111" } })

    let refreshed = 0
    layer.source.refresh = () => refreshed++

    layer.reconcile({ url, rev: 1, style: { color: "#16a34a" } })

    assert.equal(refreshed, 0, "a colour change re-requested the whole document")
    assert.equal(layer.layer.getStyle().getStroke().getColor(), "#16a34a")
  })

  it("does nothing at all when the spec is unchanged", () => {
    const layer = new UrlShapeLayer()
    layer.reconcile({ url, rev: 1 })

    let refreshed = 0
    layer.source.refresh = () => refreshed++

    layer.reconcile({ url, rev: 1 })

    assert.equal(refreshed, 0)
  })

  it("forgets the document when the source goes away", () => {
    const layer = new UrlShapeLayer()
    layer.reconcile({ url })
    layer.reconcile(null)

    // Not merely emptied: a source still pointing at the document would fetch
    // it again on the next refresh.
    assert.equal(layer.source.getUrl(), undefined)
    assert.equal(layer.source.getFeatures().length, 0)
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
