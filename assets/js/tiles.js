import WMTSCapabilities from "ol/format/WMTSCapabilities.js"
import LayerGroup from "ol/layer/Group.js"
import TileLayer from "ol/layer/Tile.js"
import { get as getProjection } from "ol/proj.js"
import WMTS, { optionsFromCapabilities } from "ol/source/WMTS.js"
import XYZ from "ol/source/XYZ.js"
import { apply as applyVectorStyle } from "ol-mapbox-style"

/**
 * Turning a resolved `tiles` config into the OpenLayers layer that draws it.
 *
 * Its own module because there are two callers now: the basemap in slot 0, and
 * every entry of the `layers` list drawn over it. They want exactly the same
 * construction — including the vector path, which is not a source you can set
 * but a whole `LayerGroup` that `ol-mapbox-style` populates asynchronously — and
 * a second copy of that would be a second place for the licence handling to
 * drift.
 */

// Carto and friends use Leaflet's `{r}` placeholder for retina tiles, which
// OpenLayers does not know about. Resolve it once, here, rather than making
// every caller strip it out of their URL.
function resolveRetina(url) {
  const ratio = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1
  return url.replace(/\{r\}/g, ratio > 1.5 ? "@2x" : "")
}

/**
 * What gets built for a given resolved tiles config — an `ol/layer/Tile` for
 * raster, an empty `ol/layer/Group` for `ol-mapbox-style` to populate, or an
 * invisible placeholder for no basemap at all. Exported so the construction
 * logic is testable without a browser: which layer class gets built, and how, is
 * plain data in, OL instance out — no canvas involved.
 */
export function buildBasemapLayer(tiles) {
  if (!tiles) return new TileLayer({ visible: false })

  if (tiles.type === "vector") return new LayerGroup()

  // A WMTS source cannot be built from the config alone: its tile grid lives in
  // a capabilities document that has to be fetched first. The layer is real
  // from the start and gains its source when that lands, the same shape the
  // vector path takes.
  if (tiles.type === "wmts") return new TileLayer()

  return new TileLayer({
    source: new XYZ({
      url: resolveRetina(tiles.url),
      attributions: tiles.attributions || undefined,
      maxZoom: tiles.maxZoom ?? 19,
      crossOrigin: "anonymous",
    }),
  })
}

/**
 * The layer, plus the asynchronous half a vector style needs.
 *
 * `ol-mapbox-style`'s `apply()` resolves once the style document, its sprite and
 * the first tiles have loaded, so the group is returned empty and populates as
 * that promise settles — the same way a raster `XYZ` layer renders tile by tile
 * as they arrive. Callers insert what they get back immediately.
 */
export function buildTileLayer(tiles) {
  const layer = buildBasemapLayer(tiles)

  if (tiles && tiles.type === "vector") {
    applyVectorStyle(layer, tiles.styleUrl)
      // Both asynchronous paths check `disposed` before touching the layer they
      // were given. A basemap swapped, or an overlay dropped, while its document
      // was in flight has already been disposed by then, and finishing the job
      // on it would resurrect a layer nothing is showing — one that goes on
      // fetching tiles for a map that moved on.
      .then((group) => !layer.disposed && setVectorAttributions(group, tiles.attributions))
      .catch((error) => console.error("[rover] could not load vector basemap style:", error))
  }

  if (tiles && tiles.type === "wmts") applyWmtsSource(layer, tiles)

  return layer
}

function applyWmtsSource(layer, tiles) {
  fetch(tiles.capabilitiesUrl)
    .then((response) => {
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
      return response.text()
    })
    .then((text) => {
      if (layer.disposed) return

      const capabilities = new WMTSCapabilities().read(text)

      // Checked before OpenLayers is handed the document, not after: of the
      // four ways this can be wrong it reports one, silently substitutes two,
      // and throws a TypeError on the fourth.
      const fault = wmtsFaultIn(capabilities, tiles)
      if (fault) throw new Error(fault)

      const options = optionsFromCapabilities(capabilities, wmtsConfigFor(tiles))
      if (!options) {
        throw new Error(`no layer ${JSON.stringify(tiles.layer)} in the capabilities document`)
      }

      layer.setSource(new WMTS({ ...options, attributions: tiles.attributions || undefined }))
    })
    .catch((error) => console.error("[rover] could not load the WMTS capabilities document:", error))
}

