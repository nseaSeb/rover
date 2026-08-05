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

  return {
    south: southWest.lat,
    west: southWest.lon,
    north: northEast.lat,
    east: northEast.lon,
  }
}

// Seven decimals is ~1cm at the equator: far past anything a click can mean,
// and short enough to keep event payloads readable in the LiveView logs.
function round(value) {
  return Math.round(value * 1e7) / 1e7
}
