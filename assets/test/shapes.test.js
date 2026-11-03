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

  describe("isTranslatable and translateGroup", () => {
    const collection = (id, extra = {}) => ({
      id,
      rev: 1,
      ...extra,
      geometry: {
        type: "FeatureCollection",
        features: [
          { type: "Feature", properties: {}, geometry: polygon() },
          { type: "Feature", properties: {}, geometry: polygon(4.9) },
        ],
      },
    })

    it("is true only for a single-feature shape marked translatable", () => {
      const layer = new ShapeLayer()
      layer.reconcile([
        shape(1, { translatable: true }),
        shape(2),
        collection("many", { translatable: true }),
      ])

      assert.equal(layer.isTranslatable(features(layer, 1)[0]), true)
      assert.equal(layer.isTranslatable(features(layer, 2)[0]), false)
      features(layer, "many").forEach((feature) => assert.equal(layer.isTranslatable(feature), false))
    })

    it("moves a shape with no group on its own", () => {
      const layer = new ShapeLayer()
      layer.reconcile([shape(1, { translatable: true }), shape(2, { translatable: true })])

      assert.deepEqual(layer.translateGroup(features(layer, 1)[0]), [features(layer, 1)[0]])
    })

    it("moves every translatable member of the group, and nothing else", () => {
      const layer = new ShapeLayer()
      layer.reconcile([
        shape(1, { translatable: true, translate_group: "sel" }),
        shape(2, { translatable: true, translate_group: "sel" }),
        // Same group, but not translatable: the cadastral outline under the
        // selection must stay where it is.
        shape(3, { translate_group: "sel" }),
        shape(4, { translatable: true, translate_group: "other" }),
        shape(5, { translatable: true }),
        collection("many", { translatable: true, translate_group: "sel" }),
      ])

      const moved = layer.translateGroup(features(layer, 2)[0])
      assert.deepEqual(moved, [features(layer, 1)[0], features(layer, 2)[0]])
    })

    it("compares groups as strings", () => {
      const layer = new ShapeLayer()
      layer.reconcile([
        shape(1, { translatable: true, translate_group: 7 }),
        shape(2, { translatable: true, translate_group: "7" }),
      ])

      assert.equal(layer.translateGroup(features(layer, 1)[0]).length, 2)
    })

    it("tells a feature still drawn from one a server render replaced", () => {
      const layer = new ShapeLayer()
      layer.reconcile([shape(1, { translatable: true }), shape(2, { translatable: true })])
      const held = features(layer, 1)[0]
      const dropped = features(layer, 2)[0]

      // A new rev rebuilds shape 1; shape 2 is removed.
      layer.reconcile([shape(1, { translatable: true, rev: 2 })])

      assert.equal(layer.isCurrent(held), false)
      assert.equal(layer.isCurrent(dropped), false)
      assert.equal(layer.isCurrent(features(layer, 1)[0]), true)
    })

    it("leaves a shape with no geometry out of the group", () => {
      const layer = new ShapeLayer()
      layer.reconcile([
        shape(1, { translatable: true, translate_group: "g" }),
        shape(2, { translatable: true, translate_group: "g", geometry: { type: "Feature", properties: {}, geometry: null } }),
      ])

      assert.equal(layer.isTranslatable(features(layer, 2)[0]), false)
      assert.deepEqual(layer.translateGroup(features(layer, 1)[0]), [features(layer, 1)[0]])
    })

    it("knows whether anything on the layer can move", () => {
      const layer = new ShapeLayer()
      layer.reconcile([shape(1)])
      assert.equal(layer.hasTranslatable(), false)

      layer.reconcile([shape(1), shape(2, { translatable: true })])
      assert.equal(layer.hasTranslatable(), true)
    })

    it("is empty for a shape that cannot move", () => {
      const layer = new ShapeLayer()
      layer.reconcile([shape(1, { translate_group: "sel" })])

      assert.deepEqual(layer.translateGroup(features(layer, 1)[0]), [])
    })

    it("re-applies the server geometry after a move, even under the same rev", () => {
      const layer = new ShapeLayer()
      layer.reconcile([shape(1, { translatable: true }), shape(2, { translatable: true })])

      const moved = features(layer, 1)[0]
      const untouched = features(layer, 2)[0]
      moved.getGeometry().translate(1000, 1000)
      layer.forgetRev(moved)

      layer.reconcile([shape(1, { translatable: true }), shape(2, { translatable: true })])

      assert.notEqual(features(layer, 1)[0], moved, "the moved shape was left where it was dragged")
      assert.equal(features(layer, 2)[0], untouched, "an unrelated shape was rebuilt")
    })
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

  // The regression this exists for: stroke and fill paint lines and areas, and a
  // Point has neither, so a style without an image rendered every point shape —
  // a drawn point echoed back by the server among them — as nothing at all.
  it("carries an image, so a Point has something to be drawn as", () => {
    const image = styleForShape({ id: 1, color: "#7c3aed" }).getImage()

    assert.ok(image, "no image style: a Point geometry would render as nothing")
    assert.equal(image.getFill().getColor(), "#7c3aed")
  })
})

describe("ShapeLayer.extentOf", () => {
  it("spans every feature of the shape", () => {
    const layer = new ShapeLayer()
    layer.reconcile([shape(1)])

    const [minX, minY, maxX, maxY] = layer.extentOf("1")
    assert.ok(minX < maxX && minY < maxY)
  })

  it("is null for an unknown shape", () => {
    assert.equal(new ShapeLayer().extentOf("nope"), null)
  })

  // GeoJSON allows `"geometry": null`, and since OpenLayers 10.11 an empty
  // `coordinates` array is read the same way: a feature with no geometry. The
  // keyboard path asked each feature for its extent and threw a TypeError.
  for (const [name, geometry] of [
    ["an empty coordinates array", { type: "Point", coordinates: [] }],
    ["a null geometry", { type: "Feature", geometry: null, properties: {} }],
    // These two keep a geometry object, one with no coordinate in it: the
    // first is what ST_AsGeoJSON writes for GEOMETRYCOLLECTION EMPTY.
    ["an empty GeometryCollection", { type: "GeometryCollection", geometries: [] }],
    ["a polygon with an empty ring", { type: "Polygon", coordinates: [[]] }],
  ]) {
    it(`is null for a shape drawn from ${name}`, () => {
      const layer = new ShapeLayer()
      layer.reconcile([shape(1, { geometry })])

      assert.equal(features(layer, 1).length, 1)
      assert.equal(layer.extentOf("1"), null)
      // The same answer the fit and its zoom ceiling read: no content.
      assert.equal(layer.extent, null)
    })
  }

  it("unions the features of a collection and skips the empty ones", () => {
    const layer = new ShapeLayer()
    layer.reconcile([
      shape(1, {
        geometry: {
          type: "FeatureCollection",
          features: [
            { type: "Feature", geometry: polygon(4.83), properties: {} },
            { type: "Feature", geometry: null, properties: {} },
            { type: "Feature", geometry: polygon(4.93), properties: {} },
          ],
        },
      }),
      shape(2, { geometry: polygon(4.83) }),
      shape(3, { geometry: polygon(4.93) }),
    ])

    const [minX, minY, maxX, maxY] = layer.extentOf("1")
    assert.equal(minX, layer.extentOf("2")[0])
    assert.equal(maxX, layer.extentOf("3")[2])
    assert.ok(minY < maxY)
  })
})