/**
 * What is wrong with reading `tiles` out of this capabilities document, in a
 * sentence, or null if nothing is.
 *
 * Pure, and exported, because none of it is reachable any other way: it runs
 * inside a promise on a document fetched over the network, and three of the
 * four faults below produce no error of their own to catch.
 *
 *   - An unknown layer is the one OpenLayers reports, by returning nothing.
 *   - A matrix set the layer does not offer is silently swapped for its first
 *     one, building a source on a grid nobody asked for.
 *   - A format the layer does not serve is taken at face value, and every tile
 *     request then fails with nothing in the console.
 *   - A matrix set in a CRS OpenLayers does not know — anything but Web
 *     Mercator and WGS 84 without proj4, so Lambert-93 or the British National
 *     Grid — makes it dereference a null projection, and the TypeError that
 *     follows reads as if the document had failed to load.
 */
export function wmtsFaultIn(capabilities, tiles) {
  const contents = (capabilities || {}).Contents || {}
  const layer = (contents.Layer || []).find((entry) => entry.Identifier === tiles.layer)

  if (!layer) {
    return `no layer ${JSON.stringify(tiles.layer)} in the capabilities document`
  }

  const formats = layer.Format || []
  if (tiles.format && formats.length > 0 && !formats.includes(tiles.format)) {
    return (
      `layer ${JSON.stringify(tiles.layer)} is not served as ${JSON.stringify(tiles.format)} — ` +
      `the document offers ${formats.map((format) => JSON.stringify(format)).join(", ")}`
    )
  }

  const sets = (layer.TileMatrixSetLink || []).map((link) => link.TileMatrixSet)
  if (tiles.matrixSet && !sets.includes(tiles.matrixSet)) {
    return (
      `layer ${JSON.stringify(tiles.layer)} is not offered in matrix set ` +
      `${JSON.stringify(tiles.matrixSet)} — the document has ` +
      `${sets.map((set) => JSON.stringify(set)).join(", ")}`
    )
  }

  const chosen = tiles.matrixSet || sets[0]
  const crs = (contents.TileMatrixSet || []).find((set) => set.Identifier === chosen)?.SupportedCRS

  if (crs && !getProjection(crs)) {
    return (
      `matrix set ${JSON.stringify(chosen)} is in ${JSON.stringify(crs)}, which OpenLayers does ` +
      `not know — it carries Web Mercator and WGS 84 only, and anything else has to be ` +
      `registered with proj4 before the map is built`
    )
  }

  return null
}

/**
 * What `optionsFromCapabilities` is asked for — carrying only the keys the
 * caller actually gave.
 *
 * Exported because the omission is the whole point and it is invisible from
 * outside: OpenLayers tests `'format' in config`, which an explicit
 * `format: undefined` satisfies, and then falls back to `image/jpeg` rather
 * than the format the document declares. A PNG-only layer asked for as JPEG
 * renders blank, with nothing in the console.
 */
export function wmtsConfigFor(tiles) {
  return {
    layer: tiles.layer,
    crossOrigin: "anonymous",
    ...(tiles.matrixSet ? { matrixSet: tiles.matrixSet } : {}),
    ...(tiles.format ? { format: tiles.format } : {}),
  }
}

/**
 * Dispose a layer and, when it is a group, everything in it.
 *
 * `ol/layer/Group` does not override `disposeInternal`, so disposing one
 * releases the group and leaves its children — for a vector basemap or overlay,
 * every `VectorTile` layer `ol-mapbox-style` put there, with its source and its
 * listeners — alive for as long as the page is.
 */
export function disposeLayer(layer) {
  if (layer.getLayers) layer.getLayers().forEach(disposeLayer)

  layer.dispose()
}

// Attribution stays Rover's to own, not the style document's — the same
// licence-compliance posture the raster path already takes, where Rover sets
// the attribution string rather than trusting whatever a tile server declares.
function setVectorAttributions(group, attributions) {
  group.getLayers().forEach((layer) => {
    const source = layer.getSource && layer.getSource()
    if (source && source.setAttributions) source.setAttributions(attributions || undefined)
  })
}
