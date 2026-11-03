import assert from "node:assert/strict"
import { describe, it } from "node:test"

import LineString from "ol/geom/LineString.js"
import MultiPolygon from "ol/geom/MultiPolygon.js"
import Point from "ol/geom/Point.js"
import Polygon from "ol/geom/Polygon.js"

import Feature from "ol/Feature.js"

import {
  PanKey,
  ShapeTranslate,
  boxBigEnough,
  boxModifiers,
  boxSelectArmed,
  intersectsPolygon,
  panKeyArmed,
  panKeyClaims,
} from "../js/gestures.js"
import { gesturesFor, wantsEvent } from "../js/rover_map.js"

const square = (x, y, size) => [
  [x, y],
  [x + size, y],
  [x + size, y + size],
  [x, y + size],
  [x, y],
]

// A square of side 10 centred on (0, 0), rotated 45°: a diamond whose bounding
// box is [-7.07, -7.07, 7.07, 7.07].
const diamond = (() => {
  const r = 10 / Math.SQRT2
  return [
    [0, -r],
    [r, 0],
    [0, r],
    [-r, 0],
    [0, -r],
  ]
})()

describe("intersectsPolygon", () => {
  it("catches a point inside and misses one outside", () => {
    assert.equal(intersectsPolygon(new Point([1, 1]), square(0, 0, 10)), true)
    assert.equal(intersectsPolygon(new Point([11, 1]), square(0, 0, 10)), false)
  })

  it("catches a polygon with a vertex inside", () => {
    assert.equal(intersectsPolygon(new Polygon([square(5, 5, 10)]), square(0, 0, 10)), true)
  })

  it("catches a polygon that wholly contains the rectangle", () => {
    assert.equal(intersectsPolygon(new Polygon([square(-100, -100, 200)]), square(0, 0, 10)), true)
  })

  it("catches a line crossing the rectangle with both ends outside", () => {
    const line = new LineString([
      [-5, 5],
      [15, 5],
    ])
    assert.equal(intersectsPolygon(line, square(0, 0, 10)), true)
  })

  it("catches a rotated rectangle crossing a polygon with no vertex inside either", () => {
    // A long thin bar through the diamond's middle: none of its corners is in
    // the diamond, and none of the diamond's corners is in the bar.
    const bar = new Polygon([
      [
        [-20, -1],
        [20, -1],
        [20, 1],
        [-20, 1],
        [-20, -1],
      ],
    ])
    assert.equal(intersectsPolygon(bar, diamond), true)
  })

  it("misses a shape inside the bounding box of a rotated rectangle but outside it", () => {
    // The corner of the diamond's bounding box — an extent test says yes.
    assert.equal(intersectsPolygon(new Point([6.5, 6.5]), diamond), false)
    assert.equal(intersectsPolygon(new Polygon([square(5.5, 5.5, 1)]), diamond), false)
  })

  it("looks at every part of a multi-geometry", () => {
    const multi = new MultiPolygon([[square(100, 100, 1)], [square(2, 2, 1)]])
    assert.equal(intersectsPolygon(multi, square(0, 0, 10)), true)
  })

  it("misses a missing geometry", () => {
    assert.equal(intersectsPolygon(null, square(0, 0, 10)), false)
  })
})

describe("boxModifiers", () => {
  it("counts a key held at the start or at the end", () => {
    assert.deepEqual(boxModifiers({ shiftKey: true }, { shiftKey: false, ctrlKey: true }), {
      shift: true,
      ctrl: true,
      alt: false,
      meta: false,
    })
  })

  it("is all false with no events", () => {
    assert.deepEqual(boxModifiers(null, undefined), {
      shift: false,
      ctrl: false,
      alt: false,
      meta: false,
    })
  })
})

describe("boxBigEnough", () => {
  it("lets a 4-pixel drag through on either axis", () => {
    assert.equal(boxBigEnough([10, 10], [14, 10]), true)
    assert.equal(boxBigEnough([10, 10], [10, 6]), true)
  })

  it("treats less as a click", () => {
    assert.equal(boxBigEnough([10, 10], [13, 13]), false)
  })
})

