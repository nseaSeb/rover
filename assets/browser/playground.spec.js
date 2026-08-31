import { expect, test } from "@playwright/test"

/**
 * A deliberately small suite against the `mix dev` playground.
 *
 * It is not an acceptance suite. Its job is to stand guard over the four things
 * that have actually broken in this library — all of them in the DOM or the
 * canvas, where neither ExUnit nor `node --test` can see:
 *
 *   - the view recentring itself to zoom 2 on every marker update (0.1)
 *   - the initial fit framing the shapes and leaving markers off-screen (0.2)
 *   - an open popup silently restored to `hidden` by a LiveView patch (0.2)
 *   - a tile URL built with the wrong FORMAT, which renders as nothing at all
 *
 * Each scenario below was confirmed to go red when its bug is reintroduced. A
 * regression test nobody has watched fail proves nothing.
 */

// 1×1 transparent PNG. Served for every tile request whatever format was asked
// for — the browser reads the Content-Type, not the URL, and we only care which
// URLs Rover *builds*. That keeps the suite offline and deterministic.
const TILE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
)

const MAP = "#clients"
const CANVAS = "#clients-canvas"

/** Stub the tile server and record every URL that was requested. */
async function stubTiles(page) {
  const urls = []

  await page.route("**://data.geopf.fr/**", (route) => {
    urls.push(route.request().url())

    return route.fulfill({
      status: 200,
      contentType: "image/png",
      // OpenLayers asks for tiles with crossOrigin="anonymous"; without this the
      // image load fails and the map is blank for a reason that has nothing to do
      // with the code under test.
      headers: { "access-control-allow-origin": "*" },
      body: TILE,
    })
  })

  return urls
}

