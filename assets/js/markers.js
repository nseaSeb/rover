import Feature from "ol/Feature.js"
import Point from "ol/geom/Point.js"
import VectorLayer from "ol/layer/Vector.js"
import Cluster from "ol/source/Cluster.js"
import VectorSource from "ol/source/Vector.js"

import { project } from "./coords.js"
import { clusterStyle, styleFor } from "./styles.js"

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
 *
 * Clustering does not change any of that, which is the whole reason it is
 * affordable. `ol/source/Cluster` *wraps* a source rather than replacing it: the
 * markers stay in `this.source`, reconciled exactly as before, and the cluster
 * source derives grouped features from them for rendering only. What clustering
 * does change is what is on screen — so the click path, the popup anchor and the
 * layer style all have to cope with a feature that is a group rather than a pin.
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
    this.clusterSource = null
  }

  /**
   * Turn grouping on or off.
   *
   * Only the layer's source changes. The markers, their styles and the entry map
   * are untouched, so toggling this mid-session costs nothing and loses nothing.
   */
  setClustering(options) {
    this.releaseClusterSource()

    if (!options) {
      this.layer.setSource(this.source)
      // Back to per-feature styles, which each marker already carries.
      this.layer.setStyle(undefined)
      return
    }

    this.clusterSource = new Cluster({
      source: this.source,
      distance: options.distance ?? 40,
      minDistance: options.minDistance ?? 20,
      // Every other source here is built with wrapX: false; Cluster does not
      // inherit it from the source it wraps, and VectorSource defaults to true —
      // which would repeat the circles across world copies.
      wrapX: false,
    })

    this.layer.setSource(this.clusterSource)
    // A cluster feature is not a marker and has no style of its own, so the layer
    // has to decide: the member's own pin when it is alone, a counted circle when
    // it is not.
    this.layer.setStyle((feature) => this.styleForRendered(feature))
  }

  get clustering() {
    return Boolean(this.clusterSource)
  }

  /**
   * Detach a clusterer we are done with.
   *
   * `ol/source/Cluster` subscribes to the source it wraps in its constructor, and
   * dropping the reference does not unsubscribe. Without this, every toggle of
   * `cluster` leaves another live clusterer re-clustering the whole marker set on
   * every reconcile, in a source nothing draws — five toggles cost five extra full
   * passes per update, for the life of the LiveView.
   */
  releaseClusterSource() {
    if (!this.clusterSource) return

    this.clusterSource.setSource(null)
    this.clusterSource = null
  }

  styleForRendered(feature) {
    const members = feature.get("features")
    if (!members) return undefined

    if (members.length === 1) {
      const marker = members[0].get(ROVER_KEY)
      return marker ? styleFor(marker) : undefined
    }

    return clusterStyle(members.length)
  }

  /**
   * The markers behind a rendered feature: one when it is a pin or a lone cluster,
   * several when it is a group.
   */
  membersOf(feature) {
    if (!feature) return []

    const members = feature.get("features")
    if (!members) {
      const marker = feature.get(ROVER_KEY)
      return marker ? [marker] : []
    }

    return members.map((member) => member.get(ROVER_KEY)).filter(Boolean)
  }

  reconcile(markers) {
    const seen = new Set()
    const added = []

    // A feature already in `this.source` firing a `change` event is exactly what
    // `this.clusterSource` listens for to recluster — so a batch that moves or
    // restyles several markers would otherwise pay for one full clear-and-recluster
    // pass over the whole set per feature touched, not once for the batch.
    // Detaching leaves this.source's own reconciliation untouched (it does not
    // listen to itself) and reattaching at the end triggers exactly one refresh,
    // synchronously, before the browser has any chance to paint the gap.
    const clusterSource = this.clusterSource
    if (clusterSource) clusterSource.setSource(null)

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

    // Reattaching runs exactly one refresh, covering every add, remove, move and
    // restyle from this pass in a single clear-and-recluster.
    if (clusterSource) clusterSource.setSource(this.source)
  }

  build(key, marker, geometryHash, appearanceHash) {
    const feature = new Feature({ geometry: new Point(project(marker.lat, marker.lon)) })
    feature.setId(key)
    feature.setStyle(styleFor(marker))
    feature.setProperties({ [ROVER_KEY]: marker }, true)

    this.entries.set(key, { feature, marker, geometryHash, appearanceHash })
    return feature
  }

  /**
   * The single marker a rendered feature stands for, or null.
   *
   * A group of twelve is not a marker: it has no id to report and no popup to open,
   * so callers must handle it as a cluster instead of being handed one arbitrary
   * member.
   */
  markerFor(feature) {
    const members = this.membersOf(feature)

    return members.length === 1 ? members[0] : null
  }

  /** The markers of a rendered feature when it is a group of more than one. */
  clusterFor(feature) {
    const members = this.membersOf(feature)

    return members.length > 1 ? members : null
  }

  markerById(id) {
    const entry = this.entries.get(String(id))
    return entry && entry.marker
  }

  /**
   * The feature currently *on screen* for a marker — which is not always the
   * feature the reconciler built.
   *
   * When clustering, a marker is drawn as part of a group whose geometry sits at the
   * members' centroid. Anchoring a popup to the marker's own coordinate would point
   * it away from the pin the user clicked. So a marker that has been grouped with
   * others has no rendered feature of its own, and callers treat that as "nothing to
   * point at" — which closes the popup.
   */
  featureById(id) {
    const entry = this.entries.get(String(id))
    if (!entry) return null
    if (!this.clusterSource) return entry.feature

    return (
      this.clusterSource
        .getFeatures()
        .find((cluster) => {
          const members = cluster.get("features")
          return members && members.length === 1 && members[0] === entry.feature
        }) || null
    )
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
    // Nothing is draggable while clustering. What is under the pointer is a cluster
    // feature, even for a group of one, and `Translate` would move the throwaway
    // Point that Cluster allocated: the marker's own geometry would be untouched,
    // the drag event would report coordinates for a feature that is not the marker,
    // and the next recompute would snap the pin back.
    if (this.clusterSource) return false

    const marker = this.markerFor(feature)
    return Boolean(marker && marker.draggable)
  }

  get extent() {
    return this.entries.size > 0 ? this.source.getExtent() : null
  }

  dispose() {
    this.releaseClusterSource()
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
