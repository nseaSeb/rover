import VectorLayer from "ol/layer/Vector.js"
import VectorSource from "ol/source/Vector.js"

import { format, styleForShape } from "./shapes.js"

/**
 * Geometry the browser fetches for itself, from a URL the server named.
 *
 * A layer of its own rather than a variant of `ShapeLayer`, because the two
 * have opposite identity stories. `ShapeLayer` knows every feature it holds: it
 * was told about each one, keyed by id, and reconciles them against the next
 * list. Features read out of a file are not in that map at all — the server has
 * never seen them — so letting them into that source would put untracked
 * features beside tracked ones, which is exactly the problem the sketch layer
 * exists to avoid on the drawing path.
 *
 * The trade that buys: the whole file arrives in one request the browser caches,
 * instead of being re-serialised into an attribute whenever anything on the map
 * changes. What it costs: the server cannot name these features, so they have no
 * popups, no keyboard entries and no editing. Clicks still work, carrying
 * whatever id and properties the GeoJSON itself declares.
 */
export class UrlShapeLayer {
  constructor() {
    // No `url` yet: the source is built once and pointed at a document by
    // `reconcile`, so a change of URL is a reload rather than a new layer.
    this.source = new VectorSource({ format, wrapX: false })
    this.layer = new VectorLayer({
      source: this.source,
      // Under the shapes the server sends, over the tiles: geometry loaded in
      // bulk is backdrop for the shapes an application is actually managing.
      zIndex: 4,
      updateWhileAnimating: false,
      updateWhileInteracting: false,
    })

    this.spec = null
  }

  /**
   * Point the layer at a document, or restyle what it has, or empty it.
   *
   * Refetching and restyling are separate on purpose. A style is a handful of
   * numbers the server can change on any render; the document behind it can be
   * hundreds of kilobytes, and re-requesting it because a colour moved would
   * undo the reason for loading it this way.
   */
  reconcile(spec) {
    const previous = this.spec
    this.spec = spec || null

    if (!this.spec) {
      if (previous) this.clear()
      return
    }

    this.layer.setStyle(styleForShape(this.spec.style || {}))

    if (previous && previous.url === this.spec.url && previous.rev === this.spec.rev) return

    // setUrl then refresh, not refresh alone: a bare refresh re-requests the
    // same URL, which an HTTP cache is entitled to answer from its copy — and
    // the whole point of a rev is to ask a question the cache has not heard.
    this.source.setUrl(urlFor(this.spec))
    this.source.refresh()
  }

  /**
   * A click target, in the shape the rest of the map speaks.
   *
   * `null` for both the id and the data of a feature that declares neither: a
   * GeoJSON file is under no obligation to carry an `id` member, and reporting
   * `undefined` to the server is worse than reporting nothing.
   */
  shapeFor(feature) {
    if (!feature) return null

    const { geometry, ...properties } = feature.getProperties()

    return {
      id: feature.getId() ?? null,
      data: Object.keys(properties).length > 0 ? properties : null,
    }
  }

  get extent() {
    return this.source.getFeatures().length > 0 ? this.source.getExtent() : null
  }

  clear() {
    // Both, and in this order: clearing alone leaves the source pointed at the
    // document, and the next `refresh()` would fetch it all over again.
    this.source.setUrl(undefined)
    this.source.clear()
  }

  dispose() {
    this.clear()
    this.spec = null
  }
}

// The rev rides as a query parameter because that is what makes the request a
// different one. Appended rather than merged, so a URL that already carries a
// query string keeps it.
function urlFor(spec) {
  if (spec.rev == null) return spec.url

  const separator = spec.url.includes("?") ? "&" : "?"

  return `${spec.url}${separator}rev=${encodeURIComponent(spec.rev)}`
}
