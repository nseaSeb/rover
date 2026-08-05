import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { MarkerLayer } from "../js/markers.js"
import { unproject } from "../js/coords.js"

const at = (id, lat, lon, rest = {}) => ({ id, lat, lon, ...rest })

// These tests exist for one claim: `reconcile` is not "clear and redraw". If it
// ever becomes that, every assertion below about object identity fails.
describe("MarkerLayer.reconcile", () => {
  it("adds the markers it is given", () => {
    const layer = new MarkerLayer()
    layer.reconcile([at(1, 45.75, 4.85), at(2, 48.85, 2.35)])

    assert.equal(layer.source.getFeatures().length, 2)
    assert.deepEqual(
      layer.source.getFeatures().map((f) => f.getId()),
      ["1", "2"]
    )
  })

  it("places markers at the coordinate they were given, lat first", () => {
    const layer = new MarkerLayer()
    layer.reconcile([at(1, 45.75, 4.85)])

    const { lat, lon } = unproject(feature(layer, 1).getGeometry().getCoordinates())

    assert.ok(Math.abs(lat - 45.75) < 1e-6, `latitude was ${lat}`)
    assert.ok(Math.abs(lon - 4.85) < 1e-6, `longitude was ${lon}`)
  })

  it("keeps the very same feature object across an unrelated update", () => {
    const layer = new MarkerLayer()
    layer.reconcile([at(1, 45.75, 4.85), at(2, 48.85, 2.35)])

    const untouched = feature(layer, 2)
    const untouchedGeometry = untouched.getGeometry()

    layer.reconcile([at(1, 45.76, 4.86), at(2, 48.85, 2.35)])

    assert.equal(feature(layer, 2), untouched, "an unrelated marker was rebuilt")
    assert.equal(feature(layer, 2).getGeometry(), untouchedGeometry)
  })

  it("moves a marker without replacing its feature or its style", () => {
    const layer = new MarkerLayer()
    layer.reconcile([at(1, 45.75, 4.85, { label: "Atelier" })])

    const before = feature(layer, 1)
    const styleBefore = before.getStyle()

    layer.reconcile([at(1, 46.0, 5.0, { label: "Atelier" })])

    assert.equal(feature(layer, 1), before, "moving rebuilt the feature")
    assert.equal(feature(layer, 1).getStyle(), styleBefore, "moving rebuilt the style")

    const { lat } = unproject(feature(layer, 1).getGeometry().getCoordinates())
    assert.ok(Math.abs(lat - 46.0) < 1e-6)
  })

  it("restyles a marker without touching its geometry", () => {
    const layer = new MarkerLayer()
    layer.reconcile([at(1, 45.75, 4.85, { color: "#e11d48" })])

    const geometry = feature(layer, 1).getGeometry()
    const styleBefore = feature(layer, 1).getStyle()

    layer.reconcile([at(1, 45.75, 4.85, { color: "#0ea5e9" })])

    assert.equal(feature(layer, 1).getGeometry(), geometry, "restyling rebuilt the geometry")
    assert.notEqual(feature(layer, 1).getStyle(), styleBefore, "the new colour was not applied")
  })

  it("does nothing at all when the list is identical", () => {
    const layer = new MarkerLayer()
    const markers = [at(1, 45.75, 4.85, { label: "Atelier" }), at(2, 48.85, 2.35)]

    layer.reconcile(markers)
    const geometries = [feature(layer, 1).getGeometry(), feature(layer, 2).getGeometry()]
    const styles = [feature(layer, 1).getStyle(), feature(layer, 2).getStyle()]

    layer.reconcile(markers.map((m) => ({ ...m })))

    assert.equal(feature(layer, 1).getGeometry(), geometries[0])
    assert.equal(feature(layer, 2).getGeometry(), geometries[1])
    assert.equal(feature(layer, 1).getStyle(), styles[0])
    assert.equal(feature(layer, 2).getStyle(), styles[1])
  })

  it("removes markers that are gone, and only those", () => {
    const layer = new MarkerLayer()
    layer.reconcile([at(1, 45.75, 4.85), at(2, 48.85, 2.35), at(3, 43.3, 5.4)])

    const survivor = feature(layer, 3)
    layer.reconcile([at(3, 43.3, 5.4)])

    assert.equal(layer.source.getFeatures().length, 1)
    assert.equal(feature(layer, 3), survivor)
    assert.equal(layer.entries.size, 1)
  })

  it("treats a changed id as a different marker", () => {
    const layer = new MarkerLayer()
    layer.reconcile([at(1, 45.75, 4.85)])
    const before = feature(layer, 1)

    layer.reconcile([at(2, 45.75, 4.85)])

    assert.equal(feature(layer, 1), undefined)
    assert.notEqual(feature(layer, 2), before)
  })

  it("handles numeric and string ids as the same identity", () => {
    const layer = new MarkerLayer()
    layer.reconcile([at(7, 45.75, 4.85)])
    const before = feature(layer, 7)

    layer.reconcile([at("7", 45.75, 4.85)])

    assert.equal(feature(layer, 7), before)
    assert.equal(layer.entries.size, 1)
  })

  it("shares one style object between identical markers", () => {
    const layer = new MarkerLayer()
    layer.reconcile([at(1, 45.0, 4.0, { color: "#111" }), at(2, 46.0, 5.0, { color: "#111" })])

    assert.equal(feature(layer, 1).getStyle(), feature(layer, 2).getStyle())
  })

  it("exposes the marker behind a feature, for click handling" , () => {
    const layer = new MarkerLayer()
    layer.reconcile([at(1, 45.75, 4.85, { label: "Atelier", data: { status: "late" } })])

    const marker = layer.markerFor(feature(layer, 1))

    assert.equal(marker.label, "Atelier")
    assert.deepEqual(marker.data, { status: "late" })
    assert.equal(layer.isDraggable(feature(layer, 1)), false)
    assert.equal(layer.extent.length, 4)
  })

  it("survives an empty list", () => {
    const layer = new MarkerLayer()
    layer.reconcile([at(1, 45.75, 4.85)])
    layer.reconcile([])

    assert.equal(layer.source.getFeatures().length, 0)
    assert.equal(layer.extent, null)
  })
})

function feature(layer, id) {
  const entry = layer.entries.get(String(id))
  return entry && entry.feature
}
