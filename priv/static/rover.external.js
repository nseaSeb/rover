// js/coords.js
import { fromLonLat, toLonLat } from "ol/proj.js";
function project(lat, lon) {
  return fromLonLat([lon, lat]);
}
function unproject(coordinate) {
  const [lon, lat] = toLonLat(coordinate);
  return { lat: round(lat), lon: round(lon) };
}
function extentToBbox(extent) {
  const [minX, minY, maxX, maxY] = extent;
  const southWest = unproject([minX, minY]);
  const northEast = unproject([maxX, maxY]);
  const bbox = {
    south: southWest.lat,
    west: southWest.lon,
    north: northEast.lat,
    east: northEast.lon
  };
  if (bbox.west > bbox.east) bbox.crosses_antimeridian = true;
  return bbox;
}
function round(value) {
  return Math.round(value * 1e7) / 1e7;
}

// js/popups.js
var OFFSET_PX = 44;
var Popups = class {
  constructor(rootEl, roverMap) {
    this.root = rootEl;
    this.roverMap = roverMap;
    this.openId = null;
    roverMap.on("markerClick", ({ id }) => this.open(id));
    roverMap.on("mapClick", () => this.close());
    roverMap.on("shapeClick", () => this.close());
    this.onPostrender = () => this.position();
    roverMap.map.on("postrender", this.onPostrender);
    this.onKeydown = (event) => {
      if (event.key === "Escape") this.close();
    };
    document.addEventListener("keydown", this.onKeydown);
    this.onClick = (event) => {
      if (event.target.closest("[data-rover-popup-close]")) this.close();
    };
    this.root.addEventListener("click", this.onClick);
  }
  open(id) {
    const node = this.nodeFor(id);
    if (!node) return;
    this.close();
    this.openId = String(id);
    node.hidden = false;
    this.position();
  }
  close() {
    if (this.openId === null) return;
    const node = this.nodeFor(this.openId);
    if (node) node.hidden = true;
    this.openId = null;
  }
  position() {
    if (this.openId === null) return;
    const node = this.nodeFor(this.openId);
    const marker = this.roverMap.markerLayer.markerById(this.openId);
    if (!node || !marker) return this.close();
    const pixel = this.roverMap.map.getPixelFromCoordinate(project(marker.lat, marker.lon));
    if (!pixel) return;
    node.style.left = `${Math.round(pixel[0])}px`;
    node.style.top = `${Math.round(pixel[1]) - OFFSET_PX}px`;
  }
  // Called after LiveView patches the element: the open marker may be gone, or
  // its coordinates may have changed underneath the popup.
  refresh() {
    this.position();
  }
  nodeFor(id) {
    return this.root.querySelector(`[data-rover-popup-for="${cssEscape(String(id))}"]`);
  }
  destroy() {
    document.removeEventListener("keydown", this.onKeydown);
    this.root.removeEventListener("click", this.onClick);
    this.roverMap.map.un("postrender", this.onPostrender);
  }
};
function cssEscape(value) {
  return typeof CSS !== "undefined" && CSS.escape ? CSS.escape(value) : value.replace(/"/g, '\\"');
}

// js/rover_map.js
import Map2 from "ol/Map.js";
import View from "ol/View.js";
import Overlay from "ol/Overlay.js";
import TileLayer from "ol/layer/Tile.js";
import XYZ from "ol/source/XYZ.js";
import Attribution from "ol/control/Attribution.js";
import FullScreen from "ol/control/FullScreen.js";
import Rotate from "ol/control/Rotate.js";
import ScaleLine from "ol/control/ScaleLine.js";
import Zoom from "ol/control/Zoom.js";
import Translate from "ol/interaction/Translate.js";
import { defaults as defaultInteractions } from "ol/interaction/defaults.js";
import { createEmpty, extend } from "ol/extent.js";

// js/markers.js
import Feature from "ol/Feature.js";
import Point from "ol/geom/Point.js";
import VectorLayer from "ol/layer/Vector.js";
import VectorSource from "ol/source/Vector.js";

// js/styles.js
import Style from "ol/style/Style.js";
import Icon from "ol/style/Icon.js";
import Text from "ol/style/Text.js";
import Fill from "ol/style/Fill.js";
import Stroke from "ol/style/Stroke.js";
var DEFAULT_COLOR = "#e11d48";
var cache = /* @__PURE__ */ new Map();
var CACHE_LIMIT = 512;
function styleFor(marker) {
  const key = [
    marker.emoji || "",
    marker.icon || "",
    marker.color || DEFAULT_COLOR,
    marker.scale || 1,
    marker.label || ""
  ].join("|");
  let style = cache.get(key);
  if (!style) {
    style = buildStyle(marker);
    if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value);
    cache.set(key, style);
  }
  return style;
}
function buildStyle(marker) {
  const scale = marker.scale || 1;
  const styles = marker.emoji ? [new Style({ text: emojiText(marker.emoji, scale) })] : [new Style({ image: pinImage(marker, scale) })];
  if (marker.label) {
    const label = labelText(marker.label);
    if (marker.emoji) {
      styles.push(new Style({ text: label }));
    } else {
      styles[0].setText(label);
    }
  }
  return styles;
}
function pinImage(marker, scale) {
  return marker.icon ? new Icon({ src: marker.icon, anchor: [0.5, 1], scale }) : new Icon({ src: pinDataUri(marker.color || DEFAULT_COLOR), anchor: [0.5, 1], scale });
}
function emojiText(emoji, scale) {
  return new Text({
    text: emoji,
    font: `${Math.round(22 * scale)}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`,
    // Sit the glyph on the coordinate the way a pin's tip does.
    textBaseline: "bottom",
    offsetY: 4
  });
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
    overflow: true
  });
}
function pinDataUri(color) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="36" viewBox="0 0 26 36">
<path d="M13 35.5S25.2 21.6 25.2 13A12.2 12.2 0 1 0 .8 13c0 8.6 12.2 22.5 12.2 22.5z" fill="${color}" stroke="rgba(0,0,0,0.22)" stroke-width="1"/>
<circle cx="13" cy="12.8" r="4.4" fill="#ffffff" fill-opacity="0.92"/>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

