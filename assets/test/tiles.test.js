import assert from "node:assert/strict"
import { describe, it } from "node:test"

import LayerGroup from "ol/layer/Group.js"
import TileLayer from "ol/layer/Tile.js"
import XYZ from "ol/source/XYZ.js"

import { buildBasemapLayer } from "../js/rover_map.js"
import { disposeLayer, wmtsConfigFor, wmtsFaultIn } from "../js/tiles.js"

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

describe("wmtsConfigFor", () => {
  const tiles = { type: "wmts", capabilitiesUrl: "https://example.com/wmts", layer: "ORTHO" }

  it("omits a format the caller did not give, rather than passing undefined", () => {
    // The regression this exists for: OpenLayers tests `'format' in config`,
    // which an explicit `format: undefined` satisfies — so it stops reading the
    // format out of the document and falls back to image/jpeg. A PNG-only layer
    // then renders blank, with nothing in the console.
    const config = wmtsConfigFor(tiles)

    assert.equal("format" in config, false)
    assert.equal("matrixSet" in config, false)
    assert.equal(config.layer, "ORTHO")
    assert.equal(config.crossOrigin, "anonymous")
  })

  it("passes the ones it was given", () => {
    const config = wmtsConfigFor({ ...tiles, matrixSet: "PM", format: "image/png" })

    assert.equal(config.matrixSet, "PM")
    assert.equal(config.format, "image/png")
  })
})

describe("wmtsFaultIn", () => {
  // The parsed shape of a capabilities document, which is what the WMTS source
  // is built from. Reading it is where every one of these goes wrong.
  const document = {
    Contents: {
      Layer: [
        {
          Identifier: "ORTHO",
          Format: ["image/jpeg"],
          TileMatrixSetLink: [{ TileMatrixSet: "PM" }, { TileMatrixSet: "LAMB93" }],
        },
      ],
      TileMatrixSet: [
        { Identifier: "PM", SupportedCRS: "urn:ogc:def:crs:EPSG::3857" },
        { Identifier: "LAMB93", SupportedCRS: "urn:ogc:def:crs:EPSG::2154" },
      ],
    },
  }

  const tiles = { layer: "ORTHO", matrixSet: "PM" }

  it("says nothing about a document that answers the question", () => {
    assert.equal(wmtsFaultIn(document, tiles), null)
    assert.equal(wmtsFaultIn(document, { layer: "ORTHO" }), null)
    assert.equal(wmtsFaultIn(document, { ...tiles, format: "image/jpeg" }), null)
  })

  it("names a layer the document does not describe", () => {
    assert.match(wmtsFaultIn(document, { layer: "PLAN" }), /no layer "PLAN"/)
  })

  it("names a format the layer does not serve", () => {
    // OpenLayers takes the format at face value, so every tile request then
    // fails with nothing in the console.
    const fault = wmtsFaultIn(document, { ...tiles, format: "image/png" })

    assert.match(fault, /not served as "image\/png"/)
    assert.match(fault, /"image\/jpeg"/)
  })

  it("names a matrix set the layer does not offer", () => {
    // OpenLayers silently swaps in the layer's first one, building a source on
    // a grid nobody asked for.
    const fault = wmtsFaultIn(document, { layer: "ORTHO", matrixSet: "WGS84G" })

    assert.match(fault, /not offered in matrix set "WGS84G"/)
    assert.match(fault, /"PM", "LAMB93"/)
  })

  it("names a CRS OpenLayers cannot build a grid in", () => {
    // Without proj4 it carries Web Mercator and WGS 84 only, and dereferences a
    // null projection for anything else — a TypeError that reads as if the
    // document had failed to load.
    const fault = wmtsFaultIn(document, { layer: "ORTHO", matrixSet: "LAMB93" })

    assert.match(fault, /EPSG::2154/)
    assert.match(fault, /proj4/)
  })

  it("checks the matrix set the layer would fall back to, not only a named one", () => {
    const lambertFirst = {
      Contents: {
        ...document.Contents,
        Layer: [{ ...document.Contents.Layer[0], TileMatrixSetLink: [{ TileMatrixSet: "LAMB93" }] }],
      },
    }

    assert.match(wmtsFaultIn(lambertFirst, { layer: "ORTHO" }), /EPSG::2154/)
  })
})

describe("disposeLayer", () => {
  it("disposes what a group holds, which the group's own dispose does not", () => {
    // ol/layer/Group does not override disposeInternal, so a vector basemap's
    // children — every layer ol-mapbox-style put in it — outlive the page.
    const child = buildBasemapLayer({ type: "raster", url: "https://a/{z}/{x}/{y}.png" })
    const group = buildBasemapLayer({ type: "vector", styleUrl: "https://example.com/style.json" })
    group.getLayers().push(child)

    disposeLayer(group)

    assert.equal(group.disposed, true)
    assert.equal(child.disposed, true, "the group was released and its children left running")
  })
})
