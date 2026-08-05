import { fromLonLat, toLonLat } from "ol/proj.js"

// Rover's public vocabulary is {lat, lon}. OpenLayers works in projected
// [x, y] — i.e. [lon, lat] run through Web Mercator. The flip happens here and
// nowhere else, so that no application code ever has to think about it.

export function project(lat, lon) {
  return fromLonLat([lon, lat])
}

export function unproject(coordinate) {
  const [lon, lat] = toLonLat(coordinate)
  return { lat: round(lat), lon: round(lon) }
}

export function extentToBbox(extent) {
  const [minX, minY, maxX, maxY] = extent
  const southWest = unproject([minX, minY])
  const northEast = unproject([maxX, maxY])

  const bbox = {
    south: southWest.lat,
    west: southWest.lon,
    north: northEast.lat,
    east: northEast.lon,
  }

  // Longitudes come back wrapped into ±180, so a viewport straddling the
  // antimeridian — Fiji, New Zealand, the Aleutians — yields west > east. Flag
  // it instead of handing back a box that `lon BETWEEN west AND east` reads as
  // empty, which would silently return no rows for those users.
  if (bbox.west > bbox.east) bbox.crosses_antimeridian = true

  return bbox
}

// Seven decimals is ~1cm at the equator: far past anything a click can mean,
// and short enough to keep event payloads readable in the LiveView logs.
function round(value) {
  return Math.round(value * 1e7) / 1e7
}
