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

export class RoverMap {
  constructor(element, config, push) {
    this.element = element
    this.config = config
    this.push = push
    this.hasFitted = false
    // Programmatic view changes still fire `moveend`. Without this window, a
    // LiveView that assigns `center` in response to `on_move_end` would ping-pong
    // with the client forever. A time window rather than a counter: a dropped
    // callback can only ever cost us one suppressed event, never wedge the map
    // into silence.
    this.quietUntil = 0

    this.markerLayer = new MarkerLayer()
    this.tileLayer = new TileLayer({ zIndex: 0 })
    this.applyTiles(config.tiles)

    this.map = new Map({
      target: element,
      layers: [this.tileLayer, this.markerLayer.layer],
      controls: buildControls(config),
      interactions: config.interactive === false ? [] : defaultInteractions(),
      view: new View({
        center: project(config.center[0], config.center[1]),
        zoom: config.zoom,
        minZoom: config.minZoom,
        maxZoom: config.maxZoom,
        constrainResolution: true,
      }),
    })

    this.setupTooltip()
    this.setupPointer()
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
    this.config = config

    // Compare against what the server sent *last time*, not against where the
    // map currently is. A user who panned away keeps their view; a server that
    // assigns a new center gets an animation.
    if (!sameCenter(previous.center, config.center) || previous.zoom !== config.zoom) {
      this.animateTo(config.center, config.zoom)
    }

    if (JSON.stringify(previous.tiles) !== JSON.stringify(config.tiles)) {
      this.applyTiles(config.tiles)
    }

    const view = this.map.getView()
    if (previous.minZoom !== config.minZoom) view.setMinZoom(config.minZoom ?? 0)
    if (previous.maxZoom !== config.maxZoom) view.setMaxZoom(config.maxZoom ?? 28)
  }

  animateTo(center, zoom) {
    this.beQuiet(ANIMATION_MS)
    this.map
      .getView()
      .animate({ center: project(center[0], center[1]), zoom, duration: ANIMATION_MS })
  }

  maybeFit() {
    const mode = this.config.fit
    if (!mode) return
    if (mode === "once" && this.hasFitted) return

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

  setupPointer() {
    this.map.on("pointermove", (event) => {
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

        const { lat, lon } = unproject(feature.getGeometry().getCoordinates())
        this.emit("markerDragEnd", { id: marker.id, lat, lon, data: marker.data ?? null })
      })
    })

    this.map.addInteraction(this.translate)
  }

  setupEvents() {
    this.map.on("singleclick", (event) => {
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

// -- helpers ----------------------------------------------------------------

function buildControls(config) {
  const wanted = config.controls || {}
  const controls = []

  if (wanted.zoom !== false) controls.push(new Zoom())
  if (wanted.attribution !== false) controls.push(new Attribution({ collapsible: true }))
  if (wanted.scaleLine) controls.push(new ScaleLine())
  if (wanted.fullScreen) controls.push(new FullScreen())
  if (wanted.rotate) controls.push(new Rotate())

  return controls
}

// Carto and friends use Leaflet's `{r}` placeholder for retina tiles, which
// OpenLayers does not know about. Resolve it once, here, rather than making
// every caller strip it out of their URL.
function resolveRetina(url) {
  const suffix = (window.devicePixelRatio || 1) > 1.5 ? "@2x" : ""
  return url.replace(/\{r\}/g, suffix)
}

function sameCenter(a, b) {
  return Boolean(a) && Boolean(b) && a[0] === b[0] && a[1] === b[1]
}

function now() {
  return typeof performance !== "undefined" ? performance.now() : Date.now()
}

function round(value, digits) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}