describe("boxSelectArmed", () => {
  const armed = (config, listeners = {}) =>
    boxSelectArmed(config, gesturesFor(config), (name) => wantsEvent(config, listeners, name))

  const noPan = { dragPan: false }

  it("arms when something wants boxSelect and drag_pan is off", () => {
    assert.equal(armed({ interactions: noPan, events: { boxSelect: "boxed" } }), true)
  })

  it("stays off while drag_pan is on, so a drag is still a pan", () => {
    assert.equal(armed({ events: { boxSelect: "boxed" } }), false)
    assert.equal(armed({ interactions: { dragPan: true }, events: { boxSelect: "boxed" } }), false)
  })

  it("stays off with no handler", () => {
    assert.equal(armed({ interactions: noPan, events: {} }), false)
  })

  it("stays off on a locked map", () => {
    assert.equal(
      armed({ interactive: false, interactions: noPan, events: { boxSelect: "boxed" } }),
      false
    )
  })

  it("arms for a client-side subscriber", () => {
    assert.equal(armed({ interactions: noPan, events: {} }, { boxSelect: [() => {}] }), true)
  })
})

describe("panKeyArmed", () => {
  it("is on for space on an interactive map only", () => {
    assert.equal(panKeyArmed({ panKey: "space" }), true)
    assert.equal(panKeyArmed({ panKey: "space", interactive: false }), false)
    assert.equal(panKeyArmed({}), false)
  })
})

describe("PanKey", () => {
  const canvas = { tagName: "DIV" }
  const body = { tagName: "BODY" }
  const button = { tagName: "BUTTON" }
  const input = { tagName: "INPUT" }

  const space = (target, extra = {}) => {
    const event = { code: "Space", key: " ", target, prevented: false, ...extra }
    event.preventDefault = () => {
      event.prevented = true
    }
    return event
  }

  const context = (overrides = {}) => ({ armed: true, canvas, body, hovered: false, ...overrides })

  const recorder = () => {
    const changes = []
    return { changes, key: new PanKey((held) => changes.push(held)) }
  }

  it("holds while Space is down on the focused map, and lets go on keyup", () => {
    const { changes, key } = recorder()
    const down = space(canvas)

    assert.equal(key.keydown(down, context()), true)
    assert.equal(key.held, true)
    assert.equal(down.prevented, true, "the page would scroll")

    key.keyup(space(canvas))
    assert.equal(key.held, false)
    assert.deepEqual(changes, [true, false])
  })

  it("keeps preventing the default on repeats, without firing again", () => {
    const { changes, key } = recorder()
    key.keydown(space(canvas), context())

    const repeat = space(canvas, { repeat: true })
    key.keydown(repeat, context())

    assert.equal(repeat.prevented, true)
    assert.deepEqual(changes, [true])
  })

  it("lets go when the window loses focus mid-press", () => {
    const { changes, key } = recorder()
    key.keydown(space(canvas), context())
    key.reset()

    assert.equal(key.held, false)
    assert.deepEqual(changes, [true, false])
  })

  it("takes Space on the bare page only while the map is hovered", () => {
    const { key } = recorder()

    assert.equal(key.keydown(space(body), context({ hovered: false })), false)
    assert.equal(key.held, false)
    assert.equal(key.keydown(space(body), context({ hovered: true })), true)
  })

  it("never takes Space from a text field or a button", () => {
    const { key } = recorder()

    for (const target of [input, button, { tagName: "DIV", isContentEditable: true }]) {
      const event = space(target)
      assert.equal(key.keydown(event, context({ hovered: true })), false)
      assert.equal(event.prevented, false, `the default was stolen from ${target.tagName}`)
    }

    assert.equal(key.held, false)
  })

  it("does nothing when pan_key is not armed", () => {
    const { key } = recorder()
    const event = space(canvas)

    assert.equal(key.keydown(event, context({ armed: false })), false)
    assert.equal(event.prevented, false)
  })

  it("leaves Ctrl, Alt and Meta with Space alone", () => {
    const { key } = recorder()

    for (const modifier of ["ctrlKey", "altKey", "metaKey"]) {
      const event = space(canvas, { [modifier]: true })
      assert.equal(key.keydown(event, context()), false)
      assert.equal(event.prevented, false, `${modifier}+Space was stolen`)
    }
  })

  it("ignores every other key", () => {
    assert.equal(panKeyClaims({ code: "KeyA", key: "a", target: canvas }, context()), false)
  })
})

