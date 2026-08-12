import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { ShapeLayer, styleForShape } from "../js/shapes.js"

const polygon = (lon = 4.83) => ({
  type: "Polygon",
  coordinates: [
    [
      [lon, 45.76],
      [lon + 0.01, 45.76],
      [lon + 0.01, 45.77],
      [lon, 45.77],
      [lon, 45.76],
    ],
  ],
})

const shape = (id, overrides = {}) => ({ id, geometry: polygon(), rev: 1, ...overrides })

const features = (layer, id) => {
  const entry = layer.entries.get(String(id))
  return entry && entry.features
}

// Same contract as the marker reconciler, asserted the same way: by object
// identity. If reconcile ever becomes "clear and redraw", these fail.
describe("ShapeLayer.reconcile", () => {
  it("adds the shapes it is given", () => {
    const layer = new ShapeLayer()
    layer.reconcile([shape(1), shape(2)])

    assert.equal(layer.source.getFeatures().length, 2)
    assert.equal(layer.entries.size, 2)
  })

  it("reads a bare geometry, a Feature and a FeatureCollection alike", () => {
    const layer = new ShapeLayer()

    layer.reconcile([
      { id: "bare", geometry: polygon(), rev: 1 },
      { id: "feature", geometry: { type: "Feature", properties: {}, geometry: polygon() }, rev: 1 },
      {
        id: "collection",
        rev: 1,
        geometry: {
          type: "FeatureCollection",
          features: [
            { type: "Feature", properties: {}, geometry: polygon() },
            { type: "Feature", properties: {}, geometry: polygon(4.9) },
          ],
        },
      },
    ])

    assert.equal(features(layer, "bare").length, 1)
    assert.equal(features(layer, "feature").length, 1)
    // One shape, two features — which is why an entry holds an array.
    assert.equal(features(layer, "collection").length, 2)
    assert.equal(layer.source.getFeatures().length, 4)
  })

  it("projects into Web Mercator, so coordinates are not left as degrees", () => {
    const layer = new ShapeLayer()
    layer.reconcile([shape(1)])

    const [x, y] = features(layer, 1)[0].getGeometry().getCoordinates()[0][0]

    assert.ok(Math.abs(x - 537_000) < 20_000, `x was ${x}`)
    assert.ok(Math.abs(y - 5_745_000) < 40_000, `y was ${y}`)
  })

  it("leaves an unchanged shape entirely alone", () => {
    const layer = new ShapeLayer()
    layer.reconcile([shape(1), shape(2)])

    const untouched = features(layer, 2)[0]
    const geometry = untouched.getGeometry()
    const style = untouched.getStyle()

    layer.reconcile([shape(1), shape(2)])

    assert.equal(features(layer, 2)[0], untouched, "an unchanged shape was rebuilt")
    assert.equal(features(layer, 2)[0].getGeometry(), geometry)
    assert.equal(features(layer, 2)[0].getStyle(), style)
  })

  it("rebuilds only the shape whose rev changed", () => {
    const layer = new ShapeLayer()
    layer.reconcile([shape(1), shape(2)])

    const rebuilt = features(layer, 1)[0]
    const untouched = features(layer, 2)[0]

    layer.reconcile([{ id: 1, geometry: polygon(5.0), rev: 2 }, shape(2)])

    assert.notEqual(features(layer, 1)[0], rebuilt, "a changed geometry was not rebuilt")
    assert.equal(features(layer, 2)[0], untouched, "an unrelated shape was rebuilt")
    assert.equal(layer.source.getFeatures().length, 2, "the old feature was left behind")
  })

  it("trusts rev: identical revs mean identical geometry, whatever the coordinates say", () => {
    // This is the contract that makes shapes affordable — the client never hashes
    // a thousand-point route. A caller who lies about rev gets a stale map, which
    // is exactly the trade Rover.Shape documents.
    const layer = new ShapeLayer()
    layer.reconcile([shape(1)])
    const before = features(layer, 1)[0]

    layer.reconcile([{ id: 1, geometry: polygon(9.9), rev: 1 }])

    assert.equal(features(layer, 1)[0], before)
  })

  it("restyles without rebuilding the geometry", () => {
    const layer = new ShapeLayer()
    layer.reconcile([shape(1, { color: "#16a34a" })])

    const feature = features(layer, 1)[0]
    const geometry = feature.getGeometry()
    const styleBefore = feature.getStyle()

    layer.reconcile([shape(1, { color: "#e11d48" })])

    assert.equal(features(layer, 1)[0], feature, "restyling rebuilt the feature")
    assert.equal(features(layer, 1)[0].getGeometry(), geometry, "restyling rebuilt the geometry")
    assert.notEqual(features(layer, 1)[0].getStyle(), styleBefore, "the colour was not applied")
  })

  it("removes shapes that are gone, and only those", () => {
    const layer = new ShapeLayer()
    layer.reconcile([shape(1), shape(2), shape(3)])
    const survivor = features(layer, 3)[0]

    layer.reconcile([shape(3)])

    assert.equal(layer.source.getFeatures().length, 1)
    assert.equal(layer.entries.size, 1)
    assert.equal(features(layer, 3)[0], survivor)
  })

  it("removes every feature of a multi-feature shape", () => {
    const layer = new ShapeLayer()
    layer.reconcile([
      {
        id: "collection",
        rev: 1,
        geometry: {
          type: "FeatureCollection",
          features: [
            { type: "Feature", properties: {}, geometry: polygon() },
            { type: "Feature", properties: {}, geometry: polygon(4.9) },
          ],
        },
      },
    ])

    layer.reconcile([])

    assert.equal(layer.source.getFeatures().length, 0)
    assert.equal(layer.entries.size, 0)
  })

  it("exposes the shape behind a feature, for click handling", () => {
    const layer = new ShapeLayer()
    layer.reconcile([shape("parcel-42", { data: { section: "AB" } })])

    const found = layer.shapeFor(features(layer, "parcel-42")[0])

    assert.equal(found.id, "parcel-42")
    assert.deepEqual(found.data, { section: "AB" })
  })

  it("does not answer to the marker property key", () => {
    // markerFor() reads "rover"; a shape answering to it would be handed to
    // marker click handlers as though it were a pin.
    const layer = new ShapeLayer()
    layer.reconcile([shape(1)])

    assert.equal(features(layer, 1)[0].get("rover"), undefined)
  })

  it("survives unreadable geometry instead of taking the map down with it", () => {
    const layer = new ShapeLayer()
    layer.reconcile([{ id: 1, geometry: { type: "Polygon" }, rev: 1 }, shape(2)])

    assert.equal(features(layer, 1).length, 0)
    assert.equal(features(layer, 2).length, 1, "a bad shape stopped the good one")
  })

  it("reports an extent only when it holds something" , () => {
    const layer = new ShapeLayer()
    assert.equal(layer.extent, null)

    layer.reconcile([shape(1)])
    assert.equal(layer.extent.length, 4)

    layer.reconcile([])
    assert.equal(layer.extent, null)
  })

  describe("isEditable", () => {
    it("is true for a single-feature shape marked editable", () => {
      const layer = new ShapeLayer()
      layer.reconcile([shape(1, { editable: true })])

      assert.equal(layer.isEditable(features(layer, 1)[0]), true)
    })

    it("is false when editable was not set", () => {
      const layer = new ShapeLayer()
      layer.reconcile([shape(1)])

      assert.equal(layer.isEditable(features(layer, 1)[0]), false)
    })

    it("is false for a multi-feature shape, even when marked editable", () => {
      // A drag would have no single :geometry to write the result back to.
      const layer = new ShapeLayer()
      layer.reconcile([
        {
          id: "collection",
          rev: 1,
          editable: true,
          geometry: {
            type: "FeatureCollection",
            features: [
              { type: "Feature", properties: {}, geometry: polygon() },
              { type: "Feature", properties: {}, geometry: polygon(4.9) },
            ],
          },
        },
      ])

      features(layer, "collection").forEach((feature) => {
        assert.equal(layer.isEditable(feature), false)
      })
    })
  })

  describe("forgetRev", () => {
    it("nulls the cached rev, so the next reconcile rebuilds even a same-rev shape", () => {
      const layer = new ShapeLayer()
      layer.reconcile([shape(1, { editable: true })])

      const edited = features(layer, 1)[0]
      edited.getGeometry().setCoordinates(polygon(9.9).coordinates)
      layer.forgetRev(edited)

      // The server rejects the edit: it sends the very same shape as before.
      layer.reconcile([shape(1, { editable: true })])

      assert.notEqual(features(layer, 1)[0], edited, "the shape was left alone instead of rebuilt")
    })
  })

  describe("propertiesFor", () => {
    it("is null for a bare geometry", () => {
      const layer = new ShapeLayer()
      layer.reconcile([shape(1)])

      assert.equal(layer.propertiesFor(features(layer, 1)[0]), null)
    })

    it("returns a Feature's own properties", () => {
      const layer = new ShapeLayer()
      layer.reconcile([
        {
          id: 1,
          rev: 1,
          geometry: { type: "Feature", properties: { parcel_id: "AB214" }, geometry: polygon() },
        },
      ])

      assert.deepEqual(layer.propertiesFor(features(layer, 1)[0]), { parcel_id: "AB214" })
    })

    it("returns the single member's properties from a one-feature FeatureCollection", () => {
      const layer = new ShapeLayer()
      layer.reconcile([
        {
          id: 1,
          rev: 1,
          geometry: {
            type: "FeatureCollection",
            features: [
              { type: "Feature", properties: { parcel_id: "AB214" }, geometry: polygon() },
            ],
          },
        },
      ])

      assert.deepEqual(layer.propertiesFor(features(layer, 1)[0]), { parcel_id: "AB214" })
    })

    it("is null for a FeatureCollection of more than one — no single feature owns it", () => {
      const layer = new ShapeLayer()
      layer.reconcile([
        {
          id: "collection",
          rev: 1,
          geometry: {
            type: "FeatureCollection",
            features: [
              { type: "Feature", properties: { a: 1 }, geometry: polygon() },
              { type: "Feature", properties: { b: 2 }, geometry: polygon(4.9) },
            ],
          },
        },
      ])

      features(layer, "collection").forEach((feature) => {
        assert.equal(layer.propertiesFor(feature), null)
      })
    })
  })
})

describe("styleForShape", () => {
  it("shares one style between identically styled shapes", () => {
    assert.equal(
      styleForShape({ id: 1, color: "#111", width: 2 }),
      styleForShape({ id: 2, color: "#111", width: 2 })
    )
  })

  it("turns a hex fill into an rgba array so opacity can apply", () => {
    const fill = styleForShape({ id: 1, color: "#16a34a", fill_opacity: 0.3 }).getFill().getColor()

    assert.deepEqual(fill, [22, 163, 74, 0.3])
  })

  it("expands three-digit hex", () => {
    const fill = styleForShape({ id: 1, color: "#0f8", fill_opacity: 0.5 }).getFill().getColor()

    assert.deepEqual(fill, [0, 255, 136, 0.5])
  })

  it("honours fill_opacity: 0 rather than substituting the default", () => {
    const fill = styleForShape({ id: 1, color: "#16a34a", fill_opacity: 0 }).getFill().getColor()

    assert.equal(fill[3], 0)
  })

  it("passes a non-hex colour through untouched", () => {
    const fill = styleForShape({ id: 1, fill_color: "rgba(0,0,0,0.5)" }).getFill().getColor()

    assert.equal(fill, "rgba(0,0,0,0.5)")
  })
})
