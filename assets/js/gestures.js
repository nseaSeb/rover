import { primaryAction } from "ol/events/condition.js"
import DragBox from "ol/interaction/DragBox.js"
import PointerInteraction from "ol/interaction/Pointer.js"

// The vector-editor gestures: the selection rectangle, moving shapes, and the
// temporary hand of `pan_key`. Kept out of rover_map.js so the parts that decide
// anything — what a rectangle caught, who owns the Space bar — can be tested
// without a document or an `ol/Map`.

/** Below this, in pixels on either axis, a rectangle is a click that wobbled. */
export const BOX_MIN_PIXELS = 4

/**
 * Is an event aimed at what the user is typing into, rather than at the map?
 *
 * Lives here because the Space bar asks the same question Escape does; it is
 * re-exported from rover_map.js, where callers have always found it.
 */
export function isTextEntry(target) {
  if (!target || !target.tagName) return false

  return (
    target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
  )
}

/**
 * Is the selection rectangle armed for this config?
 *
 * Only when something wants `boxSelect` and `:drag_pan` is not among the
 * gestures: with it, a drag on the background is a pan, and there is nothing to
 * arbitrate. `gestures` is `gesturesFor(config)` — empty on a locked map — and
 * `wants` the map's own `wants`, so a client-side `on("boxSelect")` arms it as a
 * server handler does.
 */
export function boxSelectArmed(config, gestures, wants) {
  if (!config || config.interactive === false) return false
  if (gestures.includes("dragPan")) return false

  return Boolean(wants("boxSelect"))
}

/** Is a finished rectangle big enough to be one, rather than a click? */
export function boxBigEnough(startPixel, endPixel) {
  return (
    Math.max(
      Math.abs(endPixel[0] - startPixel[0]),
      Math.abs(endPixel[1] - startPixel[1])
    ) >= BOX_MIN_PIXELS
  )
}

/**
 * The modifier keys of a selection rectangle: held when it started *or* when it
 * ended. Read at the release only, Shift let go a moment before the button
 * reads as no Shift — and the user plainly meant to add to the selection.
 * Ctrl is there because it, not Shift, is the add-to-selection key on Windows
 * and Linux.
 */
export function boxModifiers(start, end) {
  const held = (key) => Boolean((start && start[key]) || (end && end[key]))

  return {
    shift: held("shiftKey"),
    ctrl: held("ctrlKey"),
    alt: held("altKey"),
    meta: held("metaKey"),
  }
}

/** Is `config` asking for the Space bar to be a temporary hand? */
export function panKeyArmed(config) {
  return Boolean(config) && config.interactive !== false && config.panKey === "space"
}

// -- geometry ----------------------------------------------------------------

/**
 * Does an OpenLayers geometry touch a closed ring?
 *
 * OpenLayers has no polygon-polygon intersection, and an extent test is wrong as
 * soon as the view is rotated: the rectangle the user drew is then a rotated
 * polygon, and its bounding box catches shapes sitting outside it. So this
 * answers the real question — any vertex of one inside the other, or any two
 * edges crossing — after a cheap bounding-box rejection.
 *
 * `ring` is an array of `[x, y]`, first and last equal, in the same projection
 * as the geometry.
 */
export function intersectsPolygon(geometry, ring) {
  if (!geometry || !ring || ring.length < 4) return false

  const type = geometry.getType()

  if (type === "GeometryCollection") {
    return geometry.getGeometries().some((member) => intersectsPolygon(member, ring))
  }

  if (!extentsOverlap(geometry.getExtent(), ringExtent(ring))) return false

  const paths = pathsOf(geometry)

  // A vertex of the shape inside the rectangle.
  for (const path of paths) {
    for (const coordinate of path) {
      if (insideRing(coordinate, ring)) return true
    }
  }

  // The rectangle inside an area: no vertex of the polygon is in it and no edge
  // crosses it, but the user plainly touched the shape.
  if (type === "Polygon" || type === "MultiPolygon") {
    for (const corner of ring) {
      if (geometry.intersectsCoordinate(corner)) return true
    }
  }

  // Edges crossing, with every vertex outside on both sides — a thin rotated
  // rectangle across a long route.
  for (const path of paths) {
    for (let i = 1; i < path.length; i++) {
      for (let j = 1; j < ring.length; j++) {
        if (segmentsCross(path[i - 1], path[i], ring[j - 1], ring[j])) return true
      }
    }
  }

  return false
}

