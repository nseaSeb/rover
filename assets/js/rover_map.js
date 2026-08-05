import Map from "ol/Map.js"
import View from "ol/View.js"
import Overlay from "ol/Overlay.js"
import TileLayer from "ol/layer/Tile.js"
import XYZ from "ol/source/XYZ.js"
import Attribution from "ol/control/Attribution.js"
import FullScreen from "ol/control/FullScreen.js"
import Rotate from "ol/control/Rotate.js"
import ScaleLine from "ol/control/ScaleLine.js"
import Zoom from "ol/control/Zoom.js"
import Translate from "ol/interaction/Translate.js"
import { defaults as defaultInteractions } from "ol/interaction/defaults.js"

import { extentToBbox, project, unproject } from "./coords.js"
import { MarkerLayer } from "./markers.js"

const HIT_TOLERANCE = 6
const ANIMATION_MS = 350
const DEFAULT_CENTER = [0, 0]
const DEFAULT_ZOOM = 2

export class RoverMap {
  constructor(element, config, push) {
    this.element = element
    this.config = normalizeConfig(config)
    this.push = push || (() => {})
    this.hasFitted = false
    // Programmatic view changes still fire `moveend`. Without this window, a
    // LiveView that assigns `center` in response to `on_move_end` would ping-pong
    // with the client forever. A time window rather than a counter: a dropped
    // callback can only ever cost us one suppressed event, never wedge the map
    // into silence.
    this.quietUntil = 0

    this.markerLayer = new MarkerLayer()
    this.tileLayer = new TileLayer({ zIndex: 0 })
    this.applyTiles(this.config.tiles)

    this.map = new Map({
      target: element,
      layers: [this.tileLayer, this.markerLayer.layer],
      controls: buildControls(this.config),
      interactions: buildInteractions(this.config),
      view: new View({
        center: project(this.config.center[0], this.config.center[1]),
        zoom: this.config.zoom,
        minZoom: this.config.minZoom,
        maxZoom: this.config.maxZoom,
        constrainResolution: true,
      }),
    })

    this.setupTooltip()
    this.setupDragging()
    this.setupEvents()
    this.observeResize()
  }

  // -- updates from the server ---------------------------------------------

  setMarkers(markers) {
    this.markerLayer.reconcile(markers)
    this.maybeFit()
  }

  setConfig(config) {
    const previous = this.config
    const next = normalizeConfig(config)
    this.config = next

    if (shouldRecenter(previous, next)) this.animateTo(next.center, next.zoom)

    if (changed(previous.tiles, next.tiles)) this.applyTiles(next.tiles)

    // Controls and interactions were built once at mount. A map that locks
    // itself while a form is saving, or that turns on the scale line, needs them
    // rebuilt — otherwise the attribute change reaches the client and does
    // nothing at all.
    if (changed(previous.controls, next.controls) || previous.interactive !== next.interactive) {
      this.applyControls(next)
    }

    if (previous.interactive !== next.interactive) this.applyInteractions(next)

    const view = this.map.getView()
    if (previous.minZoom !== next.minZoom) view.setMinZoom(next.minZoom ?? 0)
    if (previous.maxZoom !== next.maxZoom) view.setMaxZoom(next.maxZoom ?? 28)
  }

  animateTo(center, zoom) {
    this.beQuiet(ANIMATION_MS)
    this.map.getView().animate({ center: project(center[0], center[1]), zoom, duration: ANIMATION_MS })
  }

