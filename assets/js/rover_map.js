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
import { never } from "ol/events/condition.js"
import Draw from "ol/interaction/Draw.js"
import Modify from "ol/interaction/Modify.js"
import Snap from "ol/interaction/Snap.js"
import Translate from "ol/interaction/Translate.js"
import { defaults as defaultInteractions } from "ol/interaction/defaults.js"
import { createEmpty, extend } from "ol/extent.js"

import { extentToBbox, project, unproject } from "./coords.js"
import { DrawLayer, drawTypeFor } from "./draw.js"
import { HeatmapLayer } from "./heatmap.js"
import { MarkerLayer } from "./markers.js"
import { ShapeLayer, format as geoJsonFormat } from "./shapes.js"

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
    // Client-side subscribers, kept separate from `push`. A popup must open on a
    // marker click even when the application never wired on_marker_click — the
    // server has no part to play in it.
    this.listeners = {}

    // What `Rover.start_drawing/3` armed, or null. Held rather than inferred from
    // the interaction, because `applyInteractions` throws every interaction away
    // and needs to know whether to arm a new one afterwards.
    this.drawing = null

    this.markerLayer = new MarkerLayer()
    this.shapeLayer = new ShapeLayer()
    this.drawLayer = new DrawLayer()
    this.heatmapLayer = new HeatmapLayer()
    this.tileLayer = new TileLayer({ zIndex: 0 })
    this.applyTiles(this.config.tiles)

    this.map = new Map({
      target: element,
      layers: [
        this.tileLayer,
        this.heatmapLayer.layer,
        this.shapeLayer.layer,
        this.drawLayer.layer,
        this.markerLayer.layer,
      ],
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

    this.markerLayer.setClustering(this.config.cluster)

    this.setupTooltip()
    // Editing before dragging: OpenLayers checks the most-recently-added
    // interaction first, so this order is what makes a draggable marker win a
    // pointer-gesture tie against an editable shape's vertex sitting under it —
    // matching featureAt()'s "markers win ties" rule for clicks.
    this.setupEditing()
    this.setupDragging()
    this.setupEvents()
    this.observeResize()
  }

  // -- updates from the server ---------------------------------------------

  setMarkers(markers) {
    this.markerLayer.reconcile(markers)
    this.maybeFit()
  }

  setShapes(shapes) {
    this.acceptShapes(shapes)
    this.maybeFit()
  }

  setHeatmap(heatmap) {
    this.heatmapLayer.reconcile(heatmap)
    this.maybeFit()
  }

  /**
   * Load both layers and fit once.
   *
   * Calling setShapes() then setMarkers() fits twice, and the second fit is a
   * no-op: the first one already set `hasFitted`, so with the default
   * `fit: "once"` the markers never entered the initial framing at all. Anything
   * outside the shapes' bounding box was simply off-screen, for good. The mount
   * path and any update touching both layers go through here instead.
   */
  setContent({ markers, shapes, heatmap }) {
    if (heatmap !== undefined) this.heatmapLayer.reconcile(heatmap)
    if (shapes !== undefined) this.acceptShapes(shapes)
    if (markers !== undefined) this.markerLayer.reconcile(markers)
    this.maybeFit()
  }

  /**
   * Take a shape list from the server, and drop whatever was sketched.
   *
   * The two happen in one synchronous call, so when this is the update carrying
   * the drawn shape the swap from pending sketch to real tracked shape is
   * invisible — there is no frame in which the map shows both or neither.
   *
   * The clear is unconditional, which is the trade: any `:shapes` update drops a
   * finished sketch, including one that arrived from somewhere else — a PubSub
   * broadcast landing between `drawEnd` and the server's echo blanks the polygon
   * until the round trip completes. Recognising *which* update carries the drawn
   * shape would need an identity the client does not have, since assigning one is
   * the whole thing the server does with a `drawEnd`. An unconditional clear is
   * also what cleans up after a sketch the server refused.
   */
  acceptShapes(shapes) {
    this.drawLayer.clear()
    this.shapeLayer.reconcile(shapes)
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

    if (changed(previous.cluster, next.cluster)) this.markerLayer.setClustering(next.cluster)

    const view = this.map.getView()
    if (previous.minZoom !== next.minZoom) view.setMinZoom(next.minZoom ?? 0)
    if (previous.maxZoom !== next.maxZoom) view.setMaxZoom(next.maxZoom ?? 28)
  }

  animateTo(center, zoom) {
    this.beQuiet(ANIMATION_MS)
    this.map.getView().animate({ center: project(center[0], center[1]), zoom, duration: ANIMATION_MS })
  }

  /**
   * A one-shot move, from `Rover.fly_to/4`.
   *
   * Deliberately does not touch `config` or `hasFitted`: the view has been moved,
   * but nothing about what the server is rendering has changed, so the next update
   * must not undo this and must not think a fit is owed.
   */
  flyTo({ center, zoom, duration }) {
    const ms = duration ?? ANIMATION_MS
    this.beQuiet(ms)

    this.map.getView().animate({
      center: project(center[0], center[1]),
      // `undefined` leaves the zoom alone, which is what omitting :zoom means.
      zoom: typeof zoom === "number" ? zoom : undefined,
      duration: ms,
    })
  }

  /** A one-shot fit, from `Rover.fit_to/4`. */
  fitTo({ bbox, padding, maxZoom, duration }) {
    const [south, west, north, east] = bbox
    const [minX, minY] = project(south, west)
    const [maxX, maxY] = project(north, east)

    const ms = duration ?? ANIMATION_MS
    const pad = padding ?? 48
    this.beQuiet(ms)

    this.map.getView().fit([minX, minY, maxX, maxY], {
      size: this.map.getSize(),
      padding: [pad, pad, pad, pad],
      maxZoom,
      duration: ms,
    })
  }

  maybeFit() {
    if (!shouldFit({ hasFitted: this.hasFitted, ...this.config })) return

    const extent = this.contentExtent
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
      maxZoom: fitMaxZoom(this.config, this.shapeLayer.entries.size > 0),
      duration,
    })
  }

  // Every layer that carries content: a heat field alone, or a parcel outline with
  // no pin on it, still frames.
  get contentExtent() {
    const extents = [
      this.heatmapLayer.extent,
      this.shapeLayer.extent,
      this.markerLayer.extent,
    ].filter(Boolean)

    if (extents.length === 0) return null
    if (extents.length === 1) return extents[0]

    const union = createEmpty()
    extents.forEach((extent) => extend(union, extent))
    return union
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

    // Modify.setMap (called when interactions.clear() drops it) tears down its
    // vertex overlay but not the ADDFEATURE/REMOVEFEATURE listeners it put on
    // shapeLayer.source — only dispose() does, via disposeInternal(). Skipping
    // this leaks one Modify's worth of listeners every time interactive toggles.
    if (this.modify) this.modify.dispose()
    this.modify = null
    this.setupEditing()

    this.translate = null
    this.setupDragging()

    // Draw and Snap went out with the rest, and need disposing for the same
    // reason Modify above does. A map that has just been locked is a picture, so
    // stopDrawing() below cancels an armed drawing outright rather than
    // remembering it across the toggle.
    //
    // Nothing re-arms on the LiveView path: `interactive` is a boolean attribute,
    // so this method only runs on a transition, and the only transition that can
    // find a drawing armed is the one into a locked map. The re-arm is for a
    // caller driving `setConfig` from JavaScript, where an unset `interactive`
    // can turn into `true` with the mode still on.
    const type = this.drawing && this.drawing.type
    this.stopDrawing()
    if (type && config.interactive !== false) this.armDrawing(type)
  }

  // -- drawing --------------------------------------------------------------

  /**
   * Arm the map for drawing, from `Rover.start_drawing/3`.
   *
   * A locked map refuses: `interactive={false}` withholds every other pointer
   * gesture, and a drawing mode is the largest of them.
   */
  startDrawing({ type }) {
    if (this.config.interactive === false) return

    const geometryType = drawTypeFor(type)

    if (!geometryType) {
      console.error(`[rover] cannot draw ${JSON.stringify(type)} — expected Point, LineString or Polygon`)
      return
    }

    // Re-arming with a different type replaces the mode rather than stacking a
    // second Draw beside the first, which would put two vertices down per click.
    this.stopDrawing()
    this.armDrawing(geometryType)
  }

  armDrawing(type) {
    this.drawing = { type }

    // Nothing is listening, so every finished sketch will sit in the scratch
    // layer forever: `acceptShapes` is the only thing that clears it, and it runs
    // on a `:shapes` update that can now never come. Say so rather than let the
    // map fill up with dashed phantoms.
    if (!this.wants("drawEnd")) {
      console.error("[rover] drawing was armed with no on_draw_end handler — the shape drawn will go nowhere")
    }

    this.draw = new Draw({ source: this.drawLayer.source, type })

    this.draw.on("drawend", (event) => {
      // Same precision as an edited shape, for the same reason: about a
      // centimetre, rather than the ~15 significant digits a raw Mercator round
      // trip produces.
      const geometry = geoJsonFormat.writeGeometryObject(event.feature.getGeometry(), {
        decimals: 7,
      })

      // No id: the shape does not exist yet, and identity is the server's to
      // assign when it turns this into a `Rover.Shape`.
      this.emit("drawEnd", { type: geometry.type, geometry })
    })

    this.map.addInteraction(this.draw)

    // Snap last. OpenLayers runs interactions in reverse-add order, so this one
    // sees the pointer event before Draw does — which is the only order in which
    // it can move the point onto an existing vertex or edge. Snapping to the
    // shape layer is what lets a new parcel share a border with the one next to
    // it instead of leaving a sliver.
    this.snap = new Snap({ source: this.shapeLayer.source, pixelTolerance: HIT_TOLERANCE })
    this.map.addInteraction(this.snap)

    // Escape abandons the sketch in progress without disarming the mode, the way
    // it does in every drawing tool. The server is not told: it armed a mode, and
    // the mode is still armed.
    // Bound to the document, the way a drawing tool binds it — a sketch is
    // abandoned from wherever the pointer happens to be. The one Escape that is
    // plainly not aimed at the map is the one dismissing what the user is typing
    // into.
    this.onDrawKeydown = (event) => {
      if (event.key !== "Escape" || !this.draw) return
      if (isTextEntry(event.target)) return

      this.draw.abortDrawing()
    }
    document.addEventListener("keydown", this.onDrawKeydown)

    this.element.classList.add("rover-map__canvas--drawing")
  }

  /** Disarm, from `Rover.stop_drawing/2` — and discard the sketch with the mode. */
  stopDrawing() {
    if (this.draw) {
      this.map.removeInteraction(this.draw)
      this.draw.dispose()
      this.draw = null
    }

    if (this.snap) {
      this.map.removeInteraction(this.snap)
      this.snap.dispose()
      this.snap = null
    }

    if (this.onDrawKeydown) {
      document.removeEventListener("keydown", this.onDrawKeydown)
      this.onDrawKeydown = null
    }

    this.drawLayer.clear()
    this.drawing = null
    this.element.classList.remove("rover-map__canvas--drawing")
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

  setupEditing() {
    if (this.config.interactive === false) return

    this.modify = new Modify({
      source: this.shapeLayer.source,
      filter: (feature) => this.shapeLayer.isEditable(feature),
      // Modify's own option, unlike Translate's hitTolerance above — same idea,
      // different name.
      pixelTolerance: HIT_TOLERANCE,
      // Off by default, this inserts a vertex whenever the pointer is merely
      // near an edge — including a single click with no drag at all, which
      // would silently add a vertex and fire shapeEditEnd from what looked
      // like a read-only click on the shape (e.g. one that also opens its
      // popup via on_shape_click). Dragging an existing vertex is this
      // feature's whole scope; inserting new ones is not.
      insertVertexCondition: never,
    })

    this.modify.on("modifyend", (event) => {
      event.features.forEach((feature) => {
        const shape = this.shapeLayer.shapeFor(feature)
        if (!shape) return

        // Same reasoning as forgetGeometry on a marker drag: the geometry now
        // disagrees with the rev the server last sent, so the next payload —
        // whether it accepts the edit or rejects it — must be applied rather
        // than skipped as "unchanged".
        this.shapeLayer.forgetRev(feature)

        // 7 decimal places is roughly a centimetre — enough precision to matter,
        // far short of the ~15 significant digits a raw Mercator round trip
        // otherwise produces.
        const geometry = geoJsonFormat.writeGeometryObject(feature.getGeometry(), {
          decimals: 7,
        })
        const properties = this.shapeLayer.propertiesFor(feature)
        this.emit("shapeEditEnd", {
          id: shape.id,
          geometry,
          properties,
          data: shape.data ?? null,
        })
      })
    })

    this.map.addInteraction(this.modify)
  }

  setupEvents() {
    this.map.on("pointermove", (event) => {
      if (this.config.interactive === false) return
      // While drawing, the pointer is a pen: a tooltip following it would cover
      // the vertex being placed, and the crosshair is the cursor that belongs.
      if (this.drawing) return this.hideTooltip()
      if (event.dragging) return this.hideTooltip()

      const { marker, cluster, markerFeature, shape } = this.featureAt(event.pixel)
      const clickableShape = shape && this.wants("shapeClick")

      this.map.getTargetElement().style.cursor =
        marker || cluster || clickableShape ? "pointer" : ""

      if (cluster) {
        this.hideTooltip()
      } else if (marker) {
        this.showTooltip(marker, markerFeature.getGeometry().getCoordinates())
      } else if (shape && (shape.tooltip || shape.label)) {
        // Anchored at the pointer: a route's tooltip jumping to its centroid would
        // point at nothing the user is looking at.
        this.showTooltip(shape, event.coordinate)
      } else {
        this.hideTooltip()
      }
    })

    this.map.getViewport().addEventListener("pointerleave", () => this.hideTooltip())

    this.map.on("singleclick", (event) => {
      if (this.config.interactive === false) return
      // A click that places a vertex is not a click on anything. Every click
      // event goes, not just `mapClick`: markers, shapes and clusters are the
      // things a user traces *around*, and claiming their clicks would open a
      // popup or zoom into a group under the polygon being drawn. The mapClick
      // case is the one that bites hardest — Popups listens for it, so without
      // this every corner of a polygon also dismissed whatever was open.
      if (this.drawing) return

      const { marker, cluster, markerFeature, shape } = this.featureAt(event.pixel)
      const { lat, lon } = unproject(event.coordinate)

      if (cluster) {
        this.emit("clusterClick", {
          count: cluster.length,
          ids: cluster.map((member) => member.id),
          lat,
          lon,
        })

        // Zooming into a group is what a click on one means, unless the application
        // says otherwise. Without it a cluster is a dead end: you can see that
        // twelve things are there and have no way to reach them.
        if (this.config.cluster && this.config.cluster.zoomOnClick !== false) {
          this.zoomToCluster(markerFeature)
        }
      } else if (marker) {
        this.emit("markerClick", {
          id: marker.id,
          lat: marker.lat,
          lon: marker.lon,
          data: marker.data ?? null,
        })
      } else if (shape && this.wants("shapeClick")) {
        this.emit("shapeClick", { id: shape.id, lat, lon, data: shape.data ?? null })
      } else {
        // A shape with no click handler is scenery, not a target. Filled polygons
        // are hit-testable across their whole interior, so claiming the click here
        // would silently swallow every mapClick inside any zone on the map.
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

  // Returns whichever of the two layers is under the pixel. Markers win ties:
  // they are drawn on top, and a pin sitting inside its own parcel outline should
  // answer the click. forEachFeatureAtPixel iterates topmost-first, so stopping
  // as soon as a marker is found is enough to enforce that.
  /**
   * Frame the members of a cluster, so a click drills into it.
   *
   * Two traps here, both of which turn the drill-in into the dead end it exists to
   * prevent.
   *
   * `View#fit` treats `maxZoom` as a resolution *floor*, so it clamps in both
   * directions: passing the marker-only cap of 16 while sitting at zoom 18 zooms
   * *out* to 16, where the members are closer together in pixels than before and
   * still one group. The cap here is therefore the basemap's own ceiling, and the
   * result is refused outright if it would move the view backwards.
   *
   * The members' extent is often a single point, because everything in the group is
   * at the same place. That branch steps in by two levels — again bounded by the
   * basemap, not by the view's default ceiling of 28, which would land on a blurry
   * over-zoom.
   */
  zoomToCluster(clusterFeature) {
    const members = clusterFeature.get("features") || []
    if (members.length === 0) return

    const extent = createEmpty()
    members.forEach((member) => extend(extent, member.getGeometry().getExtent()))

    const view = this.map.getView()
    const current = view.getZoom() ?? 0
    const ceiling = fitMaxZoom(this.config, true)

    if (current >= ceiling) return

    this.beQuiet(ANIMATION_MS)

    if (extent[0] === extent[2] && extent[1] === extent[3]) {
      view.animate({
        center: [extent[0], extent[1]],
        zoom: Math.min(current + 2, ceiling),
        duration: ANIMATION_MS,
      })
      return
    }

    const padding = this.config.fitPadding ?? 48
    view.fit(extent, {
      size: this.map.getSize(),
      padding: [padding, padding, padding, padding],
      maxZoom: ceiling,
      duration: ANIMATION_MS,
    })
  }

  featureAt(pixel) {
    let marker = null
    let shape = null

    this.map.forEachFeatureAtPixel(
      pixel,
      (feature, layer) => {
        if (layer === this.markerLayer.layer) {
          marker = marker || feature
        } else if (layer === this.shapeLayer.layer) {
          shape = shape || feature
        }

        return Boolean(marker)
      },
      {
        layerFilter: (layer) =>
          layer === this.markerLayer.layer || layer === this.shapeLayer.layer,
        hitTolerance: HIT_TOLERANCE,
      }
    )

    return {
      marker: this.markerLayer.markerFor(marker),
      cluster: this.markerLayer.clusterFor(marker),
      markerFeature: marker,
      shape: this.shapeLayer.shapeFor(shape),
      shapeFeature: shape,
    }
  }

  emit(name, payload) {
    const event = (this.config.events || {})[name]
    if (event) this.push(event, payload)

    const subscribers = this.listeners[name]
    if (subscribers) subscribers.forEach((fn) => fn(payload))
  }

  on(name, fn) {
    this.listeners[name] = this.listeners[name] || []
    this.listeners[name].push(fn)
  }

  wants(name) {
    return wantsEvent(this.config, this.listeners, name)
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
    this.stopDrawing()
    this.markerLayer.dispose()
    this.drawLayer.dispose()
    this.shapeLayer.dispose()
    this.heatmapLayer.dispose()
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

/**
 * Should `maybeFit` fit, given the map's state and config?
 *
 * With no center from the caller, "put my content on screen" is the whole
 * instruction, so the first frame is always fitted — only the client knows the
 * viewport size. `fit` then governs *re*fitting.
 */
/**
 * Does anything care about this event — the server, or a client-side subscriber?
 *
 * Both matter, and for different reasons. A shape with no handler and no popup is
 * scenery: it must not claim the click, or a filled polygon swallows every
 * `on_map_click` across its whole interior. A shape with a popup and no handler is
 * interactive, and the server has no part in it.
 *
 * Pure, and exported, because the scenery case is the one the browser suite cannot
 * reach without a third map on the playground.
 */
export function wantsEvent(config, listeners, name) {
  const subscribers = (listeners || {})[name]

  return Boolean(((config || {}).events || {})[name]) || Boolean(subscribers && subscribers.length)
}

export function shouldFit({ hasFitted, derivedCenter, fit }) {
  if (!hasFitted && derivedCenter) return true
  if (!fit) return false
  if (fit === "once" && hasFitted) return false

  return true
}

/**
 * How far a fit may zoom in.
 *
 * Two markers in the same yard have a real but tiny extent, and fitting it
 * literally zooms past anything the basemap can render — a blurry over-zoomed
 * tile. So never go beyond what the tiles have, and for a marker-only extent
 * stop earlier still, at something a human would have chosen. A geometry is
 * different: a small parcel should fill the frame, not sit in it as a speck.
 */
export function fitMaxZoom(config, hasShapes) {
  const tileMax = (config.tiles && config.tiles.maxZoom) || 19

  return hasShapes ? tileMax : Math.min(tileMax, 16)
}

/**
 * Is an Escape aimed at what the user is typing into, rather than at the map?
 *
 * Exported so the one case that matters can be asserted without a form, a map and
 * a half-traced polygon on the same page.
 */
export function isTextEntry(target) {
  if (!target || !target.tagName) return false

  return (
    target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
  )
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
