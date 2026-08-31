import VectorLayer from "ol/layer/Vector.js"
import VectorSource from "ol/source/Vector.js"
import Circle from "ol/style/Circle.js"
import Fill from "ol/style/Fill.js"
import Stroke from "ol/style/Stroke.js"
import Style from "ol/style/Style.js"

const PENDING_COLOR = "#2563eb"

// What `Rover.start_drawing/3` may ask for, keyed by the GeoJSON type name the
// server sends. Circle is absent on purpose rather than by omission: OpenLayers
// can draw one, GeoJSON cannot represent one, so a drawn circle could never
// round-trip back through `Rover.Shape`.
const TYPES = new Set(["Point", "LineString", "Polygon"])

/**
 * The GeoJSON type name to hand `ol/interaction/Draw`, or `null` when the
 * payload asks for something that cannot round-trip.
 *
 * Pure, and exported, because the refusal is the interesting half and reaching it
 * through a real map means getting a malformed payload past the server first.
 */
export function drawTypeFor(type) {
  return TYPES.has(type) ? type : null
}

/**
 * The scratch layer a shape is drawn into before the server has seen it.
 *
 * A separate source from `ShapeLayer`'s, which is the whole point. `ShapeLayer`
 * tracks what it renders in `this.entries`, populated by `build()`; a feature
 * that `Draw` put straight into its source would be an untracked orphan, and the
 * moment the server echoed the new shape back, `reconcile()` would add its own
 * feature beside it and the map would show the polygon twice.
 *
 * So the sketch lives here, styled as pending, and is cleared the next time
 * anything touches `:shapes` at all. On the accepted path that clear and the
 * server's own feature land in the same `setShapes` call, so the handover is
 * invisible; on the abandoned path it is the cleanup.
 */
export class DrawLayer {
  constructor() {
    this.source = new VectorSource({ wrapX: false })
    this.layer = new VectorLayer({
      source: this.source,
      // Above the shapes it is about to become one of, below the markers.
      zIndex: 6,
      style: pendingStyle(),
    })
  }

  clear() {
    this.source.clear()
  }

  dispose() {
    this.source.clear()
  }
}

// Dashed, so a sketch never looks like a shape the server has accepted — the
// difference matters while the round trip is in flight.
function pendingStyle() {
  return new Style({
    stroke: new Stroke({ color: PENDING_COLOR, width: 2, lineDash: [6, 5] }),
    fill: new Fill({ color: [37, 99, 235, 0.08] }),
    // A drawn Point has no stroke or fill to show.
    image: new Circle({
      radius: 5,
      fill: new Fill({ color: PENDING_COLOR }),
      stroke: new Stroke({ color: "rgba(255, 255, 255, 0.9)", width: 2 }),
    }),
  })
}
