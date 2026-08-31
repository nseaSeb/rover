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
var SHAPE_OFFSET_PX = 12;
var BELOW_OFFSET_PX = 8;
var Popups = class {
  constructor(rootEl, roverMap) {
    this.root = rootEl;
    this.roverMap = roverMap;
    this.current = null;
    roverMap.on("markerClick", ({ id }) => this.open("marker", id));
    roverMap.on(
      "shapeClick",
      ({ id, lat, lon }) => this.open("shape", id, project(lat, lon))
    );
    roverMap.on("clusterClick", () => this.close());
    roverMap.on("mapClick", () => this.close());
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
  open(kind, id, coordinate) {
    const key = `${kind}:${id}`;
    const node = this.nodeFor(key);
    const opener = keyboardOpener(document.activeElement);
    this.close();
    if (!node) return;
    this.current = { kind, id: String(id), key, coordinate };
    node.hidden = false;
    this.position();
    if (opener && this.current) {
      this.returnFocusTo = opener;
      focusInto(node);
    }
  }
  close() {
    if (!this.current) return;
    const node = this.nodeFor(this.current.key);
    const held = Boolean(node && node.contains(document.activeElement));
    if (node) node.hidden = true;
    this.current = null;
    if (held && this.returnFocusTo && this.returnFocusTo.isConnected) {
      this.returnFocusTo.focus();
    }
    this.returnFocusTo = null;
  }
  /**
   * Where the open popup should point, in map coordinates.
   *
   * A marker is read from its *feature*, not from the marker the server sent: a
   * drag moves the geometry on the client while the server's lat/lon stays put, and
   * the popup should follow the pin the user is holding.
   *
   * A shape is anchored where it was clicked. Pointing at the centroid of a long
   * route or a large parcel would point at nothing the user did.
   */
  anchor() {
    if (!this.current) return null;
    if (this.current.kind === "marker") {
      const feature = this.roverMap.markerLayer.featureById(this.current.id);
      return feature ? feature.getGeometry().getCoordinates() : null;
    }
    return this.roverMap.shapeLayer.entries.has(this.current.id) ? this.current.coordinate : null;
  }
  position() {
    if (!this.current) return;
    const node = this.nodeFor(this.current.key);
    const coordinate = this.anchor();
    if (!node || !coordinate) return this.close();
    const pixel = this.roverMap.map.getPixelFromCoordinate(coordinate);
    if (!pixel) return;
    const offset = this.current.kind === "marker" ? OFFSET_PX : SHAPE_OFFSET_PX;
    const [x, y] = pixel;
    const below = y - offset - node.offsetHeight < 0;
    node.classList.toggle("rover-popup--below", below);
    node.style.left = `${Math.round(x)}px`;
    node.style.top = `${Math.round(below ? y + BELOW_OFFSET_PX : y - offset)}px`;
  }
  /**
   * Called after LiveView patches the element.
   *
   * `hidden` is a static attribute in the HEEx template, so morphdom restores it
   * on every patch that re-renders the comprehension — an open popup silently
   * disappears while this class still believes it is open. Re-assert it.
   */
  refresh() {
    if (!this.current) return;
    const node = this.nodeFor(this.current.key);
    if (!node) return this.close();
    node.hidden = false;
    this.position();
  }
  nodeFor(key) {
    return this.root.querySelector(`[data-rover-popup-for="${cssEscape(key)}"]`);
  }
  destroy() {
    document.removeEventListener("keydown", this.onKeydown);
    this.root.removeEventListener("click", this.onClick);
    this.roverMap.map.un("postrender", this.onPostrender);
  }
};
function keyboardOpener(active) {
  if (!active || !active.closest) return null;
  return active.closest("[data-rover-focus]");
}
function focusInto(node) {
  const focusable = node.querySelector(
    "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])"
  );
  (focusable || node).focus();
}
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
import { never } from "ol/events/condition.js";
import Draw from "ol/interaction/Draw.js";
import Modify from "ol/interaction/Modify.js";
import Snap from "ol/interaction/Snap.js";
import Translate from "ol/interaction/Translate.js";
import { defaults as defaultInteractions } from "ol/interaction/defaults.js";
import { createEmpty, extend } from "ol/extent.js";

// js/draw.js
import VectorLayer from "ol/layer/Vector.js";
import VectorSource from "ol/source/Vector.js";
import Circle from "ol/style/Circle.js";
import Fill from "ol/style/Fill.js";
import Stroke from "ol/style/Stroke.js";
import Style from "ol/style/Style.js";
var PENDING_COLOR = "#2563eb";
var TYPES = /* @__PURE__ */ new Set(["Point", "LineString", "Polygon"]);
function drawTypeFor(type) {
  return TYPES.has(type) ? type : null;
}
var DrawLayer = class {
  constructor() {
    this.source = new VectorSource({ wrapX: false });
    this.layer = new VectorLayer({
      source: this.source,
      // Above the shapes it is about to become one of, below the markers.
      zIndex: 6,
      style: pendingStyle()
    });
  }
  clear() {
    this.source.clear();
  }
  dispose() {
    this.source.clear();
  }
};
function pendingStyle() {
  return new Style({
    stroke: new Stroke({ color: PENDING_COLOR, width: 2, lineDash: [6, 5] }),
    fill: new Fill({ color: [37, 99, 235, 0.08] }),
    // A drawn Point has no stroke or fill to show.
    image: new Circle({
      radius: 5,
      fill: new Fill({ color: PENDING_COLOR }),
      stroke: new Stroke({ color: "rgba(255, 255, 255, 0.9)", width: 2 })
    })
  });
}

// js/heatmap.js
import Feature from "ol/Feature.js";
import Point from "ol/geom/Point.js";
import HeatmapLayerOl from "ol/layer/Heatmap.js";
import VectorSource2 from "ol/source/Vector.js";
var HeatmapLayer = class {
  constructor() {
    this.source = new VectorSource2({ wrapX: false });
    this.layer = new HeatmapLayerOl({
      source: this.source,
      // Under the shapes and the markers: a heat field is background, and covering
      // a parcel outline with it would defeat both.
      zIndex: 2,
      weight: (feature) => feature.get("weight")
    });
    this.rev = null;
    this.count = 0;
  }
  // A null payload means the map has no heat field at all — the attribute is absent
  // rather than an empty object, so that every map without one carries nothing.
  reconcile(payload) {
    const { points = [], rev = null, style } = payload || {};
    this.applyStyle(style);
    const next = String(rev);
    if (next === this.rev) return;
    this.rev = next;
    this.source.clear();
    this.count = points.length;
    if (points.length > 0) {
      this.source.addFeatures(
        points.map((point) => {
          const feature = new Feature({ geometry: new Point(project(point.lat, point.lon)) });
          feature.set("weight", point.weight ?? 1, true);
          return feature;
        })
      );
    }
  }
  applyStyle(style) {
    if (!style) return;
    if (typeof style.radius === "number") this.layer.setRadius(style.radius);
    if (typeof style.blur === "number") this.layer.setBlur(style.blur);
    if (typeof style.opacity === "number") this.layer.setOpacity(style.opacity);
    if (Array.isArray(style.gradient) && style.gradient.length > 1) {
      this.layer.setGradient(style.gradient);
    }
  }
  get extent() {
    return this.count > 0 ? this.source.getExtent() : null;
  }
  dispose() {
    this.source.clear();
    this.count = 0;
    this.rev = null;
  }
};

// js/markers.js
import Feature2 from "ol/Feature.js";
import Point2 from "ol/geom/Point.js";
import VectorLayer2 from "ol/layer/Vector.js";
import Cluster from "ol/source/Cluster.js";
import VectorSource3 from "ol/source/Vector.js";

// js/styles.js
import Style2 from "ol/style/Style.js";
import Circle2 from "ol/style/Circle.js";
import Icon from "ol/style/Icon.js";
import Text from "ol/style/Text.js";
import Fill2 from "ol/style/Fill.js";
import Stroke2 from "ol/style/Stroke.js";
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
  const styles = marker.emoji ? [new Style2({ text: emojiText(marker.emoji, scale) })] : [new Style2({ image: pinImage(marker, scale) })];
  if (marker.label) {
    const label = labelText(marker.label);
    if (marker.emoji) {
      styles.push(new Style2({ text: label }));
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
    fill: new Fill2({ color: "#111827" }),
    // A halo rather than a background box: legible over any tile, without
    // drawing a rectangle over the map.
    stroke: new Stroke2({ color: "rgba(255, 255, 255, 0.92)", width: 3 }),
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
var clusterCache = /* @__PURE__ */ new Map();
var CLUSTER_COLOR = "#2563eb";
function clusterStyle(count) {
  let style = clusterCache.get(count);
  if (!style) {
    const radius = Math.min(28, 12 + Math.log2(count) * 3);
    style = new Style2({
      image: new Circle2({
        radius,
        fill: new Fill2({ color: withAlpha(CLUSTER_COLOR, 0.85) }),
        stroke: new Stroke2({ color: "rgba(255, 255, 255, 0.9)", width: 2 })
      }),
      text: new Text({
        text: String(count),
        font: "600 12px ui-sans-serif, system-ui, -apple-system, sans-serif",
        fill: new Fill2({ color: "#ffffff" })
      })
    });
    if (clusterCache.size >= CACHE_LIMIT) clusterCache.delete(clusterCache.keys().next().value);
    clusterCache.set(count, style);
  }
  return style;
}
function withAlpha(hex, alpha) {
  const digits = hex.slice(1);
  return [
    parseInt(digits.slice(0, 2), 16),
    parseInt(digits.slice(2, 4), 16),
    parseInt(digits.slice(4, 6), 16),
    alpha
  ];
}

// js/markers.js
var ROVER_KEY = "rover";
var MarkerLayer = class {
  constructor() {
    this.source = new VectorSource3({ wrapX: false });
    this.layer = new VectorLayer2({
      source: this.source,
      // Markers are the thing the user came for: keep them above every other
      // layer regardless of the order layers happen to be added in.
      zIndex: 10,
      updateWhileAnimating: true,
      updateWhileInteracting: true
    });
    this.entries = /* @__PURE__ */ new Map();
    this.clusterSource = null;
  }
  /**
   * Turn grouping on or off.
   *
   * Only the layer's source changes. The markers, their styles and the entry map
   * are untouched, so toggling this mid-session costs nothing and loses nothing.
   */
  setClustering(options) {
    this.releaseClusterSource();
    if (!options) {
      this.layer.setSource(this.source);
      this.layer.setStyle(void 0);
      return;
    }
    this.clusterSource = new Cluster({
      source: this.source,
      distance: options.distance ?? 40,
      minDistance: options.minDistance ?? 20,
      // Every other source here is built with wrapX: false; Cluster does not
      // inherit it from the source it wraps, and VectorSource defaults to true —
      // which would repeat the circles across world copies.
      wrapX: false
    });
    this.layer.setSource(this.clusterSource);
    this.layer.setStyle((feature) => this.styleForRendered(feature));
  }
  get clustering() {
    return Boolean(this.clusterSource);
  }
  /**
   * Detach a clusterer we are done with.
   *
   * `ol/source/Cluster` subscribes to the source it wraps in its constructor, and
   * dropping the reference does not unsubscribe. Without this, every toggle of
   * `cluster` leaves another live clusterer re-clustering the whole marker set on
   * every reconcile, in a source nothing draws — five toggles cost five extra full
   * passes per update, for the life of the LiveView.
   */
  releaseClusterSource() {
    if (!this.clusterSource) return;
    this.clusterSource.setSource(null);
    this.clusterSource = null;
  }
  styleForRendered(feature) {
    const members = feature.get("features");
    if (!members) return void 0;
    if (members.length === 1) {
      const marker = members[0].get(ROVER_KEY);
      return marker ? styleFor(marker) : void 0;
    }
    return clusterStyle(members.length);
  }
  /**
   * The markers behind a rendered feature: one when it is a pin or a lone cluster,
   * several when it is a group.
   */
  membersOf(feature) {
    if (!feature) return [];
    const members = feature.get("features");
    if (!members) {
      const marker = feature.get(ROVER_KEY);
      return marker ? [marker] : [];
    }
    return members.map((member) => member.get(ROVER_KEY)).filter(Boolean);
  }
  reconcile(markers) {
    const seen = /* @__PURE__ */ new Set();
    const added = [];
    const clusterSource = this.clusterSource;
    if (clusterSource) clusterSource.setSource(null);
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
    if (clusterSource) clusterSource.setSource(this.source);
  }
  build(key, marker, geometryHash, appearanceHash) {
    const feature = new Feature2({ geometry: new Point2(project(marker.lat, marker.lon)) });
    feature.setId(key);
    feature.setStyle(styleFor(marker));
    feature.setProperties({ [ROVER_KEY]: marker }, true);
    this.entries.set(key, { feature, marker, geometryHash, appearanceHash });
    return feature;
  }
  /**
   * The single marker a rendered feature stands for, or null.
   *
   * A group of twelve is not a marker: it has no id to report and no popup to open,
   * so callers must handle it as a cluster instead of being handed one arbitrary
   * member.
   */
  markerFor(feature) {
    const members = this.membersOf(feature);
    return members.length === 1 ? members[0] : null;
  }
  /** The markers of a rendered feature when it is a group of more than one. */
  clusterFor(feature) {
    const members = this.membersOf(feature);
    return members.length > 1 ? members : null;
  }
  markerById(id) {
    const entry = this.entries.get(String(id));
    return entry && entry.marker;
  }
  /**
   * The feature currently *on screen* for a marker — which is not always the
   * feature the reconciler built.
   *
   * When clustering, a marker is drawn as part of a group whose geometry sits at the
   * members' centroid. Anchoring a popup to the marker's own coordinate would point
   * it away from the pin the user clicked. So a marker that has been grouped with
   * others has no rendered feature of its own, and callers treat that as "nothing to
   * point at" — which closes the popup.
   */
  featureById(id) {
    const entry = this.entries.get(String(id));
    if (!entry) return null;
    if (!this.clusterSource) return entry.feature;
    return this.clusterSource.getFeatures().find((cluster) => {
      const members = cluster.get("features");
      return members && members.length === 1 && members[0] === entry.feature;
    }) || null;
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
    if (this.clusterSource) return false;
    const marker = this.markerFor(feature);
    return Boolean(marker && marker.draggable);
  }
  get extent() {
    return this.entries.size > 0 ? this.source.getExtent() : null;
  }
  dispose() {
    this.releaseClusterSource();
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
import VectorLayer3 from "ol/layer/Vector.js";
import VectorSource4 from "ol/source/Vector.js";
import Fill3 from "ol/style/Fill.js";
import Stroke3 from "ol/style/Stroke.js";
import Style3 from "ol/style/Style.js";
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
    this.source = new VectorSource4({ wrapX: false });
    this.layer = new VectorLayer3({
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
  /**
   * Whether a rendered feature may have its vertices dragged.
   *
   * A shape backed by more than one feature (a FeatureCollection) has no single
   * geometry a drag could write back to a single `:geometry` field, so only a
   * shape whose entry holds exactly one feature qualifies — this is what
   * `ol/interaction/Modify`'s `filter` option calls per feature.
   */
  isEditable(feature) {
    const shape = this.shapeFor(feature);
    if (!shape || !shape.editable) return false;
    const entry = this.entries.get(String(shape.id));
    return Boolean(entry && entry.features.length === 1);
  }
  /**
   * Drop the cached revision for a feature the client edited on its own.
   *
   * Mirrors `MarkerLayer.forgetGeometry`, but for the rev a shape is diffed by
   * instead of a coordinate hash: without this, a server payload that echoes
   * back the same `:rev` — whether it accepted the edit or rejected it — would
   * hash-match the stale entry and `reconcile()` would skip re-applying it,
   * leaving the shape wherever the user last dragged it regardless of what the
   * server actually decided.
   */
  forgetRev(feature) {
    const shape = this.shapeFor(feature);
    const entry = shape && this.entries.get(String(shape.id));
    if (entry) entry.rev = null;
  }
  /**
   * The GeoJSON `properties` a shape's own `:geometry` carried, if it was a
   * `Feature` (or a single-member `FeatureCollection`) rather than a bare
   * geometry — `null` otherwise.
   *
   * `writeGeometryObject`, used to report an edit back, only ever writes the
   * bare geometry — there is no `writeFeatureObject` call anywhere in the
   * edit path. Without this, merging that bare geometry straight into
   * `:geometry` silently drops whatever `properties` a `Feature`-wrapped
   * shape carried, on the first accepted edit.
   */
  propertiesFor(feature) {
    const shape = this.shapeFor(feature);
    const geometry = shape && shape.geometry;
    if (!geometry) return null;
    if (geometry.type === "Feature") return geometry.properties ?? null;
    if (geometry.type === "FeatureCollection" && geometry.features?.length === 1) {
      return geometry.features[0].properties ?? null;
    }
    return null;
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
  const style = new Style3({
    stroke: new Stroke3({ color, width: shape.width || DEFAULT_WIDTH }),
    fill: new Fill3({ color: withOpacity(shape.fill_color || color, opacity) })
  });
  if (shape.label) {
    style.setText(
      new Text2({
        text: shape.label,
        font: "500 12px ui-sans-serif, system-ui, -apple-system, sans-serif",
        fill: new Fill3({ color: "#111827" }),
        stroke: new Stroke3({ color: "rgba(255, 255, 255, 0.92)", width: 3 }),
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
    this.drawing = null;
    this.markerLayer = new MarkerLayer();
    this.shapeLayer = new ShapeLayer();
    this.drawLayer = new DrawLayer();
    this.heatmapLayer = new HeatmapLayer();
    this.tileLayer = new TileLayer({ zIndex: 0 });
    this.applyTiles(this.config.tiles);
    this.map = new Map2({
      target: element,
      // OpenLayers listens for keys on this element, and by default that is the
      // viewport it builds *inside* the target. Nothing ever focuses that, so
      // KeyboardPan and KeyboardZoom — both already in defaultInteractions() —
      // were present and unreachable. The target is the element the component
      // gives a tabindex, so a keydown on the focused map now reaches them.
      keyboardEventTarget: element,
      layers: [
        this.tileLayer,
        this.heatmapLayer.layer,
        this.shapeLayer.layer,
        this.drawLayer.layer,
        this.markerLayer.layer
      ],
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
    this.markerLayer.setClustering(this.config.cluster);
    this.applyAccessibility(this.config);
    this.setupTooltip();
    this.setupEditing();
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
    this.acceptShapes(shapes);
    this.maybeFit();
  }
  setHeatmap(heatmap) {
    this.heatmapLayer.reconcile(heatmap);
    this.maybeFit();
  }
  /**
   * Load both layers and fit once.
   *
   * Calling setShapes() then setMarkers() fits twice, and the second fit is a
   * no-op: the first one already set `hasFitted`, so with the default
   * `fit: "once"` the markers never entered the initial framing at all. Anything
   * outside the shapes' bounding box was simply off-screen, for good. The mount
   * path and any update touching both layers go through here instead.
   */
  setContent({ markers, shapes, heatmap }) {
    if (heatmap !== void 0) this.heatmapLayer.reconcile(heatmap);
    if (shapes !== void 0) this.acceptShapes(shapes);
    if (markers !== void 0) this.markerLayer.reconcile(markers);
    this.maybeFit();
  }
  /**
   * Take a shape list from the server, and drop whatever was sketched.
   *
   * The two happen in one synchronous call, so when this is the update carrying
   * the drawn shape the swap from pending sketch to real tracked shape is
   * invisible — there is no frame in which the map shows both or neither.
   *
   * The clear is unconditional, which is the trade: any `:shapes` update drops a
   * finished sketch, including one that arrived from somewhere else — a PubSub
   * broadcast landing between `drawEnd` and the server's echo blanks the polygon
   * until the round trip completes. Recognising *which* update carries the drawn
   * shape would need an identity the client does not have, since assigning one is
   * the whole thing the server does with a `drawEnd`. An unconditional clear is
   * also what cleans up after a sketch the server refused.
   */
  acceptShapes(shapes) {
    this.drawLayer.clear();
    this.shapeLayer.reconcile(shapes);
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
    if (previous.interactive !== next.interactive || previous.label !== next.label) {
      this.applyAccessibility(next);
    }
    if (changed(previous.cluster, next.cluster)) this.markerLayer.setClustering(next.cluster);
    const view = this.map.getView();
    if (previous.minZoom !== next.minZoom) view.setMinZoom(next.minZoom ?? 0);
    if (previous.maxZoom !== next.maxZoom) view.setMaxZoom(next.maxZoom ?? 28);
  }
  animateTo(center, zoom) {
    this.beQuiet(ANIMATION_MS);
    this.map.getView().animate({ center: project(center[0], center[1]), zoom, duration: ANIMATION_MS });
  }
  /**
   * A one-shot move, from `Rover.fly_to/4`.
   *
   * Deliberately does not touch `config` or `hasFitted`: the view has been moved,
   * but nothing about what the server is rendering has changed, so the next update
   * must not undo this and must not think a fit is owed.
   */
  flyTo({ center, zoom, duration }) {
    const ms = duration ?? ANIMATION_MS;
    this.beQuiet(ms);
    this.map.getView().animate({
      center: project(center[0], center[1]),
      // `undefined` leaves the zoom alone, which is what omitting :zoom means.
      zoom: typeof zoom === "number" ? zoom : void 0,
      duration: ms
    });
  }
  /** A one-shot fit, from `Rover.fit_to/4`. */
  fitTo({ bbox, padding, maxZoom, duration }) {
    const [south, west, north, east] = bbox;
    const [minX, minY] = project(south, west);
    const [maxX, maxY] = project(north, east);
    const ms = duration ?? ANIMATION_MS;
    const pad = padding ?? 48;
    this.beQuiet(ms);
    this.map.getView().fit([minX, minY, maxX, maxY], {
      size: this.map.getSize(),
      padding: [pad, pad, pad, pad],
      maxZoom,
      duration: ms
    });
  }
  maybeFit() {
    if (!shouldFit({ hasFitted: this.hasFitted, ...this.config })) return;
    const extent = this.contentExtent;
    if (!extent || !Number.isFinite(extent[0])) return;
    const duration = this.hasFitted ? ANIMATION_MS : 0;
    this.hasFitted = true;
    this.beQuiet(duration);
    const padding = this.config.fitPadding ?? 48;
    this.map.getView().fit(extent, {
      size: this.map.getSize(),
      padding: [padding, padding, padding, padding],
      maxZoom: fitMaxZoom(this.config, this.shapeLayer.entries.size > 0),
      duration
    });
  }
  // Every layer that carries content: a heat field alone, or a parcel outline with
  // no pin on it, still frames.
  get contentExtent() {
    const extents = [
      this.heatmapLayer.extent,
      this.shapeLayer.extent,
      this.markerLayer.extent
    ].filter(Boolean);
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
    if (this.modify) this.modify.dispose();
    this.modify = null;
    this.setupEditing();
    this.translate = null;
    this.setupDragging();
    const type = this.drawing && this.drawing.type;
    this.stopDrawing();
    if (type && config.interactive !== false) this.armDrawing(type);
  }
  // -- drawing --------------------------------------------------------------
  /**
   * Arm the map for drawing, from `Rover.start_drawing/3`.
   *
   * A locked map refuses: `interactive={false}` withholds every other pointer
   * gesture, and a drawing mode is the largest of them.
   */
  startDrawing({ type }) {
    if (this.config.interactive === false) return;
    const geometryType = drawTypeFor(type);
    if (!geometryType) {
      console.error(`[rover] cannot draw ${JSON.stringify(type)} \u2014 expected Point, LineString or Polygon`);
      return;
    }
    this.stopDrawing();
    this.armDrawing(geometryType);
  }
  armDrawing(type) {
    this.drawing = { type };
    if (!this.wants("drawEnd")) {
      console.error("[rover] drawing was armed with no on_draw_end handler \u2014 the shape drawn will go nowhere");
    }
    this.draw = new Draw({ source: this.drawLayer.source, type });
    this.draw.on("drawend", (event) => {
      const geometry = format.writeGeometryObject(event.feature.getGeometry(), {
        decimals: 7
      });
      this.emit("drawEnd", { type: geometry.type, geometry });
    });
    this.map.addInteraction(this.draw);
    this.snap = new Snap({ source: this.shapeLayer.source, pixelTolerance: HIT_TOLERANCE });
    this.map.addInteraction(this.snap);
    this.onDrawKeydown = (event) => {
      if (event.key !== "Escape" || !this.draw) return;
      if (isTextEntry(event.target)) return;
      this.draw.abortDrawing();
    };
    document.addEventListener("keydown", this.onDrawKeydown);
    this.element.classList.add("rover-map__canvas--drawing");
  }
  /** Disarm, from `Rover.stop_drawing/2` — and discard the sketch with the mode. */
  stopDrawing() {
    if (this.draw) {
      this.map.removeInteraction(this.draw);
      this.draw.dispose();
      this.draw = null;
    }
    if (this.snap) {
      this.map.removeInteraction(this.snap);
      this.snap.dispose();
      this.snap = null;
    }
    if (this.onDrawKeydown) {
      document.removeEventListener("keydown", this.onDrawKeydown);
      this.onDrawKeydown = null;
    }
    this.drawLayer.clear();
    this.drawing = null;
    this.element.classList.remove("rover-map__canvas--drawing");
  }
  /**
   * The map element's accessible name, and whether it is in the tab order.
   *
   * Applied from here rather than left to the server's markup, because the
   * element is `phx-update="ignore"` — and LiveView merges only `data-*`
   * attributes onto an ignored element (`mergeAttrs`, `isIgnored`). The server's
   * rendering is the first paint; every change after it has to come through the
   * config, or a map that locks itself stays a focusable `role="application"`
   * nobody can do anything with.
   */
  applyAccessibility(config) {
    if (config.label) this.element.setAttribute("aria-label", config.label);
    if (config.interactive === false) {
      this.element.removeAttribute("tabindex");
    } else {
      this.element.setAttribute("tabindex", "0");
    }
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
  setupEditing() {
    if (this.config.interactive === false) return;
    this.modify = new Modify({
      source: this.shapeLayer.source,
      filter: (feature) => this.shapeLayer.isEditable(feature),
      // Modify's own option, unlike Translate's hitTolerance above — same idea,
      // different name.
      pixelTolerance: HIT_TOLERANCE,
      // Off by default, this inserts a vertex whenever the pointer is merely
      // near an edge — including a single click with no drag at all, which
      // would silently add a vertex and fire shapeEditEnd from what looked
      // like a read-only click on the shape (e.g. one that also opens its
      // popup via on_shape_click). Dragging an existing vertex is this
      // feature's whole scope; inserting new ones is not.
      insertVertexCondition: never
    });
    this.modify.on("modifyend", (event) => {
      event.features.forEach((feature) => {
        const shape = this.shapeLayer.shapeFor(feature);
        if (!shape) return;
        this.shapeLayer.forgetRev(feature);
        const geometry = format.writeGeometryObject(feature.getGeometry(), {
          decimals: 7
        });
        const properties = this.shapeLayer.propertiesFor(feature);
        this.emit("shapeEditEnd", {
          id: shape.id,
          geometry,
          properties,
          data: shape.data ?? null
        });
      });
    });
    this.map.addInteraction(this.modify);
  }
  setupEvents() {
    this.map.on("pointermove", (event) => {
      if (this.config.interactive === false) return;
      if (this.drawing) return this.hideTooltip();
      if (event.dragging) return this.hideTooltip();
      const { marker, cluster, markerFeature, shape } = this.featureAt(event.pixel);
      const clickableShape = shape && this.wants("shapeClick");
      this.map.getTargetElement().style.cursor = marker || cluster || clickableShape ? "pointer" : "";
      if (cluster) {
        this.hideTooltip();
      } else if (marker) {
        this.showTooltip(marker, markerFeature.getGeometry().getCoordinates());
      } else if (shape && (shape.tooltip || shape.label)) {
        this.showTooltip(shape, event.coordinate);
      } else {
        this.hideTooltip();
      }
    });
    this.map.getViewport().addEventListener("pointerleave", () => this.hideTooltip());
    this.map.on("singleclick", (event) => {
      if (this.config.interactive === false) return;
      if (this.drawing) return;
      const { marker, cluster, markerFeature, shape } = this.featureAt(event.pixel);
      const { lat, lon } = unproject(event.coordinate);
      if (cluster) {
        this.emit("clusterClick", {
          count: cluster.length,
          ids: cluster.map((member) => member.id),
          lat,
          lon
        });
        if (this.config.cluster && this.config.cluster.zoomOnClick !== false) {
          this.zoomToCluster(markerFeature);
        }
      } else if (marker) {
        this.emit("markerClick", {
          id: marker.id,
          lat: marker.lat,
          lon: marker.lon,
          data: marker.data ?? null
        });
      } else if (shape && this.wants("shapeClick")) {
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
  /**
   * Frame the members of a cluster, so a click drills into it.
   *
   * Two traps here, both of which turn the drill-in into the dead end it exists to
   * prevent.
   *
   * `View#fit` treats `maxZoom` as a resolution *floor*, so it clamps in both
   * directions: passing the marker-only cap of 16 while sitting at zoom 18 zooms
   * *out* to 16, where the members are closer together in pixels than before and
   * still one group. The cap here is therefore the basemap's own ceiling, and the
   * result is refused outright if it would move the view backwards.
   *
   * The members' extent is often a single point, because everything in the group is
   * at the same place. That branch steps in by two levels — again bounded by the
   * basemap, not by the view's default ceiling of 28, which would land on a blurry
   * over-zoom.
   */
  zoomToCluster(clusterFeature) {
    const members = clusterFeature.get("features") || [];
    if (members.length === 0) return;
    const extent = createEmpty();
    members.forEach((member) => extend(extent, member.getGeometry().getExtent()));
    const view = this.map.getView();
    const current = view.getZoom() ?? 0;
    const ceiling = fitMaxZoom(this.config, true);
    if (current >= ceiling) return;
    this.beQuiet(ANIMATION_MS);
    if (extent[0] === extent[2] && extent[1] === extent[3]) {
      view.animate({
        center: [extent[0], extent[1]],
        zoom: Math.min(current + 2, ceiling),
        duration: ANIMATION_MS
      });
      return;
    }
    const padding = this.config.fitPadding ?? 48;
    view.fit(extent, {
      size: this.map.getSize(),
      padding: [padding, padding, padding, padding],
      maxZoom: ceiling,
      duration: ANIMATION_MS
    });
  }
  /**
   * Do to a feature what a click on it would do, named rather than pointed at.
   *
   * The keyboard's way in. `<.map>` renders one hidden button per marker and
   * shape, carrying `marker:<id>` or `shape:<id>`; pressing one lands here, and
   * from here on it is the same path as a pointer click — the same payload to the
   * server, the same popup opened by the same subscriber.
   */
  activate(key) {
    if (this.config.interactive === false) return;
    const target = parseFocusKey(key);
    if (!target) return;
    if (target.kind === "marker") {
      const marker = this.markerLayer.markerById(target.id);
      if (!marker) return;
      this.emit("markerClick", {
        id: marker.id,
        lat: marker.lat,
        lon: marker.lon,
        data: marker.data ?? null
      });
      return;
    }
    const entry = this.shapeLayer.entries.get(target.id);
    if (!entry || !this.wants("shapeClick")) return;
    if (entry.features.length === 0) return;
    const extent = createEmpty();
    entry.features.forEach((feature) => extend(extent, feature.getGeometry().getExtent()));
    const [minX, minY, maxX, maxY] = extent;
    const { lat, lon } = unproject([(minX + maxX) / 2, (minY + maxY) / 2]);
    this.emit("shapeClick", { id: entry.shape.id, lat, lon, data: entry.shape.data ?? null });
  }
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
      cluster: this.markerLayer.clusterFor(marker),
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
  wants(name) {
    return wantsEvent(this.config, this.listeners, name);
  }
  // -- lifecycle ------------------------------------------------------------
  observeResize() {
    if (typeof ResizeObserver === "undefined") return;
    this.resizeObserver = new ResizeObserver(() => this.map.updateSize());
    this.resizeObserver.observe(this.element);
  }
  destroy() {
    if (this.resizeObserver) this.resizeObserver.disconnect();
    this.stopDrawing();
    this.markerLayer.dispose();
    this.drawLayer.dispose();
    this.shapeLayer.dispose();
    this.heatmapLayer.dispose();
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
function wantsEvent(config, listeners, name) {
  const subscribers = (listeners || {})[name];
  return Boolean(((config || {}).events || {})[name]) || Boolean(subscribers && subscribers.length);
}
function shouldFit({ hasFitted, derivedCenter, fit }) {
  if (!hasFitted && derivedCenter) return true;
  if (!fit) return false;
  if (fit === "once" && hasFitted) return false;
  return true;
}
function fitMaxZoom(config, hasShapes) {
  const tileMax = config.tiles && config.tiles.maxZoom || 19;
  return hasShapes ? tileMax : Math.min(tileMax, 16);
}
function isTextEntry(target) {
  if (!target || !target.tagName) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}
function parseFocusKey(key) {
  if (typeof key !== "string") return null;
  const at = key.indexOf(":");
  if (at < 1) return null;
  const kind = key.slice(0, at);
  const id = key.slice(at + 1);
  if (kind !== "marker" && kind !== "shape" || id === "") return null;
  return { kind, id };
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
    this.heatmapJson = this.el.dataset.roverHeatmap;
    this.config = parse(this.configJson, {}, "data-rover");
    this.map = new RoverMap(
      this.canvasEl,
      this.config,
      (event, payload) => this.emit(event, payload)
    );
    this.map.setContent({
      heatmap: parse(this.heatmapJson, null, "data-rover-heatmap"),
      shapes: parse(this.shapesJson, [], "data-rover-shapes"),
      markers: parse(this.markersJson, [], "data-rover-markers")
    });
    this.popups = new Popups(this.el, this.map);
    this.onIndexClick = (event) => {
      const button = event.target.closest && event.target.closest("[data-rover-focus]");
      if (button && this.map) this.map.activate(button.dataset.roverFocus);
    };
    this.el.addEventListener("click", this.onIndexClick);
    this.el._rover = this.map;
    this.handleEvent("rover:fly_to", (payload) => {
      if (this.mine(payload)) this.map.flyTo(payload);
    });
    this.handleEvent("rover:fit_to", (payload) => {
      if (this.mine(payload)) this.map.fitTo(payload);
    });
    this.handleEvent("rover:start_drawing", (payload) => {
      if (this.mine(payload)) this.map.startDrawing(payload);
    });
    this.handleEvent("rover:stop_drawing", (payload) => {
      if (this.mine(payload)) this.map.stopDrawing();
    });
  },
  mine(payload) {
    return payload && payload.id === this.el.id;
  },
  updated() {
    if (!this.map) return;
    const configJson = this.el.dataset.rover;
    if (configJson !== this.configJson) {
      this.configJson = configJson;
      this.config = parse(configJson, this.config, "data-rover");
      this.map.setConfig(this.config);
    }
    const content = {};
    const heatmapJson = this.el.dataset.roverHeatmap;
    if (heatmapJson !== this.heatmapJson) {
      this.heatmapJson = heatmapJson;
      content.heatmap = parse(heatmapJson, null, "data-rover-heatmap");
    }
    const shapesJson = this.el.dataset.roverShapes;
    if (shapesJson !== this.shapesJson) {
      this.shapesJson = shapesJson;
      content.shapes = parse(shapesJson, [], "data-rover-shapes");
    }
    const markersJson = this.el.dataset.roverMarkers;
    if (markersJson !== this.markersJson) {
      this.markersJson = markersJson;
      content.markers = parse(markersJson, [], "data-rover-markers");
    }
    if (content.heatmap !== void 0 || content.shapes !== void 0 || content.markers !== void 0) {
      this.map.setContent(content);
    }
    if (this.popups) this.popups.refresh();
  },
  destroyed() {
    this.el.removeEventListener("click", this.onIndexClick);
    if (this.popups) this.popups.destroy();
    if (this.map) this.map.destroy();
    this.popups = null;
    this.map = null;
    this.el._rover = null;
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
  DrawLayer,
  HeatmapLayer,
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
