import GeoJSON from "ol/format/GeoJSON.js"
import VectorLayer from "ol/layer/Vector.js"
import VectorSource from "ol/source/Vector.js"
import Fill from "ol/style/Fill.js"
import Stroke from "ol/style/Stroke.js"
import Style from "ol/style/Style.js"
import Text from "ol/style/Text.js"

// Deliberately not "rover": markerFor() reads that key, and a shape answering to
// it would be handed to marker click handlers as if it were a pin.
const SHAPE_KEY = "roverShape"

const DEFAULT_COLOR = "#2563eb"
const DEFAULT_WIDTH = 2
const DEFAULT_FILL_OPACITY = 0.12
const CACHE_LIMIT = 256

// Separate from the marker style cache on purpose. That one is a module-level
// Map shared by every map on the page, and a few hundred polygons would evict
// every pin style in it.
const cache = new Map()

// GeoJSON is longitude-first in WGS 84; the map renders in Web Mercator. One
// reader, configured once, does that conversion for every geometry — exported
// so rover_map.js can run it in reverse (writeGeometryObject) on a shape a user
// just edited, the same projection flip applied symmetrically both ways.
export const format = new GeoJSON({
  dataProjection: "EPSG:4326",
  featureProjection: "EPSG:3857",
})

/**
 * Holds the shape layer and keeps it in sync with the list the server sent.
 *
 * Same contract as `MarkerLayer`: keyed by id, only what changed is touched. The
 * difference is that geometry is compared by the server-supplied `rev` rather
 * than by hashing coordinates — a route can be thousands of points, and hashing
 * it on every update is the cost this class exists to avoid.
 *
 * One shape can also become several OpenLayers features, because a
 * FeatureCollection is a legal geometry, so each entry holds an array.
 */
export class ShapeLayer {
  constructor() {
    this.source = new VectorSource({ wrapX: false })
    this.layer = new VectorLayer({
      source: this.source,
      // Above the tiles, below the markers: an outline should never swallow the
      // pin that sits on it.
      zIndex: 5,
      updateWhileAnimating: false,
      updateWhileInteracting: false,
    })
    this.entries = new Map()
  }

  reconcile(shapes) {
    const seen = new Set()
    const added = []

    for (const shape of shapes) {
      const key = String(shape.id)
      seen.add(key)

      const rev = String(shape.rev)
      const appearanceHash = appearanceOf(shape)
      const entry = this.entries.get(key)

      if (!entry) {
        added.push(...this.build(key, shape, rev, appearanceHash))
        continue
      }

      if (entry.rev !== rev) {
        // Geometry cannot be mutated in place the way a Point's coordinates can,
        // so this one shape is rebuilt — and only this one.
        entry.features.forEach((feature) => this.source.removeFeature(feature))
        added.push(...this.build(key, shape, rev, appearanceHash))
        continue
      }

      if (entry.appearanceHash !== appearanceHash) {
        const style = styleForShape(shape)
        entry.features.forEach((feature) => feature.setStyle(style))
        entry.appearanceHash = appearanceHash
      }

      entry.shape = shape
      entry.features.forEach((feature) =>
        feature.setProperties({ [SHAPE_KEY]: shape }, true)
      )
    }

    for (const [key, entry] of this.entries) {
      if (!seen.has(key)) {
        entry.features.forEach((feature) => this.source.removeFeature(feature))
        this.entries.delete(key)
      }
    }

    if (added.length > 0) this.source.addFeatures(added)
  }

  build(key, shape, rev, appearanceHash) {
    const features = readGeometry(shape)
    const style = styleForShape(shape)

    features.forEach((feature, index) => {
      feature.setId(`${key}:${index}`)
      feature.setStyle(style)
      feature.setProperties({ [SHAPE_KEY]: shape }, true)
    })

    this.entries.set(key, { features, shape, rev, appearanceHash })
    return features
  }

  shapeFor(feature) {
    return feature && feature.get(SHAPE_KEY)
  }