  maybeFit() {
    // With no center from the caller, "put my markers on screen" is the whole
    // instruction, so the first frame is always fitted — the client is the only
    // side that knows the viewport size. `fit` then governs *re*fitting.
    const initial = !this.hasFitted && this.config.derivedCenter
    const mode = this.config.fit

    if (!initial) {
      if (!mode) return
      if (mode === "once" && this.hasFitted) return
    }

    const extent = this.markerLayer.extent
    if (!extent || !Number.isFinite(extent[0])) return

    // The very first fit happens as the map appears, so it should be instant;
    // later ones are a change the user is watching, so they animate.
    const duration = this.hasFitted ? ANIMATION_MS : 0
    this.hasFitted = true
    this.beQuiet(duration)

    const padding = this.config.fitPadding ?? 48
    this.map.getView().fit(extent, {
      size: this.map.getSize(),
      padding: [padding, padding, padding, padding],
      // A single marker has a zero-width extent; fitting it literally would zoom
      // to the maximum. Cap it at something a human would have chosen.
      maxZoom: 16,
      duration,
    })
  }

  beQuiet(duration) {
    this.quietUntil = now() + duration + 120
  }

  applyTiles(tiles) {
    if (!tiles) {
      this.tileLayer.setSource(null)
      this.tileLayer.setVisible(false)
      return
    }

    this.tileLayer.setVisible(true)
    this.tileLayer.setSource(
      new XYZ({
        url: resolveRetina(tiles.url),
        attributions: tiles.attributions || undefined,
        maxZoom: tiles.maxZoom ?? 19,
        crossOrigin: "anonymous",
      })
    )
  }

  applyControls(config) {
    const controls = this.map.getControls()
    controls.clear()
    buildControls(config).forEach((control) => controls.push(control))
  }

  applyInteractions(config) {
    const interactions = this.map.getInteractions()
    interactions.clear()
    buildInteractions(config).forEach((interaction) => interactions.push(interaction))

    this.translate = null
    this.setupDragging()
  }

  // -- interaction ----------------------------------------------------------

  setupTooltip() {
    this.tooltipEl = document.createElement("div")
    this.tooltipEl.className = "rover-tooltip"
    this.tooltipEl.hidden = true

    this.tooltip = new Overlay({
      element: this.tooltipEl,
      offset: [0, -14],
      positioning: "bottom-center",
      stopEvent: false,
    })
    this.map.addOverlay(this.tooltip)
  }

  showTooltip(marker, coordinate) {
    const text = marker.tooltip || marker.label
    if (!text) return this.hideTooltip()

    this.tooltipEl.textContent = text
    this.tooltipEl.hidden = false
    this.tooltip.setPosition(coordinate)
  }

  hideTooltip() {
    this.tooltipEl.hidden = true
    this.tooltip.setPosition(undefined)
  }

  setupDragging() {
    if (this.config.interactive === false) return

    this.translate = new Translate({
      filter: (feature) => this.markerLayer.isDraggable(feature),
      hitTolerance: HIT_TOLERANCE,
    })

    this.translate.on("translateend", (event) => {
      event.features.forEach((feature) => {
        const marker = this.markerLayer.markerFor(feature)
        if (!marker) return

        // The geometry now disagrees with the coordinates the server sent. Forget
        // the cached hash so that the next payload — whether it accepts the drag
        // or rejects it — is applied rather than skipped as "unchanged".
        this.markerLayer.forgetGeometry(feature)

        const { lat, lon } = unproject(feature.getGeometry().getCoordinates())
        this.emit("markerDragEnd", { id: marker.id, lat, lon, data: marker.data ?? null })
      })
    })

    this.map.addInteraction(this.translate)
  }

