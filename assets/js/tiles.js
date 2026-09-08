import WMTSCapabilities from "ol/format/WMTSCapabilities.js"
import LayerGroup from "ol/layer/Group.js"
import TileLayer from "ol/layer/Tile.js"
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
      const options = optionsFromCapabilities(capabilities, {
        layer: tiles.layer,
        matrixSet: tiles.matrixSet,
        format: tiles.format,
        crossOrigin: "anonymous",
      })

      // The document parsed and simply does not describe this layer, or does
      // not offer it in the matrix set asked for. Naming both is the difference
      // between a fixable typo and a blank map.
      if (!options) {
        throw new Error(
          `no layer ${JSON.stringify(tiles.layer)} in the capabilities document` +
            (tiles.matrixSet ? ` for matrix set ${JSON.stringify(tiles.matrixSet)}` : "")
        )
      }

      layer.setSource(new WMTS({ ...options, attributions: tiles.attributions || undefined }))
    })
    .catch((error) => console.error("[rover] could not load the WMTS capabilities document:", error))
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
