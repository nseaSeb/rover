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

    this.config = parse(this.configJson, {}, "data-rover")
    this.map = new RoverMap(this.canvasEl, this.config, (event, payload) =>
      this.emit(event, payload)
    )
    this.map.setMarkers(parse(this.markersJson, [], "data-rover-markers"))
  },

  updated() {
    if (!this.map) return

    const configJson = this.el.dataset.rover
    if (configJson !== this.configJson) {
      this.configJson = configJson
      this.config = parse(configJson, this.config, "data-rover")
      this.map.setConfig(this.config)
    }

    const markersJson = this.el.dataset.roverMarkers
    if (markersJson !== this.markersJson) {
      this.markersJson = markersJson
      this.map.setMarkers(parse(markersJson, [], "data-rover-markers"))
    }
  },

  destroyed() {
    if (this.map) this.map.destroy()
    this.map = null
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
