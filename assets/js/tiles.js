import LayerGroup from "ol/layer/Group.js"
import TileLayer from "ol/layer/Tile.js"
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
      .then((group) => setVectorAttributions(group, tiles.attributions))
      .catch((error) => console.error("[rover] could not load vector basemap style:", error))
  }

  return layer
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
