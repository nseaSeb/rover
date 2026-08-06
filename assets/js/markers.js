import Feature from "ol/Feature.js"
import Point from "ol/geom/Point.js"
import VectorLayer from "ol/layer/Vector.js"
import VectorSource from "ol/source/Vector.js"

import { project } from "./coords.js"
import { styleFor } from "./styles.js"

const ROVER_KEY = "rover"

/**
 * Holds the marker layer and keeps it in sync with the list the server sent.
 *
 * The whole point of this class is that `reconcile` is *not* "clear and
 * redraw". Markers are keyed by their id; on every update we compute what
 * changed and touch only that. Moving one vehicle in a fleet of five hundred
 * updates one geometry — the other 499 features, and their cached styles, are
 * left exactly as they were. Nothing flickers, nothing is reallocated, and an
 * in-flight animation or an open tooltip survives the update.
 */
export class MarkerLayer {
  constructor() {
    this.source = new VectorSource({ wrapX: false })
    this.layer = new VectorLayer({
      source: this.source,
      // Markers are the thing the user came for: keep them above every other
      // layer regardless of the order layers happen to be added in.
      zIndex: 10,
      updateWhileAnimating: true,
      updateWhileInteracting: true,
    })
    this.entries = new Map()
  }

  reconcile(markers) {
    const seen = new Set()
    const added = []

    for (const marker of markers) {
      const key = String(marker.id)
      seen.add(key)

      const geometryHash = `${marker.lat},${marker.lon}`
      const appearanceHash = appearanceOf(marker)
      const entry = this.entries.get(key)

      if (!entry) {
        added.push(this.build(key, marker, geometryHash, appearanceHash))
        continue
      }

      // Two hashes rather than one: a marker that merely moved should not throw
      // away its style, and a marker that was merely relabelled should not
      // touch its geometry.
      if (entry.geometryHash !== geometryHash) {
        entry.feature.getGeometry().setCoordinates(project(marker.lat, marker.lon))
        entry.geometryHash = geometryHash
      }

      if (entry.appearanceHash !== appearanceHash) {
        entry.feature.setStyle(styleFor(marker))
        entry.appearanceHash = appearanceHash
      }

      entry.marker = marker
      entry.feature.setProperties({ [ROVER_KEY]: marker }, true)
    }

    for (const [key, entry] of this.entries) {
      if (!seen.has(key)) {
        this.source.removeFeature(entry.feature)
        this.entries.delete(key)
      }
    }

    // One batched insert: OpenLayers reindexes its R-tree once instead of once
    // per feature.
    if (added.length > 0) this.source.addFeatures(added)
  }

  build(key, marker, geometryHash, appearanceHash) {
    const feature = new Feature({ geometry: new Point(project(marker.lat, marker.lon)) })
    feature.setId(key)
    feature.setStyle(styleFor(marker))
    feature.setProperties({ [ROVER_KEY]: marker }, true)

    this.entries.set(key, { feature, marker, geometryHash, appearanceHash })
    return feature
  }

  markerFor(feature) {
    return feature && feature.get(ROVER_KEY)
  }

  markerById(id) {
    const entry = this.entries.get(String(id))
    return entry && entry.marker
  }

  featureById(id) {
    const entry = this.entries.get(String(id))
    return entry && entry.feature
  }

  /**
   * Drop the cached geometry hash for a feature the client moved on its own.
   *
   * After a drag, the geometry no longer matches the coordinates the server
   * sent. Without this, the next payload carrying those same coordinates hashes
   * identically and is skipped as "unchanged" — so a rejected drag would stick,
   * and the marker would stay wherever the user dropped it forever.
   */
  forgetGeometry(feature) {
    const entry = feature && this.entries.get(String(feature.getId()))
    if (entry) entry.geometryHash = null
  }

  isDraggable(feature) {
    const marker = this.markerFor(feature)
    return Boolean(marker && marker.draggable)
  }

  get extent() {
    return this.entries.size > 0 ? this.source.getExtent() : null
  }

  dispose() {
    this.source.clear()
    this.entries.clear()
  }
}

function appearanceOf(marker) {
  return [
    marker.label || "",
    marker.color || "",
    marker.emoji || "",
    marker.icon || "",
    marker.scale || "",
  ].join("|")
}
