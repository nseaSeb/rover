import LayerGroup from "ol/layer/Group.js"

import { buildTileLayer } from "./tiles.js"

/**
 * The tile layers drawn between the basemap and everything else.
 *
 * One `ol/layer/Group` holding them all, rather than N layers juggled in the
 * map's own collection: the group is inserted once, at one z-index, and
 * reconciling a list of overlays becomes ordinary work on the group's
 * collection instead of surgery on the map's — which the basemap swap in slot 0
 * is already doing enough of.
 *
 * Reconciled like markers and shapes, and for the same reason. Rebuilding every
 * layer on every render would re-request every tile, so a map that toggles one
 * overlay's opacity would blink the other three. What identifies a layer is its
 * `id` when the caller gave it one, and its position in the list when they did
 * not — position being the honest default, since two layers of the same tiles
 * are otherwise indistinguishable.
 */
export class OverlayLayers {
  constructor() {
    // Above the basemap in slot 0, below the heatmap at 2. Overlays build up a
    // basemap; they never cover the caller's own data.
    this.layer = new LayerGroup({ zIndex: 1 })
    this.entries = []
  }

  /**
   * Apply a list of overlay configs, touching only what changed.
   *
   * A null or empty list is a map with no overlays, which is the common case —
   * the attribute is absent rather than an empty array, so nothing to do.
   */
  reconcile(layers) {
    const wanted = layers || []
    const previous = this.entries
    const collection = this.layer.getLayers()

    this.entries = wanted.map((config, index) => {
      const key = keyOf(config, index)
      const existing = previous.find((entry) => entry.key === key)

      // Same tiles under the same name: keep the layer, and with it every tile
      // the browser has already fetched into it.
      if (existing && sameTiles(existing.tiles, config.tiles)) {
        applyOptions(existing.layer, config)
        return { ...existing, tiles: config.tiles }
      }

      const layer = buildTileLayer(config.tiles)
      applyOptions(layer, config)

      return { key, tiles: config.tiles, layer }
    })

    // Whatever survived keeps its object identity; the rest is disposed, which
    // for a vector group is what stops its tile loading.
    previous
      .filter((entry) => !this.entries.some((kept) => kept.layer === entry.layer))
      .forEach((entry) => entry.layer.dispose())

    collection.clear()
    this.entries.forEach((entry) => collection.push(entry.layer))
  }

  dispose() {
    this.entries.forEach((entry) => entry.layer.dispose())
    this.entries = []
    this.layer.getLayers().clear()
  }
}

// An id names a layer across a reordering; without one, the position in the list
// is the only thing that can tell two entries apart, so it is the identity.
function keyOf(config, index) {
  return config.id != null ? `id:${config.id}` : `at:${index}`
}

// The whole resolved tiles config, compared as the server sent it: a changed URL,
// style document, attribution or max zoom all mean a layer that has to be rebuilt
// rather than adjusted.
function sameTiles(previous, next) {
  return JSON.stringify(previous) === JSON.stringify(next)
}

// Every option OpenLayers can change on a live layer. An absent one is not an
// instruction to keep whatever the layer happens to hold — a caller who drops
// `opacity` from the list means the default again — so each is applied, always.
function applyOptions(layer, config) {
  layer.setOpacity(config.opacity ?? 1)
  layer.setVisible(config.visible !== false)
  layer.setMinZoom(config.minZoom ?? -Infinity)
  layer.setMaxZoom(config.maxZoom ?? Infinity)
}
