import VectorLayer from "ol/layer/Vector.js"
import VectorSource from "ol/source/Vector.js"

import { format, styleForShape } from "./shapes.js"

// Where a feature's own id from the file is kept. Not as the feature's id:
// `ol/source/Vector` indexes by that and silently refuses a second feature
// whose id is already taken, so a document that repeats one — a parcel split
// into several Features, or `1` beside `"1"` — would lose every repeat with
// nothing logged and no error. `ShapeLayer` sidesteps the same rule by keying
// its own features `id:index`.
const SOURCE_ID = "rover:sourceId"

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

    // A different document, so what is on the map answers to a URL nobody is
    // asking for any more: it would go on being clickable — reporting ids from
    // the old file while the server has moved on — and go on being framed,
    // until the response lands. A rev bump is the same document again, and
    // emptying for one would blink it.
    if (previous && previous.url !== this.spec.url) this.source.clear()

    this.load()
  }

  load() {
    const url = urlFor(this.spec)
    this.request += 1
    const request = this.request

    fetch(url, { credentials: "same-origin" })
      .then((response) => {
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)

        return response.text()
      })
      .then((text) => {
        // A newer request has been made, or the source has been emptied, since
        // this one went out.
        if (request !== this.request) return false

        const features = format.readFeatures(text)

        features.forEach((feature) => {
          feature.set(SOURCE_ID, feature.getId() ?? null, true)
          feature.setId(undefined)
        })

        this.source.clear()
        this.source.addFeatures(features)

        return true
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
        // Both gated: a request that has already been superseded has nothing to
        // report. Its features are not this layer's to drop, and naming a URL
        // the map abandoned two revs ago is noise, not a diagnosis.
        if (request === this.request) {
          this.source.clear()
          console.error(`[rover] could not load ${url}:`, error)
        }

        return false
      })
      // After the catch, not inside it. A callback that throws — framing a map
      // whose container has no size yet, say — would otherwise be reported as a
      // document that failed to load, and take the one that just loaded fine
      // off the map with it.
      .then((loaded) => loaded && this.onLoad())
      // The callback's own failures, reported as its own and no further: the
      // document loaded, so the source keeps what it holds. Without this the
      // chain ends on a rejection nobody handles, which Rover's console
      // convention never shows and the browser suite's `pageerror` listener
      // never sees.
      .catch((error) => console.error("[rover] shape_source load callback failed:", error))
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

    const properties = { ...feature.getProperties() }
    // The geometry by the name this feature actually keeps it under, and the id
    // Rover parked out of OpenLayers' way. Neither is data the file declared.
    delete properties[feature.getGeometryName()]
    delete properties[SOURCE_ID]

    return {
      id: feature.get(SOURCE_ID) ?? null,
      data: Object.keys(properties).length > 0 ? properties : null,
    }
  }

  get extent() {
    if (this.source.isEmpty()) return null

    const extent = this.source.getExtent()

    // A document whose features all carry `"geometry": null` — which GeoJSON
    // allows — has features and no extent, and OpenLayers answers that with
    // infinities. Reporting those as an extent poisons the union every fit is
    // computed from: the map frames the whole plane, or nothing at all.
    return Number.isFinite(extent[0]) ? extent : null
  }

  clear() {
    // Bumped as well as emptied: a response already on its way belongs to a
    // document nobody is asking for any more.
    this.request += 1
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