function pathsOf(geometry) {
  const coordinates = geometry.getCoordinates()

  switch (geometry.getType()) {
    case "Point":
      return [[coordinates]]
    case "MultiPoint":
      return coordinates.map((coordinate) => [coordinate])
    case "LineString":
      return [coordinates]
    case "MultiLineString":
    case "Polygon":
      return coordinates
    case "MultiPolygon":
      return coordinates.flat(1)
    default:
      return []
  }
}

function ringExtent(ring) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const [x, y] of ring) {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }

  return [minX, minY, maxX, maxY]
}

function extentsOverlap(a, b) {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1]
}

// Even-odd ray casting. A point exactly on an edge may land either way; the
// edge test below catches it regardless.
function insideRing([x, y], ring) {
  let inside = false

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]

    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside
    }
  }

  return inside
}

function orientation(a, b, c) {
  const value = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
  return value > 0 ? 1 : value < 0 ? -1 : 0
}

function onSegment(a, b, c) {
  return (
    Math.min(a[0], b[0]) <= c[0] &&
    c[0] <= Math.max(a[0], b[0]) &&
    Math.min(a[1], b[1]) <= c[1] &&
    c[1] <= Math.max(a[1], b[1])
  )
}

function segmentsCross(p1, p2, q1, q2) {
  const o1 = orientation(p1, p2, q1)
  const o2 = orientation(p1, p2, q2)
  const o3 = orientation(q1, q2, p1)
  const o4 = orientation(q1, q2, p2)

  if (o1 !== o2 && o3 !== o4) return true

  return (
    (o1 === 0 && onSegment(p1, p2, q1)) ||
    (o2 === 0 && onSegment(p1, p2, q2)) ||
    (o3 === 0 && onSegment(q1, q2, p1)) ||
    (o4 === 0 && onSegment(q1, q2, p2))
  )
}

// -- the Space bar -----------------------------------------------------------

/**
 * Who owns a Space keypress: the map, or whatever the page had it aimed at.
 *
 * The map takes it when it has the keyboard focus, or when it is under the
 * pointer and nothing else has the focus (`document.body` is the target).
 * Never from a text field, and never from a button — the index of features and
 * the popups are buttons, and Space is how a keyboard user presses them.
 */
export function panKeyClaims(event, { canvas, hovered, body }) {
  if (!event || (event.code !== "Space" && event.key !== " ")) return false
  // Ctrl+Space and friends switch input methods and open launchers.
  if (event.ctrlKey || event.altKey || event.metaKey) return false

  const target = event.target
  if (isTextEntry(target)) return false
  if (target === canvas) return true

  return Boolean(hovered) && target === body
}

/**
 * Whether Space is held down for the map, fed plain events so it can be tested
 * without a document. `onChange(held)` fires on every transition.
 */
export class PanKey {
  constructor(onChange) {
    this.held = false
    this.onChange = onChange || (() => {})
  }

  /**
   * Returns true when the map took the key. The browser default — scrolling the
   * page — is prevented for repeats too, or holding Space scrolls in bursts.
   */
  keydown(event, context) {
    if (!context.armed || !panKeyClaims(event, context)) return false

    event.preventDefault()
    this.set(true)
    return true
  }

  keyup(event) {
    if (!this.held) return false
    if (event.code !== "Space" && event.key !== " ") return false

    this.set(false)
    return true
  }

  /** The window lost focus, the page was hidden, or the map is going away. */
  reset() {
    this.set(false)
  }

  set(held) {
    if (this.held === held) return

    this.held = held
    this.onChange(held)
  }
}

// -- interactions ------------------------------------------------------------

/**
 * `ol/interaction/DragBox`, taught one thing for a touch screen: a one-finger
 * drag draws the rectangle, and a second finger landing cancels it — that
 * gesture is a pan or a pinch, and must not also select.
 */