// js/markers.js
var ROVER_KEY = "rover";
var MarkerLayer = class {
  constructor() {
    this.source = new VectorSource({ wrapX: false });
    this.layer = new VectorLayer({
      source: this.source,
      // Markers are the thing the user came for: keep them above every other
      // layer regardless of the order layers happen to be added in.
      zIndex: 10,
      updateWhileAnimating: true,
      updateWhileInteracting: true
    });
    this.entries = /* @__PURE__ */ new Map();
  }
  reconcile(markers) {
    const seen = /* @__PURE__ */ new Set();
    const added = [];
    for (const marker of markers) {
      const key = String(marker.id);
      seen.add(key);
      const geometryHash = `${marker.lat},${marker.lon}`;
      const appearanceHash = appearanceOf(marker);
      const entry = this.entries.get(key);
      if (!entry) {
        added.push(this.build(key, marker, geometryHash, appearanceHash));
        continue;
      }
      if (entry.geometryHash !== geometryHash) {
        entry.feature.getGeometry().setCoordinates(project(marker.lat, marker.lon));
        entry.geometryHash = geometryHash;
      }
      if (entry.appearanceHash !== appearanceHash) {
        entry.feature.setStyle(styleFor(marker));
        entry.appearanceHash = appearanceHash;
      }
      entry.marker = marker;
      entry.feature.setProperties({ [ROVER_KEY]: marker }, true);
    }
    for (const [key, entry] of this.entries) {
      if (!seen.has(key)) {
        this.source.removeFeature(entry.feature);
        this.entries.delete(key);
      }
    }
    if (added.length > 0) this.source.addFeatures(added);
  }
  build(key, marker, geometryHash, appearanceHash) {
    const feature = new Feature({ geometry: new Point(project(marker.lat, marker.lon)) });
    feature.setId(key);
    feature.setStyle(styleFor(marker));
    feature.setProperties({ [ROVER_KEY]: marker }, true);
    this.entries.set(key, { feature, marker, geometryHash, appearanceHash });
    return feature;
  }
  markerFor(feature) {
    return feature && feature.get(ROVER_KEY);
  }
  markerById(id) {
    const entry = this.entries.get(String(id));
    return entry && entry.marker;
  }
  /**
   * Drop the cached geometry hash for a feature the client moved on its own.
   *
   * After a drag, the geometry no longer matches the coordinates the server
   * sent. Without this, the next payload carrying those same coordinates hashes
   * identically and is skipped as "unchanged" — so a rejected drag would stick,
   * and the marker would stay wherever the user dropped it forever.
   */
  forgetGeometry(feature) {
    const entry = feature && this.entries.get(String(feature.getId()));
    if (entry) entry.geometryHash = null;
  }
  isDraggable(feature) {
    const marker = this.markerFor(feature);
    return Boolean(marker && marker.draggable);
  }
  get extent() {
    return this.entries.size > 0 ? this.source.getExtent() : null;
  }
  dispose() {
    this.source.clear();
    this.entries.clear();
  }
};
function appearanceOf(marker) {
  return [
    marker.label || "",
    marker.color || "",
    marker.emoji || "",
    marker.icon || "",
    marker.scale || ""
  ].join("|");
}

