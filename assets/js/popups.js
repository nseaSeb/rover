import { project } from "./coords.js"

// How far above the coordinate the popup floats: enough to clear a pin, which is
// 36px tall and anchored at its tip. A shape is anchored where it was clicked, so
// it needs less.
const OFFSET_PX = 44
const SHAPE_OFFSET_PX = 12

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
 * Every popup is rendered up front and hidden, so opening one is a class change
 * with no server round-trip — the same feel as Leaflet's `bindPopup`. The cost is
 * one DOM node per marker, which is why clustering rather than popups is the answer
 * to hundreds of markers.
 *
 * Keys are namespaced — `marker:1`, `shape:1` — because a marker and a shape may
 * legitimately carry the same id, and two nodes answering to the same selector
 * means one of them silently wins.
 */
export class Popups {
  constructor(rootEl, roverMap) {
    this.root = rootEl
    this.roverMap = roverMap
    this.current = null

    roverMap.on("markerClick", ({ id }) => this.open("marker", id))
    // A shape with no popup still dismisses whatever was open, which is what a
    // click on "not this popup" should do.
    roverMap.on("shapeClick", ({ id, lat, lon }) =>
      this.open("shape", id, project(lat, lon))
    )
    // Any click that is not on this popup dismisses it — including one that lands on
    // a group, which claims the click and would otherwise leave the popup anchored
    // to a marker the view has just moved away from.
    roverMap.on("clusterClick", () => this.close())
    roverMap.on("mapClick", () => this.close())

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

  open(kind, id, coordinate) {
    const key = `${kind}:${id}`
    const node = this.nodeFor(key)

    // Sampled before close(), which hands focus back to whatever opened the
    // *previous* popup. Read afterwards, a mouse click landing while a
    // keyboard-opened popup is up would look like a keyboard opening.
    //
    // Only a keyboard opening moves focus. A pointer user has their attention
    // where they clicked and does not need to be sent anywhere; a keyboard user
    // pressed a button and would otherwise be left standing on it, with the
    // popup they just opened unreachable except by tabbing the whole page.
    const opener = keyboardOpener(document.activeElement)

    this.close()
    if (!node) return

    this.current = { kind, id: String(id), key, coordinate }
    node.hidden = false
    this.position()

    // position() closes again when there is nothing left to point at — a marker
    // that clustering has just grouped, say. Focusing a hidden node would drop
    // focus on the floor.
    if (opener && this.current) {
      this.returnFocusTo = opener
      focusInto(node)
    }
  }

  close() {
    if (!this.current) return

    const node = this.nodeFor(this.current.key)
    // Whether the popup still holds focus decides who gets it back. A user who
    // has already tabbed away must not be yanked backwards by a popup closing
    // behind them.
    const held = Boolean(node && node.contains(document.activeElement))

    if (node) node.hidden = true
    this.current = null

    if (held && this.returnFocusTo && this.returnFocusTo.isConnected) {
      this.returnFocusTo.focus()
    }

    this.returnFocusTo = null
  }

  /**
   * Where the open popup should point, in map coordinates.
   *
   * A marker is read from its *feature*, not from the marker the server sent: a
   * drag moves the geometry on the client while the server's lat/lon stays put, and
   * the popup should follow the pin the user is holding.
   *
   * A shape is anchored where it was clicked. Pointing at the centroid of a long
   * route or a large parcel would point at nothing the user did.
   */
  anchor() {
    if (!this.current) return null

    if (this.current.kind === "marker") {
      const feature = this.roverMap.markerLayer.featureById(this.current.id)
      return feature ? feature.getGeometry().getCoordinates() : null
    }

    return this.roverMap.shapeLayer.entries.has(this.current.id) ? this.current.coordinate : null
  }

  position() {
    if (!this.current) return

    const node = this.nodeFor(this.current.key)
    const coordinate = this.anchor()

    // The feature was removed from under an open popup, or its slot no longer
    // renders. Either way there is nothing left to point at.
    if (!node || !coordinate) return this.close()

    const pixel = this.roverMap.map.getPixelFromCoordinate(coordinate)
    if (!pixel) return

    const offset = this.current.kind === "marker" ? OFFSET_PX : SHAPE_OFFSET_PX
    const [x, y] = pixel
    const below = y - offset - node.offsetHeight < 0

    node.classList.toggle("rover-popup--below", below)
    node.style.left = `${Math.round(x)}px`
    node.style.top = `${Math.round(below ? y + BELOW_OFFSET_PX : y - offset)}px`
  }

  /**
   * Called after LiveView patches the element.
   *
   * `hidden` is a static attribute in the HEEx template, so morphdom restores it
   * on every patch that re-renders the comprehension — an open popup silently
   * disappears while this class still believes it is open. Re-assert it.
   */
  refresh() {
    if (!this.current) return

    const node = this.nodeFor(this.current.key)
    if (!node) return this.close()

    node.hidden = false
    this.position()
  }

  nodeFor(key) {
    return this.root.querySelector(`[data-rover-popup-for="${cssEscape(key)}"]`)
  }

  destroy() {
    document.removeEventListener("keydown", this.onKeydown)
    this.root.removeEventListener("click", this.onClick)
    this.roverMap.map.un("postrender", this.onPostrender)
  }
}

/**
 * The keyboard index button that opened this popup, if that is what did.
 *
 * The distinction the focus behaviour turns on, and the only reliable signal for
 * it: a pointer click leaves focus on the map or on nothing at all, while a
 * press of one of `<.map>`'s hidden feature buttons leaves it on that button.
 */
function keyboardOpener(active) {
  if (!active || !active.closest) return null

  return active.closest("[data-rover-focus]")
}

// The close button, if the slot has one, and the popup itself otherwise — it
// carries tabindex="-1" for exactly this.
function focusInto(node) {
  const focusable = node.querySelector(
    "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])"
  )

  ;(focusable || node).focus()
}

// Marker ids are application data — a UUID, a slug, conceivably something with a
// quote in it. Escape before interpolating into a selector.
function cssEscape(value) {
  return typeof CSS !== "undefined" && CSS.escape ? CSS.escape(value) : value.replace(/"/g, '\\"')
}
