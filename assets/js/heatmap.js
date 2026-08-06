import Feature from "ol/Feature.js"
import Point from "ol/geom/Point.js"
import HeatmapLayerOl from "ol/layer/Heatmap.js"
import VectorSource from "ol/source/Vector.js"

import { project } from "./coords.js"

/**
 * A density field, kept in sync with the point list the server sent.
 *
 * Deliberately not reconciled feature by feature the way markers and shapes are.
 * No individual point is visible in the output — the whole thing is one aggregate —
 * so per-point identity would buy nothing and cost every caller an id. The server
 * sends a revision instead, and the field is rebuilt only when that changes.
 *
 * Rebuilding is O(n) in the points, which is also what changing a density field
 * costs no matter how it is done.
 */
export class HeatmapLayer {
  constructor() {
    this.source = new VectorSource({ wrapX: false })
    this.layer = new HeatmapLayerOl({
      source: this.source,
      // Under the shapes and the markers: a heat field is background, and covering
      // a parcel outline with it would defeat both.
      zIndex: 2,
      weight: (feature) => feature.get("weight"),
    })
    this.rev = null
    this.count = 0
  }

  // A null payload means the map has no heat field at all — the attribute is absent
  // rather than an empty object, so that every map without one carries nothing.
  reconcile(payload) {
    const { points = [], rev = null, style } = payload || {}

    this.applyStyle(style)

    const next = String(rev)
    if (next === this.rev) return

    this.rev = next
    this.source.clear()
    this.count = points.length

    if (points.length > 0) {
      this.source.addFeatures(
        points.map((point) => {
          const feature = new Feature({ geometry: new Point(project(point.lat, point.lon)) })
          feature.set("weight", point.weight ?? 1, true)
          return feature
        })
      )
    }
  }

  applyStyle(style) {
    if (!style) return

    // Setters rather than a rebuilt layer: radius and blur are the two things a
    // caller tunes interactively, and rebuilding would drop the rendered field for
    // a frame each time.
    if (typeof style.radius === "number") this.layer.setRadius(style.radius)
    if (typeof style.blur === "number") this.layer.setBlur(style.blur)
    if (typeof style.opacity === "number") this.layer.setOpacity(style.opacity)
    if (Array.isArray(style.gradient) && style.gradient.length > 1) {
      this.layer.setGradient(style.gradient)
    }
  }

  get extent() {
    return this.count > 0 ? this.source.getExtent() : null
  }

  dispose() {
    this.source.clear()
    this.count = 0
    this.rev = null
  }
}