// js/shapes.js
import GeoJSON from "ol/format/GeoJSON.js";
import VectorLayer2 from "ol/layer/Vector.js";
import VectorSource2 from "ol/source/Vector.js";
import Fill2 from "ol/style/Fill.js";
import Stroke2 from "ol/style/Stroke.js";
import Style2 from "ol/style/Style.js";
import Text2 from "ol/style/Text.js";
var SHAPE_KEY = "roverShape";
var DEFAULT_COLOR2 = "#2563eb";
var DEFAULT_WIDTH = 2;
var DEFAULT_FILL_OPACITY = 0.12;
var CACHE_LIMIT2 = 256;
var cache2 = /* @__PURE__ */ new Map();
var format = new GeoJSON({
  dataProjection: "EPSG:4326",
  featureProjection: "EPSG:3857"
});
var ShapeLayer = class {
  constructor() {
    this.source = new VectorSource2({ wrapX: false });
    this.layer = new VectorLayer2({
      source: this.source,
      // Above the tiles, below the markers: an outline should never swallow the
      // pin that sits on it.
      zIndex: 5,
      updateWhileAnimating: false,
      updateWhileInteracting: false
    });
    this.entries = /* @__PURE__ */ new Map();
  }
  reconcile(shapes) {
    const seen = /* @__PURE__ */ new Set();
    const added = [];
    for (const shape of shapes) {
      const key = String(shape.id);
      seen.add(key);
      const rev = String(shape.rev);
      const appearanceHash = appearanceOf2(shape);
      const entry = this.entries.get(key);
      if (!entry) {
        added.push(...this.build(key, shape, rev, appearanceHash));
        continue;
      }
      if (entry.rev !== rev) {
        entry.features.forEach((feature) => this.source.removeFeature(feature));
        added.push(...this.build(key, shape, rev, appearanceHash));
        continue;
      }
      if (entry.appearanceHash !== appearanceHash) {
        const style = styleForShape(shape);
        entry.features.forEach((feature) => feature.setStyle(style));
        entry.appearanceHash = appearanceHash;
      }
      entry.shape = shape;
      entry.features.forEach(
        (feature) => feature.setProperties({ [SHAPE_KEY]: shape }, true)
      );
    }
    for (const [key, entry] of this.entries) {
      if (!seen.has(key)) {
        entry.features.forEach((feature) => this.source.removeFeature(feature));
        this.entries.delete(key);
      }
    }
    if (added.length > 0) this.source.addFeatures(added);
  }
  build(key, shape, rev, appearanceHash) {
    const features = readGeometry(shape);
    const style = styleForShape(shape);
    features.forEach((feature, index) => {
      feature.setId(`${key}:${index}`);
      feature.setStyle(style);
      feature.setProperties({ [SHAPE_KEY]: shape }, true);
    });
    this.entries.set(key, { features, shape, rev, appearanceHash });
    return features;
  }
  shapeFor(feature) {
    return feature && feature.get(SHAPE_KEY);
  }
  get extent() {
    return this.entries.size > 0 ? this.source.getExtent() : null;
  }
  dispose() {
    this.source.clear();
    this.entries.clear();
  }
};
function readGeometry(shape) {
  try {
    return format.readFeatures(shape.geometry);
  } catch (error) {
    console.error(`[rover] shape ${shape.id} has unreadable geometry:`, error, shape.geometry);
    return [];
  }
}
function styleForShape(shape) {
  const key = appearanceOf2(shape);
  let style = cache2.get(key);
  if (!style) {
    style = buildStyle2(shape);
    if (cache2.size >= CACHE_LIMIT2) cache2.delete(cache2.keys().next().value);
    cache2.set(key, style);
  }
  return style;
}
function buildStyle2(shape) {
  const color = shape.color || DEFAULT_COLOR2;
  const opacity = shape.fill_opacity ?? DEFAULT_FILL_OPACITY;
  const style = new Style2({
    stroke: new Stroke2({ color, width: shape.width || DEFAULT_WIDTH }),
    fill: new Fill2({ color: withOpacity(shape.fill_color || color, opacity) })
  });
  if (shape.label) {
    style.setText(
      new Text2({
        text: shape.label,
        font: "500 12px ui-sans-serif, system-ui, -apple-system, sans-serif",
        fill: new Fill2({ color: "#111827" }),
        stroke: new Stroke2({ color: "rgba(255, 255, 255, 0.92)", width: 3 }),
        overflow: true
      })
    );
  }
  return style;
}
function withOpacity(color, opacity) {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color);
  if (!hex) return color;
  let digits = hex[1];
  if (digits.length === 3) digits = digits.split("").map((d) => d + d).join("");
  return [
    parseInt(digits.slice(0, 2), 16),
    parseInt(digits.slice(2, 4), 16),
    parseInt(digits.slice(4, 6), 16),
    opacity
  ];
}
function appearanceOf2(shape) {
  return [
    shape.color || "",
    shape.width || "",
    shape.fill_color || "",
    shape.fill_opacity ?? "",
    shape.label || ""
  ].join("|");
}

