import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { OverlayLayers } from "../js/overlays.js"

const raster = (url) => ({ type: "raster", url, maxZoom: 19 })
const layerAt = (overlays, index) => overlays.layer.getLayers().item(index)

// The same claim `markers.test.js` and `shapes.test.js` make, for the layer that
// costs the most to get wrong: reconcile is not "clear and rebuild". A rebuilt
// tile layer re-requests every tile it had, so a map that toggles one overlay
// would blink the others.
describe("OverlayLayers.reconcile", () => {
  it("adds the layers it is given, in the order they were given", () => {
    const overlays = new OverlayLayers()
    overlays.reconcile([{ tiles: raster("https://a/{z}/{x}/{y}.png") }, { tiles: raster("https://b/{z}/{x}/{y}.png") }])

    assert.equal(overlays.layer.getLayers().getLength(), 2)
    assert.deepEqual(
      overlays.entries.map((entry) => entry.layer.getSource().getUrls()),
      [["https://a/{z}/{x}/{y}.png"], ["https://b/{z}/{x}/{y}.png"]]
    )
  })

  it("sits between the basemap and the heatmap", () => {
    // Overlays build a basemap up; they never cover the caller's own data.
    assert.equal(new OverlayLayers().layer.getZIndex(), 1)
  })

  it("changes an option without rebuilding the layer", () => {
    const overlays = new OverlayLayers()
    const tiles = raster("https://a/{z}/{x}/{y}.png")
    overlays.reconcile([{ id: "ortho", tiles }])

    const before = layerAt(overlays, 0)
    overlays.reconcile([{ id: "ortho", tiles, opacity: 0.5, visible: false }])

    assert.equal(layerAt(overlays, 0), before, "changing an option re-requested every tile")
    assert.equal(before.getOpacity(), 0.5)
    assert.equal(before.getVisible(), false)
  })

  it("puts an option back to its default when it is dropped from the list", () => {
    const overlays = new OverlayLayers()
    const tiles = raster("https://a/{z}/{x}/{y}.png")
    overlays.reconcile([{ id: "ortho", tiles, opacity: 0.5 }])
    overlays.reconcile([{ id: "ortho", tiles }])

    assert.equal(layerAt(overlays, 0).getOpacity(), 1)
  })

  it("rebuilds a layer whose tiles changed", () => {
    const overlays = new OverlayLayers()
    overlays.reconcile([{ id: "ortho", tiles: raster("https://a/{z}/{x}/{y}.png") }])

    const before = layerAt(overlays, 0)
    overlays.reconcile([{ id: "ortho", tiles: raster("https://b/{z}/{x}/{y}.png") }])

    assert.notEqual(layerAt(overlays, 0), before, "the new url was never fetched")
    assert.deepEqual(layerAt(overlays, 0).getSource().getUrls(), ["https://b/{z}/{x}/{y}.png"])
  })

  it("keeps an identified layer across a reordering", () => {
    const overlays = new OverlayLayers()
    const ortho = { id: "ortho", tiles: raster("https://a/{z}/{x}/{y}.png") }
    const cadastre = { id: "cadastre", tiles: raster("https://b/{z}/{x}/{y}.png") }

    overlays.reconcile([ortho, cadastre])
    const before = layerAt(overlays, 0)

    overlays.reconcile([cadastre, ortho])

    assert.equal(layerAt(overlays, 1), before, "reordering rebuilt an identified layer")
  })

  it("treats position as the identity when no id was given", () => {
    // Two entries of the same tiles are otherwise indistinguishable, so position
    // is the honest answer rather than a guess.
    const overlays = new OverlayLayers()
    const a = { tiles: raster("https://a/{z}/{x}/{y}.png") }
    const b = { tiles: raster("https://b/{z}/{x}/{y}.png") }

    overlays.reconcile([a, b])
    const first = layerAt(overlays, 0)

    overlays.reconcile([b, a])

    assert.notEqual(layerAt(overlays, 0), first)
    assert.deepEqual(layerAt(overlays, 0).getSource().getUrls(), ["https://b/{z}/{x}/{y}.png"])
  })

  it("drops a layer that left the list", () => {
    const overlays = new OverlayLayers()
    overlays.reconcile([{ id: "ortho", tiles: raster("https://a/{z}/{x}/{y}.png") }])
    overlays.reconcile([])

    assert.equal(overlays.layer.getLayers().getLength(), 0)
    assert.deepEqual(overlays.entries, [])
  })

  it("treats a null list as no overlays at all", () => {
    // The attribute is absent rather than an empty array on a map without any.
    const overlays = new OverlayLayers()
    overlays.reconcile(null)

    assert.equal(overlays.layer.getLayers().getLength(), 0)
  })

  it("drops the zoom floor half a level, so the level named is drawn", () => {
    // OpenLayers draws a layer where `zoom > minZoom`, excluding the level it
    // names, while the map's own `min_zoom` includes it. One attribute name
    // meaning two things on one component is not worth shipping.
    const overlays = new OverlayLayers()
    overlays.reconcile([{ tiles: raster("https://a/{z}/{x}/{y}.png"), minZoom: 12, maxZoom: 18 }])

    const layer = layerAt(overlays, 0)

    assert.equal(layer.getMinZoom(), 11.5)
    // The ceiling is inclusive in OpenLayers already, so it passes through.
    assert.equal(layer.getMaxZoom(), 18)
  })

  it("never hands one layer to two configs sharing an id", () => {
    // Rejected server-side, but this class is reachable from JavaScript too, and
    // one layer pushed into the collection twice is rendered twice per frame.
    // The same tiles as well as the same id, which is the case that bites: with
    // different tiles the second config rebuilds anyway and never claims the
    // layer the first is already keeping.
    const overlays = new OverlayLayers()
    const config = { id: "same", tiles: raster("https://a/{z}/{x}/{y}.png") }

    overlays.reconcile([config, config])
    overlays.reconcile([config, config])

    const layers = overlays.layer.getLayers().getArray()

    assert.equal(layers.length, 2)
    assert.notEqual(layers[0], layers[1], "the same layer was added twice")
  })

  // A vector overlay is not asserted here. It goes through the same
  // `buildTileLayer` as a vector basemap — whose construction `tiles.test.js`
  // covers — and the half that is not construction is `ol-mapbox-style`'s
  // `apply()`, which wants a document and a style fetch. That belongs in the
  // browser suite, where the vector basemap is already exercised end to end.
})
