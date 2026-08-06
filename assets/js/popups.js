// How far above the coordinate the popup floats: enough to clear a pin, which is
// 36px tall and anchored at its tip.
const OFFSET_PX = 44

// When the balloon would be clipped by the container's top edge, it flips below
// the pin instead. `.rover-map` hides its overflow — a clipped popup is not
// partly visible, it is gone.
const BELOW_OFFSET_PX = 8

/**
 * Marker popups, positioned by hand rather than by an OpenLayers Overlay.
 *
 * This is a deliberate refusal of the obvious tool. `ol/Overlay` works by moving
 * the DOM node you give it into a container of its own — a container that lives
 * inside the map's viewport, which is to say inside `#{id}-canvas`, which is
 * marked `phx-update="ignore"`. Handing LiveView-rendered markup to an Overlay
 * therefore reparents it into a subtree LiveView has been told to leave alone,
 * and every later patch is aimed at a node that is no longer where the server
 * thinks it is.
 *
 * So the popups stay exactly where HEEx rendered them, in the outer element that
 * LiveView patches normally, and this class does the one thing the Overlay was
 * wanted for: convert a coordinate to a pixel and set `left`/`top`. LiveView
 * keeps full ownership of the DOM; we only move it.
 *
 * Every marker's popup is rendered up front and hidden, so opening one is a
 * class change with no server round-trip — the same feel as Leaflet's
 * `bindPopup`. The cost is one DOM node per marker, which is why clustering
 * rather than popups is the answer to hundreds of markers.
 */
export class Popups {
  constructor(rootEl, roverMap) {
    this.root = rootEl
    this.roverMap = roverMap
    this.openId = null

    roverMap.on("markerClick", ({ id }) => this.open(id))
    roverMap.on("mapClick", () => this.close())
    roverMap.on("shapeClick", () => this.close())

    this.onPostrender = () => this.position()
    roverMap.map.on("postrender", this.onPostrender)

    this.onKeydown = (event) => {
      if (event.key === "Escape") this.close()
    }
    document.addEventListener("keydown", this.onKeydown)

    this.onClick = (event) => {
      if (event.target.closest("[data-rover-popup-close]")) this.close()
    }
    this.root.addEventListener("click", this.onClick)
  }

  open(id) {
    const node = this.nodeFor(id)
    if (!node) return

    this.close()
    this.openId = String(id)
    node.hidden = false
    this.position()
  }

  close() {
    if (this.openId === null) return

    const node = this.nodeFor(this.openId)
    if (node) node.hidden = true
    this.openId = null
  }

  position() {
    if (this.openId === null) return

    const node = this.nodeFor(this.openId)
    // The feature, not the marker: a drag moves the geometry on the client while
    // the server's lat/lon stays put, and the popup should follow the pin the
    // user is holding rather than hang back at the old coordinate.
    const feature = this.roverMap.markerLayer.featureById(this.openId)

    // The marker was removed from under an open popup, or its slot no longer
    // renders. Either way there is nothing left to point at.
    if (!node || !feature) return this.close()

    const pixel = this.roverMap.map.getPixelFromCoordinate(feature.getGeometry().getCoordinates())
    if (!pixel) return

    const [x, y] = pixel
    const below = y - OFFSET_PX - node.offsetHeight < 0

    node.classList.toggle("rover-popup--below", below)
    node.style.left = `${Math.round(x)}px`
    node.style.top = `${Math.round(below ? y + BELOW_OFFSET_PX : y - OFFSET_PX)}px`
  }

  /**
   * Called after LiveView patches the element.
   *
   * `hidden` is a static attribute in the HEEx template, so morphdom restores it
   * on every patch that re-renders the comprehension — an open popup silently
   * disappears while this class still believes it is open. Re-assert it.
   */
  refresh() {
    if (this.openId === null) return

    const node = this.nodeFor(this.openId)
    if (!node) return this.close()

    node.hidden = false
    this.position()
  }

  nodeFor(id) {
    return this.root.querySelector(`[data-rover-popup-for="${cssEscape(String(id))}"]`)
  }

  destroy() {
    document.removeEventListener("keydown", this.onKeydown)
    this.root.removeEventListener("click", this.onClick)
    this.roverMap.map.un("postrender", this.onPostrender)
  }
}

// Marker ids are application data — a UUID, a slug, conceivably something with a
// quote in it. Escape before interpolating into a selector.
function cssEscape(value) {
  return typeof CSS !== "undefined" && CSS.escape ? CSS.escape(value) : value.replace(/"/g, '\\"')
}
