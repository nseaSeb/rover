import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { DrawLayer, drawTypeFor } from "../js/draw.js"
import { ShapeLayer, format } from "../js/shapes.js"

describe("drawTypeFor", () => {
  it("accepts the three types a drawn shape can round-trip as", () => {
    assert.equal(drawTypeFor("Point"), "Point")
    assert.equal(drawTypeFor("LineString"), "LineString")
    assert.equal(drawTypeFor("Polygon"), "Polygon")
  })

  it("refuses a circle, which OpenLayers can draw and GeoJSON cannot carry", () => {
    assert.equal(drawTypeFor("Circle"), null)
  })

  it("refuses anything else rather than handing it to Draw", () => {
    // The server validates first, so reaching this means a malformed payload —
    // which must not become `new Draw({type: undefined})` and a broken map.
    assert.equal(drawTypeFor("Blob"), null)
    assert.equal(drawTypeFor(undefined), null)
    assert.equal(drawTypeFor(null), null)
  })
})

describe("DrawLayer", () => {
  it("keeps the sketch out of the shape layer's source", () => {
    // The whole reason this class exists. A feature Draw put into ShapeLayer's
    // own source would be absent from `entries`, so reconcile() would never
    // remove it — and the server's echo of the same shape would render beside
    // it, showing the polygon twice.
    const draw = new DrawLayer()
    const shapes = new ShapeLayer()

    assert.notEqual(draw.source, shapes.source)
  })

  it("clears the sketch on demand", () => {
    const layer = new DrawLayer()
    layer.source.addFeatures(sketch())

    assert.equal(layer.source.getFeatures().length, 1)

    layer.clear()

    assert.equal(layer.source.getFeatures().length, 0)
  })

  it("sits above the shapes and below the markers", () => {
    // A sketch hidden under the parcel it is being traced over is not a sketch.
    assert.equal(new DrawLayer().layer.getZIndex(), 6)
  })

  it("is empty after disposal", () => {
    const layer = new DrawLayer()
    layer.source.addFeatures(sketch())
    layer.dispose()

    assert.equal(layer.source.getFeatures().length, 0)
  })
})

function sketch() {
  return format.readFeatures({
    type: "Polygon",
    coordinates: [
      [
        [4.83, 45.76],
        [4.84, 45.76],
        [4.84, 45.77],
        [4.83, 45.76],
      ],
    ],
  })
}
