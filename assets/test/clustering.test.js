import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { MarkerLayer } from "../js/markers.js"
import { clusterStyle } from "../js/styles.js"

const at = (id, lat, lon, rest = {}) => ({ id, lat, lon, ...rest })

const features = (layer) => layer.source.getFeatures()
const rendered = (layer) =>
  layer.clusterSource ? layer.clusterSource.getFeatures() : layer.source.getFeatures()

// Clustering introduces a second kind of feature — a group — alongside the markers.
// These assertions are about the seam between the two, which is where it can go
// wrong quietly.
describe("MarkerLayer clustering", () => {
  it("leaves reconciliation completely alone", () => {
    // The point of wrapping rather than replacing the source: the reconciler never
    // learns that clustering exists.
    const layer = new MarkerLayer()
    layer.reconcile([at(1, 45.75, 4.85), at(2, 48.85, 2.35)])

    const before = features(layer)
    layer.setClustering({ distance: 40 })

    assert.deepEqual(features(layer), before, "the markers were rebuilt by clustering")
    assert.equal(layer.entries.size, 2)
  })

  it("keeps the same features when clustering is switched off again", () => {
    const layer = new MarkerLayer()
    layer.reconcile([at(1, 45.75, 4.85)])
    const feature = features(layer)[0]

    layer.setClustering({ distance: 40 })
    layer.setClustering(null)

    assert.equal(features(layer)[0], feature)
    assert.equal(layer.clustering, false)
  })

  it("reconciles into a clustered layer without special-casing", () => {
    const layer = new MarkerLayer()
    layer.setClustering({ distance: 40 })
    layer.reconcile([at(1, 45.75, 4.85)])

    const feature = features(layer)[0]
    layer.reconcile([at(1, 46.0, 5.0)])

    assert.equal(features(layer)[0], feature, "a move rebuilt the feature")
    assert.equal(layer.entries.size, 1)
  })

  it("swaps the layer source rather than the markers", () => {
    const layer = new MarkerLayer()
    layer.reconcile([at(1, 45.75, 4.85)])

    assert.equal(layer.layer.getSource(), layer.source)

    layer.setClustering({})
    assert.equal(layer.layer.getSource(), layer.clusterSource)
    assert.equal(layer.clusterSource.getSource(), layer.source)
  })

  describe("membersOf", () => {
    it("reads a bare marker feature", () => {
      const layer = new MarkerLayer()
      layer.reconcile([at(1, 45.75, 4.85, { label: "Atelier" })])

      const members = layer.membersOf(features(layer)[0])

      assert.equal(members.length, 1)
      assert.equal(members[0].label, "Atelier")
    })

    it("is empty for nothing", () => {
      assert.deepEqual(new MarkerLayer().membersOf(null), [])
    })
  })

  describe("markerFor and clusterFor", () => {
    it("a lone marker is a marker, not a cluster", () => {
      const layer = new MarkerLayer()
      layer.setClustering({ distance: 40 })
      layer.reconcile([at(1, 45.75, 4.85)])
      layer.clusterSource.refresh()

      // OpenLayers builds cluster features lazily, on load; force it.
      layer.clusterSource.loadFeatures([-2e7, -2e7, 2e7, 2e7], 1, "EPSG:3857")
      const [group] = rendered(layer)

      assert.equal(layer.markerFor(group).id, 1)
      assert.equal(layer.clusterFor(group), null)
    })

    it("a group of several is a cluster, not one arbitrary member", () => {
      // Being handed one member of twelve is the failure mode worth guarding: the
      // click would report a marker that the user did not click.
      const layer = new MarkerLayer()
      layer.setClustering({ distance: 40 })
      layer.reconcile([at(1, 45.75, 4.85), at(2, 45.7501, 4.8501), at(3, 45.7502, 4.8502)])
      layer.clusterSource.loadFeatures([-2e7, -2e7, 2e7, 2e7], 1, "EPSG:3857")

      const group = rendered(layer).find((f) => (f.get("features") || []).length > 1)

      assert.ok(group, "three coincident markers did not group")
      assert.equal(layer.markerFor(group), null, "a group was reported as a single marker")
      assert.deepEqual(
        layer.clusterFor(group).map((m) => m.id).sort(),
        [1, 2, 3]
      )
    })
  })

  describe("featureById", () => {
    it("returns the marker's own feature when not clustering", () => {
      const layer = new MarkerLayer()
      layer.reconcile([at(1, 45.75, 4.85)])

      assert.equal(layer.featureById(1), features(layer)[0])
    })

    it("returns the group when the marker is alone in it", () => {
      const layer = new MarkerLayer()
      layer.setClustering({ distance: 40 })
      layer.reconcile([at(1, 45.75, 4.85)])
      layer.clusterSource.loadFeatures([-2e7, -2e7, 2e7, 2e7], 1, "EPSG:3857")

      const found = layer.featureById(1)

      assert.ok(found, "no rendered feature for a lone marker")
      assert.deepEqual(found.get("features"), [features(layer)[0]])
    })

    it("returns nothing for a marker grouped with others", () => {
      // This is what closes an open popup when the user zooms out: the popup would
      // otherwise point at the marker's own coordinate while its pin is drawn at the
      // group's centre.
      const layer = new MarkerLayer()
      layer.setClustering({ distance: 40 })
      layer.reconcile([at(1, 45.75, 4.85), at(2, 45.7501, 4.8501)])
      layer.clusterSource.loadFeatures([-2e7, -2e7, 2e7, 2e7], 1, "EPSG:3857")

      assert.equal(layer.featureById(1), null)
    })

    it("is null for an unknown id", () => {
      assert.equal(new MarkerLayer().featureById("nope"), null)
    })
  })

  describe("the layer style", () => {
    it("draws a lone member as its own marker", () => {
      const layer = new MarkerLayer()
      layer.setClustering({ distance: 40 })
      layer.reconcile([at(1, 45.75, 4.85, { color: "#16a34a" })])
      layer.clusterSource.loadFeatures([-2e7, -2e7, 2e7, 2e7], 1, "EPSG:3857")

      const style = layer.styleForRendered(rendered(layer)[0])

      // An array of styles is what styleFor returns for a marker; a cluster circle
      // is a single Style with a Text.
      assert.ok(Array.isArray(style), "a lone marker was drawn as a cluster circle")
    })

    it("draws a group as a counted circle", () => {
      const layer = new MarkerLayer()
      layer.setClustering({ distance: 40 })
      layer.reconcile([at(1, 45.75, 4.85), at(2, 45.7501, 4.8501)])
      layer.clusterSource.loadFeatures([-2e7, -2e7, 2e7, 2e7], 1, "EPSG:3857")

      const group = rendered(layer).find((f) => (f.get("features") || []).length > 1)
      const style = layer.styleForRendered(group)

      assert.equal(style, clusterStyle(2))
      assert.equal(style.getText().getText(), "2")
    })
  })
})

describe("clusterStyle", () => {
  it("shares one style per count", () => {
    assert.equal(clusterStyle(7), clusterStyle(7))
  })

  it("grows with the logarithm of the count, and stops growing", () => {
    const small = clusterStyle(2).getImage().getRadius()
    const medium = clusterStyle(20).getImage().getRadius()
    const huge = clusterStyle(5000).getImage().getRadius()

    assert.ok(medium > small)
    assert.ok(huge > medium)
    // Linear growth would let a group of five thousand swallow the map.
    assert.ok(huge <= 28, `radius reached ${huge}`)
  })
})
