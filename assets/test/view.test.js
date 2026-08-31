import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  fitMaxZoom,
  isTextEntry,
  normalizeConfig,
  parseFocusKey,
  shouldFit,
  shouldRecenter,
  wantsEvent,
} from "../js/rover_map.js"

const config = (overrides) => normalizeConfig({ center: [45.75, 4.85], zoom: 12, ...overrides })

describe("shouldRecenter", () => {
  it("moves the view when the caller assigns a new center", () => {
    assert.equal(shouldRecenter(config({}), config({ center: [48.85, 2.35] })), true)
  })

  it("moves the view when the caller assigns a new zoom", () => {
    assert.equal(shouldRecenter(config({}), config({ zoom: 15 })), true)
  })

  it("leaves the view alone when nothing changed", () => {
    assert.equal(shouldRecenter(config({}), config({})), false)
  })

  // The regression this function exists for: with no center given, Rover derives
  // one from the markers, so it shifts every time any marker moves. Honouring it
  // animated the map to the derived centre at the derived zoom — a world view —
  // on every single marker update, with no way back.
  it("ignores a centre Rover derived from the markers", () => {
    const before = config({ center: [45.75, 4.845], zoom: 2, derivedCenter: true })
    const after = config({ center: [45.77, 4.845], zoom: 2, derivedCenter: true })

    assert.equal(shouldRecenter(before, after), false)
  })

  it("still honours a caller taking control after a derived centre", () => {
    const before = config({ center: [45.75, 4.845], zoom: 2, derivedCenter: true })
    const after = config({ center: [48.85, 2.35], zoom: 13 })

    assert.equal(shouldRecenter(before, after), true)
  })
})

describe("normalizeConfig", () => {
  it("supplies a usable view when the payload is unusable", () => {
    // hook.js falls back to `{}` when data-rover cannot be parsed. Before this,
    // RoverMap dereferenced config.center[0] and threw, so the fallback was dead
    // code — and the publicly exported RoverMap could not be called without a
    // fully-formed config either.
    const normalized = normalizeConfig({})

    assert.deepEqual(normalized.center, [0, 0])
    assert.equal(normalized.zoom, 2)
  })

  it("survives null", () => {
    assert.deepEqual(normalizeConfig(null).center, [0, 0])
  })

  it("leaves a well-formed config alone", () => {
    const normalized = normalizeConfig({ center: [45.75, 4.85], zoom: 12, fit: "once" })

    assert.deepEqual(normalized.center, [45.75, 4.85])
    assert.equal(normalized.zoom, 12)
    assert.equal(normalized.fit, "once")
  })
})

describe("shouldFit", () => {
  // The regression behind setContent(): the first fit sets hasFitted, and with the
  // default fit: "once" every later call declines. Loading shapes and then markers
  // as two separate calls therefore framed the shapes alone, and anything outside
  // their bounding box was off-screen for good.
  it("declines a second call once the initial fit has happened", () => {
    const config = { derivedCenter: true, fit: "once" }

    assert.equal(shouldFit({ hasFitted: false, ...config }), true)
    assert.equal(shouldFit({ hasFitted: true, ...config }), false)
  })

  it("always fits the first frame when the centre was derived", () => {
    assert.equal(shouldFit({ hasFitted: false, derivedCenter: true, fit: false }), true)
  })

  it("never fits when the caller chose the centre and asked for no fitting", () => {
    assert.equal(shouldFit({ hasFitted: false, derivedCenter: undefined, fit: false }), false)
  })

  it("refits every time with fit: always", () => {
    assert.equal(shouldFit({ hasFitted: true, derivedCenter: true, fit: "always" }), true)
  })
})

describe("fitMaxZoom", () => {
  it("stops a marker-only fit short of the basemap ceiling", () => {
    // Two vans parked in the same yard have a real but tiny extent. Fitting it
    // literally zooms past anything the tiles can render.
    assert.equal(fitMaxZoom({ tiles: { maxZoom: 19 } }, false), 16)
  })

  it("lets a geometry fill the frame, but not past the tiles" , () => {
    assert.equal(fitMaxZoom({ tiles: { maxZoom: 19 } }, true), 19)
  })

  it("respects a lower tile ceiling in both cases", () => {
    assert.equal(fitMaxZoom({ tiles: { maxZoom: 14 } }, true), 14)
    assert.equal(fitMaxZoom({ tiles: { maxZoom: 14 } }, false), 14)
  })

  it("falls back to 19 with no basemap" , () => {
    assert.equal(fitMaxZoom({}, true), 19)
    assert.equal(fitMaxZoom({}, false), 16)
  })
})