describe("ShapeTranslate", () => {
  const press = (pixel) => ({
    pixel,
    coordinate: [pixel[0] * 10, pixel[1] * 10],
    originalEvent: { pointerId: 1, isPrimary: true, button: 0 },
  })

  const setup = () => {
    const feature = new Feature(new Point([0, 0]))
    const ends = []
    const gesture = new ShapeTranslate({
      hit: () => feature,
      group: (hit) => [hit],
      onEnd: (end) => ends.push(end),
    })
    // What OpenLayers' Pointer base keeps for the press in progress.
    gesture.targetPointers = [{}]
    return { feature, ends, gesture }
  }

  it("does not move or report a press that wobbles under 4 pixels", () => {
    const { feature, ends, gesture } = setup()

    assert.equal(gesture.handleDownEvent(press([100, 100])), true)
    gesture.handleDragEvent(press([102, 101]))
    gesture.handleUpEvent(press([102, 101]))

    assert.deepEqual(feature.getGeometry().getCoordinates(), [0, 0])
    assert.deepEqual(ends, [])
  })

  it("says once that the press became a move", () => {
    const feature = new Feature(new Point([0, 0]))
    const moves = []
    const gesture = new ShapeTranslate({
      hit: () => feature,
      group: (hit) => [hit],
      onMove: (features) => moves.push(features),
    })
    gesture.targetPointers = [{}]

    gesture.handleDownEvent(press([100, 100]))
    gesture.handleDragEvent(press([101, 100]))
    assert.equal(moves.length, 0, "a wobble is not a move")
    gesture.handleDragEvent(press([110, 100]))
    gesture.handleDragEvent(press([120, 100]))

    assert.deepEqual(moves, [[feature]])
  })

  it("moves by the whole drag once past the threshold, and reports it", () => {
    const { feature, ends, gesture } = setup()

    gesture.handleDownEvent(press([100, 100]))
    gesture.handleDragEvent(press([102, 100]))
    gesture.handleDragEvent(press([110, 100]))
    gesture.handleUpEvent(press([110, 100]))

    assert.deepEqual(feature.getGeometry().getCoordinates(), [100, 0])
    assert.equal(ends.length, 1)
    assert.deepEqual(ends[0].from, [1000, 1000])
    assert.deepEqual(ends[0].to, [1100, 1000])
  })

  // Through handleEvent, as OpenLayers delivers them: the second finger's
  // pointerdown reaches the gesture while it is mid-sequence.
  const deliver = (gesture, type, pixel, pointers) =>
    gesture.handleEvent({
      ...press(pixel),
      type,
      activePointers: pointers,
      originalEvent: { ...press(pixel).originalEvent, preventDefault: () => {} },
    })

  it("gives up and puts the shapes back when a second finger lands", () => {
    const { feature, ends, gesture } = setup()
    const one = [{ pointerId: 1 }]
    const two = [{ pointerId: 1 }, { pointerId: 2 }]

    deliver(gesture, "pointerdown", [100, 100], one)
    deliver(gesture, "pointerdrag", [120, 100], one)
    deliver(gesture, "pointerdown", [320, 100], two)
    deliver(gesture, "pointerdrag", [330, 100], two)
    deliver(gesture, "pointerup", [330, 100], one)

    assert.deepEqual(feature.getGeometry().getCoordinates(), [0, 0])
    assert.deepEqual(ends, [])
  })

  it("does not commit a half-done move when a second finger only taps", () => {
    const { feature, ends, gesture } = setup()
    const one = [{ pointerId: 1 }]
    const two = [{ pointerId: 1 }, { pointerId: 2 }]

    deliver(gesture, "pointerdown", [100, 100], one)
    deliver(gesture, "pointerdrag", [120, 100], one)
    deliver(gesture, "pointerdown", [320, 100], two)
    // The tap lifts before any drag event.
    deliver(gesture, "pointerup", [320, 100], one)

    assert.deepEqual(feature.getGeometry().getCoordinates(), [0, 0])
    assert.deepEqual(ends, [])
  })

  it("puts the shapes back when taken off the map mid-drag", () => {
    const { feature, ends, gesture } = setup()

    gesture.handleDownEvent(press([100, 100]))
    gesture.handleDragEvent(press([120, 130]))
    gesture.setMap(null)

    assert.deepEqual(feature.getGeometry().getCoordinates(), [0, 0])
    assert.deepEqual(ends, [])
  })
})