/** Fail the test on anything the page logs as broken. Cheap, and catches a lot. */
function failOnPageErrors(page) {
  const problems = []

  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`))
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`console.error: ${message.text()}`)
  })

  return problems
}

/**
 * A pixel inside the canvas with neither a marker nor a shape under it.
 *
 * Hard-coding a corner does not survive: the map is 28rem tall, not the viewport,
 * and the zoom control, scale line and attribution each own one. Asking the map
 * which pixels are empty is both correct and self-adjusting.
 */
async function emptyPixel(page) {
  const pixel = await page.evaluate((selector) => {
    const rover = document.querySelector(selector)._rover
    const [width, height] = rover.map.getSize()

    // Inset well clear of the controls in every corner.
    for (let x = 60; x < width - 60; x += 20) {
      for (let y = 60; y < height - 60; y += 20) {
        const { marker, shape } = rover.featureAt([x, y])
        if (!marker && !shape) return { x, y }
      }
    }

    return null
  }, MAP)

  if (!pixel) throw new Error("no empty pixel on the map to click")

  return pixel
}

/**
 * A pixel carrying a shape and no marker, on the given map.
 *
 * The centre of a shape's extent is not good enough: markers win hit-test ties, and
 * on a 10rem map showing the same content the pins cover much of the geometry. Ask
 * the map which pixels are actually the shape's.
 */
async function shapePixel(page, selector) {
  const pixel = await page.evaluate((sel) => {
    const rover = document.querySelector(sel)._rover
    const [width, height] = rover.map.getSize()

    for (let x = 4; x < width - 4; x += 4) {
      for (let y = 4; y < height - 4; y += 4) {
        const { marker, shape } = rover.featureAt([x, y])
        if (shape && !marker) return { x, y }
      }
    }

    return null
  }, selector)

  if (!pixel) throw new Error(`no shape-only pixel on ${selector}`)

  return pixel
}

/**
 * A pixel carrying a cluster of more than one marker.
 *
 * Not the centroid of an arbitrary group: `ol/source/Cluster` groups every feature
 * in the source, not only the visible ones, so a group's centre is often off-screen
 * and unclickable. Scanning for one the map itself reports guarantees both.
 */
async function clusterPixel(page, selector, avoid = null) {
  const pixel = await page.evaluate(
    ([sel, keepClear]) => {
      const rover = document.querySelector(sel)._rover
      const [width, height] = rover.map.getSize()
      const far = (x, y) =>
        !keepClear || Math.hypot(x - keepClear.x, y - keepClear.y) > keepClear.radius

      for (let x = 50; x < width - 50; x += 8) {
        for (let y = 50; y < height - 50; y += 8) {
          if (far(x, y) && rover.featureAt([x, y]).cluster) return { x, y }
        }
      }

      return null
    },
    [selector, avoid]
  )

  if (!pixel) throw new Error(`no clickable cluster on ${selector}`)

  return pixel
}

/**
 * A pixel carrying a group of exactly one marker — which is drawn as its own pin and
 * is the only kind of grouped marker that can still open a popup.
 */
async function soloPixel(page, selector) {
  const pixel = await page.evaluate((sel) => {
    const rover = document.querySelector(sel)._rover
    const [width, height] = rover.map.getSize()

    for (let x = 50; x < width - 50; x += 6) {
      for (let y = 50; y < height - 50; y += 6) {
        const hit = rover.featureAt([x, y])
        if (hit.marker && !hit.cluster) return { x, y, id: hit.marker.id }
      }
    }

    return null
  }, selector)

  if (!pixel) throw new Error(`no lone marker on ${selector}`)

  return pixel
}

/**
 * Where a shape's first vertex is on screen, in pixels relative to the canvas.
 *
 * Mirrors markerPixel: read from the feature's own geometry rather than
 * guessing, so the answer follows the map instead of assuming it.
 */
function shapeVertexPixel(page, selector, shapeId) {
  return page.evaluate(
    ([sel, id]) => {
      const rover = document.querySelector(sel)._rover
      const entry = rover.shapeLayer.entries.get(String(id))
      if (!entry) return null

      // Already projected (the feature's own geometry, not raw GeoJSON degrees).
      const coordinate = entry.features[0].getGeometry().getCoordinates()[0][0]
      const [x, y] = rover.map.getPixelFromCoordinate(coordinate)
      return { x, y }
    },
    [selector, shapeId]
  )
}

/** The pixel midway along a shape's first edge — on the outline, not on a vertex. */
function shapeEdgeMidpointPixel(page, selector, shapeId) {
  return page.evaluate(
    ([sel, id]) => {
      const rover = document.querySelector(sel)._rover
      const entry = rover.shapeLayer.entries.get(String(id))
      if (!entry) return null

      const ring = entry.features[0].getGeometry().getCoordinates()[0]
      const mid = [(ring[0][0] + ring[1][0]) / 2, (ring[0][1] + ring[1][1]) / 2]
      const [x, y] = rover.map.getPixelFromCoordinate(mid)
      return { x, y }
    },
    [selector, shapeId]
  )
}

/** Wait until the hook has mounted and handed us the map. */
async function mapReady(page) {
  await page.waitForFunction(
    (selector) => Boolean(document.querySelector(selector)?._rover),
    MAP,
    { timeout: 15_000 }
  )
}

/**
 * Where a marker is on screen, in pixels relative to the canvas.
 *
 * Read from the feature's own geometry, so no projection maths happens here and
 * the answer follows the map rather than assuming it.
 */
function markerPixel(page, id) {
  return page.evaluate(
    ([selector, markerId]) => {
      const rover = document.querySelector(selector)._rover
      const feature = rover.markerLayer.featureById(markerId)
      if (!feature) return null

      const [x, y] = rover.map.getPixelFromCoordinate(feature.getGeometry().getCoordinates())
      return { x, y }
    },
    [MAP, id]
  )
}

/**
 * The state of the drawing mode, read off the map itself.
 *
 * `drawing` is what `Rover.start_drawing/3` armed; `sketch` is how many features
 * are sitting in the scratch layer. The pair is what distinguishes "the sketch
 * became a shape" from "the sketch is still a sketch", and neither is visible in
 * the DOM.
 */
function drawState(page) {
  return page.evaluate((selector) => {
    const rover = document.querySelector(selector)._rover

    return {
      drawing: rover.drawing ? rover.drawing.type : null,
      sketch: rover.drawLayer.source.getFeatures().length,
      shapes: rover.shapeLayer.entries.size,
    }
  }, MAP)
}

/** Click a sequence of canvas-relative points, in order. */
async function clickPath(page, points) {
  const canvas = page.locator(CANVAS)

  for (const point of points) {
    await canvas.click({ position: point })
  }
}

/**
 * Press Tab until the focused element matches, and return its focus key.
 *
 * The zoom controls live inside the canvas and come first in the tab order, so
 * the number of presses is a property of the controls the map was given rather
 * than something worth hard-coding.
 */
async function tabTo(page, selector, limit = 8) {
  for (let i = 0; i < limit; i++) {
    await page.keyboard.press("Tab")

    const key = await page.evaluate(
      (sel) => (document.activeElement.matches(sel) ? document.activeElement.dataset.roverFocus : null),
      selector
    )

    if (key) return key
  }

  return null
}

test.describe("the playground", () => {
  test("builds IGN tile URLs the Géoportail accepts", async ({ page }) => {
    const urls = await stubTiles(page)
    const problems = failOnPageErrors(page)

    await page.goto("/")
    await mapReady(page)
    await expect.poll(() => urls.length).toBeGreaterThan(0)

    const plan = urls[0]

    // The plan layer is PNG. Asking for the wrong format gets an
    // InvalidParameterValue XML document where a tile should be — which renders as
    // nothing, with no error anywhere. That shipped once.
    expect(decodeURIComponent(plan)).toContain("LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2")
    expect(decodeURIComponent(plan)).toContain("FORMAT=image/png")

    // The placeholders must be substituted, and TILEROW must carry y while
    // TILECOL carries x. Swap them and the map loads, wrong.
    expect(plan).toMatch(/TILEMATRIX=\d+/)
    expect(plan).toMatch(/TILEROW=\d+/)
    expect(plan).toMatch(/TILECOL=\d+/)
    expect(plan).not.toContain("{z}")

    urls.length = 0
    await page.getByRole("button", { name: /^Tiles:/ }).click()
    await expect.poll(() => urls.length).toBeGreaterThan(0)

    // The orthophotography layer is JPEG, and does not answer to PNG.
    const ortho = decodeURIComponent(urls[0])
    expect(ortho).toContain("LAYER=ORTHOIMAGERY.ORTHOPHOTOS")
    expect(ortho).toContain("FORMAT=image/jpeg")

    expect(problems).toEqual([])
  })

  test("opens a marker popup on click and closes it on the map", async ({ page }) => {
    await stubTiles(page)
    const problems = failOnPageErrors(page)

    await page.goto("/")
    await mapReady(page)

    const popup = page.locator(`${MAP} [data-rover-popup-for="marker:1"]`)
    await expect(popup).toBeHidden()

    const pixel = await markerPixel(page, 1)
    expect(pixel).not.toBeNull()

    await page.locator(CANVAS).click({ position: pixel })
    await expect(popup).toBeVisible()
    await expect(popup).toContainText("Atelier")

    await page.locator(CANVAS).click({ position: await emptyPixel(page) })
    await expect(popup).toBeHidden()

    expect(problems).toEqual([])
  })

  test("opens a shape popup where the shape was clicked", async ({ page }) => {
    await stubTiles(page)
    const problems = failOnPageErrors(page)

    // The parcel alone, so there is a large filled polygon to aim at.
    await page.goto("/?shapes=parcel")
    await mapReady(page)

    const popup = page.locator(`${MAP} [data-rover-popup-for="shape:parcel"]`)
    await expect(popup).toBeHidden()

    const inside = await shapePixel(page, MAP)

    await page.locator(CANVAS).click({ position: inside })
    await expect(popup).toBeVisible()
    await expect(popup).toContainText("AB 214")

    // Anchored near the click, not at some far-off centroid.
    const anchored = await page.evaluate(() => {
      const node = document.querySelector('#clients [data-rover-popup-for="shape:parcel"]')
      return { left: parseFloat(node.style.left), top: parseFloat(node.style.top) }
    })

    expect(Math.abs(anchored.left - inside.x)).toBeLessThan(4)
    expect(anchored.top).toBeLessThan(inside.y)

    await page.locator(CANVAS).click({ position: await emptyPixel(page) })
    await expect(popup).toBeHidden()

    expect(problems).toEqual([])
  })

  test("a marker and a shape sharing an id open their own popups", async ({ page }) => {
    await stubTiles(page)
    const problems = failOnPageErrors(page)

    await page.goto("/")
    await mapReady(page)

    // Marker 1 and no shape called 1 in the demo, but the selectors must still be
    // distinct — a bare id would have both nodes answering to one query.
    const markerPopup = page.locator(`${MAP} [data-rover-popup-for="marker:1"]`)
    const shapePopup = page.locator(`${MAP} [data-rover-popup-for="shape:parcel"]`)

    await page.locator(CANVAS).click({ position: await markerPixel(page, 1) })
    await expect(markerPopup).toBeVisible()
    await expect(shapePopup).toBeHidden()

    expect(problems).toEqual([])
  })

  test("opens a shape popup with no server handler wired", async ({ page }) => {
    await stubTiles(page)
    const problems = failOnPageErrors(page)

    await page.goto("/")
    await mapReady(page)

    // The second map has a shape popup and no on_* attributes whatsoever. A shape
    // click keyed on the configured event alone would never reach it, and the popup
    // would simply never open — marker popups need no server, and neither should
    // these.
    const popup = page.locator('#mini [data-rover-popup-for="shape:parcel"]')
    await expect(popup).toBeHidden()

    const inside = await shapePixel(page, "#mini")

    await page.locator("#mini-canvas").click({ position: inside })
    await expect(popup).toBeVisible()
    await expect(popup).toContainText("no handler wired")

    expect(problems).toEqual([])
  })

  test("shows a shape tooltip on hover", async ({ page }) => {
    await stubTiles(page)
    const problems = failOnPageErrors(page)

    await page.goto("/?shapes=parcel")
    await mapReady(page)

    const inside = await shapePixel(page, MAP)

    await page.locator(CANVAS).hover({ position: inside })

    const tooltip = page.locator(`${MAP} .rover-tooltip`)
    await expect(tooltip).toBeVisible()
    await expect(tooltip).toContainText("Parcel AB 214")

    expect(problems).toEqual([])
  })

  test("renders a heat field, and rebuilds it only when the revision changes", async ({
    page,
  }) => {
    await stubTiles(page)
    const problems = failOnPageErrors(page)

    await page.goto("/")
    await mapReady(page)

    const heat = () =>
      page.evaluate((selector) => {
        const layer = document.querySelector(selector)._rover.heatmapLayer
        return {
          count: layer.source.getFeatures().length,
          rev: layer.rev,
          radius: layer.layer.getRadius(),
          blur: layer.layer.getBlur(),
          visible: layer.layer.getVisible(),
        }
      }, MAP)

    expect((await heat()).count).toBe(0)

    await page.getByRole("button", { name: /^Heatmap:/ }).click()
    await expect(page.locator(".log")).toContainText("heatmap on")

    const on = await heat()
    expect(on.count).toBe(180)
    // The style has to reach the layer, not just the payload.
    expect(on.radius).toBe(14)
    expect(on.blur).toBe(22)
    expect(on.visible).toBe(true)

    // An unrelated update must not rebuild the field. Comparing the revision proves
    // nothing — it would be the same string either way — so tag a feature and see
    // whether it survives. A rebuild replaces every feature and loses the tag.
    await page.evaluate((selector) => {
      const features = document.querySelector(selector)._rover.heatmapLayer.source.getFeatures()
      features[0].set("__probe", "tagged", true)
    }, MAP)

    await page.getByRole("button", { name: "Move the first one" }).click()
    await expect(page.locator(".log")).toContainText("moved marker 1")

    const survived = await page.evaluate((selector) => {
      const features = document.querySelector(selector)._rover.heatmapLayer.source.getFeatures()
      return features.length > 0 && features[0].get("__probe")
    }, MAP)

    expect(survived, "the heat field was rebuilt for nothing").toBe("tagged")
    expect((await heat()).count).toBe(180)

    // A style-only change is the case the layer's revision check exists for: the
    // payload changes, so the hook does call reconcile, and the new radius must be
    // applied without throwing away the points.
    await page.getByRole("button", { name: /^Heat radius:/ }).click()
    await expect(page.locator(".log")).toContainText("style only")

    const restyled = await heat()
    expect(restyled.radius, "the new radius was not applied").toBe(20)

    const stillTagged = await page.evaluate((selector) => {
      const features = document.querySelector(selector)._rover.heatmapLayer.source.getFeatures()
      return features.length > 0 && features[0].get("__probe")
    }, MAP)

    expect(stillTagged, "restyling rebuilt the whole field").toBe("tagged")

    await page.getByRole("button", { name: /^Heatmap:/ }).click()
    await expect(page.locator(".log")).toContainText("heatmap off")
    expect((await heat()).count).toBe(0)

    expect(problems).toEqual([])
  })

  test("keeps an open popup open across a LiveView patch", async ({ page }) => {
    await stubTiles(page)
    const problems = failOnPageErrors(page)

    await page.goto("/")
    await mapReady(page)

    const popup = page.locator(`${MAP} [data-rover-popup-for="marker:1"]`)
    await page.locator(CANVAS).click({ position: await markerPixel(page, 1) })
    await expect(popup).toBeVisible()

    // `hidden` is a static attribute in the template, so every re-render of the
    // marker comprehension restores it. The popup used to vanish here while the
    // client still believed it was open.
    await page.getByRole("button", { name: "Move the first one" }).click()
    await expect(page.locator(".log")).toContainText("moved marker 1")

    await expect(popup).toBeVisible()

    expect(problems).toEqual([])
  })

  test("frames markers and shapes together on the first paint", async ({ page }) => {
    await stubTiles(page)
    const problems = failOnPageErrors(page)

    // The parcel alone: its bounding box excludes two of the three markers. With
    // both shapes the route's box happens to enclose them all, which is why the
    // bug hid for a whole release.
    await page.goto("/?shapes=parcel")
    await mapReady(page)

    const offscreen = await page.evaluate((selector) => {
      const rover = document.querySelector(selector)._rover
      const [minX, minY, maxX, maxY] = rover.map
        .getView()
        .calculateExtent(rover.map.getSize())

      // Everything here is EPSG:3857 already — the view extent and the features
      // alike — so containment is plain arithmetic.
      return [...rover.markerLayer.entries.entries()]
        .map(([id, entry]) => {
          const [x, y] = entry.feature.getGeometry().getCoordinates()
          return { id, inside: x >= minX && x <= maxX && y >= minY && y <= maxY }
        })
        .filter((marker) => !marker.inside)
        .map((marker) => marker.id)
    }, MAP)

    expect(offscreen, "markers left outside the initial frame").toEqual([])

    expect(problems).toEqual([])
  })

  test("flies to a one-shot destination without making it state", async ({ page }) => {
    await stubTiles(page)
    const problems = failOnPageErrors(page)

    await page.goto("/")
    await mapReady(page)

    const centre = () =>
      page.evaluate((selector) => {
        const rover = document.querySelector(selector)._rover
        const [x, y] = rover.map.getView().getCenter()
        return { x, y, zoom: rover.map.getView().getZoom() }
      }, MAP)

    const before = await centre()

    // Paris, from a map framed on Lyon. Nothing is assigned, so this is the whole
    // round trip: push_event, the right map answering, the view animating.
    await page.getByRole("button", { name: "Fly to Paris" }).click()
    await expect(page.locator(".log")).toContainText("flew to Paris")
    await page.waitForTimeout(900)

    const after = await centre()

    expect(after.x, "the view did not move").not.toBeCloseTo(before.x, 0)
    expect(after.zoom).toBeCloseTo(12, 0)

    // The other map on the page shares the markers but was not addressed. A command
    // that reaches every hook and is not filtered by id moves both.
    const mini = await page.evaluate(
      () => document.getElementById("mini")._rover.map.getView().getCenter()[0]
    )

    expect(mini, "the second map flew too").toBeCloseTo(before.x, 0)

    // And it survives the next unrelated re-render: a command must not be undone
    // by a config attribute that never changed.
    await page.getByRole("button", { name: "Recolour the parcel" }).click()
    await expect(page.locator(".log")).toContainText("recoloured")
    await page.waitForTimeout(600)

    const later = await centre()
    expect(later.x, "an unrelated update pulled the view back").toBeCloseTo(after.x, 0)

    expect(problems).toEqual([])
  })

  test("fits to a subset on command, honouring max_zoom", async ({ page }) => {
    await stubTiles(page)
    const problems = failOnPageErrors(page)

    await page.goto("/")
    await mapReady(page)

    const zoom = () =>
      page.evaluate(
        (selector) => document.querySelector(selector)._rover.map.getView().getZoom(),
        MAP
      )

    const before = await zoom()

    // One marker with max_zoom: 17 lands on exactly 17 — an assertion that cannot
    // be satisfied by doing nothing, which a `>=` against the previous zoom quietly
    // was.
    await page.getByRole("button", { name: "Fit the first client" }).click()
    await expect(page.locator(".log")).toContainText("fitted to marker")
    await page.waitForTimeout(900)

    const after = await zoom()

    expect(after, `zoom ${before} -> ${after}`).toBeCloseTo(17, 0)
    expect(after).not.toBeCloseTo(before, 0)

    expect(problems).toEqual([])
  })

  test("groups a crowd, and a click drills into a group", async ({ page }) => {
    await stubTiles(page)
    const problems = failOnPageErrors(page)

    await page.goto("/")
    await mapReady(page)

    const state = () =>
      page.evaluate((selector) => {
        const layer = document.querySelector(selector)._rover.markerLayer
        const rendered = layer.clusterSource
          ? layer.clusterSource.getFeatures()
          : layer.source.getFeatures()

        return {
          markers: layer.source.getFeatures().length,
          rendered: rendered.length,
          clustering: layer.clustering,
          groups: rendered.filter((f) => (f.get("features") || []).length > 1).length,
          zoom: document.querySelector(selector)._rover.map.getView().getZoom(),
        }
      }, MAP)

    // Assert on the button's own label, not on the shared log: `on_move_end` writes
    // to that whenever the view settles, and racing the two fails for no reason.
    await page.getByRole("button", { name: /^Crowd:/ }).click()
    await expect(page.getByRole("button", { name: "Crowd: 240 markers" })).toBeVisible()

    const crowded = await state()
    expect(crowded.markers).toBe(243)
    expect(crowded.clustering).toBe(false)
    expect(crowded.rendered).toBe(243)

    await page.getByRole("button", { name: /^Cluster:/ }).click()
    await expect(page.getByRole("button", { name: "Cluster: on" })).toBeVisible()

    const grouped = await state()
    expect(grouped.clustering).toBe(true)
    expect(grouped.markers, "clustering rebuilt the markers").toBe(243)
    // The point of the feature: far fewer things drawn than there are markers.
    expect(grouped.rendered).toBeLessThan(crowded.rendered)
    expect(grouped.groups).toBeGreaterThan(0)

    // A click on a group must drill in, or a cluster is a dead end: you can see that
    // twelve things are there with no way to reach them.
    await page.locator(CANVAS).click({ position: await clusterPixel(page, MAP) })
    await expect(page.locator(".cluster-log")).toContainText("cluster of")
    await page.waitForTimeout(700)

    const drilled = (await state()).zoom
    expect(drilled, "the click did not zoom into the group").toBeGreaterThan(grouped.zoom)

    expect(problems).toEqual([])
  })

  test("drilling into a group never zooms out", async ({ page }) => {
    await stubTiles(page)
    const problems = failOnPageErrors(page)

    await page.goto("/")
    await mapReady(page)

    // Two markers ~20m apart, clustered, seen from zoom 18: ~33px apart, inside the
    // default clustering distance, with the view already past the marker-only cap of
    // 16. `View#fit` treats maxZoom as a resolution *floor*, so passing that cap here
    // used to animate 18 → 16, where the pair is closer in pixels than before and
    // stays one group. Clicks then did nothing at all — the dead end zoom_on_click
    // exists to prevent.
    await page.getByRole("button", { name: "Two in a yard" }).click()
    await expect(page.locator(".log")).toContainText("two vans in a yard")
    await page.waitForTimeout(500)

    const zoom = () =>
      page.evaluate(
        (selector) => document.querySelector(selector)._rover.map.getView().getZoom(),
        MAP
      )

    const before = await zoom()
    expect(before, "the yard setup did not reach zoom 18").toBeCloseTo(18, 0)

    // No conditional: if the two vans are not grouped, the setup is wrong and this
    // test must say so rather than skip itself.
    const group = await clusterPixel(page, MAP)

    await page.locator(CANVAS).click({ position: group })
    await page.waitForTimeout(800)

    const after = await zoom()
    expect(after, `zoom went backwards from ${before} to ${after}`).toBeGreaterThanOrEqual(
      before - 0.01
    )

    expect(problems).toEqual([])
  })

  test("a click on a group dismisses an open popup", async ({ page }) => {
    await stubTiles(page)
    const problems = failOnPageErrors(page)

    await page.goto("/")
    await mapReady(page)

    await page.getByRole("button", { name: /^Crowd:/ }).click()
    await expect(page.getByRole("button", { name: "Crowd: 240 markers" })).toBeVisible()
    // Twice, to reach `zoom_on_click: false`. With the zoom, the drill-in makes the
    // clusters recompute and the popup closes as a side effect — which masks whether
    // dismissing it was ever deliberate. Without the zoom, nothing moves, and the
    // explicit dismissal is the only thing that can close it.
    await page.getByRole("button", { name: /^Cluster:/ }).click()
    await page.getByRole("button", { name: /^Cluster:/ }).click()
    await expect(page.getByRole("button", { name: "Cluster: on, no zoom" })).toBeVisible()

    // A marker alone in its group is drawn as its own pin, so it still has a popup.
    const solo = await soloPixel(page, MAP)
    await page.locator(CANVAS).click({ position: { x: solo.x, y: solo.y } })

    const popup = page.locator(`${MAP} [data-rover-popup-for="marker:${solo.id}"]`)
    await expect(popup).toBeVisible()

    // Clicking a group claims the click. Without dismissing the popup it would stay
    // anchored to a marker while the view animates somewhere else entirely.
    //
    // Well clear of the open popup: it sits above its marker with pointer events, so
    // a group underneath it is unclickable and the test would time out rather than
    // fail for a reason worth reading.
    const group = await clusterPixel(page, MAP, { x: solo.x, y: solo.y, radius: 220 })

    await page.locator(CANVAS).click({ position: group })
    await expect(popup).toBeHidden()

    expect(problems).toEqual([])
  })

  test("closes a popup when its marker becomes part of a group", async ({ page }) => {
    await stubTiles(page)
    const problems = failOnPageErrors(page)

    await page.goto("/")
    await mapReady(page)

    const popup = page.locator(`${MAP} [data-rover-popup-for="marker:1"]`)

    await page.locator(CANVAS).click({ position: await markerPixel(page, 1) })
    await expect(popup).toBeVisible()

    // Grouped, the marker has no rendered feature of its own — its pin is drawn at
    // the group's centre. Leaving the popup open would point it at empty space.
    await page.getByRole("button", { name: /^Crowd:/ }).click()
    await expect(page.getByRole("button", { name: "Crowd: 240 markers" })).toBeVisible()
    await page.getByRole("button", { name: /^Cluster:/ }).click()
    await expect(page.getByRole("button", { name: "Cluster: on" })).toBeVisible()

    await expect(popup).toBeHidden()

    expect(problems).toEqual([])
  })

  test("does not yank the view when a marker moves", async ({ page }) => {
    await stubTiles(page)
    const problems = failOnPageErrors(page)

    await page.goto("/")
    await mapReady(page)

    const before = await page.evaluate(
      (selector) => document.querySelector(selector)._rover.map.getView().getZoom(),
      MAP
    )

    // 0.1 animated to the derived centre at the derived zoom on every marker
    // update, landing on a world view with no way back.
    await page.getByRole("button", { name: "Move the first one" }).click()
    await expect(page.locator(".log")).toContainText("moved marker 1")
    await page.waitForTimeout(600)

    const after = await page.evaluate(
      (selector) => document.querySelector(selector)._rover.map.getView().getZoom(),
      MAP
    )

    expect(after, `zoom went from ${before} to ${after}`).toBeCloseTo(before, 1)

    expect(problems).toEqual([])
  })

  test("drags an editable shape's vertex and reports the edited geometry", async ({ page }) => {
    await stubTiles(page)
    const problems = failOnPageErrors(page)

    await page.goto("/?shapes=parcel")
    await mapReady(page)

    const box = await page.locator(CANVAS).boundingBox()
    const before = await shapeVertexPixel(page, MAP, "parcel")
    expect(before).not.toBeNull()

    const start = { x: box.x + before.x, y: box.y + before.y }
    const end = { x: start.x + 24, y: start.y - 18 }

    // Modify arms hit-detection on hover, before the pointer goes down — skip
    // the move and the drag grabs nothing.
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(end.x, end.y, { steps: 5 })
    await page.mouse.up()

    await expect(page.locator(".log")).toContainText("shape parcel edited — and the server now agrees")

    const after = await shapeVertexPixel(page, MAP, "parcel")
    expect(
      Math.hypot(after.x - before.x, after.y - before.y),
      "the vertex did not move"
    ).toBeGreaterThan(10)

    expect(problems).toEqual([])
  })

  test("a plain click on an editable shape's edge neither inserts a vertex nor edits it", async ({
    page,
  }) => {
    // Modify's default insertVertexCondition is "always": a bare click near an
    // edge (no drag) inserts a vertex there and still fires modifyend, which
    // would silently mutate geometry from what looks like a read-only click —
    // one that, on this same shape, also opens its popup via on_shape_click.
    await stubTiles(page)
    const problems = failOnPageErrors(page)

    await page.goto("/?shapes=parcel")
    await mapReady(page)

    const before = await shapeEdgeMidpointPixel(page, MAP, "parcel")
    expect(before).not.toBeNull()

    const vertexCountBefore = await page.evaluate(
      (selector) =>
        document
          .querySelector(selector)
          ._rover.shapeLayer.entries.get("parcel")
          .features[0].getGeometry()
          .getCoordinates()[0].length,
      MAP
    )

    await page.locator(CANVAS).click({ position: before })

    // The click still does its ordinary job — opening the popup — so
    // shapeClick is expected; shapeEditEnd is not.
    await expect(page.locator(`${MAP} [data-rover-popup-for="shape:parcel"]`)).toBeVisible()
    await expect(page.locator(".log")).not.toContainText("shape parcel edited")

    const vertexCountAfter = await page.evaluate(
      (selector) =>
        document
          .querySelector(selector)
          ._rover.shapeLayer.entries.get("parcel")
          .features[0].getGeometry()
          .getCoordinates()[0].length,
      MAP
    )

    expect(vertexCountAfter, "a click inserted a vertex").toBe(vertexCountBefore)

    expect(problems).toEqual([])
  })

  test("a rejected shape edit snaps back to the server's geometry", async ({ page }) => {
    await stubTiles(page)
    const problems = failOnPageErrors(page)

    await page.goto("/?shapes=parcel")
    await mapReady(page)

    await page.getByRole("button", { name: /^Edits:/ }).click()
    await expect(page.getByRole("button", { name: "Edits: rejected" })).toBeVisible()

    const box = await page.locator(CANVAS).boundingBox()
    const before = await shapeVertexPixel(page, MAP, "parcel")

    const start = { x: box.x + before.x, y: box.y + before.y }
    const end = { x: start.x + 24, y: start.y - 18 }

    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(end.x, end.y, { steps: 5 })
    await page.mouse.up()

    await expect(page.locator(".log")).toContainText("rejected, snapping back")

    // The bounce back to the server's own (unedited) geometry is the load-
    // bearing behaviour: :rev alone changed, not :geometry, and only a :rev
    // the client has not already cached forces reconcile() to rebuild at all.
    const after = await shapeVertexPixel(page, MAP, "parcel")
    expect(after.x, "the vertex stayed at the dropped position").toBeCloseTo(before.x, 0)
    expect(after.y, "the vertex stayed at the dropped position").toBeCloseTo(before.y, 0)

    expect(problems).toEqual([])
  })
  test("draws a polygon, and the sketch becomes a shape the server owns", async ({ page }) => {
    // The scratch layer's whole reason for existing: a feature Draw put straight
    // into ShapeLayer's source would be untracked by `entries`, so the server's
    // echo of the same shape would render a second feature beside it and the
    // polygon would appear twice. Asserting the sketch is empty afterwards is
    // what catches that.
    await stubTiles(page)
    const problems = failOnPageErrors(page)

    await page.goto("/?shapes=none")
    await mapReady(page)

    await page.getByRole("button", { name: "Draw: off" }).click()
    await expect(page.getByRole("button", { name: "Draw: polygon" })).toBeVisible()
    expect(await drawState(page)).toMatchObject({ drawing: "Polygon", shapes: 0 })

    // Three corners, then the last click again — how OpenLayers is told a
    // polygon is finished.
    await clickPath(page, [
      { x: 120, y: 120 },
      { x: 220, y: 120 },
      { x: 220, y: 200 },
      { x: 220, y: 200 },
    ])

    await expect(page.locator(".log")).toContainText(
      "drew drawn-1 (Polygon) — the sketch became a shape the server owns"
    )

    const after = await drawState(page)
    expect(after.shapes, "the drawn shape did not reach the shape layer").toBe(1)
    expect(after.sketch, "the sketch outlived the shape it became").toBe(0)
    // Still armed: the mode ends when the server says so, not when one shape is
    // finished, so tracing four parcels takes four gestures and no toolbar trips.
    expect(after.drawing).toBe("Polygon")

    expect(problems).toEqual([])
  })

  test("the map is reachable by keyboard, and its arrow keys pan it", async ({ page }) => {
    // OpenLayers ships KeyboardPan and KeyboardZoom in defaultInteractions(), and
    // both were dead: nothing focusable, and the key listener bound to a viewport
    // no one ever focuses.
    await stubTiles(page)
    const problems = failOnPageErrors(page)

    await page.goto("/")
    await mapReady(page)

    const center = () =>
      page.evaluate(
        (selector) => document.querySelector(selector)._rover.map.getView().getCenter(),
        MAP
      )

    const before = await center()

    await page.locator(CANVAS).focus()
    expect(
      await page.evaluate((selector) => document.activeElement === document.querySelector(selector), CANVAS),
      "the map cannot take focus"
    ).toBe(true)

    await page.keyboard.press("ArrowDown")

    await expect
      .poll(async () => (await center())[1], { message: "the arrow key did not pan the map" })
      .not.toBe(before[1])

    expect(problems).toEqual([])
  })

  test("a click that places a vertex is not a click on the map", async ({ page }) => {
    // Every click while drawing also reaches `singleclick`. Without the guard it
    // fires on_map_click per vertex — and Popups listens for mapClick, so each
    // corner of a polygon would also dismiss whatever popup was open.
    await stubTiles(page)
    const problems = failOnPageErrors(page)

    await page.goto("/?shapes=none")
    await mapReady(page)

    await page.getByRole("button", { name: "Draw: off" }).click()
    await expect(page.getByRole("button", { name: "Draw: polygon" })).toBeVisible()

    await clickPath(page, [
      { x: 130, y: 130 },
      { x: 210, y: 130 },
    ])

    await expect(page.locator(".log")).not.toContainText("map clicked at")

    expect(problems).toEqual([])
  })

  test("Escape abandons the sketch and leaves the mode armed", async ({ page }) => {
    await stubTiles(page)
    const problems = failOnPageErrors(page)

    await page.goto("/?shapes=none")
    await mapReady(page)

    await page.getByRole("button", { name: "Draw: off" }).click()
    await expect(page.getByRole("button", { name: "Draw: polygon" })).toBeVisible()

    await clickPath(page, [
      { x: 140, y: 140 },
      { x: 230, y: 140 },
      { x: 230, y: 210 },
    ])

    await page.keyboard.press("Escape")

    const afterEscape = await drawState(page)
    expect(afterEscape.sketch, "the abandoned sketch is still on the map").toBe(0)
    expect(afterEscape.shapes, "an abandoned sketch reached the server").toBe(0)
    expect(afterEscape.drawing, "Escape disarmed the mode as well").toBe("Polygon")

    // And turning the mode off leaves nothing behind.
    await page.getByRole("button", { name: "Draw: polygon" }).click()
    await page.getByRole("button", { name: "Draw: line" }).click()
    await page.getByRole("button", { name: "Draw: point" }).click()
    await expect(page.getByRole("button", { name: "Draw: off" })).toBeVisible()

    expect(await drawState(page)).toMatchObject({ drawing: null, sketch: 0 })

    expect(problems).toEqual([])
  })

  test("a marker is reachable by keyboard, and opens its own popup", async ({ page }) => {
    // Markers are painted into a canvas, so the hidden button list is the only
    // way a keyboard reaches one at all.
    await stubTiles(page)
    const problems = failOnPageErrors(page)

    await page.goto("/")
    await mapReady(page)

    await page.locator(CANVAS).focus()

    // Past the zoom controls, which sit inside the canvas and come first.
    const key = await tabTo(page, "[data-rover-focus]")
    expect(key, "no feature button in the tab order").toBe("marker:1")

    // Hidden until focused, then shown: a focus ring nobody can see is worse
    // than none.
    await expect(page.locator('[data-rover-focus="marker:1"]')).toBeVisible()

    await page.keyboard.press("Enter")

    const popup = page.locator(`${MAP} [data-rover-popup-for="marker:1"]`)
    await expect(popup).toBeVisible()
    await expect(page.locator(".log")).toContainText("marker 1")

    expect(
      await page.evaluate(() => Boolean(document.activeElement.closest(".rover-popup"))),
      "focus stayed on the button instead of following into the popup"
    ).toBe(true)

    await page.keyboard.press("Escape")

    await expect(popup).toBeHidden()
    expect(
      await page.evaluate(() => document.activeElement.dataset.roverFocus),
      "focus was dropped on the body instead of handed back"
    ).toBe("marker:1")

    expect(problems).toEqual([])
  })

  test("draws a point, the type the server asked for", async ({ page }) => {
    await stubTiles(page)
    const problems = failOnPageErrors(page)

    await page.goto("/?shapes=none")
    await mapReady(page)

    await page.getByRole("button", { name: "Draw: off" }).click()
    await page.getByRole("button", { name: "Draw: polygon" }).click()
    await page.getByRole("button", { name: "Draw: line" }).click()
    await expect(page.getByRole("button", { name: "Draw: point" })).toBeVisible()
    expect(await drawState(page)).toMatchObject({ drawing: "Point" })

    await clickPath(page, [{ x: 160, y: 160 }])

    await expect(page.locator(".log")).toContainText("drew drawn-1 (Point)")
    expect((await drawState(page)).sketch).toBe(0)

    expect(problems).toEqual([])
  })

  test("a pointer click is left alone by the focus handling", async ({ page }) => {
    // Only a keyboard opening moves focus. A mouse user has their attention
    // where they clicked and must not be sent anywhere.
    await stubTiles(page)
    const problems = failOnPageErrors(page)

    await page.goto("/")
    await mapReady(page)

    const marker = await markerPixel(page, 1)
    await page.locator(CANVAS).click({ position: marker })

    await expect(page.locator(`${MAP} [data-rover-popup-for="marker:1"]`)).toBeVisible()

    expect(
      await page.evaluate(() => Boolean(document.activeElement.closest(".rover-popup"))),
      "a pointer click moved focus into the popup"
    ).toBe(false)

    expect(problems).toEqual([])
  })
  test("a clustered marker is still reachable by keyboard", async ({ page }) => {
    // markerFor(featureById(id)) returns null for a marker OpenLayers has
    // grouped, so resolving the button that way made every grouped marker's tab
    // stop a silent no-op — under clustering, which is the documented answer to
    // hundreds of markers and exactly when this list matters most.
    await stubTiles(page)
    const problems = failOnPageErrors(page)

    await page.goto("/")
    await mapReady(page)

    await page.getByRole("button", { name: /^Crowd:/ }).click()
    await page.getByRole("button", { name: "Cluster: off" }).click()
    await expect(page.getByRole("button", { name: /^Cluster: on/ })).toBeVisible()

    // The premise: marker 1 has no rendered feature of its own any more.
    await expect
      .poll(() =>
        page.evaluate(
          (selector) => document.querySelector(selector)._rover.markerLayer.featureById("1"),
          MAP
        )
      )
      .toBeNull()

    await page.locator('[data-rover-focus="marker:1"]').focus()
    await page.keyboard.press("Enter")

    await expect(page.locator(".log")).toContainText("marker 1")

    // A grouped marker has no popup — the popup would point at the group's
    // centre — so focus must stay where it was rather than be dropped.
    expect(
      await page.evaluate(() => document.activeElement.dataset.roverFocus),
      "focus was dropped when no popup opened"
    ).toBe("marker:1")

    expect(problems).toEqual([])
  })
  test("locking the map takes it out of the tab order, and unlocking puts it back", async ({
    page,
  }) => {
    // The canvas is phx-update="ignore", and LiveView merges only data-* onto an
    // ignored element — so tabindex and aria-label rendered by the server are
    // written once at mount and never again. Without the client re-applying
    // them, a map that locks itself stays a focusable role="application" that
    // does nothing.
    await stubTiles(page)
    const problems = failOnPageErrors(page)

    await page.goto("/")
    await mapReady(page)

    const tabindex = () => page.locator(CANVAS).getAttribute("tabindex")

    expect(await tabindex()).toBe("0")

    await page.getByRole("button", { name: "Interactive: on" }).click()
    await expect(page.getByRole("button", { name: "Interactive: off" })).toBeVisible()

    await expect.poll(tabindex, { message: "a locked map is still a tab stop" }).toBeNull()
    // And this map's feature buttons went with it: a locked map withholds every
    // click. Scoped to this map — the second one on the page is untouched, which
    // is the point of locking one and not the other.
    await expect(page.locator(`${MAP} [data-rover-focus]`)).toHaveCount(0)

    await page.getByRole("button", { name: "Interactive: off" }).click()
    await expect(page.getByRole("button", { name: "Interactive: on" })).toBeVisible()

    await expect
      .poll(tabindex, { message: "unlocking did not put the map back in the tab order" })
      .toBe("0")

    expect(problems).toEqual([])
  })
})