describe("the union of both layers", () => {
  it("covers a marker far outside the shapes", async () => {
    // What setContent buys: the framing extent spans both layers. Before the fix
    // the fit only ever saw whichever layer was loaded first.
    const { MarkerLayer } = await import("../js/markers.js")
    const { ShapeLayer } = await import("../js/shapes.js")
    const { createEmpty, extend } = await import("ol/extent.js")

    const markers = new MarkerLayer()
    markers.reconcile([{ id: 1, lat: 48.85, lon: 2.35 }])

    const shapes = new ShapeLayer()
    shapes.reconcile([
      {
        id: "p",
        rev: 1,
        geometry: {
          type: "Polygon",
          coordinates: [[[4.83, 45.76], [4.84, 45.76], [4.84, 45.77], [4.83, 45.77], [4.83, 45.76]]],
        },
      },
    ])

    const union = createEmpty()
    extend(union, shapes.extent)
    extend(union, markers.extent)

    // Paris is north-west of the Lyon parcel: the union must reach both.
    assert.ok(union[0] < shapes.extent[0], "the union did not extend west to the marker")
    assert.ok(union[3] > shapes.extent[3], "the union did not extend north to the marker")
    assert.ok(union[2] >= shapes.extent[2], "the union lost the parcel's eastern edge")
  })
})

describe("wantsEvent", () => {
  it("is true when the server wired a handler", () => {
    assert.equal(wantsEvent({ events: { shapeClick: "pick" } }, {}, "shapeClick"), true)
  })

  it("is true when only a client subscriber cares", () => {
    // A shape popup needs no server. Keying the click on the configured event alone
    // meant a <:shape_popup> could never open.
    assert.equal(wantsEvent({}, { shapeClick: [() => {}] }, "shapeClick"), true)
  })

  // The regression this exists for: shapes carry a default fill, so their whole
  // interior is hit-testable. A decorative outline claiming the click swallows every
  // on_map_click inside it — a click-to-place-a-marker map silently stops working.
  it("is false for scenery: no handler, no popup", () => {
    assert.equal(wantsEvent({ events: {} }, {}, "shapeClick"), false)
    assert.equal(wantsEvent({ events: { markerClick: "x" } }, {}, "shapeClick"), false)
    assert.equal(wantsEvent({}, { shapeClick: [] }, "shapeClick"), false)
  })

  it("survives a missing config or listener map", () => {
    assert.equal(wantsEvent(null, null, "shapeClick"), false)
  })
})

describe("fitMaxZoom as the drill-in ceiling", () => {
  // `View#fit` treats maxZoom as a resolution floor, so it clamps in both
  // directions. Passing the marker-only cap of 16 while sitting at zoom 18 zooms
  // *out* to 16, where a group's members are closer together in pixels than before
  // and still one group — the dead end zoom_on_click exists to prevent.
  it("uses the basemap ceiling, not the marker cap", () => {
    assert.equal(fitMaxZoom({ tiles: { maxZoom: 19 } }, true), 19)
    assert.notEqual(fitMaxZoom({ tiles: { maxZoom: 19 } }, true), 16)
  })

  it("still respects a lower basemap", () => {
    assert.equal(fitMaxZoom({ tiles: { maxZoom: 17 } }, true), 17)
  })
})

// The Escape that abandons a sketch is bound to the document, the way a drawing
// tool binds it. The one press that is plainly not the map's is the one
// dismissing whatever the user is typing into.
describe("isTextEntry", () => {
  it("leaves Escape to a field the user is typing in", () => {
    assert.equal(isTextEntry({ tagName: "INPUT" }), true)
    assert.equal(isTextEntry({ tagName: "TEXTAREA" }), true)
    assert.equal(isTextEntry({ tagName: "SELECT" }), true)
    assert.equal(isTextEntry({ tagName: "DIV", isContentEditable: true }), true)
  })

  it("takes Escape for the map everywhere else", () => {
    assert.equal(isTextEntry({ tagName: "DIV" }), false)
    assert.equal(isTextEntry({ tagName: "BODY" }), false)
    assert.equal(isTextEntry(null), false)
  })
})

describe("parseFocusKey", () => {
  it("names the layer and the feature a keyboard press is aimed at", () => {
    assert.deepEqual(parseFocusKey("marker:1"), { kind: "marker", id: "1" })
    assert.deepEqual(parseFocusKey("shape:parcel"), { kind: "shape", id: "parcel" })
  })

  it("splits on the first colon only, because ids are application data", () => {
    // A slug or a URN with a colon in it would otherwise be truncated into a
    // different feature's id, or into one that does not exist at all.
    assert.deepEqual(parseFocusKey("marker:urn:lot:14"), { kind: "marker", id: "urn:lot:14" })
  })

  it("refuses anything that is not one of the two layers", () => {
    assert.equal(parseFocusKey("heatmap:1"), null)
    assert.equal(parseFocusKey("marker:"), null)
    assert.equal(parseFocusKey(":1"), null)
    assert.equal(parseFocusKey("marker"), null)
    assert.equal(parseFocusKey(null), null)
  })
})