// js/rover_map.js
var HIT_TOLERANCE = 6;
var ANIMATION_MS = 350;
var DEFAULT_CENTER = [0, 0];
var DEFAULT_ZOOM = 2;
var RoverMap = class {
  constructor(element, config, push) {
    this.element = element;
    this.config = normalizeConfig(config);
    this.push = push || (() => {
    });
    this.hasFitted = false;
    this.quietUntil = 0;
    this.listeners = {};
    this.markerLayer = new MarkerLayer();
    this.shapeLayer = new ShapeLayer();
    this.tileLayer = new TileLayer({ zIndex: 0 });
    this.applyTiles(this.config.tiles);
    this.map = new Map2({
      target: element,
      layers: [this.tileLayer, this.shapeLayer.layer, this.markerLayer.layer],
      controls: buildControls(this.config),
      interactions: buildInteractions(this.config),
      view: new View({
        center: project(this.config.center[0], this.config.center[1]),
        zoom: this.config.zoom,
        minZoom: this.config.minZoom,
        maxZoom: this.config.maxZoom,
        constrainResolution: true
      })
    });
    this.setupTooltip();
    this.setupDragging();
    this.setupEvents();
    this.observeResize();
  }
  // -- updates from the server ---------------------------------------------
  setMarkers(markers) {
    this.markerLayer.reconcile(markers);
    this.maybeFit();
  }
  setShapes(shapes) {
    this.shapeLayer.reconcile(shapes);
    this.maybeFit();
  }
  setConfig(config) {
    const previous = this.config;
    const next = normalizeConfig(config);
    this.config = next;
    if (shouldRecenter(previous, next)) this.animateTo(next.center, next.zoom);
    if (changed(previous.tiles, next.tiles)) this.applyTiles(next.tiles);
    if (changed(previous.controls, next.controls) || previous.interactive !== next.interactive) {
      this.applyControls(next);
    }
    if (previous.interactive !== next.interactive) this.applyInteractions(next);
    const view = this.map.getView();
    if (previous.minZoom !== next.minZoom) view.setMinZoom(next.minZoom ?? 0);
    if (previous.maxZoom !== next.maxZoom) view.setMaxZoom(next.maxZoom ?? 28);
  }
  animateTo(center, zoom) {
    this.beQuiet(ANIMATION_MS);
    this.map.getView().animate({ center: project(center[0], center[1]), zoom, duration: ANIMATION_MS });
  }
  maybeFit() {
    const initial = !this.hasFitted && this.config.derivedCenter;
    const mode = this.config.fit;
    if (!initial) {
      if (!mode) return;
      if (mode === "once" && this.hasFitted) return;
    }
    const extent = this.contentExtent;
    if (!extent || !Number.isFinite(extent[0])) return;
    const duration = this.hasFitted ? ANIMATION_MS : 0;
    this.hasFitted = true;
    this.beQuiet(duration);
    const padding = this.config.fitPadding ?? 48;
    this.map.getView().fit(extent, {
      size: this.map.getSize(),
      padding: [padding, padding, padding, padding],
      // A lone marker has a zero-width extent; fitting it literally would zoom to
      // the maximum, so cap it at something a human would have chosen. A polygon
      // has real width and should be fitted for what it is — capping it would
      // leave a small parcel as a speck in the middle of a region.
      maxZoom: isPunctual(extent) ? 16 : void 0,
      duration
    });
  }
  // Markers and shapes together: a parcel outline with no pin on it still frames.
  get contentExtent() {
    const extents = [this.shapeLayer.extent, this.markerLayer.extent].filter(Boolean);
    if (extents.length === 0) return null;
    if (extents.length === 1) return extents[0];
    const union = createEmpty();
    extents.forEach((extent) => extend(union, extent));
    return union;
  }
  beQuiet(duration) {
    this.quietUntil = now() + duration + 120;
  }
  applyTiles(tiles) {
    if (!tiles) {
      this.tileLayer.setSource(null);
      this.tileLayer.setVisible(false);
      return;
    }
    this.tileLayer.setVisible(true);
    this.tileLayer.setSource(
      new XYZ({
        url: resolveRetina(tiles.url),
        attributions: tiles.attributions || void 0,
        maxZoom: tiles.maxZoom ?? 19,
        crossOrigin: "anonymous"
      })
    );
  }
  applyControls(config) {
    const controls = this.map.getControls();
    controls.clear();
    buildControls(config).forEach((control) => controls.push(control));
  }
  applyInteractions(config) {
    const interactions = this.map.getInteractions();
    interactions.clear();
    buildInteractions(config).forEach((interaction) => interactions.push(interaction));
    this.translate = null;
    this.setupDragging();
  }
  // -- interaction ----------------------------------------------------------
  setupTooltip() {
    this.tooltipEl = document.createElement("div");
    this.tooltipEl.className = "rover-tooltip";
    this.tooltipEl.hidden = true;
    this.tooltip = new Overlay({
      element: this.tooltipEl,
      offset: [0, -14],
      positioning: "bottom-center",
      stopEvent: false
    });
    this.map.addOverlay(this.tooltip);
  }
  showTooltip(marker, coordinate) {
    const text = marker.tooltip || marker.label;
    if (!text) return this.hideTooltip();
    this.tooltipEl.textContent = text;
    this.tooltipEl.hidden = false;
    this.tooltip.setPosition(coordinate);
  }
  hideTooltip() {
    this.tooltipEl.hidden = true;
    this.tooltip.setPosition(void 0);
  }
  setupDragging() {
    if (this.config.interactive === false) return;
    this.translate = new Translate({
      filter: (feature) => this.markerLayer.isDraggable(feature),
      hitTolerance: HIT_TOLERANCE
    });
    this.translate.on("translateend", (event) => {
      event.features.forEach((feature) => {
        const marker = this.markerLayer.markerFor(feature);
        if (!marker) return;
        this.markerLayer.forgetGeometry(feature);
        const { lat, lon } = unproject(feature.getGeometry().getCoordinates());
        this.emit("markerDragEnd", { id: marker.id, lat, lon, data: marker.data ?? null });
      });
    });
    this.map.addInteraction(this.translate);
  }
  setupEvents() {
    this.map.on("pointermove", (event) => {
      if (this.config.interactive === false) return;
      if (event.dragging) return this.hideTooltip();
      const { marker, markerFeature, shape } = this.featureAt(event.pixel);
      const clickableShape = shape && (this.config.events || {}).shapeClick;
      this.map.getTargetElement().style.cursor = marker || clickableShape ? "pointer" : "";
      if (marker) {
        this.showTooltip(marker, markerFeature.getGeometry().getCoordinates());
      } else {
        this.hideTooltip();
      }
    });
    this.map.getViewport().addEventListener("pointerleave", () => this.hideTooltip());
    this.map.on("singleclick", (event) => {
      if (this.config.interactive === false) return;
      const { marker, shape } = this.featureAt(event.pixel);
      const { lat, lon } = unproject(event.coordinate);
      if (marker) {
        this.emit("markerClick", {
          id: marker.id,
          lat: marker.lat,
          lon: marker.lon,
          data: marker.data ?? null
        });
      } else if (shape) {
        this.emit("shapeClick", { id: shape.id, lat, lon, data: shape.data ?? null });
      } else {
        this.emit("mapClick", { lat, lon });
      }
    });
    this.map.on("moveend", () => {
      if (now() < this.quietUntil) return;
      const view = this.map.getView();
      const center = unproject(view.getCenter());
      this.emit("moveEnd", {
        center: [center.lat, center.lon],
        zoom: round2(view.getZoom(), 2),
        bbox: extentToBbox(view.calculateExtent(this.map.getSize()))
      });
    });
  }
  // Returns whichever of the two layers is under the pixel. Markers win ties:
  // they are drawn on top, and a pin sitting inside its own parcel outline should
  // answer the click. forEachFeatureAtPixel iterates topmost-first, so stopping
  // as soon as a marker is found is enough to enforce that.
  featureAt(pixel) {
    let marker = null;
    let shape = null;
    this.map.forEachFeatureAtPixel(
      pixel,
      (feature, layer) => {
        if (layer === this.markerLayer.layer) {
          marker = marker || feature;
        } else if (layer === this.shapeLayer.layer) {
          shape = shape || feature;
        }
        return Boolean(marker);
      },
      {
        layerFilter: (layer) => layer === this.markerLayer.layer || layer === this.shapeLayer.layer,
        hitTolerance: HIT_TOLERANCE
      }
    );
    return {
      marker: this.markerLayer.markerFor(marker),
      markerFeature: marker,
      shape: this.shapeLayer.shapeFor(shape),
      shapeFeature: shape
    };
  }
  emit(name, payload) {
    const event = (this.config.events || {})[name];
    if (event) this.push(event, payload);
    const subscribers = this.listeners[name];
    if (subscribers) subscribers.forEach((fn) => fn(payload));
  }
  on(name, fn) {
    this.listeners[name] = this.listeners[name] || [];
    this.listeners[name].push(fn);
  }
  // -- lifecycle ------------------------------------------------------------
  observeResize() {
    if (typeof ResizeObserver === "undefined") return;
    this.resizeObserver = new ResizeObserver(() => this.map.updateSize());
    this.resizeObserver.observe(this.element);
  }
  destroy() {
    if (this.resizeObserver) this.resizeObserver.disconnect();
    this.markerLayer.dispose();
    this.shapeLayer.dispose();
    this.map.setTarget(void 0);
  }
};
function shouldRecenter(previous, next) {
  if (next.derivedCenter) return false;
  return !sameCenter(previous.center, next.center) || previous.zoom !== next.zoom;
}
function normalizeConfig(config) {
  const source = config || {};
  return {
    ...source,
    center: Array.isArray(source.center) ? source.center : DEFAULT_CENTER,
    zoom: typeof source.zoom === "number" ? source.zoom : DEFAULT_ZOOM
  };
}
function buildControls(config) {
  const wanted = config.controls || {};
  const locked = config.interactive === false;
  const controls = [];
  if (!locked && wanted.zoom !== false) controls.push(new Zoom());
  if (wanted.attribution !== false) controls.push(new Attribution({ collapsible: true }));
  if (wanted.scaleLine) controls.push(new ScaleLine());
  if (!locked && wanted.fullScreen) controls.push(new FullScreen());
  if (!locked && wanted.rotate) controls.push(new Rotate());
  return controls;
}
function buildInteractions(config) {
  return config.interactive === false ? [] : defaultInteractions().getArray();
}
function resolveRetina(url) {
  const ratio = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  return url.replace(/\{r\}/g, ratio > 1.5 ? "@2x" : "");
}
function isPunctual(extent) {
  return extent[0] === extent[2] && extent[1] === extent[3];
}
function sameCenter(a, b) {
  return Boolean(a) && Boolean(b) && a[0] === b[0] && a[1] === b[1];
}
function changed(a, b) {
  return JSON.stringify(a ?? null) !== JSON.stringify(b ?? null);
}
function now() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}
function round2(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

// js/hook.js
var Rover = {
  mounted() {
    this.canvasEl = this.el.querySelector(".rover-map__canvas") || this.el;
    this.configJson = this.el.dataset.rover;
    this.markersJson = this.el.dataset.roverMarkers;
    this.shapesJson = this.el.dataset.roverShapes;
    this.config = parse(this.configJson, {}, "data-rover");
    this.map = new RoverMap(
      this.canvasEl,
      this.config,
      (event, payload) => this.emit(event, payload)
    );
    this.map.setShapes(parse(this.shapesJson, [], "data-rover-shapes"));
    this.map.setMarkers(parse(this.markersJson, [], "data-rover-markers"));
    this.popups = new Popups(this.el, this.map);
  },
  updated() {
    if (!this.map) return;
    const configJson = this.el.dataset.rover;
    if (configJson !== this.configJson) {
      this.configJson = configJson;
      this.config = parse(configJson, this.config, "data-rover");
      this.map.setConfig(this.config);
    }
    const shapesJson = this.el.dataset.roverShapes;
    if (shapesJson !== this.shapesJson) {
      this.shapesJson = shapesJson;
      this.map.setShapes(parse(shapesJson, [], "data-rover-shapes"));
    }
    const markersJson = this.el.dataset.roverMarkers;
    if (markersJson !== this.markersJson) {
      this.markersJson = markersJson;
      this.map.setMarkers(parse(markersJson, [], "data-rover-markers"));
    }
    if (this.popups) this.popups.refresh();
  },
  destroyed() {
    if (this.popups) this.popups.destroy();
    if (this.map) this.map.destroy();
    this.popups = null;
    this.map = null;
  },
  emit(event, payload) {
    const target = this.config.target;
    if (target === void 0 || target === null || target === "") {
      this.pushEvent(event, payload);
    } else {
      this.pushEventTo(/^\d+$/.test(target) ? Number(target) : target, event, payload);
    }
  }
};
var RoverHooks = { Rover };
function parse(json, fallback, attribute) {
  if (!json) return fallback;
  try {
    return JSON.parse(json);
  } catch (error) {
    console.error(`[rover] could not parse ${attribute}:`, error, json);
    return fallback;
  }
}

// js/index.js
var index_default = RoverHooks;
export {
  MarkerLayer,
  Rover,
  RoverHooks,
  RoverMap,
  ShapeLayer,
  index_default as default,
  extentToBbox,
  project,
  unproject
};
