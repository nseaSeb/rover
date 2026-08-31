import { Popups } from "./popups.js"
import { RoverMap } from "./rover_map.js"

/**
 * The LiveView hook behind `<.map>`.
 *
 * The server renders two attributes — `data-rover` (view configuration) and
 * `data-rover-markers` (the marker list). LiveView already diffs attributes, so
 * changing only the markers sends only the markers. The hook then diffs each
 * payload against the last one it saw before doing any work at all: a re-render
 * that did not touch the map costs a string comparison.
 */
export const Rover = {
  mounted() {
    this.canvasEl = this.el.querySelector(".rover-map__canvas") || this.el
    this.configJson = this.el.dataset.rover
    this.markersJson = this.el.dataset.roverMarkers
    this.shapesJson = this.el.dataset.roverShapes
    this.heatmapJson = this.el.dataset.roverHeatmap

    this.config = parse(this.configJson, {}, "data-rover")
    this.map = new RoverMap(this.canvasEl, this.config, (event, payload) =>
      this.emit(event, payload)
    )
    this.map.setContent({
      heatmap: parse(this.heatmapJson, null, "data-rover-heatmap"),
      shapes: parse(this.shapesJson, [], "data-rover-shapes"),
      markers: parse(this.markersJson, [], "data-rover-markers"),
    })
    this.popups = new Popups(this.el, this.map)

    // `<.map>` renders one hidden button per marker and shape — the only DOM a
    // keyboard can reach features painted into a canvas through. They are
    // ordinary buttons, so Enter and Space arrive here as a click. Delegated on
    // the root because LiveView re-renders the list whenever the features change.
    this.onIndexClick = (event) => {
      const button = event.target.closest && event.target.closest("[data-rover-focus]")
      if (button && this.map) this.map.activate(button.dataset.roverFocus)
    }
    this.el.addEventListener("click", this.onIndexClick)

    // The map instance, on the element that owns it. Markers are drawn into a
    // canvas and have no DOM node of their own, so this is the only way to get
    // from a coordinate to a pixel — which is what the browser suite needs to
    // click one, and what you want in a console when a marker is not where you
    // expected:
    //
    //     document.getElementById("clients")._rover.map.getView().getZoom()
    this.el._rover = this.map

    // push_event reaches every hook on the page, so each map answers only to the
    // id it was given. Without this, two maps in one LiveView would both fly.
    this.handleEvent("rover:fly_to", (payload) => {
      if (this.mine(payload)) this.map.flyTo(payload)
    })

    this.handleEvent("rover:fit_to", (payload) => {
      if (this.mine(payload)) this.map.fitTo(payload)
    })

    this.handleEvent("rover:start_drawing", (payload) => {
      if (this.mine(payload)) this.map.startDrawing(payload)
    })

    this.handleEvent("rover:stop_drawing", (payload) => {
      if (this.mine(payload)) this.map.stopDrawing()
    })
  },

  mine(payload) {
    return payload && payload.id === this.el.id
  },

  updated() {
    if (!this.map) return

    const configJson = this.el.dataset.rover
    if (configJson !== this.configJson) {
      this.configJson = configJson
      this.config = parse(configJson, this.config, "data-rover")
      this.map.setConfig(this.config)
    }

    // Gathered, then applied together: an update touching both layers must fit
    // once over the union, not once per layer.
    const content = {}

    const heatmapJson = this.el.dataset.roverHeatmap
    if (heatmapJson !== this.heatmapJson) {
      this.heatmapJson = heatmapJson
      content.heatmap = parse(heatmapJson, null, "data-rover-heatmap")
    }

    const shapesJson = this.el.dataset.roverShapes
    if (shapesJson !== this.shapesJson) {
      this.shapesJson = shapesJson
      content.shapes = parse(shapesJson, [], "data-rover-shapes")
    }

    const markersJson = this.el.dataset.roverMarkers
    if (markersJson !== this.markersJson) {
      this.markersJson = markersJson
      content.markers = parse(markersJson, [], "data-rover-markers")
    }

    if (
      content.heatmap !== undefined ||
      content.shapes !== undefined ||
      content.markers !== undefined
    ) {
      this.map.setContent(content)
    }

    if (this.popups) this.popups.refresh()
  },

  destroyed() {
    this.el.removeEventListener("click", this.onIndexClick)
    if (this.popups) this.popups.destroy()
    if (this.map) this.map.destroy()
    this.popups = null
    this.map = null
    this.el._rover = null
  },

  emit(event, payload) {
    const target = this.config.target

    if (target === undefined || target === null || target === "") {
      this.pushEvent(event, payload)
    } else {
      // `target={@myself}` renders a component cid; anything else is a selector.
      this.pushEventTo(/^\d+$/.test(target) ? Number(target) : target, event, payload)
    }
  },
}

export const RoverHooks = { Rover }

function parse(json, fallback, attribute) {
  if (!json) return fallback

  try {
    return JSON.parse(json)
  } catch (error) {
    console.error(`[rover] could not parse ${attribute}:`, error, json)
    return fallback
  }
}
