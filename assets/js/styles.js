import Style from "ol/style/Style.js"
import Icon from "ol/style/Icon.js"
import Text from "ol/style/Text.js"
import Fill from "ol/style/Fill.js"
import Stroke from "ol/style/Stroke.js"

export const DEFAULT_COLOR = "#e11d48"

// Styles are shared by every marker that looks the same. A thousand identical
// pins allocate one Style, not a thousand — which is most of the difference
// between a map that pans smoothly and one that stutters.
const cache = new Map()

// Labels can be volatile — an ETA, a counter, a telemetry reading — and each
// distinct one is a distinct cache key. Bounded so a long-lived LiveView session
// cannot accumulate styles for the lifetime of the page.
const CACHE_LIMIT = 512

export function styleFor(marker) {
  const key = [
    marker.emoji || "",
    marker.icon || "",
    marker.color || DEFAULT_COLOR,
    marker.scale || 1,
    marker.label || "",
  ].join("|")

  let style = cache.get(key)

  if (!style) {
    style = buildStyle(marker)

    // Map iterates in insertion order, so the first key is the oldest.
    if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value)

    cache.set(key, style)
  }

  return style
}

// Always an array, even for a single style: an emoji marker that also carries a
// label needs two, because an OpenLayers Style holds at most one Text.
function buildStyle(marker) {
  const scale = marker.scale || 1

  const styles = marker.emoji
    ? [new Style({ text: emojiText(marker.emoji, scale) })]
    : [new Style({ image: pinImage(marker, scale) })]

  if (marker.label) {
    const label = labelText(marker.label)

    if (marker.emoji) {
      styles.push(new Style({ text: label }))
    } else {
      styles[0].setText(label)
    }
  }

  return styles
}

function pinImage(marker, scale) {
  return marker.icon
    ? new Icon({ src: marker.icon, anchor: [0.5, 1], scale })
    : new Icon({ src: pinDataUri(marker.color || DEFAULT_COLOR), anchor: [0.5, 1], scale })
}

// Drawn as canvas text rather than a DOM overlay, so an emoji marker keeps
// everything a pin has: the shared style cache, hit testing through
// forEachFeatureAtPixel, and reconciliation by feature identity.
function emojiText(emoji, scale) {
  return new Text({
    text: emoji,
    font: `${Math.round(22 * scale)}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`,
    // Sit the glyph on the coordinate the way a pin's tip does.
    textBaseline: "bottom",
    offsetY: 4,
  })
}

function labelText(text) {
  return new Text({
    text,
    font: "500 12px ui-sans-serif, system-ui, -apple-system, sans-serif",
    offsetY: 8,
    textBaseline: "top",
    fill: new Fill({ color: "#111827" }),
    // A halo rather than a background box: legible over any tile, without
    // drawing a rectangle over the map.
    stroke: new Stroke({ color: "rgba(255, 255, 255, 0.92)", width: 3 }),
    overflow: true,
  })
}

function pinDataUri(color) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="36" viewBox="0 0 26 36">
<path d="M13 35.5S25.2 21.6 25.2 13A12.2 12.2 0 1 0 .8 13c0 8.6 12.2 22.5 12.2 22.5z" fill="${color}" stroke="rgba(0,0,0,0.22)" stroke-width="1"/>
<circle cx="13" cy="12.8" r="4.4" fill="#ffffff" fill-opacity="0.92"/>
</svg>`

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}
