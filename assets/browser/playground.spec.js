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

    const popup = page.locator('[data-rover-popup-for="1"]')
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

  test("keeps an open popup open across a LiveView patch", async ({ page }) => {
    await stubTiles(page)
    const problems = failOnPageErrors(page)

    await page.goto("/")
    await mapReady(page)

    const popup = page.locator('[data-rover-popup-for="1"]')
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
})