  setupEvents() {
    this.map.on("pointermove", (event) => {
      if (this.config.interactive === false) return
      if (event.dragging) return this.hideTooltip()

      const feature = this.featureAt(event.pixel)
      const marker = this.markerLayer.markerFor(feature)

      this.map.getTargetElement().style.cursor = marker ? "pointer" : ""

      if (marker) {
        this.showTooltip(marker, feature.getGeometry().getCoordinates())
      } else {
        this.hideTooltip()
      }
    })

    this.map.getViewport().addEventListener("pointerleave", () => this.hideTooltip())

    this.map.on("singleclick", (event) => {
      if (this.config.interactive === false) return

      const feature = this.featureAt(event.pixel)
      const marker = this.markerLayer.markerFor(feature)

      if (marker) {
        this.emit("markerClick", {
          id: marker.id,
          lat: marker.lat,
          lon: marker.lon,
          data: marker.data ?? null,
        })
      } else {
        const { lat, lon } = unproject(event.coordinate)
        this.emit("mapClick", { lat, lon })
      }
    })

    this.map.on("moveend", () => {
      if (now() < this.quietUntil) return

      const view = this.map.getView()
      const center = unproject(view.getCenter())

      this.emit("moveEnd", {
        center: [center.lat, center.lon],
        zoom: round(view.getZoom(), 2),
        bbox: extentToBbox(view.calculateExtent(this.map.getSize())),
      })
    })
  }

  featureAt(pixel) {
    return this.map.forEachFeatureAtPixel(pixel, (feature) => feature, {
      layerFilter: (layer) => layer === this.markerLayer.layer,
      hitTolerance: HIT_TOLERANCE,
    })
  }

  emit(name, payload) {
    const event = (this.config.events || {})[name]
    if (event) this.push(event, payload)
  }

  // -- lifecycle ------------------------------------------------------------

  observeResize() {
    if (typeof ResizeObserver === "undefined") return

    // Maps inside tabs, drawers or grid layouts are routinely laid out after
    // they are mounted; OpenLayers only learns about it if we tell it.
    this.resizeObserver = new ResizeObserver(() => this.map.updateSize())
    this.resizeObserver.observe(this.element)
  }

  destroy() {
    if (this.resizeObserver) this.resizeObserver.disconnect()
    this.markerLayer.dispose()
    this.map.setTarget(undefined)
  }
}

// -- pure helpers ------------------------------------------------------------

/**
 * Should an incoming config move the view?
 *
 * Only when the caller actually asked for a center. When no `center` was given,
 * Rover derives one from the markers — and that value changes every time any
 * marker moves. Treating it as an instruction would animate the view (and reset
 * the zoom) behind the user's back on every marker update.
 */
export function shouldRecenter(previous, next) {
  if (next.derivedCenter) return false

  return !sameCenter(previous.center, next.center) || previous.zoom !== next.zoom
}

export function normalizeConfig(config) {
  const source = config || {}

  return {
    ...source,
    center: Array.isArray(source.center) ? source.center : DEFAULT_CENTER,
    zoom: typeof source.zoom === "number" ? source.zoom : DEFAULT_ZOOM,
  }
}

function buildControls(config) {
  const wanted = config.controls || {}
  const locked = config.interactive === false
  const controls = []

  // Zoom buttons are an interaction. Attribution is a licence obligation, and
  // the scale line is passive — both survive a locked map.
  if (!locked && wanted.zoom !== false) controls.push(new Zoom())
  if (wanted.attribution !== false) controls.push(new Attribution({ collapsible: true }))
  if (wanted.scaleLine) controls.push(new ScaleLine())
  if (!locked && wanted.fullScreen) controls.push(new FullScreen())
  if (!locked && wanted.rotate) controls.push(new Rotate())

  return controls
}

function buildInteractions(config) {
  return config.interactive === false ? [] : defaultInteractions().getArray()
}

// Carto and friends use Leaflet's `{r}` placeholder for retina tiles, which
// OpenLayers does not know about. Resolve it once, here, rather than making
// every caller strip it out of their URL.
function resolveRetina(url) {
  const ratio = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1
  return url.replace(/\{r\}/g, ratio > 1.5 ? "@2x" : "")
}

function sameCenter(a, b) {
  return Boolean(a) && Boolean(b) && a[0] === b[0] && a[1] === b[1]
}

function changed(a, b) {
  return JSON.stringify(a ?? null) !== JSON.stringify(b ?? null)
}

function now() {
  return typeof performance !== "undefined" ? performance.now() : Date.now()
}

function round(value, digits) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}
