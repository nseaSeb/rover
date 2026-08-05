import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { normalizeConfig, shouldRecenter } from "../js/rover_map.js"

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
