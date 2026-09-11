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
  constructor({ onLoad } = {}) {
    this.source = new VectorSource({ wrapX: false })
    this.layer = new VectorLayer({
      source: this.source,
      // Under the shapes the server sends, over the tiles: geometry loaded in
      // bulk is backdrop for the shapes an application is actually managing.
      zIndex: 4,
      updateWhileAnimating: false,
      updateWhileInteracting: false,
    })

    this.spec = null
    this.onLoad = onLoad || (() => {})

    // Whether the map has framed what this layer holds. The owner sets it; the
    // layer clears it whenever the document changes, because a different
    // document is a different thing to frame — a source toggled off and back on
    // over another region would otherwise land entirely off-screen.
    this.framed = false

    // Which request the features on the map belong to.
    //
    // The document is fetched here rather than through `source.setUrl`, and
    // this counter is why. A rev bumped while a large one is still arriving
    // leaves two responses racing, and OpenLayers' own loader has no handle to
    // cancel the first: it indexes features by id, so a stale response landing
    // second is ignored, and one landing first takes the ids and makes the
    // fresh features duplicates to be dropped — leaving the old document on the
    // map, under the new URL, until somebody bumps the rev again. A response
    // from anything but the current request is thrown away instead.
    this.request = 0
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

    // A rev bump is the same document again, and the view the user has since
    // chosen is theirs to keep. A different URL is not.
    if (!previous || previous.url !== this.spec.url) this.framed = false

    this.load()
  }

  load() {
    const url = urlFor(this.spec)
    this.request += 1
    const request = this.request

    this.requested = url

    fetch(url, { credentials: "same-origin" })
      .then((response) => {
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)

        return response.text()
      })
      .then((text) => {
        // A newer request has been made, or the source has been emptied, since
        // this one went out.
        if (request !== this.request) return

        this.source.clear()
        this.source.addFeatures(format.readFeatures(text))
        this.onLoad()
      })
      // A 404, a 500 or a document that will not parse leaves the layer empty,
      // and empty is indistinguishable from "the file says so". Saying which it
      // was is the only thing that separates a bad path from an empty result.
      //
      // Emptied, and not left showing the last document that did load: that one
      // answers to a URL nobody is asking for any more, and it would go on being
      // clickable and go on being framed with nothing but a console line to say
      // it is stale.
      .catch((error) => {
        if (request === this.request) this.source.clear()

        console.error(`[rover] could not load ${url}:`, error)
      })
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
    // Bumped as well as emptied: a response already on its way belongs to a
    // document nobody is asking for any more.
    this.request += 1
    this.requested = null
    this.framed = false
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

  // Split on the fragment first. A rev appended after one is never sent to the
  // server at all, so it neither reaches the endpoint nor makes the request a
  // different one — bumping it would silently stop reloading.
  const [path, fragment] = splitFragment(spec.url)
  const separator = path.includes("?") ? "&" : "?"

  return `${path}${separator}rev=${encodeURIComponent(spec.rev)}${fragment}`
}

function splitFragment(url) {
  const hash = url.indexOf("#")

  return hash === -1 ? [url, ""] : [url.slice(0, hash), url.slice(hash)]
}