  /**
   * Whether a rendered feature may have its vertices dragged.
   *
   * A shape backed by more than one feature (a FeatureCollection) has no single
   * geometry a drag could write back to a single `:geometry` field, so only a
   * shape whose entry holds exactly one feature qualifies — this is what
   * `ol/interaction/Modify`'s `filter` option calls per feature.
   */
  isEditable(feature) {
    const shape = this.shapeFor(feature)
    if (!shape || !shape.editable) return false

    const entry = this.entries.get(String(shape.id))
    return Boolean(entry && entry.features.length === 1)
  }

  /**
   * Drop the cached revision for a feature the client edited on its own.
   *
   * Mirrors `MarkerLayer.forgetGeometry`, but for the rev a shape is diffed by
   * instead of a coordinate hash: without this, a server payload that echoes
   * back the same `:rev` — whether it accepted the edit or rejected it — would
   * hash-match the stale entry and `reconcile()` would skip re-applying it,
   * leaving the shape wherever the user last dragged it regardless of what the
   * server actually decided.
   */
  forgetRev(feature) {
    const shape = this.shapeFor(feature)
    const entry = shape && this.entries.get(String(shape.id))
    if (entry) entry.rev = null
  }

  /**
   * The GeoJSON `properties` a shape's own `:geometry` carried, if it was a
   * `Feature` (or a single-member `FeatureCollection`) rather than a bare
   * geometry — `null` otherwise.
   *
   * `writeGeometryObject`, used to report an edit back, only ever writes the
   * bare geometry — there is no `writeFeatureObject` call anywhere in the
   * edit path. Without this, merging that bare geometry straight into
   * `:geometry` silently drops whatever `properties` a `Feature`-wrapped
   * shape carried, on the first accepted edit.
   */
  propertiesFor(feature) {
    const shape = this.shapeFor(feature)
    const geometry = shape && shape.geometry
    if (!geometry) return null

    if (geometry.type === "Feature") return geometry.properties ?? null

    if (geometry.type === "FeatureCollection" && geometry.features?.length === 1) {
      return geometry.features[0].properties ?? null
    }

    return null
  }

  get extent() {
    return this.entries.size > 0 ? this.source.getExtent() : null
  }

  dispose() {
    this.source.clear()
    this.entries.clear()
  }
}

function readGeometry(shape) {
  try {
    // readFeatures reads a bare geometry, a Feature and a FeatureCollection
    // alike, so Rover does not have to unwrap anything before handing it over.
    return format.readFeatures(shape.geometry)
  } catch (error) {
    console.error(`[rover] shape ${shape.id} has unreadable geometry:`, error, shape.geometry)
    return []
  }
}

export function styleForShape(shape) {
  const key = appearanceOf(shape)

  let style = cache.get(key)

  if (!style) {
    style = buildStyle(shape)
    if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value)
    cache.set(key, style)
  }

  return style
}

function buildStyle(shape) {
  const color = shape.color || DEFAULT_COLOR
  const opacity = shape.fill_opacity ?? DEFAULT_FILL_OPACITY

  const style = new Style({
    stroke: new Stroke({ color, width: shape.width || DEFAULT_WIDTH }),
    fill: new Fill({ color: withOpacity(shape.fill_color || color, opacity) }),
  })

  if (shape.label) {
    style.setText(
      new Text({
        text: shape.label,
        font: "500 12px ui-sans-serif, system-ui, -apple-system, sans-serif",
        fill: new Fill({ color: "#111827" }),
        stroke: new Stroke({ color: "rgba(255, 255, 255, 0.92)", width: 3 }),
        overflow: true,
      })
    )
  }

  return style
}

// OpenLayers takes an [r, g, b, a] array, which lets a fill be translucent
// without the caller having to write rgba() by hand. Hex is the format everyone
// actually passes; any other CSS colour is handed through untouched, and its
// opacity is whatever the colour itself says.
function withOpacity(color, opacity) {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color)
  if (!hex) return color

  let digits = hex[1]
  if (digits.length === 3) digits = digits.split("").map((d) => d + d).join("")

  return [
    parseInt(digits.slice(0, 2), 16),
    parseInt(digits.slice(2, 4), 16),
    parseInt(digits.slice(4, 6), 16),
    opacity,
  ]
}

function appearanceOf(shape) {
  return [
    shape.color || "",
    shape.width || "",
    shape.fill_color || "",
    shape.fill_opacity ?? "",
    shape.label || "",
  ].join("|")
}
