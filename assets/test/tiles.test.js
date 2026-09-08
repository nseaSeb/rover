import assert from "node:assert/strict"
import { describe, it } from "node:test"

import LayerGroup from "ol/layer/Group.js"
import TileLayer from "ol/layer/Tile.js"
import XYZ from "ol/source/XYZ.js"

import { buildBasemapLayer } from "../js/rover_map.js"

// The rest of applyTiles — inserting the built layer into slot 0, calling
// ol-mapbox-style's apply() for a vector group — needs a real OL map and, for
// the vector path, a network fetch of a style document; both belong in the
// browser suite. This covers the part that is plain data in, OL layer class
// out: given a resolved tiles config, which construction path runs.
describe("buildBasemapLayer", () => {
  it("builds an invisible placeholder for no basemap", () => {
    const layer = buildBasemapLayer(null)

    assert.ok(layer instanceof TileLayer)
    assert.equal(layer.getVisible(), false)
    assert.equal(layer.getSource(), null)
  })

  it("builds an XYZ tile layer for a raster config", () => {
    const layer = buildBasemapLayer({
      type: "raster",
      url: "https://x/{z}/{x}/{y}.png",
      attributions: "© Example",
      maxZoom: 18,
    })

    assert.ok(layer instanceof TileLayer)
    assert.ok(!(layer instanceof LayerGroup))

    const source = layer.getSource()
    assert.ok(source instanceof XYZ)
    assert.deepEqual(source.getAttributions()(), ["© Example"])
  })

  it("builds a sourceless tile layer for WMTS, to be filled once its grid is known", () => {
    // The tile grid lives in a capabilities document that has to be fetched, so
    // the layer is real from the start and gains its source when that lands —
    // the same shape the vector path takes.
    const layer = buildBasemapLayer({
      type: "wmts",
      capabilitiesUrl: "https://example.com/wmts",
      layer: "ORTHO",
      maxZoom: 19,
    })

    assert.ok(layer instanceof TileLayer)
    assert.ok(!(layer instanceof LayerGroup))
    assert.equal(layer.getSource(), null)
    assert.equal(layer.getVisible(), true, "a WMTS basemap must not start hidden")
  })

  it("resolves the {r} retina placeholder on the raster path only", () => {
    const layer = buildBasemapLayer({
      type: "raster",
      url: "https://x/{z}/{x}/{y}{r}.png",
      maxZoom: 18,
    })

    const urls = layer.getSource().getUrls()
    assert.ok(urls.every((url) => !url.includes("{r}")))
  })

  it("builds an empty layer group for a vector config, ready for ol-mapbox-style to populate", () => {
    const layer = buildBasemapLayer({
      type: "vector",
      styleUrl: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
      attributions: "© Example",
      maxZoom: 24,
    })

    assert.ok(layer instanceof LayerGroup)
    assert.equal(layer.getLayers().getLength(), 0)
  })
})