export class SelectionBox extends DragBox {
  handleDragEvent(mapBrowserEvent) {
    if (this.targetPointers.length > 1) {
      // setActive(false) is DragBox's public way to drop a box in progress: it
      // removes the outline and fires `boxcancel`, never `boxend`.
      this.setActive(false)
      this.setActive(true)
      return
    }

    super.handleDragEvent(mapBrowserEvent)
  }
}

/**
 * Drags a shape, and every shape of its `translate_group`, with the pointer.
 *
 * Not `ol/interaction/Translate`, which moves only the feature under the
 * pointer unless handed a collection in advance — and the group is only known
 * once the pointer is down.
 *
 * - `hit(pixel)` — the translatable feature under the pointer, or null.
 * - `group(feature)` — the features that move with it.
 * - `enabled()` — false while drawing or while Space is held.
 * - `onStart()` / `onFinish()` — bracket the gesture (the cursor).
 * - `onMove(features)` — once, when the press turns into an actual move.
 * - `onEnd({features, from, to})` — only when something actually moved, so a
 *   plain press still reaches the click handlers.
 */
export class ShapeTranslate extends PointerInteraction {
  constructor({ hit, group, enabled, onStart, onFinish, onMove, onEnd }) {
    super()

    this.hit = hit
    this.group = group
    this.enabled = enabled || (() => true)
    this.onStart = onStart || (() => {})
    this.onFinish = onFinish || (() => {})
    this.onMove = onMove || (() => {})
    this.onEnd = onEnd || (() => {})
    this.features = null
  }

  handleDownEvent(event) {
    if (!this.enabled() || this.targetPointers.length > 1 || !primaryAction(event)) return false
    if (this.features) return false

    const feature = this.hit(event.pixel)
    if (!feature) return false

    this.features = this.group(feature)
    if (this.features.length === 0) {
      this.features = null
      return false
    }

    this.from = event.coordinate
    this.last = event.coordinate
    this.startPixel = event.pixel
    this.moved = false
    this.onStart()

    return true
  }

  handleEvent(event) {
    // A second finger makes this a pan or a pinch, for the interactions below
    // — a two-finger pan when the selection rectangle is armed, a pinch at
    // least. Caught as it lands, not on the next drag: a second finger that
    // only taps would otherwise reach handleUpEvent first and commit the move
    // half-way, and every drag would jump the shape between the two fingers.
    if (this.features && event.type === "pointerdown") this.abandon()

    return super.handleEvent(event)
  }

  handleDragEvent(event) {
    if (!this.features) return

    // A press that wobbles a pixel or two is a click with an unsteady hand, not
    // a move: nothing shifts, and nothing is reported.
    if (!this.moved && !boxBigEnough(this.startPixel, event.pixel)) return

    const dx = event.coordinate[0] - this.last[0]
    const dy = event.coordinate[1] - this.last[1]
    if (dx === 0 && dy === 0) return

    this.shift(this.features, dx, dy)

    this.last = event.coordinate
    if (!this.moved) this.onMove(this.features)
    this.moved = true
  }

  shift(features, dx, dy) {
    features.forEach((feature) => {
      const geometry = feature.getGeometry()
      if (geometry) geometry.translate(dx, dy)
    })
  }

  handleUpEvent(event) {
    if (!this.features) return false

    const features = this.features
    const moved = this.moved
    const from = this.from
    const to = this.last

    this.features = null
    this.onFinish()

    if (moved) this.onEnd({ features, from, to, event })

    return false
  }

  setMap(map) {
    // Taken off the map mid-drag — interactions are rebuilt on a config change —
    // the gesture is abandoned: the shapes go back where the server put them,
    // since nobody will be told they moved, and the cursor must not stay a
    // closed hand.
    this.abandon()
    super.setMap(map)
  }

  /** Put the shapes back where the press found them, and report nothing. */
  abandon() {
    if (!this.features) return

    if (this.moved) {
      this.shift(this.features, this.from[0] - this.last[0], this.from[1] - this.last[1])
    }

    this.features = null
    this.onFinish()
  }
}
