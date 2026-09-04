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
import Map4 from "ol/Map.js";
import View2 from "ol/View.js";
import Overlay from "ol/Overlay.js";
import LayerGroup2 from "ol/layer/Group.js";
import TileLayer2 from "ol/layer/Tile.js";
import XYZ from "ol/source/XYZ.js";

// node_modules/@maplibre/maplibre-gl-style-spec/dist/reference/v8.mjs
var v8_default = {
  $version: 8,
  $root: {
    "version": {
      "required": true,
      "type": "enum",
      "values": [8]
    },
    "name": { "type": "string" },
    "metadata": { "type": "*" },
    "center": {
      "type": "array",
      "value": "number",
      "length": 2
    },
    "centerAltitude": { "type": "number" },
    "zoom": { "type": "number" },
    "bearing": {
      "type": "number",
      "default": 0,
      "period": 360,
      "units": "degrees"
    },
    "pitch": {
      "type": "number",
      "default": 0,
      "units": "degrees"
    },
    "roll": {
      "type": "number",
      "default": 0,
      "units": "degrees"
    },
    "state": {
      "type": "state",
      "default": {}
    },
    "light": { "type": "light" },
    "sky": { "type": "sky" },
    "projection": { "type": "projection" },
    "terrain": { "type": "terrain" },
    "sources": {
      "required": true,
      "type": "sources"
    },
    "sprite": { "type": "sprite" },
    "glyphs": { "type": "string" },
    "font-faces": { "type": "fontFaces" },
    "transition": { "type": "transition" },
    "layers": {
      "required": true,
      "type": "array",
      "value": "layer"
    }
  },
  sources: { "*": { "type": "source" } },
  source: [
    "source_vector",
    "source_raster",
    "source_raster_dem",
    "source_geojson",
    "source_video",
    "source_image"
  ],
  source_vector: {
    "type": {
      "required": true,
      "type": "enum",
      "values": { "vector": {} }
    },
    "url": { "type": "string" },
    "tiles": {
      "type": "array",
      "value": "string"
    },
    "bounds": {
      "type": "array",
      "value": "number",
      "length": 4,
      "default": [
        -180,
        -85.051129,
        180,
        85.051129
      ]
    },
    "scheme": {
      "type": "enum",
      "values": {
        "xyz": {},
        "tms": {}
      },
      "default": "xyz"
    },
    "minzoom": {
      "type": "number",
      "default": 0
    },
    "maxzoom": {
      "type": "number",
      "default": 22
    },
    "attribution": { "type": "string" },
    "promoteId": { "type": "promoteId" },
    "volatile": {
      "type": "boolean",
      "default": false
    },
    "encoding": {
      "type": "enum",
      "values": {
        "mvt": {},
        "mlt": {}
      },
      "default": "mvt"
    },
    "*": { "type": "*" }
  },
  source_raster: {
    "type": {
      "required": true,
      "type": "enum",
      "values": { "raster": {} }
    },
    "url": { "type": "string" },
    "tiles": {
      "type": "array",
      "value": "string"
    },
    "bounds": {
      "type": "array",
      "value": "number",
      "length": 4,
      "default": [
        -180,
        -85.051129,
        180,
        85.051129
      ]
    },
    "minzoom": {
      "type": "number",
      "default": 0
    },
    "maxzoom": {
      "type": "number",
      "default": 22
    },
    "tileSize": {
      "type": "number",
      "default": 512,
      "units": "pixels"
    },
    "scheme": {
      "type": "enum",
      "values": {
        "xyz": {},
        "tms": {}
      },
      "default": "xyz"
    },
    "attribution": { "type": "string" },
    "volatile": {
      "type": "boolean",
      "default": false
    },
    "*": { "type": "*" }
  },
  source_raster_dem: {
    "type": {
      "required": true,
      "type": "enum",
      "values": { "raster-dem": {} }
    },
    "url": { "type": "string" },
    "tiles": {
      "type": "array",
      "value": "string"
    },
    "bounds": {
      "type": "array",
      "value": "number",
      "length": 4,
      "default": [
        -180,
        -85.051129,
        180,
        85.051129
      ]
    },
    "minzoom": {
      "type": "number",
      "default": 0
    },
    "maxzoom": {
      "type": "number",
      "default": 22
    },
    "tileSize": {
      "type": "number",
      "default": 512,
      "units": "pixels"
    },
    "attribution": { "type": "string" },
    "encoding": {
      "type": "enum",
      "values": {
        "terrarium": {},
        "mapbox": {},
        "custom": {}
      },
      "default": "mapbox"
    },
    "redFactor": {
      "type": "number",
      "default": 1
    },
    "blueFactor": {
      "type": "number",
      "default": 1
    },
    "greenFactor": {
      "type": "number",
      "default": 1
    },
    "baseShift": {
      "type": "number",
      "default": 0
    },
    "volatile": {
      "type": "boolean",
      "default": false
    },
    "*": { "type": "*" }
  },
  source_geojson: {
    "type": {
      "required": true,
      "type": "enum",
      "values": { "geojson": {} }
    },
    "data": {
      "required": true,
      "type": "*"
    },
    "maxzoom": {
      "type": "number",
      "default": 18
    },
    "attribution": { "type": "string" },
    "buffer": {
      "type": "number",
      "default": 128,
      "maximum": 512,
      "minimum": 0
    },
    "filter": { "type": "filter" },
    "tolerance": {
      "type": "number",
      "default": 0.375
    },
    "cluster": {
      "type": "boolean",
      "default": false
    },
    "clusterRadius": {
      "type": "number",
      "default": 50,
      "minimum": 0
    },
    "clusterMaxZoom": { "type": "number" },
    "clusterMinPoints": { "type": "number" },
    "clusterProperties": { "type": "*" },
    "lineMetrics": {
      "type": "boolean",
      "default": false
    },
    "generateId": {
      "type": "boolean",
      "default": false
    },
    "promoteId": { "type": "promoteId" }
  },
  source_video: {
    "type": {
      "required": true,
      "type": "enum",
      "values": { "video": {} }
    },
    "urls": {
      "required": true,
      "type": "array",
      "value": "string"
    },
    "coordinates": {
      "required": true,
      "type": "array",
      "length": 4,
      "value": {
        "type": "array",
        "length": 2,
        "value": "number"
      }
    }
  },
  source_image: {
    "type": {
      "required": true,
      "type": "enum",
      "values": { "image": {} }
    },
    "url": { "type": "string" },
    "coordinates": {
      "required": true,
      "type": "array",
      "length": 4,
      "value": {
        "type": "array",
        "length": 2,
        "value": "number"
      }
    }
  },
  layer: {
    "id": {
      "type": "string",
      "required": true
    },
    "type": {
      "type": "enum",
      "values": {
        "fill": {},
        "line": {},
        "symbol": {},
        "circle": {},
        "heatmap": {},
        "fill-extrusion": {},
        "raster": {},
        "hillshade": {},
        "color-relief": {},
        "background": {}
      },
      "required": true
    },
    "metadata": { "type": "*" },
    "source": { "type": "string" },
    "source-layer": { "type": "string" },
    "minzoom": {
      "type": "number",
      "minimum": 0,
      "maximum": 24
    },
    "maxzoom": {
      "type": "number",
      "minimum": 0,
      "maximum": 24
    },
    "filter": { "type": "filter" },
    "layout": { "type": "layout" },
    "paint": { "type": "paint" }
  },
  layout: [
    "layout_fill",
    "layout_line",
    "layout_circle",
    "layout_heatmap",
    "layout_fill-extrusion",
    "layout_symbol",
    "layout_raster",
    "layout_hillshade",
    "layout_color-relief",
    "layout_background"
  ],
  layout_background: { "visibility": {
    "type": "enum",
    "values": {
      "visible": {},
      "none": {}
    },
    "default": "visible",
    "expression": {
      "interpolated": false,
      "parameters": ["global-state"]
    },
    "property-type": "data-constant"
  } },
  layout_fill: {
    "fill-sort-key": {
      "type": "number",
      "expression": {
        "interpolated": false,
        "parameters": ["zoom", "feature"]
      },
      "property-type": "data-driven"
    },
    "visibility": {
      "type": "enum",
      "values": {
        "visible": {},
        "none": {}
      },
      "default": "visible",
      "expression": {
        "interpolated": false,
        "parameters": ["global-state"]
      },
      "property-type": "data-constant"
    }
  },
  layout_circle: {
    "circle-sort-key": {
      "type": "number",
      "expression": {
        "interpolated": false,
        "parameters": ["zoom", "feature"]
      },
      "property-type": "data-driven"
    },
    "visibility": {
      "type": "enum",
      "values": {
        "visible": {},
        "none": {}
      },
      "default": "visible",
      "expression": {
        "interpolated": false,
        "parameters": ["global-state"]
      },
      "property-type": "data-constant"
    }
  },
  layout_heatmap: { "visibility": {
    "type": "enum",
    "values": {
      "visible": {},
      "none": {}
    },
    "default": "visible",
    "expression": {
      "interpolated": false,
      "parameters": ["global-state"]
    },
    "property-type": "data-constant"
  } },
  "layout_fill-extrusion": {
    "visibility": {
      "type": "enum",
      "values": {
        "visible": {},
        "none": {}
      },
      "default": "visible",
      "expression": {
        "interpolated": false,
        "parameters": ["global-state"]
      },
      "property-type": "data-constant"
    },
    "fill-extrusion-rounded-corner-distance": {
      "type": "number",
      "default": 0,
      "minimum": 0,
      "units": "meters",
      "property-type": "constant"
    }
  },
  layout_line: {
    "line-cap": {
      "type": "enum",
      "values": {
        "butt": {},
        "round": {},
        "square": {}
      },
      "default": "butt",
      "expression": {
        "interpolated": false,
        "parameters": ["zoom", "feature"]
      },
      "property-type": "data-driven"
    },
    "line-join": {
      "type": "enum",
      "values": {
        "bevel": {},
        "round": {},
        "miter": {}
      },
      "default": "miter",
      "expression": {
        "interpolated": false,
        "parameters": ["zoom", "feature"]
      },
      "property-type": "data-driven"
    },
    "line-miter-limit": {
      "type": "number",
      "default": 2,
      "requires": [{ "line-join": "miter" }],
      "expression": {
        "interpolated": true,
        "parameters": ["zoom", "feature"]
      },
      "property-type": "data-driven"
    },
    "line-round-limit": {
      "type": "number",
      "default": 1.05,
      "requires": [{ "line-join": "round" }],
      "expression": {
        "interpolated": true,
        "parameters": ["zoom", "feature"]
      },
      "property-type": "data-driven"
    },
    "line-sort-key": {
      "type": "number",
      "expression": {
        "interpolated": false,
        "parameters": ["zoom", "feature"]
      },
      "property-type": "data-driven"
    },
    "visibility": {
      "type": "enum",
      "values": {
        "visible": {},
        "none": {}
      },
      "default": "visible",
      "expression": {
        "interpolated": false,
        "parameters": ["global-state"]
      },
      "property-type": "data-constant"
    }
  },
  layout_symbol: {
    "symbol-placement": {
      "type": "enum",
      "values": {
        "point": {},
        "line": {},
        "line-center": {}
      },
      "default": "point",
      "expression": {
        "interpolated": false,
        "parameters": ["zoom"]
      },
      "property-type": "data-constant"
    },
    "symbol-spacing": {
      "type": "number",
      "default": 250,
      "minimum": 1,
      "units": "pixels",
      "requires": [{ "symbol-placement": "line" }],
      "expression": {
        "interpolated": true,
        "parameters": ["zoom"]
      },
      "property-type": "data-constant"
    },
    "symbol-avoid-edges": {
      "type": "boolean",
      "default": false,
      "expression": {
        "interpolated": false,
        "parameters": ["zoom"]
      },
      "property-type": "data-constant"
    },
    "symbol-sort-key": {
      "type": "number",
      "expression": {
        "interpolated": false,
        "parameters": ["zoom", "feature"]
      },
      "property-type": "data-driven"
    },
    "symbol-z-order": {
      "type": "enum",
      "values": {
        "auto": {},
        "viewport-y": {},
        "source": {}
      },
      "default": "auto",
      "expression": {
        "interpolated": false,
        "parameters": ["zoom"]
      },
      "property-type": "data-constant"
    },
    "icon-allow-overlap": {
      "type": "boolean",
      "default": false,
      "requires": ["icon-image", { "!": "icon-overlap" }],
      "expression": {
        "interpolated": false,
        "parameters": ["zoom"]
      },
      "property-type": "data-constant"
    },
    "icon-overlap": {
      "type": "enum",
      "values": {
        "never": {},
        "always": {},
        "cooperative": {}
      },
      "requires": ["icon-image"],
      "expression": {
        "interpolated": false,
        "parameters": ["zoom"]
      },
      "property-type": "data-constant"
    },
    "icon-ignore-placement": {
      "type": "boolean",
      "default": false,
      "requires": ["icon-image"],
      "expression": {
        "interpolated": false,
        "parameters": ["zoom"]
      },
      "property-type": "data-constant"
    },
    "icon-optional": {
      "type": "boolean",
      "default": false,
      "requires": ["icon-image", "text-field"],
      "expression": {
        "interpolated": false,
        "parameters": ["zoom"]
      },
      "property-type": "data-constant"
    },
    "icon-rotation-alignment": {
      "type": "enum",
      "values": {
        "map": {},
        "viewport": {},
        "auto": {}
      },
      "default": "auto",
      "requires": ["icon-image"],
      "expression": {
        "interpolated": false,
        "parameters": ["zoom", "feature"]
      },
      "property-type": "data-driven"
    },
    "icon-size": {
      "type": "number",
      "default": 1,
      "minimum": 0,
      "units": "factor of the original icon size",
      "requires": ["icon-image"],
      "expression": {
        "interpolated": true,
        "parameters": ["zoom", "feature"]
      },
      "property-type": "data-driven"
    },
    "icon-text-fit": {
      "type": "enum",
      "values": {
        "none": {},
        "width": {},
        "height": {},
        "both": {}
      },
      "default": "none",
      "requires": ["icon-image", "text-field"],
      "expression": {
        "interpolated": false,
        "parameters": ["zoom"]
      },
      "property-type": "data-constant"
    },
    "icon-text-fit-padding": {
      "type": "array",
      "value": "number",
      "length": 4,
      "default": [
        0,
        0,
        0,
        0
      ],
      "units": "pixels",
      "requires": [
        "icon-image",
        "text-field",
        { "icon-text-fit": [
          "both",
          "width",
          "height"
        ] }
      ],
      "expression": {
        "interpolated": true,
        "parameters": ["zoom"]
      },
      "property-type": "data-constant"
    },
    "icon-image": {
      "type": "resolvedImage",
      "tokens": true,
      "expression": {
        "interpolated": false,
        "parameters": ["zoom", "feature"]
      },
      "property-type": "data-driven"
    },
    "icon-rotate": {
      "type": "number",
      "default": 0,
      "period": 360,
      "units": "degrees",
      "requires": ["icon-image"],
      "expression": {
        "interpolated": true,
        "parameters": ["zoom", "feature"]
      },
      "property-type": "data-driven"
    },
    "icon-padding": {
      "type": "padding",
      "default": [2],
      "units": "pixels",
      "requires": ["icon-image"],
      "expression": {
        "interpolated": true,
        "parameters": ["zoom", "feature"]
      },
      "property-type": "data-driven"
    },
    "icon-keep-upright": {
      "type": "boolean",
      "default": false,
      "requires": [
        "icon-image",
        { "icon-rotation-alignment": "map" },
        { "symbol-placement": ["line", "line-center"] }
      ],
      "expression": {
        "interpolated": false,
        "parameters": ["zoom"]
      },
      "property-type": "data-constant"
    },
    "icon-offset": {
      "type": "array",
      "value": "number",
      "length": 2,
      "default": [0, 0],
      "requires": ["icon-image"],
      "expression": {
        "interpolated": true,
        "parameters": ["zoom", "feature"]
      },
      "property-type": "data-driven"
    },
    "icon-anchor": {
      "type": "enum",
      "values": {
        "center": {},
        "left": {},
        "right": {},
        "top": {},
        "bottom": {},
        "top-left": {},
        "top-right": {},
        "bottom-left": {},
        "bottom-right": {}
      },
      "default": "center",
      "requires": ["icon-image"],
      "expression": {
        "interpolated": false,
        "parameters": ["zoom", "feature"]
      },
      "property-type": "data-driven"
    },
    "icon-pitch-alignment": {
      "type": "enum",
      "values": {
        "map": {},
        "viewport": {},
        "auto": {}
      },
      "default": "auto",
      "requires": ["icon-image"],
      "expression": {
        "interpolated": false,
        "parameters": ["zoom"]
      },
      "property-type": "data-constant"
    },
    "text-pitch-alignment": {
      "type": "enum",
      "values": {
        "map": {},
        "viewport": {},
        "auto": {}
      },
      "default": "auto",
      "requires": ["text-field"],
      "expression": {
        "interpolated": false,
        "parameters": ["zoom"]
      },
      "property-type": "data-constant"
    },
    "text-rotation-alignment": {
      "type": "enum",
      "values": {
        "map": {},
        "viewport": {},
        "viewport-glyph": {},
        "auto": {}
      },
      "default": "auto",
      "requires": ["text-field"],
      "expression": {
        "interpolated": false,
        "parameters": ["zoom"]
      },
      "property-type": "data-constant"
    },
    "text-field": {
      "type": "formatted",
      "default": "",
      "tokens": true,
      "expression": {
        "interpolated": false,
        "parameters": ["zoom", "feature"]
      },
      "property-type": "data-driven"
    },
    "text-font": {
      "type": "array",
      "value": "string",
      "default": ["Open Sans Regular", "Arial Unicode MS Regular"],
      "requires": ["text-field"],
      "expression": {
        "interpolated": false,
        "parameters": ["zoom", "feature"]
      },
      "property-type": "data-driven"
    },
    "text-size": {
      "type": "number",
      "default": 16,
      "minimum": 0,
      "units": "pixels",
      "requires": ["text-field"],
      "expression": {
        "interpolated": true,
        "parameters": ["zoom", "feature"]
      },
      "property-type": "data-driven"
    },
    "text-max-width": {
      "type": "number",
      "default": 10,
      "minimum": 0,
      "units": "ems",
      "requires": ["text-field"],
      "expression": {
        "interpolated": true,
        "parameters": ["zoom", "feature"]
      },
      "property-type": "data-driven"
    },
    "text-line-height": {
      "type": "number",
      "default": 1.2,
      "units": "ems",
      "requires": ["text-field"],
      "expression": {
        "interpolated": true,
        "parameters": ["zoom"]
      },
      "property-type": "data-constant"
    },
    "text-letter-spacing": {
      "type": "number",
      "default": 0,
      "units": "ems",
      "requires": ["text-field"],
      "expression": {
        "interpolated": true,
        "parameters": ["zoom", "feature"]
      },
      "property-type": "data-driven"
    },
    "text-justify": {
      "type": "enum",
      "values": {
        "auto": {},
        "left": {},
        "center": {},
        "right": {}
      },
      "default": "center",
      "requires": ["text-field"],
      "expression": {
        "interpolated": false,
        "parameters": ["zoom", "feature"]
      },
      "property-type": "data-driven"
    },
    "text-radial-offset": {
      "type": "number",
      "units": "ems",
      "default": 0,
      "requires": ["text-field"],
      "property-type": "data-driven",
      "expression": {
        "interpolated": true,
        "parameters": ["zoom", "feature"]
      }
    },
    "text-variable-anchor": {
      "type": "array",
      "value": "enum",
      "values": {
        "center": {},
        "left": {},
        "right": {},
        "top": {},
        "bottom": {},
        "top-left": {},
        "top-right": {},
        "bottom-left": {},
        "bottom-right": {}
      },
      "requires": ["text-field", { "symbol-placement": ["point"] }],
      "expression": {
        "interpolated": false,
        "parameters": ["zoom"]
      },
      "property-type": "data-constant"
    },
    "text-variable-anchor-offset": {
      "type": "variableAnchorOffsetCollection",
      "requires": ["text-field", { "symbol-placement": ["point"] }],
      "expression": {
        "interpolated": true,
        "parameters": ["zoom", "feature"]
      },
      "property-type": "data-driven"
    },
    "text-anchor": {
      "type": "enum",
      "values": {
        "center": {},
        "left": {},
        "right": {},
        "top": {},
        "bottom": {},
        "top-left": {},
        "top-right": {},
        "bottom-left": {},
        "bottom-right": {}
      },
      "default": "center",
      "requires": ["text-field", { "!": "text-variable-anchor" }],
      "expression": {
        "interpolated": false,
        "parameters": ["zoom", "feature"]
      },
      "property-type": "data-driven"
    },
    "text-max-angle": {
      "type": "number",
      "default": 45,
      "units": "degrees",
      "requires": ["text-field", { "symbol-placement": ["line", "line-center"] }],
      "expression": {
        "interpolated": true,
        "parameters": ["zoom"]
      },
      "property-type": "data-constant"
    },
    "text-writing-mode": {
      "type": "array",
      "value": "enum",
      "values": {
        "horizontal": {},
        "vertical": {}
      },
      "requires": ["text-field", { "symbol-placement": ["point"] }],
      "expression": {
        "interpolated": false,
        "parameters": ["zoom"]
      },
      "property-type": "data-constant"
    },
    "text-rotate": {
      "type": "number",
      "default": 0,
      "period": 360,
      "units": "degrees",
      "requires": ["text-field"],
      "expression": {
        "interpolated": true,
        "parameters": ["zoom", "feature"]
      },
      "property-type": "data-driven"
    },
    "text-padding": {
      "type": "number",
      "default": 2,
      "minimum": 0,
      "units": "pixels",
      "requires": ["text-field"],
      "expression": {
        "interpolated": true,
        "parameters": ["zoom"]
      },
      "property-type": "data-constant"
    },
    "text-keep-upright": {
      "type": "boolean",
      "default": true,
      "requires": [
        "text-field",
        { "text-rotation-alignment": "map" },
        { "symbol-placement": ["line", "line-center"] }
      ],
      "expression": {
        "interpolated": false,
        "parameters": ["zoom"]
      },
      "property-type": "data-constant"
    },
    "text-transform": {
      "type": "enum",
      "values": {
        "none": {},
        "uppercase": {},
        "lowercase": {}
      },
      "default": "none",
      "requires": ["text-field"],
      "expression": {
        "interpolated": false,
        "parameters": ["zoom", "feature"]
      },
      "property-type": "data-driven"
    },
    "text-offset": {
      "type": "array",
      "value": "number",
      "units": "ems",
      "length": 2,
      "default": [0, 0],
      "requires": ["text-field", { "!": "text-radial-offset" }],
      "expression": {
        "interpolated": true,
        "parameters": ["zoom", "feature"]
      },
      "property-type": "data-driven"
    },
    "text-allow-overlap": {
      "type": "boolean",
      "default": false,
      "requires": ["text-field", { "!": "text-overlap" }],
      "expression": {
        "interpolated": false,
        "parameters": ["zoom"]
      },
      "property-type": "data-constant"
    },
    "text-overlap": {
      "type": "enum",
      "values": {
        "never": {},
        "always": {},
        "cooperative": {}
      },
      "requires": ["text-field"],
      "expression": {
        "interpolated": false,
        "parameters": ["zoom"]
      },
      "property-type": "data-constant"
    },
    "text-ignore-placement": {
      "type": "boolean",
      "default": false,
      "requires": ["text-field"],
      "expression": {
        "interpolated": false,
        "parameters": ["zoom"]
      },
      "property-type": "data-constant"
    },
    "text-optional": {
      "type": "boolean",
      "default": false,
      "requires": ["text-field", "icon-image"],
      "expression": {
        "interpolated": false,
        "parameters": ["zoom"]
      },
      "property-type": "data-constant"
    },
    "symbol-height-offset": {
      "type": "number",
      "default": 0,
      "units": "meters",
      "requires": [{ "symbol-placement": ["point"] }],
      "expression": {
        "interpolated": true,
        "parameters": ["zoom", "feature"]
      },
      "property-type": "data-driven"
    },
    "symbol-height-anchor": {
      "type": "enum",
      "values": {
        "ground": {},
        "absolute": {}
      },
      "default": "ground",
      "requires": ["symbol-height-offset"],
      "expression": {
        "interpolated": false,
        "parameters": ["zoom"]
      },
      "property-type": "data-constant"
    },
    "visibility": {
      "type": "enum",
      "values": {
        "visible": {},
        "none": {}
      },
      "default": "visible",
      "expression": {
        "interpolated": false,
        "parameters": ["global-state"]
      },
      "property-type": "data-constant"
    }
  },
  layout_raster: { "visibility": {
    "type": "enum",
    "values": {
      "visible": {},
      "none": {}
    },
    "default": "visible",
    "expression": {
      "interpolated": false,
      "parameters": ["global-state"]
    },
    "property-type": "data-constant"
  } },
  layout_hillshade: { "visibility": {
    "type": "enum",
    "values": {
      "visible": {},
      "none": {}
    },
    "default": "visible",
    "expression": {
      "interpolated": false,
      "parameters": ["global-state"]
    },
    "property-type": "data-constant"
  } },
  "layout_color-relief": { "visibility": {
    "type": "enum",
    "values": {
      "visible": {},
      "none": {}
    },
    "default": "visible",
    "expression": {
      "interpolated": false,
      "parameters": ["global-state"]
    },
    "property-type": "data-constant"
  } },
  filter: {
    "type": "boolean",
    "expression": {
      "interpolated": false,
      "parameters": ["zoom", "feature"]
    },
    "property-type": "data-driven"
  },
  filter_operator: {
    "type": "enum",
    "values": {
      "==": {},
      "!=": {},
      ">": {},
      ">=": {},
      "<": {},
      "<=": {},
      "in": {},
      "!in": {},
      "all": {},
      "any": {},
      "none": {},
      "has": {},
      "!has": {}
    }
  },
  geometry_type: {
    "type": "enum",
    "values": {
      "Point": {},
      "LineString": {},
      "Polygon": {}
    }
  },
  "function": {
    "expression": { "type": "expression" },
    "stops": {
      "type": "array",
      "value": "function_stop"
    },
    "base": {
      "type": "number",
      "default": 1,
      "minimum": 0
    },
    "property": {
      "type": "string",
      "default": "$zoom"
    },
    "type": {
      "type": "enum",
      "values": {
        "identity": {},
        "exponential": {},
        "interval": {},
        "categorical": {}
      },
      "default": "exponential"
    },
    "colorSpace": {
      "type": "enum",
      "values": {
        "rgb": {},
        "lab": {},
        "hcl": {}
      },
      "default": "rgb"
    },
    "default": {
      "type": "*",
      "required": false
    }
  },
  function_stop: {
    "type": "array",
    "minimum": 0,
    "maximum": 24,
    "value": ["number", "color"],
    "length": 2
  },
  expression: {
    "type": "array",
    "value": "expression_name",
    "minimum": 1
  },
  light: {
    "anchor": {
      "type": "enum",
      "default": "viewport",
      "values": {
        "map": {},
        "viewport": {}
      },
      "property-type": "data-constant",
      "transition": false,
      "expression": {
        "interpolated": false,
        "parameters": ["zoom"]
      }
    },
    "position": {
      "type": "array",
      "default": [
        1.15,
        210,
        30
      ],
      "length": 3,
      "value": "number",
      "property-type": "data-constant",
      "transition": true,
      "expression": {
        "interpolated": true,
        "parameters": ["zoom"]
      }
    },
    "color": {
      "type": "color",
      "property-type": "data-constant",
      "default": "#ffffff",
      "expression": {
        "interpolated": true,
        "parameters": ["zoom"]
      },
      "transition": true
    },
    "intensity": {
      "type": "number",
      "property-type": "data-constant",
      "default": 0.5,
      "minimum": 0,
      "maximum": 1,
      "expression": {
        "interpolated": true,
        "parameters": ["zoom"]
      },
      "transition": true
    }
  },
  sky: {
    "sky-color": {
      "type": "color",
      "property-type": "data-constant",
      "default": "#88C6FC",
      "expression": {
        "interpolated": true,
        "parameters": ["zoom"]
      },
      "transition": true
    },
    "horizon-color": {
      "type": "color",
      "property-type": "data-constant",
      "default": "#ffffff",
      "expression": {
        "interpolated": true,
        "parameters": ["zoom"]
      },
      "transition": true
    },
    "fog-color": {
      "type": "color",
      "property-type": "data-constant",
      "default": "#ffffff",
      "expression": {
        "interpolated": true,
        "parameters": ["zoom"]
      },
      "transition": true
    },
    "fog-ground-blend": {
      "type": "number",
      "property-type": "data-constant",
      "default": 0.5,
      "minimum": 0,
      "maximum": 1,
      "expression": {
        "interpolated": true,
        "parameters": ["zoom"]
      },
      "transition": true
    },
    "horizon-fog-blend": {
      "type": "number",
      "property-type": "data-constant",
      "default": 0.8,
      "minimum": 0,
      "maximum": 1,
      "expression": {
        "interpolated": true,
        "parameters": ["zoom"]
      },
      "transition": true
    },
    "sky-horizon-blend": {
      "type": "number",
      "property-type": "data-constant",
      "default": 0.8,
      "minimum": 0,
      "maximum": 1,
      "expression": {
        "interpolated": true,
        "parameters": ["zoom"]
      },
      "transition": true
    },
    "atmosphere-blend": {
      "type": "number",
      "property-type": "data-constant",
      "default": 0.8,
      "minimum": 0,
      "maximum": 1,
      "expression": {
        "interpolated": true,
        "parameters": ["zoom"]
      },
      "transition": true
    }
  },
  terrain: {
    "source": {
      "type": "string",
      "required": true
    },
    "exaggeration": {
      "type": "number",
      "minimum": 0,
      "default": 1
    }
  },
  projection: { "type": {
    "type": "projectionDefinition",
    "default": "mercator",
    "property-type": "data-constant",
    "transition": false,
    "expression": {
      "interpolated": true,
      "parameters": ["zoom"]
    }
  } },
  paint: [
    "paint_fill",
    "paint_line",
    "paint_circle",
    "paint_heatmap",
    "paint_fill-extrusion",
    "paint_symbol",
    "paint_raster",
    "paint_hillshade",
    "paint_color-relief",
    "paint_background"
  ],
  paint_fill: {
    "fill-antialias": {
      "type": "boolean",
      "default": true,
      "expression": {
        "interpolated": false,
        "parameters": ["zoom"]
      },
      "property-type": "data-constant"
    },
    "fill-opacity": {
      "type": "number",
      "default": 1,
      "minimum": 0,
      "maximum": 1,
      "transition": true,
      "expression": {
        "interpolated": true,
        "parameters": [
          "zoom",
          "feature",
          "feature-state"
        ]
      },
      "property-type": "data-driven"
    },
    "fill-layer-opacity": {
      "type": "number",
      "default": 1,
      "minimum": 0,
      "maximum": 1,
      "transition": true,
      "expression": {
        "interpolated": true,
        "parameters": ["zoom", "global-state"]
      },
      "property-type": "data-constant"
    },
    "fill-color": {
      "type": "color",
      "default": "#000000",
      "transition": true,
      "expression": {
        "interpolated": true,
        "parameters": [
          "zoom",
          "feature",
          "feature-state"
        ]
      },
      "property-type": "data-driven"
    },
    "fill-outline-color": {
      "type": "color",
      "transition": true,
      "requires": [{ "!": "fill-pattern" }, { "fill-antialias": true }],
      "expression": {
        "interpolated": true,
        "parameters": [
          "zoom",
          "feature",
          "feature-state"
        ]
      },
      "property-type": "data-driven"
    },
    "fill-translate": {
      "type": "array",
      "value": "number",
      "length": 2,
      "default": [0, 0],
      "transition": true,
      "units": "pixels",
      "expression": {
        "interpolated": true,
        "parameters": ["zoom"]
      },
      "property-type": "data-constant"
    },
    "fill-translate-anchor": {
      "type": "enum",
      "values": {
        "map": {},
        "viewport": {}
      },
      "default": "map",
      "requires": ["fill-translate"],
      "expression": {
        "interpolated": false,
        "parameters": ["zoom"]
      },
      "property-type": "data-constant"
    },
    "fill-pattern": {
      "type": "resolvedImage",
      "transition": true,
      "expression": {
        "interpolated": false,
        "parameters": ["zoom", "feature"]
      },
      "property-type": "cross-faded-data-driven"
    }
  },
  "paint_fill-extrusion": {
    "fill-extrusion-opacity": {
      "type": "number",
      "default": 1,
      "minimum": 0,
      "maximum": 1,
      "transition": true,
      "expression": {
        "interpolated": true,
        "parameters": ["zoom"]
      },
      "property-type": "data-constant"
    },
    "fill-extrusion-color": {
      "type": "color",
      "default": "#000000",
      "transition": true,
      "requires": [{ "!": "fill-extrusion-pattern" }],
      "expression": {
        "interpolated": true,
        "parameters": [
          "zoom",
          "feature",
          "feature-state"
        ]
      },
      "property-type": "data-driven"
    },
    "fill-extrusion-translate": {
      "type": "array",
      "value": "number",
      "length": 2,
      "default": [0, 0],
      "transition": true,
      "units": "pixels",
      "expression": {
        "interpolated": true,
        "parameters": ["zoom"]
      },
      "property-type": "data-constant"
    },
    "fill-extrusion-translate-anchor": {
      "type": "enum",
      "values": {
        "map": {},
        "viewport": {}
      },
      "default": "map",
      "requires": ["fill-extrusion-translate"],
      "expression": {
        "interpolated": false,
        "parameters": ["zoom"]
      },
      "property-type": "data-constant"
    },
    "fill-extrusion-pattern": {
      "type": "resolvedImage",
      "transition": true,
      "expression": {
        "interpolated": false,
        "parameters": ["zoom", "feature"]
      },
      "property-type": "cross-faded-data-driven"
    },
    "fill-extrusion-height": {
      "type": "number",
      "default": 0,
      "minimum": 0,
      "units": "meters",
      "transition": true,
      "expression": {
        "interpolated": true,
        "parameters": [
          "zoom",
          "feature",
          "feature-state"
        ]
      },
      "property-type": "data-driven"
    },
    "fill-extrusion-base": {
      "type": "number",
      "default": 0,
      "minimum": 0,
      "units": "meters",
      "transition": true,
      "requires": ["fill-extrusion-height"],
      "expression": {
        "interpolated": true,
        "parameters": [
          "zoom",
          "feature",
          "feature-state"
        ]
      },
      "property-type": "data-driven"
    },
    "fill-extrusion-vertical-gradient": {
      "type": "boolean",
      "default": true,
      "transition": false,
      "expression": {
        "interpolated": false,
        "parameters": ["zoom"]
      },
      "property-type": "data-constant"
    }
  },
  paint_line: {
    "line-opacity": {
      "type": "number",
      "default": 1,
      "minimum": 0,
      "maximum": 1,
      "transition": true,
      "expression": {
        "interpolated": true,
        "parameters": [
          "zoom",
          "feature",
          "feature-state"
        ]
      },
      "property-type": "data-driven"
    },
    "line-layer-opacity": {
      "type": "number",
      "default": 1,
      "minimum": 0,
      "maximum": 1,
      "transition": true,
      "expression": {
        "interpolated": true,
        "parameters": ["zoom", "global-state"]
      },
      "property-type": "data-constant"
    },
    "line-color": {
      "type": "color",
      "default": "#000000",
      "transition": true,
      "requires": [{ "!": "line-pattern" }],
      "expression": {
        "interpolated": true,
        "parameters": [
          "zoom",
          "feature",
          "feature-state"
        ]
      },
      "property-type": "data-driven"
    },
    "line-translate": {
      "type": "array",
      "value": "number",
      "length": 2,
      "default": [0, 0],
      "transition": true,
      "units": "pixels",
      "expression": {
        "interpolated": true,
        "parameters": ["zoom"]
      },
      "property-type": "data-constant"
    },
    "line-translate-anchor": {
      "type": "enum",
      "values": {
        "map": {},
        "viewport": {}
      },
      "default": "map",
      "requires": ["line-translate"],
      "expression": {
        "interpolated": false,
        "parameters": ["zoom"]
      },
      "property-type": "data-constant"
    },
    "line-width": {
      "type": "number",
      "default": 1,
      "minimum": 0,
      "transition": true,
      "units": "pixels",
      "expression": {
        "interpolated": true,
        "parameters": [
          "zoom",
          "feature",
          "feature-state"
        ]
      },
      "property-type": "data-driven"
    },
    "line-gap-width": {
      "type": "number",
      "default": 0,
      "minimum": 0,
      "transition": true,
      "units": "pixels",
      "expression": {
        "interpolated": true,
        "parameters": [
          "zoom",
          "feature",
          "feature-state"
        ]
      },
      "property-type": "data-driven"
    },
    "line-offset": {
      "type": "number",
      "default": 0,
      "transition": true,
      "units": "pixels",
      "expression": {
        "interpolated": true,
        "parameters": [
          "zoom",
          "feature",
          "feature-state"
        ]
      },
      "property-type": "data-driven"
    },
    "line-blur": {
      "type": "number",
      "default": 0,
      "minimum": 0,
      "transition": true,
      "units": "pixels",
      "expression": {
        "interpolated": true,
        "parameters": [
          "zoom",
          "feature",
          "feature-state"
        ]
      },
      "property-type": "data-driven"
    },
    "line-dasharray": {
      "type": "array",
      "value": "number",
      "minimum": 0,
      "transition": true,
      "units": "line widths",
      "requires": [{ "!": "line-pattern" }],
      "expression": {
        "interpolated": false,
        "parameters": ["zoom", "feature"]
      },
      "property-type": "cross-faded-data-driven"
    },
    "line-pattern": {
      "type": "resolvedImage",
      "transition": true,
      "expression": {
        "interpolated": false,
        "parameters": ["zoom", "feature"]
      },
      "property-type": "cross-faded-data-driven"
    },
    "line-gradient": {
      "type": "color",
      "transition": false,
      "requires": [
        { "!": "line-dasharray" },
        { "!": "line-pattern" },
        {
          "source": "geojson",
          "has": { "lineMetrics": true }
        }
      ],
      "expression": {
        "interpolated": true,
        "parameters": ["line-progress"]
      },
      "property-type": "color-ramp"
    }
  },
  paint_circle: {
    "circle-radius": {
      "type": "number",
      "default": 5,
      "minimum": 0,
      "transition": true,
      "units": "pixels",
      "expression": {
        "interpolated": true,
        "parameters": [
          "zoom",
          "feature",
          "feature-state"
        ]
      },
      "property-type": "data-driven"
    },
    "circle-color": {
      "type": "color",
      "default": "#000000",
      "transition": true,
      "expression": {
        "interpolated": true,
        "parameters": [
          "zoom",
          "feature",
          "feature-state"
        ]
      },
      "property-type": "data-driven"
    },
    "circle-blur": {
      "type": "number",
      "default": 0,
      "transition": true,
      "expression": {
        "interpolated": true,
        "parameters": [
          "zoom",
          "feature",
          "feature-state"
        ]
      },
      "property-type": "data-driven"
    },
    "circle-opacity": {
      "type": "number",
      "default": 1,
      "minimum": 0,
      "maximum": 1,
      "transition": true,
      "expression": {
        "interpolated": true,
        "parameters": [
          "zoom",
          "feature",
          "feature-state"
        ]
      },
      "property-type": "data-driven"
    },
    "circle-translate": {
      "type": "array",
      "value": "number",
      "length": 2,
      "default": [0, 0],
      "transition": true,
      "units": "pixels",
      "expression": {
        "interpolated": true,
        "parameters": ["zoom"]
      },
      "property-type": "data-constant"
    },
    "circle-translate-anchor": {
      "type": "enum",
      "values": {
        "map": {},
        "viewport": {}
      },
      "default": "map",
      "requires": ["circle-translate"],
      "expression": {
        "interpolated": false,
        "parameters": ["zoom"]
      },
      "property-type": "data-constant"
    },
    "circle-pitch-scale": {
      "type": "enum",
      "values": {
        "map": {},
        "viewport": {}
      },
      "default": "map",
      "expression": {
        "interpolated": false,
        "parameters": ["zoom"]
      },
      "property-type": "data-constant"
    },
    "circle-pitch-alignment": {
      "type": "enum",
      "values": {
        "map": {},
        "viewport": {}
      },
      "default": "viewport",
      "expression": {
        "interpolated": false,
        "parameters": ["zoom"]
      },
      "property-type": "data-constant"
    },
    "circle-stroke-width": {
      "type": "number",
      "default": 0,
      "minimum": 0,
      "transition": true,
      "units": "pixels",
      "expression": {
        "interpolated": true,
        "parameters": [
          "zoom",
          "feature",
          "feature-state"
        ]
      },
      "property-type": "data-driven"
    },
    "circle-stroke-color": {
      "type": "color",
      "default": "#000000",
      "transition": true,
      "expression": {
        "interpolated": true,
        "parameters": [
          "zoom",
          "feature",
          "feature-state"
        ]
      },
      "property-type": "data-driven"
    },
    "circle-stroke-opacity": {
      "type": "number",
      "default": 1,
      "minimum": 0,
      "maximum": 1,
      "transition": true,
      "expression": {
        "interpolated": true,
        "parameters": [
          "zoom",
          "feature",
          "feature-state"
        ]
      },
      "property-type": "data-driven"
    }
  },
  paint_heatmap: {
    "heatmap-radius": {
      "type": "number",
      "default": 30,
      "minimum": 1,
      "transition": true,
      "units": "pixels",
      "expression": {
        "interpolated": true,
        "parameters": [
          "zoom",
          "feature",
          "feature-state"
        ]
      },
      "property-type": "data-driven"
    },
    "heatmap-weight": {
      "type": "number",
      "default": 1,
      "minimum": 0,
      "transition": false,
      "expression": {
        "interpolated": true,
        "parameters": [
          "zoom",
          "feature",
          "feature-state"
        ]
      },
      "property-type": "data-driven"
    },
    "heatmap-intensity": {
      "type": "number",
      "default": 1,
      "minimum": 0,
      "transition": true,
      "expression": {
        "interpolated": true,
        "parameters": ["zoom"]
      },
      "property-type": "data-constant"
    },
    "heatmap-color": {
      "type": "color",
      "default": [
        "interpolate",
        ["linear"],
        ["heatmap-density"],
        0,
        "rgba(0, 0, 255, 0)",
        0.1,
        "royalblue",
        0.3,
        "cyan",
        0.5,
        "lime",
        0.7,
        "yellow",
        1,
        "red"
      ],
      "transition": false,
      "expression": {
        "interpolated": true,
        "parameters": ["heatmap-density"]
      },
      "property-type": "color-ramp"
    },
    "heatmap-opacity": {
      "type": "number",
      "default": 1,
      "minimum": 0,
      "maximum": 1,
      "transition": true,
      "expression": {
        "interpolated": true,
        "parameters": ["zoom"]
      },
      "property-type": "data-constant"
    }
  },
  paint_symbol: {
    "icon-opacity": {
      "type": "number",
      "default": 1,
      "minimum": 0,
      "maximum": 1,
      "transition": true,
      "requires": ["icon-image"],
      "expression": {
        "interpolated": true,
        "parameters": [
          "zoom",
          "feature",
          "feature-state"
        ]
      },
      "property-type": "data-driven"
    },
    "icon-color": {
      "type": "color",
      "default": "#000000",
      "transition": true,
      "requires": ["icon-image"],
      "expression": {
        "interpolated": true,
        "parameters": [
          "zoom",
          "feature",
          "feature-state"
        ]
      },
      "property-type": "data-driven"
    },
    "icon-halo-color": {
      "type": "color",
      "default": "rgba(0, 0, 0, 0)",
      "transition": true,
      "requires": ["icon-image"],
      "expression": {
        "interpolated": true,
        "parameters": [
          "zoom",
          "feature",
          "feature-state"
        ]
      },
      "property-type": "data-driven"
    },
    "icon-halo-width": {
      "type": "number",
      "default": 0,
      "minimum": 0,
      "transition": true,
      "units": "pixels",
      "requires": ["icon-image"],
      "expression": {
        "interpolated": true,
        "parameters": [
          "zoom",
          "feature",
          "feature-state"
        ]
      },
      "property-type": "data-driven"
    },
    "icon-halo-blur": {
      "type": "number",
      "default": 0,
      "minimum": 0,
      "transition": true,
      "units": "pixels",
      "requires": ["icon-image"],
      "expression": {
        "interpolated": true,
        "parameters": [
          "zoom",
          "feature",
          "feature-state"
        ]
      },
      "property-type": "data-driven"
    },
    "icon-translate": {
      "type": "array",
      "value": "number",
      "length": 2,
      "default": [0, 0],
      "transition": true,
      "units": "pixels",
      "requires": ["icon-image"],
      "expression": {
        "interpolated": true,
        "parameters": ["zoom"]
      },
      "property-type": "data-constant"
    },
    "icon-translate-anchor": {
      "type": "enum",
      "values": {
        "map": {},
        "viewport": {}
      },
      "default": "map",
      "requires": ["icon-image", "icon-translate"],
      "expression": {
        "interpolated": false,
        "parameters": ["zoom"]
      },
      "property-type": "data-constant"
    },
    "text-opacity": {
      "type": "number",
      "default": 1,
      "minimum": 0,
      "maximum": 1,
      "transition": true,
      "requires": ["text-field"],
      "expression": {
        "interpolated": true,
        "parameters": [
          "zoom",
          "feature",
          "feature-state"
        ]
      },
      "property-type": "data-driven"
    },
    "text-color": {
      "type": "color",
      "default": "#000000",
      "transition": true,
      "overridable": true,
      "requires": ["text-field"],
      "expression": {
        "interpolated": true,
        "parameters": [
          "zoom",
          "feature",
          "feature-state"
        ]
      },
      "property-type": "data-driven"
    },
    "text-halo-color": {
      "type": "color",
      "default": "rgba(0, 0, 0, 0)",
      "transition": true,
      "requires": ["text-field"],
      "expression": {
        "interpolated": true,
        "parameters": [
          "zoom",
          "feature",
          "feature-state"
        ]
      },
      "property-type": "data-driven"
    },
    "text-halo-width": {
      "type": "number",
      "default": 0,
      "minimum": 0,
      "transition": true,
      "units": "pixels",
      "requires": ["text-field"],
      "expression": {
        "interpolated": true,
        "parameters": [
          "zoom",
          "feature",
          "feature-state"
        ]
      },
      "property-type": "data-driven"
    },
    "text-halo-blur": {
      "type": "number",
      "default": 0,
      "minimum": 0,
      "transition": true,
      "units": "pixels",
      "requires": ["text-field"],
      "expression": {
        "interpolated": true,
        "parameters": [
          "zoom",
          "feature",
          "feature-state"
        ]
      },
      "property-type": "data-driven"
    },
    "text-translate": {
      "type": "array",
      "value": "number",
      "length": 2,
      "default": [0, 0],
      "transition": true,
      "units": "pixels",
      "requires": ["text-field"],
      "expression": {
        "interpolated": true,
        "parameters": ["zoom"]
      },
      "property-type": "data-constant"
    },
    "text-translate-anchor": {
      "type": "enum",
      "values": {
        "map": {},
        "viewport": {}
      },
      "default": "map",
      "requires": ["text-field", "text-translate"],
      "expression": {
        "interpolated": false,
        "parameters": ["zoom"]
      },
      "property-type": "data-constant"
    }
  },
  paint_raster: {
    "raster-opacity": {
      "type": "number",
      "default": 1,
      "minimum": 0,
      "maximum": 1,
      "transition": true,
      "expression": {
        "interpolated": true,
        "parameters": ["zoom"]
      },
      "property-type": "data-constant"
    },
    "raster-hue-rotate": {
      "type": "number",
      "default": 0,
      "period": 360,
      "transition": true,
      "units": "degrees",
      "expression": {
        "interpolated": true,
        "parameters": ["zoom"]
      },
      "property-type": "data-constant"
    },
    "raster-brightness-min": {
      "type": "number",
      "default": 0,
      "minimum": 0,
      "maximum": 1,
      "transition": true,
      "expression": {
        "interpolated": true,
        "parameters": ["zoom"]
      },
      "property-type": "data-constant"
    },
    "raster-brightness-max": {
      "type": "number",
      "default": 1,
      "minimum": 0,
      "maximum": 1,
      "transition": true,
      "expression": {
        "interpolated": true,
        "parameters": ["zoom"]
      },
      "property-type": "data-constant"
    },
    "raster-saturation": {
      "type": "number",
      "default": 0,
      "minimum": -1,
      "maximum": 1,
      "transition": true,
      "expression": {
        "interpolated": true,
        "parameters": ["zoom"]
      },
      "property-type": "data-constant"
    },
    "raster-contrast": {
      "type": "number",
      "default": 0,
      "minimum": -1,
      "maximum": 1,
      "transition": true,
      "expression": {
        "interpolated": true,
        "parameters": ["zoom"]
      },
      "property-type": "data-constant"
    },
    "resampling": {
      "type": "enum",
      "values": {
        "linear": {},
        "nearest": {}
      },
      "default": "linear",
      "expression": {
        "interpolated": false,
        "parameters": ["zoom"]
      },
      "property-type": "data-constant"
    },
    "raster-resampling": {
      "type": "enum",
      "values": {
        "linear": {},
        "nearest": {}
      },
      "default": "linear",
      "expression": {
        "interpolated": false,
        "parameters": ["zoom"]
      },
      "property-type": "data-constant"
    },
    "raster-fade-duration": {
      "type": "number",
      "default": 300,
      "minimum": 0,
      "transition": false,
      "units": "milliseconds",
      "expression": {
        "interpolated": true,
        "parameters": ["zoom"]
      },
      "property-type": "data-constant"
    }
  },
  paint_hillshade: {
    "hillshade-illumination-direction": {
      "type": "numberArray",
      "default": 335,
      "minimum": 0,
      "maximum": 359,
      "transition": false,
      "expression": {
        "interpolated": true,
        "parameters": ["zoom"]
      },
      "property-type": "data-constant"
    },
    "hillshade-illumination-altitude": {
      "type": "numberArray",
      "default": 45,
      "minimum": 0,
      "maximum": 90,
      "transition": false,
      "expression": {
        "interpolated": true,
        "parameters": ["zoom"]
      },
      "property-type": "data-constant"
    },
    "hillshade-illumination-anchor": {
      "type": "enum",
      "values": {
        "map": {},
        "viewport": {}
      },
      "default": "viewport",
      "expression": {
        "interpolated": false,
        "parameters": ["zoom"]
      },
      "property-type": "data-constant"
    },
    "hillshade-exaggeration": {
      "type": "number",
      "default": 0.5,
      "minimum": 0,
      "maximum": 1,
      "transition": true,
      "expression": {
        "interpolated": true,
        "parameters": ["zoom"]
      },
      "property-type": "data-constant"
    },
    "hillshade-shadow-color": {
      "type": "colorArray",
      "default": "#000000",
      "transition": true,
      "expression": {
        "interpolated": true,
        "parameters": ["zoom"]
      },
      "property-type": "data-constant"
    },
    "hillshade-highlight-color": {
      "type": "colorArray",
      "default": "#FFFFFF",
      "transition": true,
      "expression": {
        "interpolated": true,
        "parameters": ["zoom"]
      },
      "property-type": "data-constant"
    },
    "hillshade-accent-color": {
      "type": "color",
      "default": "#000000",
      "transition": true,
      "expression": {
        "interpolated": true,
        "parameters": ["zoom"]
      },
      "property-type": "data-constant"
    },
    "hillshade-method": {
      "type": "enum",
      "values": {
        "standard": {},
        "basic": {},
        "combined": {},
        "igor": {},
        "multidirectional": {}
      },
      "default": "standard",
      "expression": {
        "interpolated": false,
        "parameters": ["zoom"]
      },
      "property-type": "data-constant"
    },
    "resampling": {
      "type": "enum",
      "values": {
        "linear": {},
        "nearest": {}
      },
      "default": "linear",
      "expression": {
        "interpolated": false,
        "parameters": ["zoom"]
      },
      "property-type": "data-constant"
    }
  },
  "paint_color-relief": {
    "color-relief-opacity": {
      "type": "number",
      "default": 1,
      "minimum": 0,
      "maximum": 1,
      "transition": true,
      "expression": {
        "interpolated": true,
        "parameters": ["zoom"]
      },
      "property-type": "data-constant"
    },
    "color-relief-color": {
      "type": "color",
      "transition": false,
      "expression": {
        "interpolated": true,
        "parameters": ["elevation"]
      },
      "property-type": "color-ramp"
    },
    "resampling": {
      "type": "enum",
      "values": {
        "linear": {},
        "nearest": {}
      },
      "default": "linear",
      "expression": {
        "interpolated": false,
        "parameters": ["zoom"]
      },
      "property-type": "data-constant"
    }
  },
  paint_background: {
    "background-color": {
      "type": "color",
      "default": "#000000",
      "transition": true,
      "requires": [{ "!": "background-pattern" }],
      "expression": {
        "interpolated": true,
        "parameters": ["zoom"]
      },
      "property-type": "data-constant"
    },
    "background-pattern": {
      "type": "resolvedImage",
      "transition": true,
      "expression": {
        "interpolated": false,
        "parameters": ["zoom"]
      },
      "property-type": "cross-faded"
    },
    "background-opacity": {
      "type": "number",
      "default": 1,
      "minimum": 0,
      "maximum": 1,
      "transition": true,
      "expression": {
        "interpolated": true,
        "parameters": ["zoom"]
      },
      "property-type": "data-constant"
    }
  },
  transition: {
    "duration": {
      "type": "number",
      "default": 300,
      "minimum": 0,
      "units": "milliseconds"
    },
    "delay": {
      "type": "number",
      "default": 0,
      "minimum": 0,
      "units": "milliseconds"
    }
  },
  "property-type": {
    "data-driven": { "type": "property-type" },
    "cross-faded": { "type": "property-type" },
    "cross-faded-data-driven": { "type": "property-type" },
    "color-ramp": { "type": "property-type" },
    "data-constant": { "type": "property-type" },
    "constant": { "type": "property-type" }
  },
  promoteId: { "*": { "type": "string" } },
  interpolation: {
    "type": "array",
    "value": "interpolation_name",
    "minimum": 1
  },
  interpolation_name: {
    "type": "enum",
    "values": {
      "linear": { "syntax": {
        "overloads": [{
          "parameters": [],
          "output-type": "interpolation"
        }],
        "parameters": []
      } },
      "exponential": { "syntax": {
        "overloads": [{
          "parameters": ["base"],
          "output-type": "interpolation"
        }],
        "parameters": [{
          "name": "base",
          "type": "number literal"
        }]
      } },
      "cubic-bezier": { "syntax": {
        "overloads": [{
          "parameters": [
            "x1",
            "y1",
            "x2",
            "y2"
          ],
          "output-type": "interpolation"
        }],
        "parameters": [
          {
            "name": "x1",
            "type": "number literal"
          },
          {
            "name": "y1",
            "type": "number literal"
          },
          {
            "name": "x2",
            "type": "number literal"
          },
          {
            "name": "y2",
            "type": "number literal"
          }
        ]
      } }
    }
  }
};

// node_modules/@maplibre/maplibre-gl-style-spec/dist/reference/latest.mjs
var latest = v8_default;

// node_modules/@maplibre/maplibre-gl-style-spec/dist/util/ref_properties.mjs
var refProperties = [
  "type",
  "source",
  "source-layer",
  "minzoom",
  "maxzoom",
  "filter",
  "layout"
];

// node_modules/@maplibre/maplibre-gl-style-spec/dist/deref.mjs
function deref(layer, parent) {
  const result = {};
  for (const k in layer) if (k !== "ref") result[k] = layer[k];
  refProperties.forEach((k) => {
    if (k in parent) result[k] = parent[k];
  });
  return result;
}
function derefLayers(layers) {
  layers = layers.slice();
  const map = /* @__PURE__ */ Object.create(null);
  for (let i = 0; i < layers.length; i++) map[layers[i].id] = layers[i];
  for (let i = 0; i < layers.length; i++) if ("ref" in layers[i]) layers[i] = deref(layers[i], map[layers[i].ref]);
  return layers;
}

// node_modules/@maplibre/maplibre-gl-style-spec/dist/expression/types.mjs
var NullType = { kind: "null" };
var NumberType = { kind: "number" };
var StringType = { kind: "string" };
var BooleanType = { kind: "boolean" };
var ColorType = { kind: "color" };
var ProjectionDefinitionType = { kind: "projectionDefinition" };
var ObjectType = { kind: "object" };
var ValueType = { kind: "value" };
var ErrorType = { kind: "error" };
var CollatorType = { kind: "collator" };
var FormattedType = { kind: "formatted" };
var PaddingType = { kind: "padding" };
var ColorArrayType = { kind: "colorArray" };
var NumberArrayType = { kind: "numberArray" };
var ResolvedImageType = { kind: "resolvedImage" };
var VariableAnchorOffsetCollectionType = { kind: "variableAnchorOffsetCollection" };
function array(itemType, N) {
  return {
    kind: "array",
    itemType,
    N
  };
}
function typeToString(type) {
  if (type.kind === "array") {
    const itemType = typeToString(type.itemType);
    return typeof type.N === "number" ? `array<${itemType}, ${type.N}>` : type.itemType.kind === "value" ? "array" : `array<${itemType}>`;
  } else return type.kind;
}
var valueMemberTypes = [
  NullType,
  NumberType,
  StringType,
  BooleanType,
  ColorType,
  ProjectionDefinitionType,
  FormattedType,
  ObjectType,
  array(ValueType),
  PaddingType,
  NumberArrayType,
  ColorArrayType,
  ResolvedImageType,
  VariableAnchorOffsetCollectionType
];
function checkSubtype(expected, t) {
  if (t.kind === "error") return null;
  else if (expected.kind === "array") {
    if (t.kind === "array" && (t.N === 0 && t.itemType.kind === "value" || !checkSubtype(expected.itemType, t.itemType)) && (typeof expected.N !== "number" || expected.N === t.N)) return null;
  } else if (expected.kind === t.kind) return null;
  else if (expected.kind === "value") {
    for (const memberType of valueMemberTypes) if (!checkSubtype(memberType, t)) return null;
  }
  return `Expected ${typeToString(expected)} but found ${typeToString(t)} instead.`;
}
function isValidType(provided, allowedTypes) {
  return allowedTypes.some((t) => t.kind === provided.kind);
}
function isValidNativeType(provided, allowedTypes) {
  return allowedTypes.some((t) => {
    if (t === "null") return provided === null;
    else if (t === "array") return Array.isArray(provided);
    else if (t === "object") return provided && !Array.isArray(provided) && typeof provided === "object";
    else return t === typeof provided;
  });
}
function verifyType(provided, sample) {
  if (provided.kind === "array" && sample.kind === "array") return provided.itemType.kind === sample.itemType.kind && typeof provided.N === "number";
  return provided.kind === sample.kind;
}

// node_modules/@maplibre/maplibre-gl-style-spec/dist/expression/types/color_spaces.mjs
var Xn = 0.96422;
var Yn = 1;
var Zn = 0.82521;
var t0 = 4 / 29;
var t1 = 6 / 29;
var t2 = 3 * t1 * t1;
var t3 = t1 * t1 * t1;
var deg2rad = Math.PI / 180;
var rad2deg = 180 / Math.PI;
function constrainAngle(angle) {
  angle = angle % 360;
  if (angle < 0) angle += 360;
  return angle;
}
function rgbToLab([r, g, b, alpha]) {
  r = rgb2xyz(r);
  g = rgb2xyz(g);
  b = rgb2xyz(b);
  let x, z;
  const y = xyz2lab((0.2225045 * r + 0.7168786 * g + 0.0606169 * b) / Yn);
  if (r === g && g === b) x = z = y;
  else {
    x = xyz2lab((0.4360747 * r + 0.3850649 * g + 0.1430804 * b) / Xn);
    z = xyz2lab((0.0139322 * r + 0.0971045 * g + 0.7141733 * b) / Zn);
  }
  const l = 116 * y - 16;
  return [
    l < 0 ? 0 : l,
    500 * (x - y),
    200 * (y - z),
    alpha
  ];
}
function rgb2xyz(x) {
  return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
}
function xyz2lab(t) {
  return t > t3 ? Math.pow(t, 1 / 3) : t / t2 + t0;
}
function labToRgb([l, a, b, alpha]) {
  let y = (l + 16) / 116, x = isNaN(a) ? y : y + a / 500, z = isNaN(b) ? y : y - b / 200;
  y = Yn * lab2xyz(y);
  x = Xn * lab2xyz(x);
  z = Zn * lab2xyz(z);
  return [
    xyz2rgb(3.1338561 * x - 1.6168667 * y - 0.4906146 * z),
    xyz2rgb(-0.9787684 * x + 1.9161415 * y + 0.033454 * z),
    xyz2rgb(0.0719453 * x - 0.2289914 * y + 1.4052427 * z),
    alpha
  ];
}
function xyz2rgb(x) {
  x = x <= 304e-5 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
function lab2xyz(t) {
  return t > t1 ? t * t * t : t2 * (t - t0);
}
function rgbToHcl(rgbColor) {
  const [l, a, b, alpha] = rgbToLab(rgbColor);
  const c = Math.sqrt(a * a + b * b);
  return [
    Math.round(c * 1e4) ? constrainAngle(Math.atan2(b, a) * rad2deg) : NaN,
    c,
    l,
    alpha
  ];
}
function hclToRgb([h, c, l, alpha]) {
  h = isNaN(h) ? 0 : h * deg2rad;
  return labToRgb([
    l,
    Math.cos(h) * c,
    Math.sin(h) * c,
    alpha
  ]);
}
function hslToRgb([h, s, l, alpha]) {
  h = constrainAngle(h);
  s /= 100;
  l /= 100;
  function f(n) {
    const k = (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  }
  return [
    f(0),
    f(8),
    f(4),
    alpha
  ];
}

// node_modules/@maplibre/maplibre-gl-style-spec/dist/util/get_own.mjs
var hasOwnProperty = Object.hasOwn || function hasOwnProperty2(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
};
function getOwn(object, key) {
  return hasOwnProperty(object, key) ? object[key] : void 0;
}

// node_modules/@maplibre/maplibre-gl-style-spec/dist/expression/types/parse_css_color.mjs
function parseCssColor(input) {
  input = input.toLowerCase().trim();
  if (input === "transparent") return [
    0,
    0,
    0,
    0
  ];
  const namedColorsMatch = getOwn(namedColors, input);
  if (namedColorsMatch) {
    const [r, g, b] = namedColorsMatch;
    return [
      r / 255,
      g / 255,
      b / 255,
      1
    ];
  }
  if (input.startsWith("#")) {
    if (/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.test(input)) {
      const step = input.length < 6 ? 1 : 2;
      let i = 1;
      return [
        parseHex(input.slice(i, i += step)),
        parseHex(input.slice(i, i += step)),
        parseHex(input.slice(i, i += step)),
        parseHex(input.slice(i, i + step) || "ff")
      ];
    }
  }
  if (input.startsWith("rgb")) {
    const rgbMatch = input.match(/^rgba?\(\s*([\de.+-]+)(%)?(?:\s+|\s*(,)\s*)([\de.+-]+)(%)?(?:\s+|\s*(,)\s*)([\de.+-]+)(%)?(?:\s*([,\/])\s*([\de.+-]+)(%)?)?\s*\)$/);
    if (rgbMatch) {
      const [_, r, rp, f1, g, gp, f2, b, bp, f3, a, ap] = rgbMatch;
      const argFormat = [
        f1 || " ",
        f2 || " ",
        f3
      ].join("");
      if (argFormat === "  " || argFormat === "  /" || argFormat === ",," || argFormat === ",,,") {
        const valFormat = [
          rp,
          gp,
          bp
        ].join("");
        const maxValue = valFormat === "%%%" ? 100 : valFormat === "" ? 255 : 0;
        if (maxValue) {
          const rgba2 = [
            clamp(+r / maxValue, 0, 1),
            clamp(+g / maxValue, 0, 1),
            clamp(+b / maxValue, 0, 1),
            a ? parseAlpha(+a, ap) : 1
          ];
          if (validateNumbers(rgba2)) return rgba2;
        }
      }
      return;
    }
  }
  const hslMatch = input.match(/^hsla?\(\s*([\de.+-]+)(?:deg)?(?:\s+|\s*(,)\s*)([\de.+-]+)%(?:\s+|\s*(,)\s*)([\de.+-]+)%(?:\s*([,\/])\s*([\de.+-]+)(%)?)?\s*\)$/);
  if (hslMatch) {
    const [_, h, f1, s, f2, l, f3, a, ap] = hslMatch;
    const argFormat = [
      f1 || " ",
      f2 || " ",
      f3
    ].join("");
    if (argFormat === "  " || argFormat === "  /" || argFormat === ",," || argFormat === ",,,") {
      const hsla2 = [
        +h,
        clamp(+s, 0, 100),
        clamp(+l, 0, 100),
        a ? parseAlpha(+a, ap) : 1
      ];
      if (validateNumbers(hsla2)) return hslToRgb(hsla2);
    }
  }
}
function parseHex(hex) {
  return parseInt(hex.padEnd(2, hex), 16) / 255;
}
function parseAlpha(a, asPercentage) {
  return clamp(asPercentage ? a / 100 : a, 0, 1);
}
function clamp(n, min, max) {
  return Math.min(Math.max(min, n), max);
}
function validateNumbers(array2) {
  return !array2.some(Number.isNaN);
}
var namedColors = {
  aliceblue: [
    240,
    248,
    255
  ],
  antiquewhite: [
    250,
    235,
    215
  ],
  aqua: [
    0,
    255,
    255
  ],
  aquamarine: [
    127,
    255,
    212
  ],
  azure: [
    240,
    255,
    255
  ],
  beige: [
    245,
    245,
    220
  ],
  bisque: [
    255,
    228,
    196
  ],
  black: [
    0,
    0,
    0
  ],
  blanchedalmond: [
    255,
    235,
    205
  ],
  blue: [
    0,
    0,
    255
  ],
  blueviolet: [
    138,
    43,
    226
  ],
  brown: [
    165,
    42,
    42
  ],
  burlywood: [
    222,
    184,
    135
  ],
  cadetblue: [
    95,
    158,
    160
  ],
  chartreuse: [
    127,
    255,
    0
  ],
  chocolate: [
    210,
    105,
    30
  ],
  coral: [
    255,
    127,
    80
  ],
  cornflowerblue: [
    100,
    149,
    237
  ],
  cornsilk: [
    255,
    248,
    220
  ],
  crimson: [
    220,
    20,
    60
  ],
  cyan: [
    0,
    255,
    255
  ],
  darkblue: [
    0,
    0,
    139
  ],
  darkcyan: [
    0,
    139,
    139
  ],
  darkgoldenrod: [
    184,
    134,
    11
  ],
  darkgray: [
    169,
    169,
    169
  ],
  darkgreen: [
    0,
    100,
    0
  ],
  darkgrey: [
    169,
    169,
    169
  ],
  darkkhaki: [
    189,
    183,
    107
  ],
  darkmagenta: [
    139,
    0,
    139
  ],
  darkolivegreen: [
    85,
    107,
    47
  ],
  darkorange: [
    255,
    140,
    0
  ],
  darkorchid: [
    153,
    50,
    204
  ],
  darkred: [
    139,
    0,
    0
  ],
  darksalmon: [
    233,
    150,
    122
  ],
  darkseagreen: [
    143,
    188,
    143
  ],
  darkslateblue: [
    72,
    61,
    139
  ],
  darkslategray: [
    47,
    79,
    79
  ],
  darkslategrey: [
    47,
    79,
    79
  ],
  darkturquoise: [
    0,
    206,
    209
  ],
  darkviolet: [
    148,
    0,
    211
  ],
  deeppink: [
    255,
    20,
    147
  ],
  deepskyblue: [
    0,
    191,
    255
  ],
  dimgray: [
    105,
    105,
    105
  ],
  dimgrey: [
    105,
    105,
    105
  ],
  dodgerblue: [
    30,
    144,
    255
  ],
  firebrick: [
    178,
    34,
    34
  ],
  floralwhite: [
    255,
    250,
    240
  ],
  forestgreen: [
    34,
    139,
    34
  ],
  fuchsia: [
    255,
    0,
    255
  ],
  gainsboro: [
    220,
    220,
    220
  ],
  ghostwhite: [
    248,
    248,
    255
  ],
  gold: [
    255,
    215,
    0
  ],
  goldenrod: [
    218,
    165,
    32
  ],
  gray: [
    128,
    128,
    128
  ],
  green: [
    0,
    128,
    0
  ],
  greenyellow: [
    173,
    255,
    47
  ],
  grey: [
    128,
    128,
    128
  ],
  honeydew: [
    240,
    255,
    240
  ],
  hotpink: [
    255,
    105,
    180
  ],
  indianred: [
    205,
    92,
    92
  ],
  indigo: [
    75,
    0,
    130
  ],
  ivory: [
    255,
    255,
    240
  ],
  khaki: [
    240,
    230,
    140
  ],
  lavender: [
    230,
    230,
    250
  ],
  lavenderblush: [
    255,
    240,
    245
  ],
  lawngreen: [
    124,
    252,
    0
  ],
  lemonchiffon: [
    255,
    250,
    205
  ],
  lightblue: [
    173,
    216,
    230
  ],
  lightcoral: [
    240,
    128,
    128
  ],
  lightcyan: [
    224,
    255,
    255
  ],
  lightgoldenrodyellow: [
    250,
    250,
    210
  ],
  lightgray: [
    211,
    211,
    211
  ],
  lightgreen: [
    144,
    238,
    144
  ],
  lightgrey: [
    211,
    211,
    211
  ],
  lightpink: [
    255,
    182,
    193
  ],
  lightsalmon: [
    255,
    160,
    122
  ],
  lightseagreen: [
    32,
    178,
    170
  ],
  lightskyblue: [
    135,
    206,
    250
  ],
  lightslategray: [
    119,
    136,
    153
  ],
  lightslategrey: [
    119,
    136,
    153
  ],
  lightsteelblue: [
    176,
    196,
    222
  ],
  lightyellow: [
    255,
    255,
    224
  ],
  lime: [
    0,
    255,
    0
  ],
  limegreen: [
    50,
    205,
    50
  ],
  linen: [
    250,
    240,
    230
  ],
  magenta: [
    255,
    0,
    255
  ],
  maroon: [
    128,
    0,
    0
  ],
  mediumaquamarine: [
    102,
    205,
    170
  ],
  mediumblue: [
    0,
    0,
    205
  ],
  mediumorchid: [
    186,
    85,
    211
  ],
  mediumpurple: [
    147,
    112,
    219
  ],
  mediumseagreen: [
    60,
    179,
    113
  ],
  mediumslateblue: [
    123,
    104,
    238
  ],
  mediumspringgreen: [
    0,
    250,
    154
  ],
  mediumturquoise: [
    72,
    209,
    204
  ],
  mediumvioletred: [
    199,
    21,
    133
  ],
  midnightblue: [
    25,
    25,
    112
  ],
  mintcream: [
    245,
    255,
    250
  ],
  mistyrose: [
    255,
    228,
    225
  ],
  moccasin: [
    255,
    228,
    181
  ],
  navajowhite: [
    255,
    222,
    173
  ],
  navy: [
    0,
    0,
    128
  ],
  oldlace: [
    253,
    245,
    230
  ],
  olive: [
    128,
    128,
    0
  ],
  olivedrab: [
    107,
    142,
    35
  ],
  orange: [
    255,
    165,
    0
  ],
  orangered: [
    255,
    69,
    0
  ],
  orchid: [
    218,
    112,
    214
  ],
  palegoldenrod: [
    238,
    232,
    170
  ],
  palegreen: [
    152,
    251,
    152
  ],
  paleturquoise: [
    175,
    238,
    238
  ],
  palevioletred: [
    219,
    112,
    147
  ],
  papayawhip: [
    255,
    239,
    213
  ],
  peachpuff: [
    255,
    218,
    185
  ],
  peru: [
    205,
    133,
    63
  ],
  pink: [
    255,
    192,
    203
  ],
  plum: [
    221,
    160,
    221
  ],
  powderblue: [
    176,
    224,
    230
  ],
  purple: [
    128,
    0,
    128
  ],
  rebeccapurple: [
    102,
    51,
    153
  ],
  red: [
    255,
    0,
    0
  ],
  rosybrown: [
    188,
    143,
    143
  ],
  royalblue: [
    65,
    105,
    225
  ],
  saddlebrown: [
    139,
    69,
    19
  ],
  salmon: [
    250,
    128,
    114
  ],
  sandybrown: [
    244,
    164,
    96
  ],
  seagreen: [
    46,
    139,
    87
  ],
  seashell: [
    255,
    245,
    238
  ],
  sienna: [
    160,
    82,
    45
  ],
  silver: [
    192,
    192,
    192
  ],
  skyblue: [
    135,
    206,
    235
  ],
  slateblue: [
    106,
    90,
    205
  ],
  slategray: [
    112,
    128,
    144
  ],
  slategrey: [
    112,
    128,
    144
  ],
  snow: [
    255,
    250,
    250
  ],
  springgreen: [
    0,
    255,
    127
  ],
  steelblue: [
    70,
    130,
    180
  ],
  tan: [
    210,
    180,
    140
  ],
  teal: [
    0,
    128,
    128
  ],
  thistle: [
    216,
    191,
    216
  ],
  tomato: [
    255,
    99,
    71
  ],
  turquoise: [
    64,
    224,
    208
  ],
  violet: [
    238,
    130,
    238
  ],
  wheat: [
    245,
    222,
    179
  ],
  white: [
    255,
    255,
    255
  ],
  whitesmoke: [
    245,
    245,
    245
  ],
  yellow: [
    255,
    255,
    0
  ],
  yellowgreen: [
    154,
    205,
    50
  ]
};

// node_modules/@maplibre/maplibre-gl-style-spec/dist/util/interpolate-primitives.mjs
function interpolateNumber(from, to, t) {
  return from + t * (to - from);
}
function interpolateArray(from, to, t) {
  return from.map((d, i) => {
    return interpolateNumber(d, to[i], t);
  });
}

// node_modules/@maplibre/maplibre-gl-style-spec/dist/expression/types/color.mjs
var _a;
var Color = (_a = class {
  /**
  * @param r Red component premultiplied by `alpha` 0..1
  * @param g Green component premultiplied by `alpha` 0..1
  * @param b Blue component premultiplied by `alpha` 0..1
  * @param [alpha=1] Alpha component 0..1
  * @param [premultiplied=true] Whether the `r`, `g` and `b` values have already
  * been multiplied by alpha. If `true` nothing happens if `false` then they will
  * be multiplied automatically.
  */
  constructor(r, g, b, alpha = 1, premultiplied = true) {
    this.r = r;
    this.g = g;
    this.b = b;
    this.a = alpha;
    if (!premultiplied) {
      this.r *= alpha;
      this.g *= alpha;
      this.b *= alpha;
      if (!alpha) this.overwriteGetter("rgb", [
        r,
        g,
        b,
        alpha
      ]);
    }
  }
  /**
  * Parses CSS color strings and converts colors to sRGB color space if needed.
  * Officially supported color formats:
  * - keyword, e.g. 'aquamarine' or 'steelblue'
  * - hex (with 3, 4, 6 or 8 digits), e.g. '#f0f' or '#e9bebea9'
  * - rgb and rgba, e.g. 'rgb(0,240,120)' or 'rgba(0%,94%,47%,0.1)' or 'rgb(0 240 120 / .3)'
  * - hsl and hsla, e.g. 'hsl(0,0%,83%)' or 'hsla(0,0%,83%,.5)' or 'hsl(0 0% 83% / 20%)'
  *
  * @param input CSS color string to parse.
  * @returns A `Color` instance, or `undefined` if the input is not a valid color string.
  */
  static parse(input) {
    if (input instanceof _a) return input;
    if (typeof input !== "string") return;
    const rgba2 = parseCssColor(input);
    if (rgba2) return new _a(...rgba2, false);
  }
  /**
  * Used in color interpolation and by 'to-rgba' expression.
  *
  * @returns Gien color, with reversed alpha blending, in sRGB color space.
  */
  get rgb() {
    const { r, g, b, a } = this;
    const f = a || Infinity;
    return this.overwriteGetter("rgb", [
      r / f,
      g / f,
      b / f,
      a
    ]);
  }
  /**
  * Used in color interpolation.
  *
  * @returns Gien color, with reversed alpha blending, in HCL color space.
  */
  get hcl() {
    return this.overwriteGetter("hcl", rgbToHcl(this.rgb));
  }
  /**
  * Used in color interpolation.
  *
  * @returns Gien color, with reversed alpha blending, in LAB color space.
  */
  get lab() {
    return this.overwriteGetter("lab", rgbToLab(this.rgb));
  }
  /**
  * Lazy getter pattern. When getter is called for the first time lazy value
  * is calculated and then overwrites getter function in given object instance.
  *
  * @example:
  * const redColor = Color.parse('red');
  * let x = redColor.hcl; // this will invoke `get hcl()`, which will calculate
  * // the value of red in HCL space and invoke this `overwriteGetter` function
  * // which in turn will set a field with a key 'hcl' in the `redColor` object.
  * // In other words it will override `get hcl()` from its `Color` prototype
  * // with its own property: hcl = [calculated red value in hcl].
  * let y = redColor.hcl; // next call will no longer invoke getter but simply
  * // return the previously calculated value
  * x === y; // true - `x` is exactly the same object as `y`
  *
  * @param getterKey Getter key
  * @param lazyValue Lazily calculated value to be memoized by current instance
  * @private
  */
  overwriteGetter(getterKey, lazyValue) {
    Object.defineProperty(this, getterKey, { value: lazyValue });
    return lazyValue;
  }
  /**
  * Used by 'to-string' expression.
  *
  * @returns Serialized color in format `rgba(r,g,b,a)`
  * where r,g,b are numbers within 0..255 and alpha is number within 1..0
  *
  * @example
  * var purple = new Color.parse('purple');
  * purple.toString; // = "rgba(128,0,128,1)"
  * var translucentGreen = new Color.parse('rgba(26, 207, 26, .73)');
  * translucentGreen.toString(); // = "rgba(26,207,26,0.73)"
  */
  toString() {
    const [r, g, b, a] = this.rgb;
    return `rgba(${[
      r,
      g,
      b
    ].map((n) => Math.round(n * 255)).join(",")},${a})`;
  }
  static interpolate(from, to, t, spaceKey = "rgb") {
    switch (spaceKey) {
      case "rgb": {
        const [r, g, b, alpha] = interpolateArray(from.rgb, to.rgb, t);
        return new _a(r, g, b, alpha, false);
      }
      case "hcl": {
        const [hue0, chroma0, light0, alphaF] = from.hcl;
        const [hue1, chroma1, light1, alphaT] = to.hcl;
        let hue, chroma;
        if (!isNaN(hue0) && !isNaN(hue1)) {
          let dh = hue1 - hue0;
          if (hue1 > hue0 && dh > 180) dh -= 360;
          else if (hue1 < hue0 && hue0 - hue1 > 180) dh += 360;
          hue = hue0 + t * dh;
        } else if (!isNaN(hue0)) {
          hue = hue0;
          if (light1 === 1 || light1 === 0) chroma = chroma0;
        } else if (!isNaN(hue1)) {
          hue = hue1;
          if (light0 === 1 || light0 === 0) chroma = chroma1;
        } else hue = NaN;
        const [r, g, b, alpha] = hclToRgb([
          hue,
          chroma ?? interpolateNumber(chroma0, chroma1, t),
          interpolateNumber(light0, light1, t),
          interpolateNumber(alphaF, alphaT, t)
        ]);
        return new _a(r, g, b, alpha, false);
      }
      case "lab": {
        const [r, g, b, alpha] = labToRgb(interpolateArray(from.lab, to.lab, t));
        return new _a(r, g, b, alpha, false);
      }
    }
  }
}, _a.black = new _a(0, 0, 0, 1), _a.white = new _a(1, 1, 1, 1), _a.transparent = new _a(0, 0, 0, 0), _a.red = new _a(1, 0, 0, 1), _a);

// node_modules/@maplibre/maplibre-gl-style-spec/dist/expression/types/formatted.mjs
var VERTICAL_ALIGN_OPTIONS = [
  "bottom",
  "center",
  "top"
];
var FormattedSection = class {
  constructor(text, image, scale, fontStack, textColor, verticalAlign) {
    this.text = text;
    this.image = image;
    this.scale = scale;
    this.fontStack = fontStack;
    this.textColor = textColor;
    this.verticalAlign = verticalAlign;
  }
};
var Formatted = class Formatted2 {
  constructor(sections) {
    this.sections = sections;
  }
  static fromString(unformatted) {
    return new Formatted2([new FormattedSection(unformatted, null, null, null, null, null)]);
  }
  isEmpty() {
    if (this.sections.length === 0) return true;
    return !this.sections.some((section) => section.text.length !== 0 || section.image && section.image.name.length !== 0);
  }
  static factory(text) {
    if (text instanceof Formatted2) return text;
    else return Formatted2.fromString(text);
  }
  toString() {
    if (this.sections.length === 0) return "";
    return this.sections.map((section) => section.text).join("");
  }
};

// node_modules/@maplibre/maplibre-gl-style-spec/dist/expression/types/padding.mjs
var Padding = class Padding2 {
  constructor(values) {
    this.values = values.slice();
  }
  /**
  * Numeric padding values
  * @param input A padding value
  * @returns A `Padding` instance, or `undefined` if the input is not a valid padding value.
  */
  static parse(input) {
    if (input instanceof Padding2) return input;
    if (typeof input === "number") return new Padding2([
      input,
      input,
      input,
      input
    ]);
    if (!Array.isArray(input)) return;
    if (input.length < 1 || input.length > 4) return;
    for (const val of input) if (typeof val !== "number") return;
    switch (input.length) {
      case 1:
        input = [
          input[0],
          input[0],
          input[0],
          input[0]
        ];
        break;
      case 2:
        input = [
          input[0],
          input[1],
          input[0],
          input[1]
        ];
        break;
      case 3:
        input = [
          input[0],
          input[1],
          input[2],
          input[1]
        ];
    }
    return new Padding2(input);
  }
  toString() {
    return JSON.stringify(this.values);
  }
  static interpolate(from, to, t) {
    return new Padding2(interpolateArray(from.values, to.values, t));
  }
};

// node_modules/@maplibre/maplibre-gl-style-spec/dist/expression/types/number_array.mjs
var NumberArray = class NumberArray2 {
  constructor(values) {
    this.values = values.slice();
  }
  /**
  * Numeric NumberArray values
  * @param input A NumberArray value
  * @returns A `NumberArray` instance, or `undefined` if the input is not a valid NumberArray value.
  */
  static parse(input) {
    if (input instanceof NumberArray2) return input;
    if (typeof input === "number") return new NumberArray2([input]);
    if (!Array.isArray(input)) return;
    for (const val of input) if (typeof val !== "number") return;
    return new NumberArray2(input);
  }
  toString() {
    return JSON.stringify(this.values);
  }
  static interpolate(from, to, t) {
    return new NumberArray2(interpolateArray(from.values, to.values, t));
  }
};

// node_modules/@maplibre/maplibre-gl-style-spec/dist/expression/types/color_array.mjs
var ColorArray = class ColorArray2 {
  constructor(values) {
    this.values = values.slice();
  }
  /**
  * ColorArray values
  * @param input A ColorArray value
  * @returns A `ColorArray` instance, or `undefined` if the input is not a valid ColorArray value.
  */
  static parse(input) {
    if (input instanceof ColorArray2) return input;
    if (typeof input === "string") {
      const parsed_val = Color.parse(input);
      if (!parsed_val) return;
      return new ColorArray2([parsed_val]);
    }
    if (!Array.isArray(input)) return;
    const colors = [];
    for (const val of input) {
      if (typeof val !== "string") return;
      const parsed_val = Color.parse(val);
      if (!parsed_val) return;
      colors.push(parsed_val);
    }
    return new ColorArray2(colors);
  }
  toString() {
    return JSON.stringify(this.values);
  }
  static interpolate(from, to, t, spaceKey = "rgb") {
    const colors = [];
    if (from.values.length != to.values.length) throw new Error(`colorArray: Arrays have mismatched length (${from.values.length} vs. ${to.values.length}), cannot interpolate.`);
    for (let i = 0; i < from.values.length; i++) colors.push(Color.interpolate(from.values[i], to.values[i], t, spaceKey));
    return new ColorArray2(colors);
  }
};

// node_modules/@maplibre/maplibre-gl-style-spec/dist/expression/runtime_error.mjs
var RuntimeError = class extends Error {
  constructor(message, path) {
    super(message);
    this.name = "RuntimeError";
    this.path = path;
  }
  toJSON() {
    return this.message;
  }
};

// node_modules/@maplibre/maplibre-gl-style-spec/dist/expression/types/variable_anchor_offset_collection.mjs
var anchors = /* @__PURE__ */ new Set([
  "center",
  "left",
  "right",
  "top",
  "bottom",
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right"
]);
var VariableAnchorOffsetCollection = class VariableAnchorOffsetCollection2 {
  constructor(values) {
    this.values = values.slice();
  }
  static parse(input) {
    if (input instanceof VariableAnchorOffsetCollection2) return input;
    if (!Array.isArray(input) || input.length < 1 || input.length % 2 !== 0) return;
    for (let i = 0; i < input.length; i += 2) {
      const anchorValue = input[i];
      const offsetValue = input[i + 1];
      if (typeof anchorValue !== "string" || !anchors.has(anchorValue)) return;
      if (!Array.isArray(offsetValue) || offsetValue.length !== 2 || typeof offsetValue[0] !== "number" || typeof offsetValue[1] !== "number") return;
    }
    return new VariableAnchorOffsetCollection2(input);
  }
  toString() {
    return JSON.stringify(this.values);
  }
  static interpolate(from, to, t, key) {
    const fromValues = from.values;
    const toValues = to.values;
    if (fromValues.length !== toValues.length) throw new RuntimeError(`Cannot interpolate values of different length. from: ${from.toString()}, to: ${to.toString()}`, key);
    const output = [];
    for (let i = 0; i < fromValues.length; i += 2) {
      if (fromValues[i] !== toValues[i]) throw new RuntimeError(`Cannot interpolate values containing mismatched anchors. from[${i}]: ${fromValues[i]}, to[${i}]: ${toValues[i]}`, key);
      output.push(fromValues[i]);
      const [fx, fy] = fromValues[i + 1];
      const [tx, ty] = toValues[i + 1];
      output.push([interpolateNumber(fx, tx, t), interpolateNumber(fy, ty, t)]);
    }
    return new VariableAnchorOffsetCollection2(output);
  }
};

// node_modules/@maplibre/maplibre-gl-style-spec/dist/expression/types/resolved_image.mjs
var ResolvedImage = class ResolvedImage2 {
  constructor(options) {
    this.name = options.name;
    this.available = options.available;
  }
  toString() {
    return this.name;
  }
  static fromString(name) {
    if (!name) return null;
    return new ResolvedImage2({
      name,
      available: false
    });
  }
};

// node_modules/@maplibre/maplibre-gl-style-spec/dist/expression/types/projection_definition.mjs
var ProjectionDefinition = class ProjectionDefinition2 {
  constructor(from, to, transition) {
    this.from = from;
    this.to = to;
    this.transition = transition;
  }
  toString() {
    if (this.from === this.to && this.transition === 1) return this.from;
    return JSON.stringify([
      this.from,
      this.to,
      this.transition
    ]);
  }
  static interpolate(from, to, t) {
    return new ProjectionDefinition2(from, to, t);
  }
  static parse(input) {
    if (input instanceof ProjectionDefinition2) return input;
    if (Array.isArray(input) && input.length === 3 && typeof input[0] === "string" && typeof input[1] === "string" && typeof input[2] === "number") return new ProjectionDefinition2(input[0], input[1], input[2]);
    if (typeof input === "object" && typeof input.from === "string" && typeof input.to === "string" && typeof input.transition === "number") return new ProjectionDefinition2(input.from, input.to, input.transition);
    if (typeof input === "string") return new ProjectionDefinition2(input, input, 1);
  }
};

// node_modules/@maplibre/maplibre-gl-style-spec/dist/expression/types/collator.mjs
var Collator = class {
  constructor(caseSensitive, diacriticSensitive, locale) {
    if (caseSensitive) this.sensitivity = diacriticSensitive ? "variant" : "case";
    else this.sensitivity = diacriticSensitive ? "accent" : "base";
    this.locale = locale;
    this.collator = new Intl.Collator(this.locale ? this.locale : [], {
      sensitivity: this.sensitivity,
      usage: "search"
    });
  }
  compare(lhs, rhs) {
    return this.collator.compare(lhs, rhs);
  }
  resolvedLocale() {
    return new Intl.Collator(this.locale ? this.locale : []).resolvedOptions().locale;
  }
};

// node_modules/@maplibre/maplibre-gl-style-spec/dist/expression/values.mjs
function validateRGBA(r, g, b, a) {
  if (!(typeof r === "number" && r >= 0 && r <= 255 && typeof g === "number" && g >= 0 && g <= 255 && typeof b === "number" && b >= 0 && b <= 255)) return `Invalid rgba value [${(typeof a === "number" ? [
    r,
    g,
    b,
    a
  ] : [
    r,
    g,
    b
  ]).join(", ")}]: 'r', 'g', and 'b' must be between 0 and 255.`;
  if (!(typeof a === "undefined" || typeof a === "number" && a >= 0 && a <= 1)) return `Invalid rgba value [${[
    r,
    g,
    b,
    a
  ].join(", ")}]: 'a' must be between 0 and 1.`;
  return null;
}
function isValue(mixed) {
  if (mixed === null || typeof mixed === "string" || typeof mixed === "boolean" || typeof mixed === "number" || mixed instanceof ProjectionDefinition || mixed instanceof Color || mixed instanceof Collator || mixed instanceof Formatted || mixed instanceof Padding || mixed instanceof NumberArray || mixed instanceof ColorArray || mixed instanceof VariableAnchorOffsetCollection || mixed instanceof ResolvedImage) return true;
  else if (Array.isArray(mixed)) {
    for (const item of mixed) if (!isValue(item)) return false;
    return true;
  } else if (typeof mixed === "object") {
    for (const key in mixed) if (!isValue(mixed[key])) return false;
    return true;
  } else return false;
}
function typeOf(value) {
  if (value === null) return NullType;
  else if (typeof value === "string") return StringType;
  else if (typeof value === "boolean") return BooleanType;
  else if (typeof value === "number") return NumberType;
  else if (value instanceof Color) return ColorType;
  else if (value instanceof ProjectionDefinition) return ProjectionDefinitionType;
  else if (value instanceof Collator) return CollatorType;
  else if (value instanceof Formatted) return FormattedType;
  else if (value instanceof Padding) return PaddingType;
  else if (value instanceof NumberArray) return NumberArrayType;
  else if (value instanceof ColorArray) return ColorArrayType;
  else if (value instanceof VariableAnchorOffsetCollection) return VariableAnchorOffsetCollectionType;
  else if (value instanceof ResolvedImage) return ResolvedImageType;
  else if (Array.isArray(value)) {
    const length = value.length;
    let itemType;
    for (const item of value) {
      const t = typeOf(item);
      if (!itemType) itemType = t;
      else if (itemType === t) continue;
      else {
        itemType = ValueType;
        break;
      }
    }
    return array(itemType || ValueType, length);
  } else return ObjectType;
}
function valueToString(value) {
  const type = typeof value;
  if (value === null) return "";
  else if (type === "string" || type === "number" || type === "boolean") return String(value);
  else if (value instanceof Color || value instanceof ProjectionDefinition || value instanceof Formatted || value instanceof Padding || value instanceof NumberArray || value instanceof ColorArray || value instanceof VariableAnchorOffsetCollection || value instanceof ResolvedImage) return value.toString();
  else return JSON.stringify(value);
}

// node_modules/@maplibre/maplibre-gl-style-spec/dist/expression/definitions/literal.mjs
var Literal = class Literal2 {
  constructor(type, value) {
    this.type = type;
    this.value = value;
  }
  static parse(args, context) {
    if (args.length !== 2) return context.error(`'literal' expression requires exactly one argument, but found ${args.length - 1} instead.`);
    if (!isValue(args[1])) return context.error(`invalid value of type "${typeof args[1]}"`);
    const value = args[1];
    let type = typeOf(value);
    const expected = context.expectedType;
    if (type.kind === "array" && type.N === 0 && expected && expected.kind === "array" && (typeof expected.N !== "number" || expected.N === 0)) type = expected;
    return new Literal2(type, value);
  }
  evaluate() {
    return this.value;
  }
  eachChild() {
  }
  outputDefined() {
    return true;
  }
};

// node_modules/@maplibre/maplibre-gl-style-spec/dist/expression/evaluation_context.mjs
var geometryTypes = [
  "Unknown",
  "Point",
  "LineString",
  "Polygon"
];
var EvaluationContext = class {
  constructor() {
    this.globals = null;
    this.feature = null;
    this.featureState = null;
    this.formattedSection = null;
    this._parseColorCache = /* @__PURE__ */ new Map();
    this.availableImages = null;
    this.canonical = null;
  }
  id() {
    return this.feature && "id" in this.feature ? this.feature.id : null;
  }
  geometryType() {
    return this.feature ? typeof this.feature.type === "number" ? geometryTypes[this.feature.type] : this.feature.type : null;
  }
  geometry() {
    return this.feature && "geometry" in this.feature ? this.feature.geometry : null;
  }
  canonicalID() {
    return this.canonical;
  }
  properties() {
    return this.feature && this.feature.properties || {};
  }
  parseColor(input) {
    let cached = this._parseColorCache.get(input);
    if (!cached) {
      cached = Color.parse(input);
      this._parseColorCache.set(input, cached);
    }
    return cached;
  }
};

// node_modules/@maplibre/maplibre-gl-style-spec/dist/expression/stops.mjs
function findStopLessThanOrEqualTo(stops, input, key) {
  const lastIndex = stops.length - 1;
  let lowerIndex = 0;
  let upperIndex = lastIndex;
  let currentIndex = 0;
  let currentValue, nextValue;
  while (lowerIndex <= upperIndex) {
    currentIndex = Math.floor((lowerIndex + upperIndex) / 2);
    currentValue = stops[currentIndex];
    nextValue = stops[currentIndex + 1];
    if (currentValue <= input) {
      if (currentIndex === lastIndex || input < nextValue) return currentIndex;
      lowerIndex = currentIndex + 1;
    } else if (currentValue > input) upperIndex = currentIndex - 1;
    else throw new RuntimeError("Input is not a number.", key);
  }
  return 0;
}

// node_modules/@maplibre/maplibre-gl-style-spec/dist/expression/definitions/step.mjs
var Step = class Step2 {
  constructor(type, input, stops, key) {
    this.type = type;
    this.input = input;
    this.key = key;
    this.labels = [];
    this.outputs = [];
    for (const [label, expression] of stops) {
      this.labels.push(label);
      this.outputs.push(expression);
    }
  }
  static parse(args, context) {
    if (args.length - 1 < 4) return context.error(`Expected at least 4 arguments, but found only ${args.length - 1}.`);
    if ((args.length - 1) % 2 !== 0) return context.error("Expected an even number of arguments.");
    const input = context.parse(args[1], 1, NumberType);
    if (!input) return null;
    const stops = [];
    let outputType = null;
    if (context.expectedType && context.expectedType.kind !== "value") outputType = context.expectedType;
    for (let i = 1; i < args.length; i += 2) {
      const label = i === 1 ? -Infinity : args[i];
      const value = args[i + 1];
      const labelKey = i;
      const valueKey = i + 1;
      if (typeof label !== "number") return context.error('Input/output pairs for "step" expressions must be defined using literal numeric values (not computed expressions) for the input values.', labelKey);
      if (stops.length && stops[stops.length - 1][0] >= label) return context.error('Input/output pairs for "step" expressions must be arranged with input values in strictly ascending order.', labelKey);
      const parsed = context.parse(value, valueKey, outputType);
      if (!parsed) return null;
      outputType = outputType || parsed.type;
      stops.push([label, parsed]);
    }
    return new Step2(outputType, input, stops, context.key);
  }
  evaluate(ctx) {
    const labels = this.labels;
    const outputs = this.outputs;
    if (labels.length === 1) return outputs[0].evaluate(ctx);
    const value = this.input.evaluate(ctx);
    if (value <= labels[0]) return outputs[0].evaluate(ctx);
    const stopCount = labels.length;
    if (value >= labels[stopCount - 1]) return outputs[stopCount - 1].evaluate(ctx);
    return outputs[findStopLessThanOrEqualTo(labels, value, this.key)].evaluate(ctx);
  }
  eachChild(fn) {
    fn(this.input);
    for (const expression of this.outputs) fn(expression);
  }
  outputDefined() {
    return this.outputs.every((out) => out.outputDefined());
  }
};

// node_modules/@maplibre/maplibre-gl-style-spec/dist/node_modules/@mapbox/unitbezier/index.mjs
function unitBezier(p1x, p1y, p2x, p2y) {
  const cx = 3 * p1x;
  const bx = 3 * (p2x - p1x) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * p1y;
  const by = 3 * (p2y - p1y) - cy;
  const ay = 1 - cy - by;
  return function solve(x, epsilon = 1e-6) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const x2 = ((ax * t + bx) * t + cx) * t - x;
      if (Math.abs(x2) < epsilon) return ((ay * t + by) * t + cy) * t;
      const d2 = (3 * ax * t + 2 * bx) * t + cx;
      if (Math.abs(d2) < 1e-6) break;
      t -= x2 / d2;
    }
    let t02 = 0;
    let t12 = 1;
    t = x;
    for (let i = 0; i < 20; i++) {
      const x2 = ((ax * t + bx) * t + cx) * t;
      if (Math.abs(x2 - x) < epsilon) break;
      if (x > x2) t02 = t;
      else t12 = t;
      t = (t02 + t12) * 0.5;
    }
    return ((ay * t + by) * t + cy) * t;
  };
}

// node_modules/@maplibre/maplibre-gl-style-spec/dist/expression/definitions/interpolate.mjs
var Interpolate = class Interpolate2 {
  constructor(type, operator, interpolation, input, stops, key) {
    this.type = type;
    this.operator = operator;
    this.interpolation = interpolation;
    this.input = input;
    this.key = key;
    this.labels = [];
    this.outputs = [];
    for (const [label, expression] of stops) {
      this.labels.push(label);
      this.outputs.push(expression);
    }
  }
  static interpolationFactor(interpolation, input, lower, upper) {
    let t = 0;
    if (interpolation.name === "exponential") t = exponentialInterpolation(input, interpolation.base, lower, upper);
    else if (interpolation.name === "linear") t = exponentialInterpolation(input, 1, lower, upper);
    else if (interpolation.name === "cubic-bezier") {
      const c = interpolation.controlPoints;
      t = unitBezier(c[0], c[1], c[2], c[3])(exponentialInterpolation(input, 1, lower, upper));
    }
    return t;
  }
  static parse(args, context) {
    let [operator, interpolation, input, ...rest] = args;
    if (!Array.isArray(interpolation) || interpolation.length === 0) return context.error("Expected an interpolation type expression.", 1);
    if (interpolation[0] === "linear") interpolation = { name: "linear" };
    else if (interpolation[0] === "exponential") {
      const base = interpolation[1];
      if (typeof base !== "number") return context.error("Exponential interpolation requires a numeric base.", 1, 1);
      interpolation = {
        name: "exponential",
        base
      };
    } else if (interpolation[0] === "cubic-bezier") {
      const controlPoints = interpolation.slice(1);
      if (controlPoints.length !== 4 || controlPoints.some((t) => typeof t !== "number" || t < 0 || t > 1)) return context.error("Cubic bezier interpolation requires four numeric arguments with values between 0 and 1.", 1);
      interpolation = {
        name: "cubic-bezier",
        controlPoints
      };
    } else return context.error(`Unknown interpolation type ${String(interpolation[0])}`, 1, 0);
    if (args.length - 1 < 4) return context.error(`Expected at least 4 arguments, but found only ${args.length - 1}.`);
    if ((args.length - 1) % 2 !== 0) return context.error("Expected an even number of arguments.");
    input = context.parse(input, 2, NumberType);
    if (!input) return null;
    const stops = [];
    let outputType = null;
    if ((operator === "interpolate-hcl" || operator === "interpolate-lab") && context.expectedType != ColorArrayType) outputType = ColorType;
    else if (context.expectedType && context.expectedType.kind !== "value") outputType = context.expectedType;
    for (let i = 0; i < rest.length; i += 2) {
      const label = rest[i];
      const value = rest[i + 1];
      const labelKey = i + 3;
      const valueKey = i + 4;
      if (typeof label !== "number") return context.error('Input/output pairs for "interpolate" expressions must be defined using literal numeric values (not computed expressions) for the input values.', labelKey);
      if (stops.length && stops[stops.length - 1][0] >= label) return context.error('Input/output pairs for "interpolate" expressions must be arranged with input values in strictly ascending order.', labelKey);
      const parsed = context.parse(value, valueKey, outputType);
      if (!parsed) return null;
      outputType = outputType || parsed.type;
      stops.push([label, parsed]);
    }
    if (!verifyType(outputType, NumberType) && !verifyType(outputType, ProjectionDefinitionType) && !verifyType(outputType, ColorType) && !verifyType(outputType, PaddingType) && !verifyType(outputType, NumberArrayType) && !verifyType(outputType, ColorArrayType) && !verifyType(outputType, VariableAnchorOffsetCollectionType) && !verifyType(outputType, array(NumberType))) return context.error(`Type ${typeToString(outputType)} is not interpolatable.`);
    return new Interpolate2(outputType, operator, interpolation, input, stops, context.key);
  }
  evaluate(ctx) {
    const labels = this.labels;
    const outputs = this.outputs;
    if (labels.length === 1) return outputs[0].evaluate(ctx);
    const value = this.input.evaluate(ctx);
    if (value <= labels[0]) return outputs[0].evaluate(ctx);
    const stopCount = labels.length;
    if (value >= labels[stopCount - 1]) return outputs[stopCount - 1].evaluate(ctx);
    const index = findStopLessThanOrEqualTo(labels, value, this.key);
    const lower = labels[index];
    const upper = labels[index + 1];
    const t = Interpolate2.interpolationFactor(this.interpolation, value, lower, upper);
    const outputLower = outputs[index].evaluate(ctx);
    const outputUpper = outputs[index + 1].evaluate(ctx);
    switch (this.operator) {
      case "interpolate":
        switch (this.type.kind) {
          case "number":
            return interpolateNumber(outputLower, outputUpper, t);
          case "color":
            return Color.interpolate(outputLower, outputUpper, t);
          case "padding":
            return Padding.interpolate(outputLower, outputUpper, t);
          case "colorArray":
            return ColorArray.interpolate(outputLower, outputUpper, t);
          case "numberArray":
            return NumberArray.interpolate(outputLower, outputUpper, t);
          case "variableAnchorOffsetCollection":
            return VariableAnchorOffsetCollection.interpolate(outputLower, outputUpper, t, this.key);
          case "array":
            return interpolateArray(outputLower, outputUpper, t);
          case "projectionDefinition":
            return ProjectionDefinition.interpolate(outputLower, outputUpper, t);
        }
      case "interpolate-hcl":
        switch (this.type.kind) {
          case "color":
            return Color.interpolate(outputLower, outputUpper, t, "hcl");
          case "colorArray":
            return ColorArray.interpolate(outputLower, outputUpper, t, "hcl");
        }
      case "interpolate-lab":
        switch (this.type.kind) {
          case "color":
            return Color.interpolate(outputLower, outputUpper, t, "lab");
          case "colorArray":
            return ColorArray.interpolate(outputLower, outputUpper, t, "lab");
        }
    }
  }
  eachChild(fn) {
    fn(this.input);
    for (const expression of this.outputs) fn(expression);
  }
  outputDefined() {
    return this.outputs.every((out) => out.outputDefined());
  }
};
function exponentialInterpolation(input, base, lowerValue, upperValue) {
  const difference = upperValue - lowerValue;
  const progress = input - lowerValue;
  if (difference === 0) return 0;
  else if (base === 1) return progress / difference;
  else return (Math.pow(base, progress) - 1) / (Math.pow(base, difference) - 1);
}
var interpolateFactory = {
  color: Color.interpolate,
  number: interpolateNumber,
  padding: Padding.interpolate,
  numberArray: NumberArray.interpolate,
  colorArray: ColorArray.interpolate,
  variableAnchorOffsetCollection: VariableAnchorOffsetCollection.interpolate,
  array: interpolateArray
};

// node_modules/@maplibre/maplibre-gl-style-spec/dist/expression/definitions/format.mjs
var FormatExpression = class FormatExpression2 {
  constructor(sections) {
    this.type = FormattedType;
    this.sections = sections;
  }
  static parse(args, context) {
    if (args.length < 2) return context.error("Expected at least one argument.");
    const firstArg = args[1];
    if (!Array.isArray(firstArg) && typeof firstArg === "object") return context.error("First argument must be an image or text section.");
    const sections = [];
    let nextTokenMayBeObject = false;
    for (let i = 1; i <= args.length - 1; ++i) {
      const arg = args[i];
      if (nextTokenMayBeObject && typeof arg === "object" && !Array.isArray(arg)) {
        nextTokenMayBeObject = false;
        let scale = null;
        if (arg["font-scale"]) {
          scale = context.parse(arg["font-scale"], 1, NumberType);
          if (!scale) return null;
        }
        let font = null;
        if (arg["text-font"]) {
          font = context.parse(arg["text-font"], 1, array(StringType));
          if (!font) return null;
        }
        let textColor = null;
        if (arg["text-color"]) {
          textColor = context.parse(arg["text-color"], 1, ColorType);
          if (!textColor) return null;
        }
        let verticalAlign = null;
        if (arg["vertical-align"]) {
          if (typeof arg["vertical-align"] === "string" && !VERTICAL_ALIGN_OPTIONS.includes(arg["vertical-align"])) return context.error(`'vertical-align' must be one of: 'bottom', 'center', 'top' but found '${arg["vertical-align"]}' instead.`);
          verticalAlign = context.parse(arg["vertical-align"], 1, StringType);
          if (!verticalAlign) return null;
        }
        const lastExpression = sections[sections.length - 1];
        lastExpression.scale = scale;
        lastExpression.font = font;
        lastExpression.textColor = textColor;
        lastExpression.verticalAlign = verticalAlign;
      } else {
        const content = context.parse(args[i], 1, ValueType);
        if (!content) return null;
        const kind = content.type.kind;
        if (kind !== "string" && kind !== "value" && kind !== "null" && kind !== "resolvedImage") return context.error("Formatted text type must be 'string', 'value', 'image' or 'null'.");
        nextTokenMayBeObject = true;
        sections.push({
          content,
          scale: null,
          font: null,
          textColor: null,
          verticalAlign: null
        });
      }
    }
    return new FormatExpression2(sections);
  }
  evaluate(ctx) {
    const evaluateSection = (section) => {
      const evaluatedContent = section.content.evaluate(ctx);
      if (typeOf(evaluatedContent) === ResolvedImageType) return new FormattedSection("", evaluatedContent, null, null, null, section.verticalAlign ? section.verticalAlign.evaluate(ctx) : null);
      return new FormattedSection(valueToString(evaluatedContent), null, section.scale ? section.scale.evaluate(ctx) : null, section.font ? section.font.evaluate(ctx).join(",") : null, section.textColor ? section.textColor.evaluate(ctx) : null, section.verticalAlign ? section.verticalAlign.evaluate(ctx) : null);
    };
    return new Formatted(this.sections.map(evaluateSection));
  }
  eachChild(fn) {
    for (const section of this.sections) {
      fn(section.content);
      if (section.scale) fn(section.scale);
      if (section.font) fn(section.font);
      if (section.textColor) fn(section.textColor);
      if (section.verticalAlign) fn(section.verticalAlign);
    }
  }
  outputDefined() {
    return false;
  }
};

// node_modules/@maplibre/maplibre-gl-style-spec/dist/node_modules/quickselect/index.mjs
function quickselect(arr, k, left = 0, right = arr.length - 1, compare2 = defaultCompare) {
  while (right > left) {
    if (right - left > 600) {
      const n = right - left + 1;
      const m = k - left + 1;
      const z = Math.log(n);
      const s = 0.5 * Math.exp(2 * z / 3);
      const sd = 0.5 * Math.sqrt(z * s * (n - s) / n) * (m - n / 2 < 0 ? -1 : 1);
      quickselect(arr, k, Math.max(left, Math.floor(k - m * s / n + sd)), Math.min(right, Math.floor(k + (n - m) * s / n + sd)), compare2);
    }
    const t = arr[k];
    let i = left;
    let j = right;
    swap(arr, left, k);
    if (compare2(arr[right], t) > 0) swap(arr, left, right);
    while (i < j) {
      swap(arr, i, j);
      i++;
      j--;
      while (compare2(arr[i], t) < 0) i++;
      while (compare2(arr[j], t) > 0) j--;
    }
    if (compare2(arr[left], t) === 0) swap(arr, left, j);
    else {
      j++;
      swap(arr, j, right);
    }
    if (j <= k) left = j + 1;
    if (k <= j) right = j - 1;
  }
}
function swap(arr, i, j) {
  const tmp = arr[i];
  arr[i] = arr[j];
  arr[j] = tmp;
}
function defaultCompare(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

// node_modules/@maplibre/maplibre-gl-style-spec/dist/util/classify_rings.mjs
function classifyRings(rings, maxRings) {
  if (rings.length <= 1) return [rings];
  const polygons = [];
  let polygon;
  let ccw;
  for (const ring of rings) {
    const area = calculateSignedArea(ring);
    if (area === 0) continue;
    ring.area = Math.abs(area);
    if (ccw === void 0) ccw = area < 0;
    if (ccw === area < 0) {
      if (polygon) polygons.push(polygon);
      polygon = [ring];
    } else polygon.push(ring);
  }
  if (polygon) polygons.push(polygon);
  if (maxRings > 1) for (let j = 0; j < polygons.length; j++) {
    if (polygons[j].length <= maxRings) continue;
    quickselect(polygons[j], maxRings, 1, polygons[j].length - 1, compareAreas);
    polygons[j] = polygons[j].slice(0, maxRings);
  }
  return polygons;
}
function compareAreas(a, b) {
  return b.area - a.area;
}
function calculateSignedArea(ring) {
  let sum = 0;
  for (let i = 0, len = ring.length, j = len - 1, p1, p2; i < len; j = i++) {
    p1 = ring[i];
    p2 = ring[j];
    sum += (p2.x - p1.x) * (p1.y + p2.y);
  }
  return sum;
}

// node_modules/@maplibre/maplibre-gl-style-spec/dist/expression/definitions/assertion.mjs
var types = {
  string: StringType,
  number: NumberType,
  boolean: BooleanType,
  object: ObjectType
};
var Assertion = class Assertion2 {
  constructor(type, args, key) {
    this.type = type;
    this.args = args;
    this.key = key;
  }
  static parse(args, context) {
    if (args.length < 2) return context.error("Expected at least one argument.");
    let i = 1;
    let type;
    const name = args[0];
    if (name === "array") {
      let itemType;
      if (args.length > 2) {
        const type2 = args[1];
        if (typeof type2 !== "string" || !(type2 in types) || type2 === "object") return context.error('The item type argument of "array" must be one of string, number, boolean', 1);
        itemType = types[type2];
        i++;
      } else itemType = ValueType;
      let N;
      if (args.length > 3) {
        if (args[2] !== null && (typeof args[2] !== "number" || args[2] < 0 || args[2] !== Math.floor(args[2]))) return context.error('The length argument to "array" must be a positive integer literal', 2);
        N = args[2];
        i++;
      }
      type = array(itemType, N);
    } else {
      if (!types[name]) throw new Error(`Types doesn't contain name = ${name}`);
      type = types[name];
    }
    const parsed = [];
    for (; i < args.length; i++) {
      const input = context.parse(args[i], i, ValueType);
      if (!input) return null;
      parsed.push(input);
    }
    return new Assertion2(type, parsed, context.key);
  }
  evaluate(ctx) {
    for (let i = 0; i < this.args.length; i++) {
      const value = this.args[i].evaluate(ctx);
      if (!checkSubtype(this.type, typeOf(value))) return value;
      else if (i === this.args.length - 1) throw new RuntimeError(`Expected value to be of type ${typeToString(this.type)}, but found ${typeToString(typeOf(value))} instead.`, this.key);
    }
    throw new Error();
  }
  eachChild(fn) {
    this.args.forEach(fn);
  }
  outputDefined() {
    return this.args.every((arg) => arg.outputDefined());
  }
};

// node_modules/@maplibre/maplibre-gl-style-spec/dist/expression/definitions/coercion.mjs
var types2 = {
  "to-boolean": BooleanType,
  "to-color": ColorType,
  "to-number": NumberType,
  "to-string": StringType
};
var Coercion = class Coercion2 {
  constructor(type, args, key) {
    this.type = type;
    this.args = args;
    this.key = key;
  }
  static parse(args, context) {
    if (args.length < 2) return context.error("Expected at least one argument.");
    const name = args[0];
    if (!types2[name]) throw new Error(`Can't parse ${name} as it is not part of the known types`);
    if ((name === "to-boolean" || name === "to-string") && args.length !== 2) return context.error("Expected one argument.");
    const type = types2[name];
    const parsed = [];
    for (let i = 1; i < args.length; i++) {
      const input = context.parse(args[i], i, ValueType);
      if (!input) return null;
      parsed.push(input);
    }
    return new Coercion2(type, parsed, context.key);
  }
  evaluate(ctx) {
    switch (this.type.kind) {
      case "boolean":
        return Boolean(this.args[0].evaluate(ctx));
      case "color": {
        let input;
        let error2;
        for (const arg of this.args) {
          input = arg.evaluate(ctx);
          error2 = null;
          if (input instanceof Color) return input;
          else if (typeof input === "string") {
            const c = ctx.parseColor(input);
            if (c) return c;
          } else if (Array.isArray(input)) {
            if (input.length < 3 || input.length > 4) error2 = `Invalid rgba value ${JSON.stringify(input)}: expected an array containing either three or four numeric values.`;
            else error2 = validateRGBA(input[0], input[1], input[2], input[3]);
            if (!error2) return new Color(input[0] / 255, input[1] / 255, input[2] / 255, input[3]);
          }
        }
        throw new RuntimeError(error2 || `Could not parse color from value '${typeof input === "string" ? input : JSON.stringify(input)}'`, this.key);
      }
      case "padding": {
        let input;
        for (const arg of this.args) {
          input = arg.evaluate(ctx);
          const pad = Padding.parse(input);
          if (pad) return pad;
        }
        throw new RuntimeError(`Could not parse padding from value '${typeof input === "string" ? input : JSON.stringify(input)}'`, this.key);
      }
      case "numberArray": {
        let input;
        for (const arg of this.args) {
          input = arg.evaluate(ctx);
          const val = NumberArray.parse(input);
          if (val) return val;
        }
        throw new RuntimeError(`Could not parse numberArray from value '${typeof input === "string" ? input : JSON.stringify(input)}'`, this.key);
      }
      case "colorArray": {
        let input;
        for (const arg of this.args) {
          input = arg.evaluate(ctx);
          const val = ColorArray.parse(input);
          if (val) return val;
        }
        throw new RuntimeError(`Could not parse colorArray from value '${typeof input === "string" ? input : JSON.stringify(input)}'`, this.key);
      }
      case "variableAnchorOffsetCollection": {
        let input;
        for (const arg of this.args) {
          input = arg.evaluate(ctx);
          const coll = VariableAnchorOffsetCollection.parse(input);
          if (coll) return coll;
        }
        throw new RuntimeError(`Could not parse variableAnchorOffsetCollection from value '${typeof input === "string" ? input : JSON.stringify(input)}'`, this.key);
      }
      case "number": {
        let value = null;
        for (const arg of this.args) {
          value = arg.evaluate(ctx);
          if (value === null) return 0;
          const num = Number(value);
          if (isNaN(num)) continue;
          return num;
        }
        throw new RuntimeError(`Could not convert ${JSON.stringify(value)} to number.`, this.key);
      }
      case "formatted":
        return Formatted.fromString(valueToString(this.args[0].evaluate(ctx)));
      case "resolvedImage":
        return ResolvedImage.fromString(valueToString(this.args[0].evaluate(ctx)));
      case "projectionDefinition": {
        const input = this.args[0].evaluate(ctx);
        if (ProjectionDefinition.parse(input)) return input;
        throw new RuntimeError(`Could not parse projectionDefinition from value '${typeof input === "string" ? input : JSON.stringify(input)}'`, this.key);
      }
      default:
        return valueToString(this.args[0].evaluate(ctx));
    }
  }
  eachChild(fn) {
    this.args.forEach(fn);
  }
  outputDefined() {
    return this.args.every((arg) => arg.outputDefined());
  }
};

// node_modules/@maplibre/maplibre-gl-style-spec/dist/expression/definitions/let.mjs
var Let = class Let2 {
  constructor(bindings, result) {
    this.type = result.type;
    this.bindings = [].concat(bindings);
    this.result = result;
  }
  evaluate(ctx) {
    return this.result.evaluate(ctx);
  }
  eachChild(fn) {
    for (const binding of this.bindings) fn(binding[1]);
    fn(this.result);
  }
  static parse(args, context) {
    if (args.length < 4) return context.error(`Expected at least 3 arguments, but found ${args.length - 1} instead.`);
    const bindings = [];
    for (let i = 1; i < args.length - 1; i += 2) {
      const name = args[i];
      if (typeof name !== "string") return context.error(`Expected string, but found ${typeof name} instead.`, i);
      if (/[^a-zA-Z0-9_]/.test(name)) return context.error("Variable names must contain only alphanumeric characters or '_'.", i);
      const value = context.parse(args[i + 1], i + 1);
      if (!value) return null;
      bindings.push([name, value]);
    }
    const result = context.parse(args[args.length - 1], args.length - 1, context.expectedType, bindings);
    if (!result) return null;
    return new Let2(bindings, result);
  }
  outputDefined() {
    return this.result.outputDefined();
  }
};

// node_modules/@maplibre/maplibre-gl-style-spec/dist/expression/definitions/var.mjs
var Var = class Var2 {
  constructor(name, boundExpression) {
    this.type = boundExpression.type;
    this.name = name;
    this.boundExpression = boundExpression;
  }
  static parse(args, context) {
    if (args.length !== 2 || typeof args[1] !== "string") return context.error("'var' expression requires exactly one string literal argument.");
    const name = args[1];
    if (!context.scope.has(name)) return context.error(`Unknown variable "${name}". Make sure "${name}" has been bound in an enclosing "let" expression before using it.`, 1);
    return new Var2(name, context.scope.get(name));
  }
  evaluate(ctx) {
    return this.boundExpression.evaluate(ctx);
  }
  eachChild() {
  }
  outputDefined() {
    return false;
  }
};

// node_modules/@maplibre/maplibre-gl-style-spec/dist/expression/definitions/at.mjs
var At = class At2 {
  constructor(type, index, input, key) {
    this.type = type;
    this.index = index;
    this.input = input;
    this.key = key;
  }
  static parse(args, context) {
    if (args.length !== 3) return context.error(`Expected 2 arguments, but found ${args.length - 1} instead.`);
    const index = context.parse(args[1], 1, NumberType);
    const input = context.parse(args[2], 2, array(context.expectedType || ValueType));
    if (!index || !input) return null;
    const t = input.type;
    return new At2(t.itemType, index, input, context.key);
  }
  evaluate(ctx) {
    const index = this.index.evaluate(ctx);
    const array2 = this.input.evaluate(ctx);
    if (index < 0) throw new RuntimeError(`Array index out of bounds: ${index} < 0.`, this.key);
    if (index >= array2.length) throw new RuntimeError(`Array index out of bounds: ${index} > ${array2.length - 1}.`, this.key);
    if (index !== Math.floor(index)) throw new RuntimeError(`Array index must be an integer, but found ${index} instead.`, this.key);
    return array2[index];
  }
  eachChild(fn) {
    fn(this.index);
    fn(this.input);
  }
  outputDefined() {
    return false;
  }
};

// node_modules/@maplibre/maplibre-gl-style-spec/dist/expression/definitions/in.mjs
var In = class In2 {
  constructor(needle, haystack, key) {
    this.needle = needle;
    this.haystack = haystack;
    this.key = key;
    this.type = BooleanType;
  }
  static parse(args, context) {
    if (args.length !== 3) return context.error(`Expected 2 arguments, but found ${args.length - 1} instead.`);
    const needle = context.parse(args[1], 1, ValueType);
    const haystack = context.parse(args[2], 2, ValueType);
    if (!needle || !haystack) return null;
    if (!isValidType(needle.type, [
      BooleanType,
      StringType,
      NumberType,
      NullType,
      ValueType
    ])) return context.error(`Expected first argument to be of type boolean, string, number or null, but found ${typeToString(needle.type)} instead`);
    return new In2(needle, haystack, context.key);
  }
  evaluate(ctx) {
    const needle = this.needle.evaluate(ctx);
    const haystack = this.haystack.evaluate(ctx);
    if (!haystack) return false;
    if (!isValidNativeType(needle, [
      "boolean",
      "string",
      "number",
      "null"
    ])) throw new RuntimeError(`Expected first argument to be of type boolean, string, number or null, but found ${typeToString(typeOf(needle))} instead.`, this.key);
    if (!isValidNativeType(haystack, ["string", "array"])) throw new RuntimeError(`Expected second argument to be of type array or string, but found ${typeToString(typeOf(haystack))} instead.`, this.key);
    return haystack.indexOf(needle) >= 0;
  }
  eachChild(fn) {
    fn(this.needle);
    fn(this.haystack);
  }
  outputDefined() {
    return true;
  }
};

// node_modules/@maplibre/maplibre-gl-style-spec/dist/expression/definitions/index_of.mjs
var IndexOf = class IndexOf2 {
  constructor(needle, haystack, key, fromIndex) {
    this.needle = needle;
    this.haystack = haystack;
    this.key = key;
    this.fromIndex = fromIndex;
    this.type = NumberType;
  }
  static parse(args, context) {
    if (args.length <= 2 || args.length >= 5) return context.error(`Expected 2 or 3 arguments, but found ${args.length - 1} instead.`);
    const needle = context.parse(args[1], 1, ValueType);
    const haystack = context.parse(args[2], 2, ValueType);
    if (!needle || !haystack) return null;
    if (!isValidType(needle.type, [
      BooleanType,
      StringType,
      NumberType,
      NullType,
      ValueType
    ])) return context.error(`Expected first argument to be of type boolean, string, number or null, but found ${typeToString(needle.type)} instead`);
    if (args.length === 4) {
      const fromIndex = context.parse(args[3], 3, NumberType);
      if (!fromIndex) return null;
      return new IndexOf2(needle, haystack, context.key, fromIndex);
    } else return new IndexOf2(needle, haystack, context.key);
  }
  evaluate(ctx) {
    const needle = this.needle.evaluate(ctx);
    const haystack = this.haystack.evaluate(ctx);
    if (!isValidNativeType(needle, [
      "boolean",
      "string",
      "number",
      "null"
    ])) throw new RuntimeError(`Expected first argument to be of type boolean, string, number or null, but found ${typeToString(typeOf(needle))} instead.`, this.key);
    let fromIndex;
    if (this.fromIndex) fromIndex = this.fromIndex.evaluate(ctx);
    if (isValidNativeType(haystack, ["string"])) {
      const rawIndex = haystack.indexOf(needle, fromIndex);
      if (rawIndex === -1) return -1;
      else return [...haystack.slice(0, rawIndex)].length;
    } else if (isValidNativeType(haystack, ["array"])) return haystack.indexOf(needle, fromIndex);
    else throw new RuntimeError(`Expected second argument to be of type array or string, but found ${typeToString(typeOf(haystack))} instead.`, this.key);
  }
  eachChild(fn) {
    fn(this.needle);
    fn(this.haystack);
    if (this.fromIndex) fn(this.fromIndex);
  }
  outputDefined() {
    return false;
  }
};

// node_modules/@maplibre/maplibre-gl-style-spec/dist/expression/definitions/match.mjs
var Match = class Match2 {
  constructor(inputType, outputType, input, cases, outputs, otherwise) {
    this.inputType = inputType;
    this.type = outputType;
    this.input = input;
    this.cases = cases;
    this.outputs = outputs;
    this.otherwise = otherwise;
  }
  static parse(args, context) {
    if (args.length < 5) return context.error(`Expected at least 4 arguments, but found only ${args.length - 1}.`);
    if (args.length % 2 !== 1) return context.error("Expected an even number of arguments.");
    let inputType;
    let outputType;
    if (context.expectedType && context.expectedType.kind !== "value") outputType = context.expectedType;
    const cases = {};
    const outputs = [];
    for (let i = 2; i < args.length - 1; i += 2) {
      let labels = args[i];
      const value = args[i + 1];
      if (!Array.isArray(labels)) labels = [labels];
      const labelContext = context.concat(i);
      if (labels.length === 0) return labelContext.error("Expected at least one branch label.");
      for (const label of labels) {
        if (typeof label !== "number" && typeof label !== "string") return labelContext.error("Branch labels must be numbers or strings.");
        else if (typeof label === "number" && Math.abs(label) > Number.MAX_SAFE_INTEGER) return labelContext.error(`Branch labels must be integers no larger than ${Number.MAX_SAFE_INTEGER}.`);
        else if (typeof label === "number" && Math.floor(label) !== label) return labelContext.error("Numeric branch labels must be integer values.");
        else if (!inputType) inputType = typeOf(label);
        else if (labelContext.checkSubtype(inputType, typeOf(label))) return null;
        if (typeof cases[String(label)] !== "undefined") return labelContext.error("Branch labels must be unique.");
        cases[String(label)] = outputs.length;
      }
      const result = context.parse(value, i, outputType);
      if (!result) return null;
      outputType = outputType || result.type;
      outputs.push(result);
    }
    const input = context.parse(args[1], 1, ValueType);
    if (!input) return null;
    const otherwise = context.parse(args[args.length - 1], args.length - 1, outputType);
    if (!otherwise) return null;
    if (input.type.kind !== "value" && context.concat(1).checkSubtype(inputType, input.type)) return null;
    return new Match2(inputType, outputType, input, cases, outputs, otherwise);
  }
  evaluate(ctx) {
    const input = this.input.evaluate(ctx);
    return (typeOf(input) === this.inputType && this.outputs[this.cases[input]] || this.otherwise).evaluate(ctx);
  }
  eachChild(fn) {
    fn(this.input);
    this.outputs.forEach(fn);
    fn(this.otherwise);
  }
  outputDefined() {
    return this.outputs.every((out) => out.outputDefined()) && this.otherwise.outputDefined();
  }
};

// node_modules/@maplibre/maplibre-gl-style-spec/dist/expression/definitions/case.mjs
var Case = class Case2 {
  constructor(type, branches, otherwise) {
    this.type = type;
    this.branches = branches;
    this.otherwise = otherwise;
  }
  static parse(args, context) {
    if (args.length < 4) return context.error(`Expected at least 3 arguments, but found only ${args.length - 1}.`);
    if (args.length % 2 !== 0) return context.error("Expected an odd number of arguments.");
    let outputType;
    if (context.expectedType && context.expectedType.kind !== "value") outputType = context.expectedType;
    const branches = [];
    for (let i = 1; i < args.length - 1; i += 2) {
      const test = context.parse(args[i], i, BooleanType);
      if (!test) return null;
      const result = context.parse(args[i + 1], i + 1, outputType);
      if (!result) return null;
      branches.push([test, result]);
      outputType = outputType || result.type;
    }
    const otherwise = context.parse(args[args.length - 1], args.length - 1, outputType);
    if (!otherwise) return null;
    if (!outputType) throw new Error("Can't infer output type");
    return new Case2(outputType, branches, otherwise);
  }
  evaluate(ctx) {
    for (const [test, expression] of this.branches) if (test.evaluate(ctx)) return expression.evaluate(ctx);
    return this.otherwise.evaluate(ctx);
  }
  eachChild(fn) {
    for (const [test, expression] of this.branches) {
      fn(test);
      fn(expression);
    }
    fn(this.otherwise);
  }
  outputDefined() {
    return this.branches.every(([_, out]) => out.outputDefined()) && this.otherwise.outputDefined();
  }
};

// node_modules/@maplibre/maplibre-gl-style-spec/dist/expression/definitions/slice.mjs
var Slice = class Slice2 {
  constructor(type, input, beginIndex, key, endIndex) {
    this.type = type;
    this.input = input;
    this.beginIndex = beginIndex;
    this.key = key;
    this.endIndex = endIndex;
  }
  static parse(args, context) {
    if (args.length <= 2 || args.length >= 5) return context.error(`Expected 2 or 3 arguments, but found ${args.length - 1} instead.`);
    const input = context.parse(args[1], 1, ValueType);
    const beginIndex = context.parse(args[2], 2, NumberType);
    if (!input || !beginIndex) return null;
    if (!isValidType(input.type, [
      array(ValueType),
      StringType,
      ValueType
    ])) return context.error(`Expected first argument to be of type array or string, but found ${typeToString(input.type)} instead`);
    if (args.length === 4) {
      const endIndex = context.parse(args[3], 3, NumberType);
      if (!endIndex) return null;
      return new Slice2(input.type, input, beginIndex, context.key, endIndex);
    } else return new Slice2(input.type, input, beginIndex, context.key);
  }
  evaluate(ctx) {
    const input = this.input.evaluate(ctx);
    const beginIndex = this.beginIndex.evaluate(ctx);
    let endIndex;
    if (this.endIndex) endIndex = this.endIndex.evaluate(ctx);
    if (isValidNativeType(input, ["string"])) return [...input].slice(beginIndex, endIndex).join("");
    else if (isValidNativeType(input, ["array"])) return input.slice(beginIndex, endIndex);
    else throw new RuntimeError(`Expected first argument to be of type array or string, but found ${typeToString(typeOf(input))} instead.`, this.key);
  }
  eachChild(fn) {
    fn(this.input);
    fn(this.beginIndex);
    if (this.endIndex) fn(this.endIndex);
  }
  outputDefined() {
    return false;
  }
};

// node_modules/@maplibre/maplibre-gl-style-spec/dist/expression/definitions/coalesce.mjs
var Coalesce = class Coalesce2 {
  constructor(type, args) {
    this.type = type;
    this.args = args;
  }
  static parse(args, context) {
    if (args.length < 2) return context.error("Expected at least one argument.");
    let outputType = null;
    const expectedType = context.expectedType;
    if (expectedType && expectedType.kind !== "value") outputType = expectedType;
    const parsedArgs = [];
    for (const arg of args.slice(1)) {
      const parsed = context.parse(arg, 1 + parsedArgs.length, outputType, void 0, { typeAnnotation: "omit" });
      if (!parsed) return null;
      outputType = outputType || parsed.type;
      parsedArgs.push(parsed);
    }
    if (!outputType) throw new Error("No output type");
    return expectedType && parsedArgs.some((arg) => checkSubtype(expectedType, arg.type)) ? new Coalesce2(ValueType, parsedArgs) : new Coalesce2(outputType, parsedArgs);
  }
  evaluate(ctx) {
    let result = null;
    let argCount = 0;
    let requestedImageName;
    for (const arg of this.args) {
      argCount++;
      result = arg.evaluate(ctx);
      if (result && result instanceof ResolvedImage && !result.available) {
        if (!requestedImageName) requestedImageName = result.name;
        result = null;
        if (argCount === this.args.length) result = requestedImageName;
      }
      if (result !== null) break;
    }
    return result;
  }
  eachChild(fn) {
    this.args.forEach(fn);
  }
  outputDefined() {
    return this.args.every((arg) => arg.outputDefined());
  }
};

// node_modules/@maplibre/maplibre-gl-style-spec/dist/expression/definitions/comparison.mjs
function isComparableType(op, type) {
  if (op === "==" || op === "!=") return type.kind === "boolean" || type.kind === "string" || type.kind === "number" || type.kind === "null" || type.kind === "value";
  else return type.kind === "string" || type.kind === "number" || type.kind === "value";
}
function eq(ctx, a, b) {
  return a === b;
}
function neq(ctx, a, b) {
  return a !== b;
}
function lt(ctx, a, b) {
  return a < b;
}
function gt(ctx, a, b) {
  return a > b;
}
function lteq(ctx, a, b) {
  return a <= b;
}
function gteq(ctx, a, b) {
  return a >= b;
}
function eqCollate(ctx, a, b, c) {
  return c.compare(a, b) === 0;
}
function neqCollate(ctx, a, b, c) {
  return !eqCollate(ctx, a, b, c);
}
function ltCollate(ctx, a, b, c) {
  return c.compare(a, b) < 0;
}
function gtCollate(ctx, a, b, c) {
  return c.compare(a, b) > 0;
}
function lteqCollate(ctx, a, b, c) {
  return c.compare(a, b) <= 0;
}
function gteqCollate(ctx, a, b, c) {
  return c.compare(a, b) >= 0;
}
function makeComparison(op, compareBasic, compareWithCollator) {
  const isOrderComparison = op !== "==" && op !== "!=";
  return class Comparison {
    constructor(lhs, rhs, key, collator) {
      this.lhs = lhs;
      this.rhs = rhs;
      this.key = key;
      this.collator = collator;
      this.type = BooleanType;
      this.hasUntypedArgument = lhs.type.kind === "value" || rhs.type.kind === "value";
    }
    static parse(args, context) {
      if (args.length !== 3 && args.length !== 4) return context.error("Expected two or three arguments.");
      const op2 = args[0];
      let lhs = context.parse(args[1], 1, ValueType);
      if (!lhs) return null;
      if (!isComparableType(op2, lhs.type)) return context.concat(1).error(`"${op2}" comparisons are not supported for type '${typeToString(lhs.type)}'.`);
      let rhs = context.parse(args[2], 2, ValueType);
      if (!rhs) return null;
      if (!isComparableType(op2, rhs.type)) return context.concat(2).error(`"${op2}" comparisons are not supported for type '${typeToString(rhs.type)}'.`);
      if (lhs.type.kind !== rhs.type.kind && lhs.type.kind !== "value" && rhs.type.kind !== "value") return context.error(`Cannot compare types '${typeToString(lhs.type)}' and '${typeToString(rhs.type)}'.`);
      if (isOrderComparison) {
        if (lhs.type.kind === "value" && rhs.type.kind !== "value") lhs = new Assertion(rhs.type, [lhs], context.key);
        else if (lhs.type.kind !== "value" && rhs.type.kind === "value") rhs = new Assertion(lhs.type, [rhs], context.key);
      }
      let collator = null;
      if (args.length === 4) {
        if (lhs.type.kind !== "string" && rhs.type.kind !== "string" && lhs.type.kind !== "value" && rhs.type.kind !== "value") return context.error("Cannot use collator to compare non-string types.");
        collator = context.parse(args[3], 3, CollatorType);
        if (!collator) return null;
      }
      return new Comparison(lhs, rhs, context.key, collator);
    }
    evaluate(ctx) {
      const lhs = this.lhs.evaluate(ctx);
      const rhs = this.rhs.evaluate(ctx);
      if (isOrderComparison && this.hasUntypedArgument) {
        const lt2 = typeOf(lhs);
        const rt = typeOf(rhs);
        if (lt2.kind !== rt.kind || !(lt2.kind === "string" || lt2.kind === "number")) throw new RuntimeError(`Expected arguments for "${op}" to be (string, string) or (number, number), but found (${lt2.kind}, ${rt.kind}) instead.`, this.key);
      }
      if (this.collator && !isOrderComparison && this.hasUntypedArgument) {
        const lt2 = typeOf(lhs);
        const rt = typeOf(rhs);
        if (lt2.kind !== "string" || rt.kind !== "string") return compareBasic(ctx, lhs, rhs);
      }
      return this.collator ? compareWithCollator(ctx, lhs, rhs, this.collator.evaluate(ctx)) : compareBasic(ctx, lhs, rhs);
    }
    eachChild(fn) {
      fn(this.lhs);
      fn(this.rhs);
      if (this.collator) fn(this.collator);
    }
    outputDefined() {
      return true;
    }
  };
}
var Equals = makeComparison("==", eq, eqCollate);
var NotEquals = makeComparison("!=", neq, neqCollate);
var LessThan = makeComparison("<", lt, ltCollate);
var GreaterThan = makeComparison(">", gt, gtCollate);
var LessThanOrEqual = makeComparison("<=", lteq, lteqCollate);
var GreaterThanOrEqual = makeComparison(">=", gteq, gteqCollate);

// node_modules/@maplibre/maplibre-gl-style-spec/dist/expression/definitions/collator.mjs
var CollatorExpression = class CollatorExpression2 {
  constructor(caseSensitive, diacriticSensitive, locale) {
    this.type = CollatorType;
    this.locale = locale;
    this.caseSensitive = caseSensitive;
    this.diacriticSensitive = diacriticSensitive;
  }
  static parse(args, context) {
    if (args.length !== 2) return context.error("Expected one argument.");
    const options = args[1];
    if (typeof options !== "object" || Array.isArray(options)) return context.error("Collator options argument must be an object.");
    const caseSensitive = context.parse(options["case-sensitive"] === void 0 ? false : options["case-sensitive"], 1, BooleanType);
    if (!caseSensitive) return null;
    const diacriticSensitive = context.parse(options["diacritic-sensitive"] === void 0 ? false : options["diacritic-sensitive"], 1, BooleanType);
    if (!diacriticSensitive) return null;
    let locale = null;
    if (options["locale"]) {
      locale = context.parse(options["locale"], 1, StringType);
      if (!locale) return null;
    }
    return new CollatorExpression2(caseSensitive, diacriticSensitive, locale);
  }
  evaluate(ctx) {
    return new Collator(this.caseSensitive.evaluate(ctx), this.diacriticSensitive.evaluate(ctx), this.locale ? this.locale.evaluate(ctx) : null);
  }
  eachChild(fn) {
    fn(this.caseSensitive);
    fn(this.diacriticSensitive);
    if (this.locale) fn(this.locale);
  }
  outputDefined() {
    return false;
  }
};

// node_modules/@maplibre/maplibre-gl-style-spec/dist/expression/definitions/number_format.mjs
var NumberFormat = class NumberFormat2 {
  constructor(number, locale, currency, unit, minFractionDigits, maxFractionDigits) {
    this.type = StringType;
    this.number = number;
    this.locale = locale;
    this.currency = currency;
    this.unit = unit;
    this.minFractionDigits = minFractionDigits;
    this.maxFractionDigits = maxFractionDigits;
  }
  static parse(args, context) {
    if (args.length !== 3) return context.error("Expected two arguments.");
    const number = context.parse(args[1], 1, NumberType);
    if (!number) return null;
    const options = args[2];
    if (typeof options !== "object" || Array.isArray(options)) return context.error("NumberFormat options argument must be an object.");
    let locale = null;
    if (options["locale"]) {
      locale = context.parse(options["locale"], 1, StringType);
      if (!locale) return null;
    }
    let currency = null;
    if (options["currency"]) {
      currency = context.parse(options["currency"], 1, StringType);
      if (!currency) return null;
    }
    let unit = null;
    if (options["unit"]) {
      unit = context.parse(options["unit"], 1, StringType);
      if (!unit) return null;
    }
    if (currency && unit) return context.error("NumberFormat options `currency` and `unit` are mutually exclusive");
    let minFractionDigits = null;
    if (options["min-fraction-digits"]) {
      minFractionDigits = context.parse(options["min-fraction-digits"], 1, NumberType);
      if (!minFractionDigits) return null;
    }
    let maxFractionDigits = null;
    if (options["max-fraction-digits"]) {
      maxFractionDigits = context.parse(options["max-fraction-digits"], 1, NumberType);
      if (!maxFractionDigits) return null;
    }
    return new NumberFormat2(number, locale, currency, unit, minFractionDigits, maxFractionDigits);
  }
  evaluate(ctx) {
    return new Intl.NumberFormat(this.locale ? this.locale.evaluate(ctx) : [], {
      style: this.currency ? "currency" : this.unit ? "unit" : "decimal",
      currency: this.currency ? this.currency.evaluate(ctx) : void 0,
      unit: this.unit ? this.unit.evaluate(ctx) : void 0,
      minimumFractionDigits: this.minFractionDigits ? this.minFractionDigits.evaluate(ctx) : void 0,
      maximumFractionDigits: this.maxFractionDigits ? this.maxFractionDigits.evaluate(ctx) : void 0
    }).format(this.number.evaluate(ctx));
  }
  eachChild(fn) {
    fn(this.number);
    if (this.locale) fn(this.locale);
    if (this.currency) fn(this.currency);
    if (this.unit) fn(this.unit);
    if (this.minFractionDigits) fn(this.minFractionDigits);
    if (this.maxFractionDigits) fn(this.maxFractionDigits);
  }
  outputDefined() {
    return false;
  }
};

// node_modules/@maplibre/maplibre-gl-style-spec/dist/expression/definitions/image.mjs
var ImageExpression = class ImageExpression2 {
  constructor(input) {
    this.type = ResolvedImageType;
    this.input = input;
  }
  static parse(args, context) {
    if (args.length !== 2) return context.error("Expected two arguments.");
    const name = context.parse(args[1], 1, StringType);
    if (!name) return context.error("No image name provided.");
    return new ImageExpression2(name);
  }
  evaluate(ctx) {
    const evaluatedImageName = this.input.evaluate(ctx);
    const value = ResolvedImage.fromString(evaluatedImageName);
    if (value && ctx.availableImages) value.available = ctx.availableImages.indexOf(evaluatedImageName) > -1;
    return value;
  }
  eachChild(fn) {
    fn(this.input);
  }
  outputDefined() {
    return false;
  }
};

// node_modules/@maplibre/maplibre-gl-style-spec/dist/expression/definitions/length.mjs
var Length = class Length2 {
  constructor(input, key) {
    this.input = input;
    this.key = key;
    this.type = NumberType;
  }
  static parse(args, context) {
    if (args.length !== 2) return context.error(`Expected 1 argument, but found ${args.length - 1} instead.`);
    const input = context.parse(args[1], 1);
    if (!input) return null;
    if (input.type.kind !== "array" && input.type.kind !== "string" && input.type.kind !== "value") return context.error(`Expected argument of type string or array, but found ${typeToString(input.type)} instead.`);
    return new Length2(input, context.key);
  }
  evaluate(ctx) {
    const input = this.input.evaluate(ctx);
    if (typeof input === "string") return [...input].length;
    else if (Array.isArray(input)) return input.length;
    else throw new RuntimeError(`Expected value to be of type string or array, but found ${typeToString(typeOf(input))} instead.`, this.key);
  }
  eachChild(fn) {
    fn(this.input);
  }
  outputDefined() {
    return false;
  }
};

// node_modules/@maplibre/maplibre-gl-style-spec/dist/util/geometry_util.mjs
var EXTENT = 8192;
function getTileCoordinates(p, canonical) {
  const x = mercatorXfromLng(p[0]);
  const y = mercatorYfromLat(p[1]);
  const tilesAtZoom = Math.pow(2, canonical.z);
  return [Math.round(x * tilesAtZoom * EXTENT), Math.round(y * tilesAtZoom * EXTENT)];
}
function getLngLatFromTileCoord(coord, canonical) {
  const tilesAtZoom = Math.pow(2, canonical.z);
  const x = (coord[0] / EXTENT + canonical.x) / tilesAtZoom;
  const y = (coord[1] / EXTENT + canonical.y) / tilesAtZoom;
  return [lngFromMercatorXfromLng(x), latFromMercatorY(y)];
}
function mercatorXfromLng(lng) {
  return (180 + lng) / 360;
}
function lngFromMercatorXfromLng(mercatorX) {
  return mercatorX * 360 - 180;
}
function mercatorYfromLat(lat) {
  return (180 - 180 / Math.PI * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360))) / 360;
}
function latFromMercatorY(mercatorY) {
  return 360 / Math.PI * Math.atan(Math.exp((180 - mercatorY * 360) * Math.PI / 180)) - 90;
}
function updateBBox(bbox, coord) {
  bbox[0] = Math.min(bbox[0], coord[0]);
  bbox[1] = Math.min(bbox[1], coord[1]);
  bbox[2] = Math.max(bbox[2], coord[0]);
  bbox[3] = Math.max(bbox[3], coord[1]);
}
function boxWithinBox(bbox1, bbox2) {
  if (bbox1[0] <= bbox2[0]) return false;
  if (bbox1[2] >= bbox2[2]) return false;
  if (bbox1[1] <= bbox2[1]) return false;
  if (bbox1[3] >= bbox2[3]) return false;
  return true;
}
function rayIntersect(p, p1, p2) {
  return p1[1] > p[1] !== p2[1] > p[1] && p[0] < (p2[0] - p1[0]) * (p[1] - p1[1]) / (p2[1] - p1[1]) + p1[0];
}
function pointOnBoundary(p, p1, p2) {
  const x1 = p[0] - p1[0];
  const y1 = p[1] - p1[1];
  const x2 = p[0] - p2[0];
  const y2 = p[1] - p2[1];
  return x1 * y2 - x2 * y1 === 0 && x1 * x2 <= 0 && y1 * y2 <= 0;
}
function segmentIntersectSegment(a, b, c, d) {
  const vectorP = [b[0] - a[0], b[1] - a[1]];
  if (perp([d[0] - c[0], d[1] - c[1]], vectorP) === 0) return false;
  if (twoSided(a, b, c, d) && twoSided(c, d, a, b)) return true;
  return false;
}
function lineIntersectPolygon(p1, p2, polygon) {
  for (const ring of polygon) for (let j = 0; j < ring.length - 1; ++j) if (segmentIntersectSegment(p1, p2, ring[j], ring[j + 1])) return true;
  return false;
}
function pointWithinPolygon(point, rings, trueIfOnBoundary = false) {
  let inside = false;
  for (const ring of rings) for (let j = 0; j < ring.length - 1; j++) {
    if (pointOnBoundary(point, ring[j], ring[j + 1])) return trueIfOnBoundary;
    if (rayIntersect(point, ring[j], ring[j + 1])) inside = !inside;
  }
  return inside;
}
function pointWithinPolygons(point, polygons) {
  for (const polygon of polygons) if (pointWithinPolygon(point, polygon)) return true;
  return false;
}
function lineStringWithinPolygon(line, polygon) {
  for (const point of line) if (!pointWithinPolygon(point, polygon)) return false;
  for (let i = 0; i < line.length - 1; ++i) if (lineIntersectPolygon(line[i], line[i + 1], polygon)) return false;
  return true;
}
function lineStringWithinPolygons(line, polygons) {
  for (const polygon of polygons) if (lineStringWithinPolygon(line, polygon)) return true;
  return false;
}
function perp(v1, v2) {
  return v1[0] * v2[1] - v1[1] * v2[0];
}
function twoSided(p1, p2, q1, q2) {
  const x1 = p1[0] - q1[0];
  const y1 = p1[1] - q1[1];
  const x2 = p2[0] - q1[0];
  const y2 = p2[1] - q1[1];
  const x3 = q2[0] - q1[0];
  const y3 = q2[1] - q1[1];
  const det1 = x1 * y3 - x3 * y1;
  const det2 = x2 * y3 - x3 * y2;
  if (det1 > 0 && det2 < 0 || det1 < 0 && det2 > 0) return true;
  return false;
}

// node_modules/@maplibre/maplibre-gl-style-spec/dist/expression/definitions/within.mjs
function getTilePolygon(coordinates, bbox, canonical) {
  const polygon = [];
  for (let i = 0; i < coordinates.length; i++) {
    const ring = [];
    for (let j = 0; j < coordinates[i].length; j++) {
      const coord = getTileCoordinates(coordinates[i][j], canonical);
      updateBBox(bbox, coord);
      ring.push(coord);
    }
    polygon.push(ring);
  }
  return polygon;
}
function getTilePolygons(coordinates, bbox, canonical) {
  const polygons = [];
  for (let i = 0; i < coordinates.length; i++) {
    const polygon = getTilePolygon(coordinates[i], bbox, canonical);
    polygons.push(polygon);
  }
  return polygons;
}
function updatePoint(p, bbox, polyBBox, worldSize) {
  if (p[0] < polyBBox[0] || p[0] > polyBBox[2]) {
    const halfWorldSize = worldSize * 0.5;
    let shift = p[0] - polyBBox[0] > halfWorldSize ? -worldSize : polyBBox[0] - p[0] > halfWorldSize ? worldSize : 0;
    if (shift === 0) shift = p[0] - polyBBox[2] > halfWorldSize ? -worldSize : polyBBox[2] - p[0] > halfWorldSize ? worldSize : 0;
    p[0] += shift;
  }
  updateBBox(bbox, p);
}
function resetBBox(bbox) {
  bbox[0] = bbox[1] = Infinity;
  bbox[2] = bbox[3] = -Infinity;
}
function getTilePoints(geometry, pointBBox, polyBBox, canonical) {
  const worldSize = Math.pow(2, canonical.z) * EXTENT;
  const shifts = [canonical.x * EXTENT, canonical.y * EXTENT];
  const tilePoints = [];
  for (const points of geometry) for (const point of points) {
    const p = [point.x + shifts[0], point.y + shifts[1]];
    updatePoint(p, pointBBox, polyBBox, worldSize);
    tilePoints.push(p);
  }
  return tilePoints;
}
function getTileLines(geometry, lineBBox, polyBBox, canonical) {
  const worldSize = Math.pow(2, canonical.z) * EXTENT;
  const shifts = [canonical.x * EXTENT, canonical.y * EXTENT];
  const tileLines = [];
  for (const line of geometry) {
    const tileLine = [];
    for (const point of line) {
      const p = [point.x + shifts[0], point.y + shifts[1]];
      updateBBox(lineBBox, p);
      tileLine.push(p);
    }
    tileLines.push(tileLine);
  }
  if (lineBBox[2] - lineBBox[0] <= worldSize / 2) {
    resetBBox(lineBBox);
    for (const line of tileLines) for (const p of line) updatePoint(p, lineBBox, polyBBox, worldSize);
  }
  return tileLines;
}
function pointsWithinPolygons(ctx, polygonGeometry) {
  const pointBBox = [
    Infinity,
    Infinity,
    -Infinity,
    -Infinity
  ];
  const polyBBox = [
    Infinity,
    Infinity,
    -Infinity,
    -Infinity
  ];
  const canonical = ctx.canonicalID();
  if (polygonGeometry.type === "Polygon") {
    const tilePolygon = getTilePolygon(polygonGeometry.coordinates, polyBBox, canonical);
    const tilePoints = getTilePoints(ctx.geometry(), pointBBox, polyBBox, canonical);
    if (!boxWithinBox(pointBBox, polyBBox)) return false;
    for (const point of tilePoints) if (!pointWithinPolygon(point, tilePolygon)) return false;
  }
  if (polygonGeometry.type === "MultiPolygon") {
    const tilePolygons = getTilePolygons(polygonGeometry.coordinates, polyBBox, canonical);
    const tilePoints = getTilePoints(ctx.geometry(), pointBBox, polyBBox, canonical);
    if (!boxWithinBox(pointBBox, polyBBox)) return false;
    for (const point of tilePoints) if (!pointWithinPolygons(point, tilePolygons)) return false;
  }
  return true;
}
function linesWithinPolygons(ctx, polygonGeometry) {
  const lineBBox = [
    Infinity,
    Infinity,
    -Infinity,
    -Infinity
  ];
  const polyBBox = [
    Infinity,
    Infinity,
    -Infinity,
    -Infinity
  ];
  const canonical = ctx.canonicalID();
  if (polygonGeometry.type === "Polygon") {
    const tilePolygon = getTilePolygon(polygonGeometry.coordinates, polyBBox, canonical);
    const tileLines = getTileLines(ctx.geometry(), lineBBox, polyBBox, canonical);
    if (!boxWithinBox(lineBBox, polyBBox)) return false;
    for (const line of tileLines) if (!lineStringWithinPolygon(line, tilePolygon)) return false;
  }
  if (polygonGeometry.type === "MultiPolygon") {
    const tilePolygons = getTilePolygons(polygonGeometry.coordinates, polyBBox, canonical);
    const tileLines = getTileLines(ctx.geometry(), lineBBox, polyBBox, canonical);
    if (!boxWithinBox(lineBBox, polyBBox)) return false;
    for (const line of tileLines) if (!lineStringWithinPolygons(line, tilePolygons)) return false;
  }
  return true;
}
var Within = class Within2 {
  constructor(geojson, geometries) {
    this.type = BooleanType;
    this.geojson = geojson;
    this.geometries = geometries;
  }
  static parse(args, context) {
    if (args.length !== 2) return context.error(`'within' expression requires exactly one argument, but found ${args.length - 1} instead.`);
    if (isValue(args[1])) {
      const geojson = args[1];
      if (geojson.type === "FeatureCollection") {
        const polygonsCoords = [];
        for (const polygon of geojson.features) {
          const { type, coordinates } = polygon.geometry;
          if (type === "Polygon") polygonsCoords.push(coordinates);
          if (type === "MultiPolygon") polygonsCoords.push(...coordinates);
        }
        if (polygonsCoords.length) return new Within2(geojson, {
          type: "MultiPolygon",
          coordinates: polygonsCoords
        });
      } else if (geojson.type === "Feature") {
        const type = geojson.geometry.type;
        if (type === "Polygon" || type === "MultiPolygon") return new Within2(geojson, geojson.geometry);
      } else if (geojson.type === "Polygon" || geojson.type === "MultiPolygon") return new Within2(geojson, geojson);
    }
    return context.error("'within' expression requires valid geojson object that contains polygon geometry type.");
  }
  evaluate(ctx) {
    if (ctx.geometry() != null && ctx.canonicalID() != null) {
      if (ctx.geometryType() === "Point") return pointsWithinPolygons(ctx, this.geometries);
      else if (ctx.geometryType() === "LineString") return linesWithinPolygons(ctx, this.geometries);
    }
    return false;
  }
  eachChild() {
  }
  outputDefined() {
    return true;
  }
};

// node_modules/@maplibre/maplibre-gl-style-spec/dist/node_modules/tinyqueue/index.mjs
var TinyQueue = class {
  constructor(data = [], compare2 = (a, b) => a < b ? -1 : a > b ? 1 : 0) {
    this.data = data;
    this.length = this.data.length;
    this.compare = compare2;
    if (this.length > 0) for (let i = (this.length >> 1) - 1; i >= 0; i--) this._down(i);
  }
  push(item) {
    this.data.push(item);
    this._up(this.length++);
  }
  pop() {
    if (this.length === 0) return void 0;
    const top = this.data[0];
    const bottom = this.data.pop();
    if (--this.length > 0) {
      this.data[0] = bottom;
      this._down(0);
    }
    return top;
  }
  peek() {
    return this.data[0];
  }
  _up(pos) {
    const { data, compare: compare2 } = this;
    const item = data[pos];
    while (pos > 0) {
      const parent = pos - 1 >> 1;
      const current = data[parent];
      if (compare2(item, current) >= 0) break;
      data[pos] = current;
      pos = parent;
    }
    data[pos] = item;
  }
  _down(pos) {
    const { data, compare: compare2 } = this;
    const halfLength = this.length >> 1;
    const item = data[pos];
    while (pos < halfLength) {
      let bestChild = (pos << 1) + 1;
      const right = bestChild + 1;
      if (right < this.length && compare2(data[right], data[bestChild]) < 0) bestChild = right;
      if (compare2(data[bestChild], item) >= 0) break;
      data[pos] = data[bestChild];
      pos = bestChild;
    }
    data[pos] = item;
  }
};

// node_modules/@maplibre/maplibre-gl-style-spec/dist/util/cheap_ruler.mjs
var RE = 6378.137;
var E2 = 0.0066943799901413165;
var RAD = Math.PI / 180;
var CheapRuler = class {
  constructor(lat) {
    const m = RAD * RE * 1e3;
    const coslat = Math.cos(lat * RAD);
    const w2 = 1 / (1 - E2 * (1 - coslat * coslat));
    const w = Math.sqrt(w2);
    this.kx = m * w * coslat;
    this.ky = m * w * w2 * 0.9933056200098587;
  }
  /**
  * Given two points of the form [longitude, latitude], returns the distance.
  *
  * @param a - point [longitude, latitude]
  * @param b - point [longitude, latitude]
  * @returns distance
  * @example
  * const distance = ruler.distance([30.5, 50.5], [30.51, 50.49]);
  * //=distance
  */
  distance(a, b) {
    const dx = this.wrap(a[0] - b[0]) * this.kx;
    const dy = (a[1] - b[1]) * this.ky;
    return Math.sqrt(dx * dx + dy * dy);
  }
  /**
  * Returns an object of the form {point, index, t}, where point is closest point on the line
  * from the given point, index is the start index of the segment with the closest point,
  * and t is a parameter from 0 to 1 that indicates where the closest point is on that segment.
  *
  * @param line - an array of points that form the line
  * @param p - point [longitude, latitude]
  * @returns the nearest point, its index in the array and the proportion along the line
  * @example
  * const point = ruler.pointOnLine(line, [-67.04, 50.5]).point;
  * //=point
  */
  pointOnLine(line, p) {
    let minDist = Infinity;
    let minX, minY, minI, minT;
    for (let i = 0; i < line.length - 1; i++) {
      let x = line[i][0];
      let y = line[i][1];
      let dx = this.wrap(line[i + 1][0] - x) * this.kx;
      let dy = (line[i + 1][1] - y) * this.ky;
      let t = 0;
      if (dx !== 0 || dy !== 0) {
        t = (this.wrap(p[0] - x) * this.kx * dx + (p[1] - y) * this.ky * dy) / (dx * dx + dy * dy);
        if (t > 1) {
          x = line[i + 1][0];
          y = line[i + 1][1];
        } else if (t > 0) {
          x += dx / this.kx * t;
          y += dy / this.ky * t;
        }
      }
      dx = this.wrap(p[0] - x) * this.kx;
      dy = (p[1] - y) * this.ky;
      const sqDist = dx * dx + dy * dy;
      if (sqDist < minDist) {
        minDist = sqDist;
        minX = x;
        minY = y;
        minI = i;
        minT = t;
      }
    }
    return {
      point: [minX, minY],
      index: minI,
      t: Math.max(0, Math.min(1, minT))
    };
  }
  wrap(deg) {
    while (deg < -180) deg += 360;
    while (deg > 180) deg -= 360;
    return deg;
  }
};

// node_modules/@maplibre/maplibre-gl-style-spec/dist/expression/definitions/distance.mjs
var MinPointsSize = 100;
var MinLinePointsSize = 50;
function compareDistPair(a, b) {
  return b[0] - a[0];
}
function getRangeSize(range) {
  return range[1] - range[0] + 1;
}
function isRangeSafe(range, threshold) {
  return range[1] >= range[0] && range[1] < threshold;
}
function splitRange(range, isLine) {
  if (range[0] > range[1]) return [null, null];
  const size = getRangeSize(range);
  if (isLine) {
    if (size === 2) return [range, null];
    const size12 = Math.floor(size / 2);
    return [[range[0], range[0] + size12], [range[0] + size12, range[1]]];
  }
  if (size === 1) return [range, null];
  const size1 = Math.floor(size / 2) - 1;
  return [[range[0], range[0] + size1], [range[0] + size1 + 1, range[1]]];
}
function getBBox(coords, range) {
  if (!isRangeSafe(range, coords.length)) return [
    Infinity,
    Infinity,
    -Infinity,
    -Infinity
  ];
  const bbox = [
    Infinity,
    Infinity,
    -Infinity,
    -Infinity
  ];
  for (let i = range[0]; i <= range[1]; ++i) updateBBox(bbox, coords[i]);
  return bbox;
}
function getPolygonBBox(polygon) {
  const bbox = [
    Infinity,
    Infinity,
    -Infinity,
    -Infinity
  ];
  for (const ring of polygon) for (const coord of ring) updateBBox(bbox, coord);
  return bbox;
}
function isValidBBox(bbox) {
  return bbox[0] !== -Infinity && bbox[1] !== -Infinity && bbox[2] !== Infinity && bbox[3] !== Infinity;
}
function bboxToBBoxDistance(bbox1, bbox2, ruler) {
  if (!isValidBBox(bbox1) || !isValidBBox(bbox2)) return NaN;
  let dx = 0;
  let dy = 0;
  if (bbox1[2] < bbox2[0]) dx = bbox2[0] - bbox1[2];
  if (bbox1[0] > bbox2[2]) dx = bbox1[0] - bbox2[2];
  if (bbox1[1] > bbox2[3]) dy = bbox1[1] - bbox2[3];
  if (bbox1[3] < bbox2[1]) dy = bbox2[1] - bbox1[3];
  return ruler.distance([0, 0], [dx, dy]);
}
function pointToLineDistance(point, line, ruler) {
  const nearestPoint = ruler.pointOnLine(line, point);
  return ruler.distance(point, nearestPoint.point);
}
function segmentToSegmentDistance(p1, p2, q1, q2, ruler) {
  const dist1 = Math.min(pointToLineDistance(p1, [q1, q2], ruler), pointToLineDistance(p2, [q1, q2], ruler));
  const dist2 = Math.min(pointToLineDistance(q1, [p1, p2], ruler), pointToLineDistance(q2, [p1, p2], ruler));
  return Math.min(dist1, dist2);
}
function lineToLineDistance(line1, range1, line2, range2, ruler) {
  if (!(isRangeSafe(range1, line1.length) && isRangeSafe(range2, line2.length))) return Infinity;
  let dist = Infinity;
  for (let i = range1[0]; i < range1[1]; ++i) {
    const p1 = line1[i];
    const p2 = line1[i + 1];
    for (let j = range2[0]; j < range2[1]; ++j) {
      const q1 = line2[j];
      const q2 = line2[j + 1];
      if (segmentIntersectSegment(p1, p2, q1, q2)) return 0;
      dist = Math.min(dist, segmentToSegmentDistance(p1, p2, q1, q2, ruler));
    }
  }
  return dist;
}
function pointsToPointsDistance(points1, range1, points2, range2, ruler) {
  if (!(isRangeSafe(range1, points1.length) && isRangeSafe(range2, points2.length))) return NaN;
  let dist = Infinity;
  for (let i = range1[0]; i <= range1[1]; ++i) for (let j = range2[0]; j <= range2[1]; ++j) {
    dist = Math.min(dist, ruler.distance(points1[i], points2[j]));
    if (dist === 0) return dist;
  }
  return dist;
}
function pointToPolygonDistance(point, polygon, ruler) {
  if (pointWithinPolygon(point, polygon, true)) return 0;
  let dist = Infinity;
  for (const ring of polygon) {
    const front = ring[0];
    const back = ring[ring.length - 1];
    if (front !== back) {
      dist = Math.min(dist, pointToLineDistance(point, [back, front], ruler));
      if (dist === 0) return dist;
    }
    const nearestPoint = ruler.pointOnLine(ring, point);
    dist = Math.min(dist, ruler.distance(point, nearestPoint.point));
    if (dist === 0) return dist;
  }
  return dist;
}
function lineToPolygonDistance(line, range, polygon, ruler) {
  if (!isRangeSafe(range, line.length)) return NaN;
  for (let i = range[0]; i <= range[1]; ++i) if (pointWithinPolygon(line[i], polygon, true)) return 0;
  let dist = Infinity;
  for (let i = range[0]; i < range[1]; ++i) {
    const p1 = line[i];
    const p2 = line[i + 1];
    for (const ring of polygon) for (let j = 0, len = ring.length, k = len - 1; j < len; k = j++) {
      const q1 = ring[k];
      const q2 = ring[j];
      if (segmentIntersectSegment(p1, p2, q1, q2)) return 0;
      dist = Math.min(dist, segmentToSegmentDistance(p1, p2, q1, q2, ruler));
    }
  }
  return dist;
}
function polygonIntersect(poly1, poly2) {
  for (const ring of poly1) for (const point of ring) if (pointWithinPolygon(point, poly2, true)) return true;
  return false;
}
function polygonToPolygonDistance(polygon1, polygon2, ruler, currentMiniDist = Infinity) {
  const bbox1 = getPolygonBBox(polygon1);
  const bbox2 = getPolygonBBox(polygon2);
  if (currentMiniDist !== Infinity && bboxToBBoxDistance(bbox1, bbox2, ruler) >= currentMiniDist) return currentMiniDist;
  if (boxWithinBox(bbox1, bbox2)) {
    if (polygonIntersect(polygon1, polygon2)) return 0;
  } else if (polygonIntersect(polygon2, polygon1)) return 0;
  let dist = Infinity;
  for (const ring1 of polygon1) for (let i = 0, len1 = ring1.length, l = len1 - 1; i < len1; l = i++) {
    const p1 = ring1[l];
    const p2 = ring1[i];
    for (const ring2 of polygon2) for (let j = 0, len2 = ring2.length, k = len2 - 1; j < len2; k = j++) {
      const q1 = ring2[k];
      const q2 = ring2[j];
      if (segmentIntersectSegment(p1, p2, q1, q2)) return 0;
      dist = Math.min(dist, segmentToSegmentDistance(p1, p2, q1, q2, ruler));
    }
  }
  return dist;
}
function updateQueue(distQueue, miniDist, ruler, points, polyBBox, rangeA) {
  if (!rangeA) return;
  const tempDist = bboxToBBoxDistance(getBBox(points, rangeA), polyBBox, ruler);
  if (tempDist < miniDist) distQueue.push([
    tempDist,
    rangeA,
    [0, 0]
  ]);
}
function updateQueueTwoSets(distQueue, miniDist, ruler, pointSet1, pointSet2, range1, range2) {
  if (!range1 || !range2) return;
  const tempDist = bboxToBBoxDistance(getBBox(pointSet1, range1), getBBox(pointSet2, range2), ruler);
  if (tempDist < miniDist) distQueue.push([
    tempDist,
    range1,
    range2
  ]);
}
function pointsToPolygonDistance(points, isLine, polygon, ruler, currentMiniDist = Infinity) {
  let miniDist = Math.min(ruler.distance(points[0], polygon[0][0]), currentMiniDist);
  if (miniDist === 0) return miniDist;
  const distQueue = new TinyQueue([[
    0,
    [0, points.length - 1],
    [0, 0]
  ]], compareDistPair);
  const polyBBox = getPolygonBBox(polygon);
  while (distQueue.length > 0) {
    const distPair = distQueue.pop();
    if (distPair[0] >= miniDist) continue;
    const range = distPair[1];
    const threshold = isLine ? MinLinePointsSize : MinPointsSize;
    if (getRangeSize(range) <= threshold) {
      if (!isRangeSafe(range, points.length)) return NaN;
      if (isLine) {
        const tempDist = lineToPolygonDistance(points, range, polygon, ruler);
        if (isNaN(tempDist) || tempDist === 0) return tempDist;
        miniDist = Math.min(miniDist, tempDist);
      } else for (let i = range[0]; i <= range[1]; ++i) {
        const tempDist = pointToPolygonDistance(points[i], polygon, ruler);
        miniDist = Math.min(miniDist, tempDist);
        if (miniDist === 0) return 0;
      }
    } else {
      const newRangesA = splitRange(range, isLine);
      updateQueue(distQueue, miniDist, ruler, points, polyBBox, newRangesA[0]);
      updateQueue(distQueue, miniDist, ruler, points, polyBBox, newRangesA[1]);
    }
  }
  return miniDist;
}
function pointSetToPointSetDistance(pointSet1, isLine1, pointSet2, isLine2, ruler, currentMiniDist = Infinity) {
  let miniDist = Math.min(currentMiniDist, ruler.distance(pointSet1[0], pointSet2[0]));
  if (miniDist === 0) return miniDist;
  const distQueue = new TinyQueue([[
    0,
    [0, pointSet1.length - 1],
    [0, pointSet2.length - 1]
  ]], compareDistPair);
  while (distQueue.length > 0) {
    const distPair = distQueue.pop();
    if (distPair[0] >= miniDist) continue;
    const rangeA = distPair[1];
    const rangeB = distPair[2];
    const threshold1 = isLine1 ? MinLinePointsSize : MinPointsSize;
    const threshold2 = isLine2 ? MinLinePointsSize : MinPointsSize;
    if (getRangeSize(rangeA) <= threshold1 && getRangeSize(rangeB) <= threshold2) {
      if (!isRangeSafe(rangeA, pointSet1.length) && isRangeSafe(rangeB, pointSet2.length)) return NaN;
      let tempDist;
      if (isLine1 && isLine2) {
        tempDist = lineToLineDistance(pointSet1, rangeA, pointSet2, rangeB, ruler);
        miniDist = Math.min(miniDist, tempDist);
      } else if (isLine1 && !isLine2) {
        const sublibe = pointSet1.slice(rangeA[0], rangeA[1] + 1);
        for (let i = rangeB[0]; i <= rangeB[1]; ++i) {
          tempDist = pointToLineDistance(pointSet2[i], sublibe, ruler);
          miniDist = Math.min(miniDist, tempDist);
          if (miniDist === 0) return miniDist;
        }
      } else if (!isLine1 && isLine2) {
        const sublibe = pointSet2.slice(rangeB[0], rangeB[1] + 1);
        for (let i = rangeA[0]; i <= rangeA[1]; ++i) {
          tempDist = pointToLineDistance(pointSet1[i], sublibe, ruler);
          miniDist = Math.min(miniDist, tempDist);
          if (miniDist === 0) return miniDist;
        }
      } else {
        tempDist = pointsToPointsDistance(pointSet1, rangeA, pointSet2, rangeB, ruler);
        miniDist = Math.min(miniDist, tempDist);
      }
    } else {
      const newRangesA = splitRange(rangeA, isLine1);
      const newRangesB = splitRange(rangeB, isLine2);
      updateQueueTwoSets(distQueue, miniDist, ruler, pointSet1, pointSet2, newRangesA[0], newRangesB[0]);
      updateQueueTwoSets(distQueue, miniDist, ruler, pointSet1, pointSet2, newRangesA[0], newRangesB[1]);
      updateQueueTwoSets(distQueue, miniDist, ruler, pointSet1, pointSet2, newRangesA[1], newRangesB[0]);
      updateQueueTwoSets(distQueue, miniDist, ruler, pointSet1, pointSet2, newRangesA[1], newRangesB[1]);
    }
  }
  return miniDist;
}
function pointToGeometryDistance(ctx, geometries) {
  const tilePoints = ctx.geometry();
  const pointPosition = tilePoints.flat().map((p) => getLngLatFromTileCoord([p.x, p.y], ctx.canonical));
  if (tilePoints.length === 0) return NaN;
  const ruler = new CheapRuler(pointPosition[0][1]);
  let dist = Infinity;
  for (const geometry of geometries) {
    switch (geometry.type) {
      case "Point":
        dist = Math.min(dist, pointSetToPointSetDistance(pointPosition, false, [geometry.coordinates], false, ruler, dist));
        break;
      case "LineString":
        dist = Math.min(dist, pointSetToPointSetDistance(pointPosition, false, geometry.coordinates, true, ruler, dist));
        break;
      case "Polygon":
        dist = Math.min(dist, pointsToPolygonDistance(pointPosition, false, geometry.coordinates, ruler, dist));
    }
    if (dist === 0) return dist;
  }
  return dist;
}
function lineStringToGeometryDistance(ctx, geometries) {
  const tileLine = ctx.geometry();
  const linePositions = tileLine.flat().map((p) => getLngLatFromTileCoord([p.x, p.y], ctx.canonical));
  if (tileLine.length === 0) return NaN;
  const ruler = new CheapRuler(linePositions[0][1]);
  let dist = Infinity;
  for (const geometry of geometries) {
    switch (geometry.type) {
      case "Point":
        dist = Math.min(dist, pointSetToPointSetDistance(linePositions, true, [geometry.coordinates], false, ruler, dist));
        break;
      case "LineString":
        dist = Math.min(dist, pointSetToPointSetDistance(linePositions, true, geometry.coordinates, true, ruler, dist));
        break;
      case "Polygon":
        dist = Math.min(dist, pointsToPolygonDistance(linePositions, true, geometry.coordinates, ruler, dist));
    }
    if (dist === 0) return dist;
  }
  return dist;
}
function polygonToGeometryDistance(ctx, geometries) {
  const tilePolygon = ctx.geometry();
  if (tilePolygon.length === 0 || tilePolygon[0].length === 0) return NaN;
  const polygons = classifyRings(tilePolygon, 0).map((polygon) => {
    return polygon.map((ring) => {
      return ring.map((p) => getLngLatFromTileCoord([p.x, p.y], ctx.canonical));
    });
  });
  const ruler = new CheapRuler(polygons[0][0][0][1]);
  let dist = Infinity;
  for (const geometry of geometries) for (const polygon of polygons) {
    switch (geometry.type) {
      case "Point":
        dist = Math.min(dist, pointsToPolygonDistance([geometry.coordinates], false, polygon, ruler, dist));
        break;
      case "LineString":
        dist = Math.min(dist, pointsToPolygonDistance(geometry.coordinates, true, polygon, ruler, dist));
        break;
      case "Polygon":
        dist = Math.min(dist, polygonToPolygonDistance(polygon, geometry.coordinates, ruler, dist));
    }
    if (dist === 0) return dist;
  }
  return dist;
}
function toSimpleGeometry(geometry) {
  if (geometry.type === "MultiPolygon") return geometry.coordinates.map((polygon) => {
    return {
      type: "Polygon",
      coordinates: polygon
    };
  });
  if (geometry.type === "MultiLineString") return geometry.coordinates.map((lineString) => {
    return {
      type: "LineString",
      coordinates: lineString
    };
  });
  if (geometry.type === "MultiPoint") return geometry.coordinates.map((point) => {
    return {
      type: "Point",
      coordinates: point
    };
  });
  return [geometry];
}
var Distance = class Distance2 {
  constructor(geojson, geometries) {
    this.type = NumberType;
    this.geojson = geojson;
    this.geometries = geometries;
  }
  static parse(args, context) {
    if (args.length !== 2) return context.error(`'distance' expression requires exactly one argument, but found ${args.length - 1} instead.`);
    if (isValue(args[1])) {
      const geojson = args[1];
      if (geojson.type === "FeatureCollection") return new Distance2(geojson, geojson.features.map((feature) => toSimpleGeometry(feature.geometry)).flat());
      else if (geojson.type === "Feature") return new Distance2(geojson, toSimpleGeometry(geojson.geometry));
      else if ("type" in geojson && "coordinates" in geojson) return new Distance2(geojson, toSimpleGeometry(geojson));
    }
    return context.error("'distance' expression requires valid geojson object that contains polygon geometry type.");
  }
  evaluate(ctx) {
    if (ctx.geometry() != null && ctx.canonicalID() != null) {
      if (ctx.geometryType() === "Point") return pointToGeometryDistance(ctx, this.geometries);
      else if (ctx.geometryType() === "LineString") return lineStringToGeometryDistance(ctx, this.geometries);
      else if (ctx.geometryType() === "Polygon") return polygonToGeometryDistance(ctx, this.geometries);
    }
    return NaN;
  }
  eachChild() {
  }
  outputDefined() {
    return true;
  }
};

// node_modules/@maplibre/maplibre-gl-style-spec/dist/expression/definitions/semiliteral.mjs
var Semiliteral = class Semiliteral2 {
  constructor(arr) {
    let elementType = null;
    for (const expr of arr) if (!elementType) elementType = expr.type;
    else if (elementType === expr.type) continue;
    else {
      elementType = ValueType;
      break;
    }
    this.type = array(elementType ?? ValueType, arr.length);
    this.arr = arr;
  }
  static parse(args, context) {
    if (args.length !== 2) return context.error(`'semiliteral' expression requires exactly one argument, but found ${args.length - 1} instead.`);
    if (!isValue(args[1])) return context.error(`invalid value of type "${typeof args[1]}"`);
    const value = args[1];
    const type = typeOf(value);
    if (type.kind === "array") {
      const parsed = value.map((item) => context.parse(item, null, ValueType));
      return new Semiliteral2(parsed);
    } else return new Literal(type, value);
  }
  evaluate(ctx) {
    return this.arr.map((arg) => arg.evaluate(ctx));
  }
  eachChild(fn) {
    this.arr.forEach(fn);
  }
  outputDefined() {
    return this.arr.every((arg) => arg.outputDefined());
  }
};

// node_modules/@maplibre/maplibre-gl-style-spec/dist/expression/definitions/global_state.mjs
var GlobalState = class GlobalState2 {
  constructor(key) {
    this.key = key;
    this.type = ValueType;
  }
  static parse(args, context) {
    if (args.length !== 2) return context.error(`Expected 1 argument, but found ${args.length - 1} instead.`);
    const key = args[1];
    if (key === void 0 || key === null) return context.error("Global state property must be defined.");
    if (typeof key !== "string") return context.error(`Global state property must be string, but found ${typeof args[1]} instead.`);
    return new GlobalState2(key);
  }
  evaluate(ctx) {
    const globalState = ctx.globals?.globalState;
    if (!globalState || Object.keys(globalState).length === 0) return null;
    return getOwn(globalState, this.key) ?? null;
  }
  eachChild() {
  }
  outputDefined() {
    return false;
  }
};

// node_modules/@maplibre/maplibre-gl-style-spec/dist/expression/definitions/index.mjs
var expressions = {
  "==": Equals,
  "!=": NotEquals,
  ">": GreaterThan,
  "<": LessThan,
  ">=": GreaterThanOrEqual,
  "<=": LessThanOrEqual,
  array: Assertion,
  at: At,
  boolean: Assertion,
  case: Case,
  coalesce: Coalesce,
  collator: CollatorExpression,
  format: FormatExpression,
  image: ImageExpression,
  in: In,
  "index-of": IndexOf,
  interpolate: Interpolate,
  "interpolate-hcl": Interpolate,
  "interpolate-lab": Interpolate,
  length: Length,
  let: Let,
  literal: Literal,
  match: Match,
  number: Assertion,
  "number-format": NumberFormat,
  object: Assertion,
  semiliteral: Semiliteral,
  slice: Slice,
  step: Step,
  string: Assertion,
  "to-boolean": Coercion,
  "to-color": Coercion,
  "to-number": Coercion,
  "to-string": Coercion,
  var: Var,
  within: Within,
  distance: Distance,
  "global-state": GlobalState
};

// node_modules/@maplibre/maplibre-gl-style-spec/dist/expression/parsing_error.mjs
var ExpressionParsingError = class extends Error {
  constructor(key, message) {
    super(message);
    this.message = message;
    this.key = key;
  }
};

// node_modules/@maplibre/maplibre-gl-style-spec/dist/expression/scope.mjs
var Scope = class Scope2 {
  constructor(parent, bindings = []) {
    this.parent = parent;
    this.bindings = {};
    for (const [name, expression] of bindings) this.bindings[name] = expression;
  }
  concat(bindings) {
    return new Scope2(this, bindings);
  }
  get(name) {
    if (this.bindings[name]) return this.bindings[name];
    if (this.parent) return this.parent.get(name);
    throw new Error(`${name} not found in scope.`);
  }
  has(name) {
    if (this.bindings[name]) return true;
    return this.parent ? this.parent.has(name) : false;
  }
};

// node_modules/@maplibre/maplibre-gl-style-spec/dist/expression/parsing_context.mjs
var ParsingContext = class ParsingContext2 {
  constructor(registry, isConstantFunc, path = [], expectedType, scope = new Scope(), errors = []) {
    this.registry = registry;
    this.path = path;
    this.key = path.map((part) => `[${part}]`).join("");
    this.scope = scope;
    this.errors = errors;
    this.expectedType = expectedType;
    this._isConstant = isConstantFunc;
  }
  /**
  * @param expr the JSON expression to parse
  * @param index the optional argument index if this expression is an argument of a parent expression that's being parsed
  * @param options
  * @param options.omitTypeAnnotations set true to omit inferred type annotations.  Caller beware: with this option set, the parsed expression's type will NOT satisfy `expectedType` if it would normally be wrapped in an inferred annotation.
  * @private
  */
  parse(expr, index, expectedType, bindings, options = {}) {
    if (index) return this.concat(index, expectedType, bindings)._parse(expr, options);
    return this._parse(expr, options);
  }
  _parse(expr, options) {
    if (expr === null || typeof expr === "string" || typeof expr === "boolean" || typeof expr === "number") expr = ["literal", expr];
    const key = this.key;
    function annotate(parsed, type, typeAnnotation) {
      if (typeAnnotation === "assert") return new Assertion(type, [parsed], key);
      else if (typeAnnotation === "coerce") return new Coercion(type, [parsed], key);
      else return parsed;
    }
    if (Array.isArray(expr)) {
      if (expr.length === 0) return this.error('Expected an array with at least one element. If you wanted a literal array, use ["literal", []].');
      const op = expr[0];
      if (typeof op !== "string") {
        this.error(`Expression name must be a string, but found ${typeof op} instead. If you wanted a literal array, use ["literal", [...]].`, 0);
        return null;
      }
      const Expr = this.registry[op];
      if (Expr) {
        let parsed = Expr.parse(expr, this);
        if (!parsed) return null;
        if (this.expectedType) {
          const expected = this.expectedType;
          const actual = parsed.type;
          if ((expected.kind === "string" || expected.kind === "number" || expected.kind === "boolean" || expected.kind === "object" || expected.kind === "array") && actual.kind === "value") parsed = annotate(parsed, expected, options.typeAnnotation || "assert");
          else if ("projectionDefinition" === expected.kind && [
            "string",
            "array",
            "value"
          ].includes(actual.kind) || [
            "color",
            "formatted",
            "resolvedImage"
          ].includes(expected.kind) && ["value", "string"].includes(actual.kind) || ["padding", "numberArray"].includes(expected.kind) && [
            "value",
            "number",
            "array"
          ].includes(actual.kind) || "colorArray" === expected.kind && [
            "value",
            "string",
            "array"
          ].includes(actual.kind) || "variableAnchorOffsetCollection" === expected.kind && ["value", "array"].includes(actual.kind)) parsed = annotate(parsed, expected, options.typeAnnotation || "coerce");
          else if (this.checkSubtype(expected, actual)) return null;
        }
        if (!(parsed instanceof Literal) && parsed.type.kind !== "resolvedImage" && this._isConstant(parsed)) {
          const ec = new EvaluationContext();
          try {
            parsed = new Literal(parsed.type, parsed.evaluate(ec));
          } catch (e) {
            this.error(e.message);
            return null;
          }
        }
        return parsed;
      }
      return this.error(`Unknown expression "${op}". If you wanted a literal array, use ["literal", [...]].`, 0);
    } else if (typeof expr === "undefined") return this.error("'undefined' value invalid. Use null instead.");
    else if (typeof expr === "object") return this.error('Bare objects invalid. Use ["literal", {...}] instead.');
    else return this.error(`Expected an array, but found ${typeof expr} instead.`);
  }
  /**
  * Returns a copy of this context suitable for parsing the subexpression at
  * index `index`, optionally appending to 'let' binding map.
  *
  * Note that `errors` property, intended for collecting errors while
  * parsing, is copied by reference rather than cloned.
  * @private
  */
  concat(index, expectedType, bindings) {
    const path = typeof index === "number" ? this.path.concat(index) : this.path;
    const scope = bindings ? this.scope.concat(bindings) : this.scope;
    return new ParsingContext2(this.registry, this._isConstant, path, expectedType || null, scope, this.errors);
  }
  /**
  * Push a parsing (or type checking) error into the `this.errors`
  * @param error The message
  * @param keys Optionally specify the source of the error at a child
  * of the current expression at `this.key`.
  * @private
  */
  error(error2, ...keys) {
    const key = `${this.key}${keys.map((k) => `[${k}]`).join("")}`;
    this.errors.push(new ExpressionParsingError(key, error2));
  }
  /**
  * Returns null if `t` is a subtype of `expected`; otherwise returns an
  * error message and also pushes it to `this.errors`.
  * @param expected The expected type
  * @param t The actual type
  * @returns null if `t` is a subtype of `expected`; otherwise returns an error message
  */
  checkSubtype(expected, t) {
    const error2 = checkSubtype(expected, t);
    if (error2) this.error(error2);
    return error2;
  }
};

// node_modules/@maplibre/maplibre-gl-style-spec/dist/expression/compound_expression.mjs
var CompoundExpression = class CompoundExpression2 {
  constructor(name, type, evaluate, args, key) {
    this.name = name;
    this.type = type;
    this._evaluate = evaluate;
    this.args = args;
    this.key = key;
  }
  evaluate(ctx) {
    return this._evaluate(ctx, this.args, this.key);
  }
  eachChild(fn) {
    this.args.forEach(fn);
  }
  outputDefined() {
    return false;
  }
  static parse(args, context) {
    const op = args[0];
    const definition = CompoundExpression2.definitions[op];
    if (!definition) return context.error(`Unknown expression "${op}". If you wanted a literal array, use ["literal", [...]].`, 0);
    const type = Array.isArray(definition) ? definition[0] : definition.type;
    const availableOverloads = Array.isArray(definition) ? [[definition[1], definition[2]]] : definition.overloads;
    const overloads = availableOverloads.filter(([signature]) => !Array.isArray(signature) || signature.length === args.length - 1);
    let signatureContext = null;
    for (const [params, evaluate] of overloads) {
      signatureContext = new ParsingContext(context.registry, isExpressionConstant, context.path, null, context.scope);
      const parsedArgs = [];
      let argParseFailed = false;
      for (let i = 1; i < args.length; i++) {
        const arg = args[i];
        const expectedType = Array.isArray(params) ? params[i - 1] : params.type;
        const parsed = signatureContext.parse(arg, 1 + parsedArgs.length, expectedType);
        if (!parsed) {
          argParseFailed = true;
          break;
        }
        parsedArgs.push(parsed);
      }
      if (argParseFailed) continue;
      if (Array.isArray(params)) {
        if (params.length !== parsedArgs.length) {
          signatureContext.error(`Expected ${params.length} arguments, but found ${parsedArgs.length} instead.`);
          continue;
        }
      }
      for (let i = 0; i < parsedArgs.length; i++) {
        const expected = Array.isArray(params) ? params[i] : params.type;
        const arg = parsedArgs[i];
        signatureContext.concat(i + 1).checkSubtype(expected, arg.type);
      }
      if (signatureContext.errors.length === 0) return new CompoundExpression2(op, type, evaluate, parsedArgs, context.key);
    }
    if (overloads.length === 1) context.errors.push(...signatureContext.errors);
    else {
      const signatures = (overloads.length ? overloads : availableOverloads).map(([params]) => stringifySignature(params)).join(" | ");
      const actualTypes = [];
      for (let i = 1; i < args.length; i++) {
        const parsed = context.parse(args[i], 1 + actualTypes.length);
        if (!parsed) return null;
        actualTypes.push(typeToString(parsed.type));
      }
      context.error(`Expected arguments of type ${signatures}, but found (${actualTypes.join(", ")}) instead.`);
    }
    return null;
  }
  static register(registry, definitions) {
    CompoundExpression2.definitions = definitions;
    for (const name in definitions) registry[name] = CompoundExpression2;
  }
};
function rgba(ctx, [r, g, b, a], key) {
  r = r.evaluate(ctx);
  g = g.evaluate(ctx);
  b = b.evaluate(ctx);
  const alpha = a ? a.evaluate(ctx) : 1;
  const error2 = validateRGBA(r, g, b, alpha);
  if (error2) throw new RuntimeError(error2, key);
  return new Color(r / 255, g / 255, b / 255, alpha, false);
}
function has(key, obj) {
  return key in obj && obj[key] !== void 0;
}
function get(key, obj) {
  const v = obj[key];
  return typeof v === "undefined" ? null : v;
}
function binarySearch(v, a, i, j) {
  while (i <= j) {
    const m = i + j >> 1;
    if (a[m] === v) return true;
    if (a[m] > v) j = m - 1;
    else i = m + 1;
  }
  return false;
}
function varargs(type) {
  return { type };
}
CompoundExpression.register(expressions, {
  error: [
    ErrorType,
    [StringType],
    (ctx, [v], key) => {
      throw new RuntimeError(v.evaluate(ctx), key);
    }
  ],
  typeof: [
    StringType,
    [ValueType],
    (ctx, [v]) => typeToString(typeOf(v.evaluate(ctx)))
  ],
  "to-rgba": [
    array(NumberType, 4),
    [ColorType],
    (ctx, [v]) => {
      const [r, g, b, a] = v.evaluate(ctx).rgb;
      return [
        r * 255,
        g * 255,
        b * 255,
        a
      ];
    }
  ],
  rgb: [
    ColorType,
    [
      NumberType,
      NumberType,
      NumberType
    ],
    rgba
  ],
  rgba: [
    ColorType,
    [
      NumberType,
      NumberType,
      NumberType,
      NumberType
    ],
    rgba
  ],
  has: {
    type: BooleanType,
    overloads: [[[StringType], (ctx, [key]) => has(key.evaluate(ctx), ctx.properties())], [[StringType, ObjectType], (ctx, [key, obj]) => has(key.evaluate(ctx), obj.evaluate(ctx))]]
  },
  get: {
    type: ValueType,
    overloads: [[[StringType], (ctx, [key]) => get(key.evaluate(ctx), ctx.properties())], [[StringType, ObjectType], (ctx, [key, obj]) => get(key.evaluate(ctx), obj.evaluate(ctx))]]
  },
  "feature-state": [
    ValueType,
    [StringType],
    (ctx, [key]) => get(key.evaluate(ctx), ctx.featureState || {})
  ],
  properties: [
    ObjectType,
    [],
    (ctx) => ctx.properties()
  ],
  "geometry-type": [
    StringType,
    [],
    (ctx) => ctx.geometryType()
  ],
  id: [
    ValueType,
    [],
    (ctx) => ctx.id()
  ],
  zoom: [
    NumberType,
    [],
    (ctx) => ctx.globals.zoom
  ],
  "heatmap-density": [
    NumberType,
    [],
    (ctx) => ctx.globals.heatmapDensity || 0
  ],
  elevation: [
    NumberType,
    [],
    (ctx) => ctx.globals.elevation || 0
  ],
  "line-progress": [
    NumberType,
    [],
    (ctx) => ctx.globals.lineProgress || 0
  ],
  accumulated: [
    ValueType,
    [],
    (ctx) => ctx.globals.accumulated === void 0 ? null : ctx.globals.accumulated
  ],
  "+": [
    NumberType,
    varargs(NumberType),
    (ctx, args) => {
      let result = 0;
      for (const arg of args) result += arg.evaluate(ctx);
      return result;
    }
  ],
  "*": [
    NumberType,
    varargs(NumberType),
    (ctx, args) => {
      let result = 1;
      for (const arg of args) result *= arg.evaluate(ctx);
      return result;
    }
  ],
  "-": {
    type: NumberType,
    overloads: [[[NumberType, NumberType], (ctx, [a, b]) => a.evaluate(ctx) - b.evaluate(ctx)], [[NumberType], (ctx, [a]) => -a.evaluate(ctx)]]
  },
  "/": [
    NumberType,
    [NumberType, NumberType],
    (ctx, [a, b]) => a.evaluate(ctx) / b.evaluate(ctx)
  ],
  "%": [
    NumberType,
    [NumberType, NumberType],
    (ctx, [a, b]) => a.evaluate(ctx) % b.evaluate(ctx)
  ],
  ln2: [
    NumberType,
    [],
    () => Math.LN2
  ],
  pi: [
    NumberType,
    [],
    () => Math.PI
  ],
  e: [
    NumberType,
    [],
    () => Math.E
  ],
  "^": [
    NumberType,
    [NumberType, NumberType],
    (ctx, [b, e]) => Math.pow(b.evaluate(ctx), e.evaluate(ctx))
  ],
  sqrt: [
    NumberType,
    [NumberType],
    (ctx, [x]) => Math.sqrt(x.evaluate(ctx))
  ],
  log10: [
    NumberType,
    [NumberType],
    (ctx, [n]) => Math.log(n.evaluate(ctx)) / Math.LN10
  ],
  ln: [
    NumberType,
    [NumberType],
    (ctx, [n]) => Math.log(n.evaluate(ctx))
  ],
  log2: [
    NumberType,
    [NumberType],
    (ctx, [n]) => Math.log(n.evaluate(ctx)) / Math.LN2
  ],
  sin: [
    NumberType,
    [NumberType],
    (ctx, [n]) => Math.sin(n.evaluate(ctx))
  ],
  cos: [
    NumberType,
    [NumberType],
    (ctx, [n]) => Math.cos(n.evaluate(ctx))
  ],
  tan: [
    NumberType,
    [NumberType],
    (ctx, [n]) => Math.tan(n.evaluate(ctx))
  ],
  asin: [
    NumberType,
    [NumberType],
    (ctx, [n]) => Math.asin(n.evaluate(ctx))
  ],
  acos: [
    NumberType,
    [NumberType],
    (ctx, [n]) => Math.acos(n.evaluate(ctx))
  ],
  atan: [
    NumberType,
    [NumberType],
    (ctx, [n]) => Math.atan(n.evaluate(ctx))
  ],
  min: [
    NumberType,
    varargs(NumberType),
    (ctx, args) => Math.min(...args.map((arg) => arg.evaluate(ctx)))
  ],
  max: [
    NumberType,
    varargs(NumberType),
    (ctx, args) => Math.max(...args.map((arg) => arg.evaluate(ctx)))
  ],
  abs: [
    NumberType,
    [NumberType],
    (ctx, [n]) => Math.abs(n.evaluate(ctx))
  ],
  round: [
    NumberType,
    [NumberType],
    (ctx, [n]) => {
      const v = n.evaluate(ctx);
      return v < 0 ? -Math.round(-v) : Math.round(v);
    }
  ],
  floor: [
    NumberType,
    [NumberType],
    (ctx, [n]) => Math.floor(n.evaluate(ctx))
  ],
  ceil: [
    NumberType,
    [NumberType],
    (ctx, [n]) => Math.ceil(n.evaluate(ctx))
  ],
  "filter-==": [
    BooleanType,
    [StringType, ValueType],
    (ctx, [k, v]) => ctx.properties()[k.value] === v.value
  ],
  "filter-id-==": [
    BooleanType,
    [ValueType],
    (ctx, [v]) => ctx.id() === v.value
  ],
  "filter-type-==": [
    BooleanType,
    [StringType],
    (ctx, [v]) => ctx.geometryType() === v.value
  ],
  "filter-<": [
    BooleanType,
    [StringType, ValueType],
    (ctx, [k, v]) => {
      const a = ctx.properties()[k.value];
      const b = v.value;
      return typeof a === typeof b && a < b;
    }
  ],
  "filter-id-<": [
    BooleanType,
    [ValueType],
    (ctx, [v]) => {
      const a = ctx.id();
      const b = v.value;
      return typeof a === typeof b && a < b;
    }
  ],
  "filter->": [
    BooleanType,
    [StringType, ValueType],
    (ctx, [k, v]) => {
      const a = ctx.properties()[k.value];
      const b = v.value;
      return typeof a === typeof b && a > b;
    }
  ],
  "filter-id->": [
    BooleanType,
    [ValueType],
    (ctx, [v]) => {
      const a = ctx.id();
      const b = v.value;
      return typeof a === typeof b && a > b;
    }
  ],
  "filter-<=": [
    BooleanType,
    [StringType, ValueType],
    (ctx, [k, v]) => {
      const a = ctx.properties()[k.value];
      const b = v.value;
      return typeof a === typeof b && a <= b;
    }
  ],
  "filter-id-<=": [
    BooleanType,
    [ValueType],
    (ctx, [v]) => {
      const a = ctx.id();
      const b = v.value;
      return typeof a === typeof b && a <= b;
    }
  ],
  "filter->=": [
    BooleanType,
    [StringType, ValueType],
    (ctx, [k, v]) => {
      const a = ctx.properties()[k.value];
      const b = v.value;
      return typeof a === typeof b && a >= b;
    }
  ],
  "filter-id->=": [
    BooleanType,
    [ValueType],
    (ctx, [v]) => {
      const a = ctx.id();
      const b = v.value;
      return typeof a === typeof b && a >= b;
    }
  ],
  "filter-has": [
    BooleanType,
    [ValueType],
    (ctx, [k]) => {
      const key = k.value;
      const props = ctx.properties();
      return key in props && props[key] !== void 0;
    }
  ],
  "filter-has-id": [
    BooleanType,
    [],
    (ctx) => ctx.id() !== null && ctx.id() !== void 0
  ],
  "filter-type-in": [
    BooleanType,
    [array(StringType)],
    (ctx, [v]) => v.value.indexOf(ctx.geometryType()) >= 0
  ],
  "filter-id-in": [
    BooleanType,
    [array(ValueType)],
    (ctx, [v]) => v.value.indexOf(ctx.id()) >= 0
  ],
  "filter-in-small": [
    BooleanType,
    [StringType, array(ValueType)],
    (ctx, [k, v]) => v.value.indexOf(ctx.properties()[k.value]) >= 0
  ],
  "filter-in-large": [
    BooleanType,
    [StringType, array(ValueType)],
    (ctx, [k, v]) => binarySearch(ctx.properties()[k.value], v.value, 0, v.value.length - 1)
  ],
  all: {
    type: BooleanType,
    overloads: [[[BooleanType, BooleanType], (ctx, [a, b]) => a.evaluate(ctx) && b.evaluate(ctx)], [varargs(BooleanType), (ctx, args) => {
      for (const arg of args) if (!arg.evaluate(ctx)) return false;
      return true;
    }]]
  },
  any: {
    type: BooleanType,
    overloads: [[[BooleanType, BooleanType], (ctx, [a, b]) => a.evaluate(ctx) || b.evaluate(ctx)], [varargs(BooleanType), (ctx, args) => {
      for (const arg of args) if (arg.evaluate(ctx)) return true;
      return false;
    }]]
  },
  "!": [
    BooleanType,
    [BooleanType],
    (ctx, [b]) => !b.evaluate(ctx)
  ],
  "is-supported-script": [
    BooleanType,
    [StringType],
    (ctx, [s]) => {
      const isSupportedScript = ctx.globals && ctx.globals.isSupportedScript;
      if (isSupportedScript) return isSupportedScript(s.evaluate(ctx));
      return true;
    }
  ],
  upcase: [
    StringType,
    [StringType],
    (ctx, [s]) => s.evaluate(ctx).toUpperCase()
  ],
  downcase: [
    StringType,
    [StringType],
    (ctx, [s]) => s.evaluate(ctx).toLowerCase()
  ],
  concat: [
    StringType,
    varargs(ValueType),
    (ctx, args) => args.map((arg) => valueToString(arg.evaluate(ctx))).join("")
  ],
  split: [
    array(StringType),
    [StringType, StringType],
    (ctx, [s, delim]) => s.evaluate(ctx).split(delim.evaluate(ctx))
  ],
  join: [
    StringType,
    [array(StringType), StringType],
    (ctx, [arr, delim]) => arr.evaluate(ctx).join(delim.evaluate(ctx))
  ],
  "resolved-locale": [
    StringType,
    [CollatorType],
    (ctx, [collator]) => collator.evaluate(ctx).resolvedLocale()
  ]
});
function stringifySignature(signature) {
  if (Array.isArray(signature)) return `(${signature.map(typeToString).join(", ")})`;
  else return `(${typeToString(signature.type)}...)`;
}
function isExpressionConstant(expression) {
  if (expression instanceof Var) return isExpressionConstant(expression.boundExpression);
  else if (expression instanceof CompoundExpression && expression.name === "error") return false;
  else if (expression instanceof CollatorExpression) return false;
  else if (expression instanceof Within) return false;
  else if (expression instanceof Distance) return false;
  else if (expression instanceof GlobalState) return false;
  const isTypeAnnotation = expression instanceof Coercion || expression instanceof Assertion;
  let childrenConstant = true;
  expression.eachChild((child) => {
    if (isTypeAnnotation) childrenConstant = childrenConstant && isExpressionConstant(child);
    else childrenConstant = childrenConstant && child instanceof Literal;
  });
  if (!childrenConstant) return false;
  return isFeatureConstant(expression) && isGlobalPropertyConstant(expression, [
    "zoom",
    "heatmap-density",
    "elevation",
    "line-progress",
    "accumulated",
    "is-supported-script"
  ]);
}
function isFeatureConstant(e) {
  if (e instanceof CompoundExpression) {
    if (e.name === "get" && e.args.length === 1) return false;
    else if (e.name === "feature-state") return false;
    else if (e.name === "has" && e.args.length === 1) return false;
    else if (e.name === "properties" || e.name === "geometry-type" || e.name === "id") return false;
    else if (/^filter-/.test(e.name)) return false;
  }
  if (e instanceof Within) return false;
  if (e instanceof Distance) return false;
  let result = true;
  e.eachChild((arg) => {
    if (result && !isFeatureConstant(arg)) result = false;
  });
  return result;
}
function isStateConstant(e) {
  if (e instanceof CompoundExpression) {
    if (e.name === "feature-state") return false;
  }
  let result = true;
  e.eachChild((arg) => {
    if (result && !isStateConstant(arg)) result = false;
  });
  return result;
}
function isGlobalPropertyConstant(e, properties) {
  if (e instanceof CompoundExpression && properties.indexOf(e.name) >= 0) return false;
  let result = true;
  e.eachChild((arg) => {
    if (result && !isGlobalPropertyConstant(arg, properties)) result = false;
  });
  return result;
}

// node_modules/@maplibre/maplibre-gl-style-spec/dist/util/properties.mjs
function supportsPropertyExpression(spec) {
  return spec["property-type"] === "data-driven" || spec["property-type"] === "cross-faded-data-driven";
}
function supportsZoomExpression(spec) {
  return !!spec.expression && spec.expression.parameters.indexOf("zoom") > -1;
}
function supportsInterpolation(spec) {
  return !!spec.expression && spec.expression.interpolated;
}

// node_modules/@maplibre/maplibre-gl-style-spec/dist/function/index.mjs
function isFunction(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) && typeOf(value) === ObjectType;
}

// node_modules/@maplibre/maplibre-gl-style-spec/dist/util/result.mjs
function success(value) {
  return {
    result: "success",
    value
  };
}
function error(value) {
  return {
    result: "error",
    value
  };
}

// node_modules/@maplibre/maplibre-gl-style-spec/dist/expression/index.mjs
var StyleExpression = class {
  constructor(expression, rootKey, propertySpec, globalState) {
    this.expression = expression;
    this._warningHistory = {};
    this._evaluator = new EvaluationContext();
    this._defaultValue = propertySpec ? getDefaultValue(propertySpec) : null;
    this._enumValues = propertySpec && propertySpec.type === "enum" ? propertySpec.values : null;
    this._globalState = globalState;
    this._rootKey = rootKey;
  }
  evaluateWithoutErrorHandling(globals, feature, featureState, canonical, availableImages, formattedSection) {
    if (this._globalState) globals = addGlobalState(globals, this._globalState);
    this._evaluator.globals = globals;
    this._evaluator.feature = feature;
    this._evaluator.featureState = featureState;
    this._evaluator.canonical = canonical;
    this._evaluator.availableImages = availableImages || null;
    this._evaluator.formattedSection = formattedSection;
    return this.expression.evaluate(this._evaluator);
  }
  evaluate(globals, feature, featureState, canonical, availableImages, formattedSection) {
    if (this._globalState) globals = addGlobalState(globals, this._globalState);
    this._evaluator.globals = globals;
    this._evaluator.feature = feature || null;
    this._evaluator.featureState = featureState || null;
    this._evaluator.canonical = canonical;
    this._evaluator.availableImages = availableImages || null;
    this._evaluator.formattedSection = formattedSection || null;
    try {
      const val = this.expression.evaluate(this._evaluator);
      if (val === null || val === void 0 || typeof val === "number" && val !== val) return this._defaultValue;
      if (this._enumValues && !(val in this._enumValues)) throw new RuntimeError(`Expected value to be one of ${Object.keys(this._enumValues).map((v) => JSON.stringify(v)).join(", ")}, but found ${JSON.stringify(val)} instead.`, "");
      return val;
    } catch (e) {
      const path = e instanceof RuntimeError ? e.path : "";
      const dedupKey = `${path}|${e.message}`;
      if (!this._warningHistory[dedupKey]) {
        this._warningHistory[dedupKey] = true;
        if (typeof console !== "undefined") console.warn(formatRuntimeWarning(this._rootKey, path, e.message, this._defaultValue));
      }
      return this._defaultValue;
    }
  }
};
function formatRuntimeWarning(rootKey, path, message, defaultValue) {
  return `${rootKey}${path}: ${message}${defaultValue == null ? "" : ` Falling back to ${String(defaultValue)}.`}`;
}
function assertRootKey(rootKey) {
  if (!rootKey) throw new Error('rootKey must identify the location of the expression in the style JSON, e.g. "layers[3].paint.line-width".');
}
function isExpression(expression) {
  return Array.isArray(expression) && expression.length > 0 && typeof expression[0] === "string" && expression[0] in expressions;
}
function createExpression(expression, rootKey, propertySpec, globalState) {
  assertRootKey(rootKey);
  const parser = new ParsingContext(expressions, isExpressionConstant, [], propertySpec ? getExpectedType(propertySpec) : void 0);
  const parsed = parser.parse(expression, void 0, void 0, void 0, propertySpec && propertySpec.type === "string" ? { typeAnnotation: "coerce" } : void 0);
  if (!parsed) return error(parser.errors);
  return success(new StyleExpression(parsed, rootKey, propertySpec, globalState));
}
var ZoomConstantExpression = class {
  constructor(kind, expression, globalState) {
    this.kind = kind;
    this._styleExpression = expression;
    this.isStateDependent = kind !== "constant" && !isStateConstant(expression.expression);
    this.globalStateRefs = findGlobalStateRefs(expression.expression);
    this._globalState = globalState;
  }
  evaluateWithoutErrorHandling(globals, feature, featureState, canonical, availableImages, formattedSection) {
    if (this._globalState) globals = addGlobalState(globals, this._globalState);
    return this._styleExpression.evaluateWithoutErrorHandling(globals, feature, featureState, canonical, availableImages, formattedSection);
  }
  evaluate(globals, feature, featureState, canonical, availableImages, formattedSection) {
    if (this._globalState) globals = addGlobalState(globals, this._globalState);
    return this._styleExpression.evaluate(globals, feature, featureState, canonical, availableImages, formattedSection);
  }
};
var ZoomDependentExpression = class {
  constructor(kind, expression, zoomStops, interpolationType, globalState) {
    this.kind = kind;
    this.zoomStops = zoomStops;
    this._styleExpression = expression;
    this.isStateDependent = kind !== "camera" && !isStateConstant(expression.expression);
    this.globalStateRefs = findGlobalStateRefs(expression.expression);
    this.interpolationType = interpolationType;
    this._globalState = globalState;
  }
  evaluateWithoutErrorHandling(globals, feature, featureState, canonical, availableImages, formattedSection) {
    if (this._globalState) globals = addGlobalState(globals, this._globalState);
    return this._styleExpression.evaluateWithoutErrorHandling(globals, feature, featureState, canonical, availableImages, formattedSection);
  }
  evaluate(globals, feature, featureState, canonical, availableImages, formattedSection) {
    if (this._globalState) globals = addGlobalState(globals, this._globalState);
    return this._styleExpression.evaluate(globals, feature, featureState, canonical, availableImages, formattedSection);
  }
  interpolationFactor(input, lower, upper) {
    if (this.interpolationType) return Interpolate.interpolationFactor(this.interpolationType, input, lower, upper);
    else return 0;
  }
};
function createPropertyExpression(expressionInput, rootKey, propertySpec, globalState) {
  const expression = createExpression(expressionInput, rootKey, propertySpec, globalState);
  if (expression.result === "error") return expression;
  const parsed = expression.value.expression;
  const isFeatureConstantResult = isFeatureConstant(parsed);
  if (!isFeatureConstantResult && !supportsPropertyExpression(propertySpec)) return error([new ExpressionParsingError("", "data expressions not supported")]);
  const isZoomConstant = isGlobalPropertyConstant(parsed, ["zoom"]);
  if (!isZoomConstant && !supportsZoomExpression(propertySpec)) return error([new ExpressionParsingError("", "zoom expressions not supported")]);
  const zoomCurve = findZoomCurve(parsed);
  if (!zoomCurve && !isZoomConstant) return error([new ExpressionParsingError("", '"zoom" expression may only be used as input to a top-level "step" or "interpolate" expression.')]);
  else if (zoomCurve instanceof ExpressionParsingError) return error([zoomCurve]);
  else if (zoomCurve instanceof Interpolate && !supportsInterpolation(propertySpec)) return error([new ExpressionParsingError("", '"interpolate" expressions cannot be used with this property')]);
  if (!zoomCurve) return success(isFeatureConstantResult ? new ZoomConstantExpression("constant", expression.value, globalState) : new ZoomConstantExpression("source", expression.value, globalState));
  const interpolationType = zoomCurve instanceof Interpolate ? zoomCurve.interpolation : void 0;
  return success(isFeatureConstantResult ? new ZoomDependentExpression("camera", expression.value, zoomCurve.labels, interpolationType, globalState) : new ZoomDependentExpression("composite", expression.value, zoomCurve.labels, interpolationType, globalState));
}
function findZoomCurve(expression) {
  let result = null;
  if (expression instanceof Let) result = findZoomCurve(expression.result);
  else if (expression instanceof Coalesce) for (const arg of expression.args) {
    result = findZoomCurve(arg);
    if (result) break;
  }
  else if ((expression instanceof Step || expression instanceof Interpolate) && expression.input instanceof CompoundExpression && expression.input.name === "zoom") result = expression;
  if (result instanceof ExpressionParsingError) return result;
  expression.eachChild((child) => {
    const childResult = findZoomCurve(child);
    if (childResult instanceof ExpressionParsingError) result = childResult;
    else if (!result && childResult) result = new ExpressionParsingError("", '"zoom" expression may only be used as input to a top-level "step" or "interpolate" expression.');
    else if (result && childResult && result !== childResult) result = new ExpressionParsingError("", 'Only one zoom-based "step" or "interpolate" subexpression may be used in an expression.');
  });
  return result;
}
function findGlobalStateRefs(expression, results = /* @__PURE__ */ new Set()) {
  if (expression instanceof GlobalState) results.add(expression.key);
  expression.eachChild((childExpression) => {
    findGlobalStateRefs(childExpression, results);
  });
  return results;
}
function getExpectedType(spec) {
  const types4 = {
    color: ColorType,
    string: StringType,
    number: NumberType,
    enum: StringType,
    boolean: BooleanType,
    formatted: FormattedType,
    padding: PaddingType,
    numberArray: NumberArrayType,
    colorArray: ColorArrayType,
    projectionDefinition: ProjectionDefinitionType,
    resolvedImage: ResolvedImageType,
    variableAnchorOffsetCollection: VariableAnchorOffsetCollectionType
  };
  if (spec.type === "array") return array(types4[spec.value] || ValueType, spec.length);
  return types4[spec.type];
}
function getDefaultValue(spec) {
  if (spec.type === "color" && isFunction(spec.default)) return new Color(0, 0, 0, 0);
  switch (spec.type) {
    case "color":
      return Color.parse(spec.default) || null;
    case "padding":
      return Padding.parse(spec.default) || null;
    case "numberArray":
      return NumberArray.parse(spec.default) || null;
    case "colorArray":
      return ColorArray.parse(spec.default) || null;
    case "variableAnchorOffsetCollection":
      return VariableAnchorOffsetCollection.parse(spec.default) || null;
    case "projectionDefinition":
      return ProjectionDefinition.parse(spec.default) || null;
    default:
      return spec.default === void 0 ? null : spec.default;
  }
}
function addGlobalState(globals, globalState) {
  const { zoom, heatmapDensity, elevation, lineProgress, isSupportedScript, accumulated } = globals ?? {};
  return {
    zoom,
    heatmapDensity,
    elevation,
    lineProgress,
    isSupportedScript,
    accumulated,
    globalState
  };
}

// node_modules/@maplibre/maplibre-gl-style-spec/dist/feature_filter/index.mjs
function classifyChildren(children) {
  let sawLegacy = false;
  for (const child of children) {
    const classification = classifyFilter(child);
    if (classification === "expression") return "expression";
    if (classification === "legacy") sawLegacy = true;
  }
  return sawLegacy ? "legacy" : "neutral";
}
function classifyFilter(filter) {
  if (typeof filter === "boolean") return "neutral";
  if (!Array.isArray(filter) || filter.length === 0) return "legacy";
  switch (filter[0]) {
    case "has":
      if (filter.length < 2 || filter[1] === "$id" || filter[1] === "$type") return "legacy";
      return filter.length === 2 ? "neutral" : "expression";
    case "in":
      return filter.length >= 3 && (typeof filter[1] !== "string" || Array.isArray(filter[2])) ? "expression" : "legacy";
    case "!in":
    case "!has":
      return "legacy";
    case "==":
    case "!=":
    case ">":
    case ">=":
    case "<":
    case "<=":
      return filter.length !== 3 || Array.isArray(filter[1]) || Array.isArray(filter[2]) ? "expression" : "legacy";
    case "none":
      return "legacy";
    case "any":
    case "all":
      return classifyChildren(filter.slice(1));
    default:
      return "expression";
  }
}
function isExpressionFilter(filter) {
  return classifyFilter(filter) !== "legacy";
}
function getFilterPropertyExpression(property) {
  if (property === "$type") return ["geometry-type"];
  if (property === "$id") return ["id"];
  return ["get", property];
}
function getLegacyFilterExpressionSuggestion(filter) {
  switch (filter[0]) {
    case "==":
    case "!=":
    case "<":
    case "<=":
    case ">":
    case ">=":
      if (filter.length !== 3 || typeof filter[1] !== "string") return null;
      return [
        filter[0],
        getFilterPropertyExpression(filter[1]),
        filter[2]
      ];
    case "in":
    case "!in": {
      if (filter.length < 2 || typeof filter[1] !== "string") return null;
      const expression = [
        "in",
        getFilterPropertyExpression(filter[1]),
        ["literal", filter.slice(2)]
      ];
      return filter[0] === "!in" ? ["!", expression] : expression;
    }
    case "has":
    case "!has": {
      if (filter.length !== 2 || typeof filter[1] !== "string") return null;
      if (filter[1] === "$type" || filter[1] === "$id") return null;
      const expression = ["has", filter[1]];
      return filter[0] === "!has" ? ["!", expression] : expression;
    }
    default:
      return null;
  }
}
function getMixedFilterMessage(filter) {
  if ((filter[0] === "<" || filter[0] === "<=" || filter[0] === ">" || filter[0] === ">=") && filter[1] === "$type") return `"$type" cannot be use with operator "${filter[0]}"`;
  const suggestion = getLegacyFilterExpressionSuggestion(filter);
  if (suggestion) return `Mixing deprecated filter syntax with expression syntax is not supported. Replace ${JSON.stringify(filter)} with ${JSON.stringify(suggestion)}.`;
  return `Mixing deprecated filter syntax with expression syntax is not supported. Convert ${JSON.stringify(filter)} to expression syntax.`;
}
function checkChild(index, path, filter) {
  const child = filter[index];
  if (!Array.isArray(child)) return null;
  if (!isExpressionFilter(child)) return {
    path: path.concat(index),
    legacyFilter: child
  };
  return findMixedLegacyFilter(child, path.concat(index));
}
function findMixedLegacyFilter(filter, path = []) {
  if (!Array.isArray(filter) || filter.length < 1) return null;
  switch (filter[0]) {
    case "all":
    case "any":
    case "none":
      for (let i = 1; i < filter.length; i++) {
        const diagnostic = checkChild(i, path, filter);
        if (diagnostic) return diagnostic;
      }
      break;
    case "!": {
      const diagnostic = checkChild(1, path, filter);
      if (diagnostic) return diagnostic;
      break;
    }
    case "case":
      for (let i = 1; i < filter.length - 1; i += 2) {
        const diagnostic = checkChild(i, path, filter);
        if (diagnostic) return diagnostic;
      }
  }
  return null;
}
function warnAboutMixedLegacyFilter(filter, rootKey) {
  const diagnostic = findMixedLegacyFilter(filter);
  if (!diagnostic || typeof console === "undefined") return;
  const path = diagnostic.path.map((index) => `[${index}]`).join("");
  console.warn(`${rootKey}${path}: ${getMixedFilterMessage(diagnostic.legacyFilter)}`);
}
var filterSpec = {
  type: "boolean",
  default: false,
  transition: false,
  "property-type": "data-driven",
  expression: {
    interpolated: false,
    parameters: ["zoom", "feature"]
  }
};
function featureFilter(filter, rootKey, globalState) {
  if (filter === null || filter === void 0) return {
    filter: () => true,
    needGeometry: false,
    getGlobalStateRefs: () => /* @__PURE__ */ new Set()
  };
  if (!isExpressionFilter(filter)) filter = convertFilter(filter);
  else warnAboutMixedLegacyFilter(filter, rootKey);
  const compiled = createExpression(filter, rootKey, filterSpec, globalState);
  if (compiled.result === "error") throw new Error(compiled.value.map((err) => `${err.key}: ${err.message}`).join(", "));
  else return {
    filter: (globalProperties, feature, canonical) => compiled.value.evaluate(globalProperties, feature, {}, canonical),
    needGeometry: geometryNeeded(filter),
    getGlobalStateRefs: () => findGlobalStateRefs(compiled.value.expression)
  };
}
function compare(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}
function geometryNeeded(filter) {
  if (!Array.isArray(filter)) return false;
  if (filter[0] === "within" || filter[0] === "distance") return true;
  for (let index = 1; index < filter.length; index++) if (geometryNeeded(filter[index])) return true;
  return false;
}
function convertFilter(filter) {
  if (!filter) return true;
  const op = filter[0];
  if (filter.length <= 1) return op !== "any";
  return op === "==" ? convertComparisonOp(filter[1], filter[2], "==") : op === "!=" ? convertNegation(convertComparisonOp(filter[1], filter[2], "==")) : op === "<" || op === ">" || op === "<=" || op === ">=" ? convertComparisonOp(filter[1], filter[2], op) : op === "any" ? convertDisjunctionOp(filter.slice(1)) : op === "all" ? ["all"].concat(filter.slice(1).map(convertFilter)) : op === "none" ? ["all"].concat(filter.slice(1).map(convertFilter).map(convertNegation)) : op === "in" ? convertInOp(filter[1], filter.slice(2)) : op === "!in" ? convertNegation(convertInOp(filter[1], filter.slice(2))) : op === "has" ? convertHasOp(filter[1]) : op === "!has" ? convertNegation(convertHasOp(filter[1])) : true;
}
function convertComparisonOp(property, value, op) {
  switch (property) {
    case "$type":
      return [`filter-type-${op}`, value];
    case "$id":
      return [`filter-id-${op}`, value];
    default:
      return [
        `filter-${op}`,
        property,
        value
      ];
  }
}
function convertDisjunctionOp(filters) {
  return ["any"].concat(filters.map(convertFilter));
}
function convertInOp(property, values) {
  if (values.length === 0) return false;
  switch (property) {
    case "$type":
      return ["filter-type-in", ["literal", values]];
    case "$id":
      return ["filter-id-in", ["literal", values]];
    default:
      if (values.length > 200 && !values.some((v) => typeof v !== typeof values[0])) return [
        "filter-in-large",
        property,
        ["literal", values.sort(compare)]
      ];
      else return [
        "filter-in-small",
        property,
        ["literal", values]
      ];
  }
}
function convertHasOp(property) {
  switch (property) {
    case "$type":
      return true;
    case "$id":
      return ["filter-has-id"];
    default:
      return ["filter-has", property];
  }
}
function convertNegation(filter) {
  return ["!", filter];
}

// node_modules/@maplibre/maplibre-gl-style-spec/dist/function/convert.mjs
function convertLiteral(value) {
  return typeof value === "object" ? ["literal", value] : value;
}
function convertFunction(parameters, propertySpec) {
  let stops = parameters.stops;
  if (!stops) return convertIdentityFunction(parameters, propertySpec);
  const zoomAndFeatureDependent = stops && typeof stops[0][0] === "object";
  const featureDependent = zoomAndFeatureDependent || parameters.property !== void 0;
  const zoomDependent = zoomAndFeatureDependent || !featureDependent;
  stops = stops.map((stop) => {
    if (!featureDependent && propertySpec.tokens && typeof stop[1] === "string") return [stop[0], convertTokenString(stop[1])];
    return [stop[0], convertLiteral(stop[1])];
  });
  if (zoomAndFeatureDependent) return convertZoomAndPropertyFunction(parameters, propertySpec, stops);
  else if (zoomDependent) return convertZoomFunction(parameters, propertySpec, stops);
  else return convertPropertyFunction(parameters, propertySpec, stops);
}
function convertIdentityFunction(parameters, propertySpec) {
  const get2 = ["get", parameters.property];
  if (parameters.default === void 0) return propertySpec.type === "string" ? ["string", get2] : get2;
  else if (propertySpec.type === "enum") return [
    "match",
    get2,
    Object.keys(propertySpec.values),
    get2,
    parameters.default
  ];
  else {
    const expression = [
      propertySpec.type === "color" ? "to-color" : propertySpec.type,
      get2,
      convertLiteral(parameters.default)
    ];
    if (propertySpec.type === "array") expression.splice(1, 0, propertySpec.value, propertySpec.length || null);
    return expression;
  }
}
function getInterpolateOperator(parameters) {
  switch (parameters.colorSpace) {
    case "hcl":
      return "interpolate-hcl";
    case "lab":
      return "interpolate-lab";
    default:
      return "interpolate";
  }
}
function convertZoomAndPropertyFunction(parameters, propertySpec, stops) {
  const featureFunctionParameters = {};
  const featureFunctionStops = {};
  const zoomStops = [];
  for (let s = 0; s < stops.length; s++) {
    const stop = stops[s];
    const zoom = stop[0].zoom;
    if (featureFunctionParameters[zoom] === void 0) {
      featureFunctionParameters[zoom] = {
        zoom,
        type: parameters.type,
        property: parameters.property,
        default: parameters.default
      };
      featureFunctionStops[zoom] = [];
      zoomStops.push(zoom);
    }
    featureFunctionStops[zoom].push([stop[0].value, stop[1]]);
  }
  if (getFunctionType({}, propertySpec) === "exponential") {
    const expression = [
      getInterpolateOperator(parameters),
      ["linear"],
      ["zoom"]
    ];
    for (const z of zoomStops) appendStopPair(expression, z, convertPropertyFunction(featureFunctionParameters[z], propertySpec, featureFunctionStops[z]), false);
    return expression;
  } else {
    const expression = ["step", ["zoom"]];
    for (const z of zoomStops) appendStopPair(expression, z, convertPropertyFunction(featureFunctionParameters[z], propertySpec, featureFunctionStops[z]), true);
    fixupDegenerateStepCurve(expression);
    return expression;
  }
}
function coalesce(a, b) {
  if (a !== void 0) return a;
  if (b !== void 0) return b;
}
function getFallback(parameters, propertySpec) {
  const defaultValue = convertLiteral(coalesce(parameters.default, propertySpec.default));
  if (defaultValue === void 0 && propertySpec.type === "resolvedImage") return "";
  return defaultValue;
}
function convertPropertyFunction(parameters, propertySpec, stops) {
  const type = getFunctionType(parameters, propertySpec);
  const get2 = ["get", parameters.property];
  if (type === "categorical" && typeof stops[0][0] === "boolean") {
    const expression = ["case"];
    for (const stop of stops) expression.push([
      "==",
      get2,
      stop[0]
    ], stop[1]);
    expression.push(getFallback(parameters, propertySpec));
    return expression;
  } else if (type === "categorical") {
    const expression = ["match", get2];
    for (const stop of stops) appendStopPair(expression, stop[0], stop[1], false);
    expression.push(getFallback(parameters, propertySpec));
    return expression;
  } else if (type === "interval") {
    const expression = ["step", ["number", get2]];
    for (const stop of stops) appendStopPair(expression, stop[0], stop[1], true);
    fixupDegenerateStepCurve(expression);
    return parameters.default === void 0 ? expression : [
      "case",
      [
        "==",
        ["typeof", get2],
        "number"
      ],
      expression,
      convertLiteral(parameters.default)
    ];
  } else if (type === "exponential") {
    const base = parameters.base !== void 0 ? parameters.base : 1;
    const expression = [
      getInterpolateOperator(parameters),
      base === 1 ? ["linear"] : ["exponential", base],
      ["number", get2]
    ];
    for (const stop of stops) appendStopPair(expression, stop[0], stop[1], false);
    return parameters.default === void 0 ? expression : [
      "case",
      [
        "==",
        ["typeof", get2],
        "number"
      ],
      expression,
      convertLiteral(parameters.default)
    ];
  } else throw new Error(`Unknown property function type ${type}`);
}
function convertZoomFunction(parameters, propertySpec, stops, input = ["zoom"]) {
  const type = getFunctionType(parameters, propertySpec);
  let expression;
  let isStep = false;
  if (type === "interval") {
    expression = ["step", input];
    isStep = true;
  } else if (type === "exponential") {
    const base = parameters.base !== void 0 ? parameters.base : 1;
    expression = [
      getInterpolateOperator(parameters),
      base === 1 ? ["linear"] : ["exponential", base],
      input
    ];
  } else throw new Error(`Unknown zoom function type "${type}"`);
  for (const stop of stops) appendStopPair(expression, stop[0], stop[1], isStep);
  fixupDegenerateStepCurve(expression);
  return expression;
}
function fixupDegenerateStepCurve(expression) {
  if (expression[0] === "step" && expression.length === 3) {
    expression.push(0);
    expression.push(expression[3]);
  }
}
function appendStopPair(curve, input, output, isStep) {
  if (curve.length > 3 && input === curve[curve.length - 2]) return;
  if (!(isStep && curve.length === 2)) curve.push(input);
  curve.push(output);
}
function getFunctionType(parameters, propertySpec) {
  if (parameters.type) return parameters.type;
  else return propertySpec.expression.interpolated ? "exponential" : "interval";
}
function convertTokenString(s) {
  const result = ["concat"];
  const re = /{([^{}]+)}/g;
  let pos = 0;
  for (let match = re.exec(s); match !== null; match = re.exec(s)) {
    const literal = s.slice(pos, re.lastIndex - match[0].length);
    pos = re.lastIndex;
    if (literal.length > 0) result.push(literal);
    result.push(["get", match[1]]);
  }
  if (result.length === 1) return s;
  if (pos < s.length) result.push(s.slice(pos));
  else if (result.length === 2) return ["to-string", result[1]];
  return result;
}

// node_modules/ol-mapbox-style/src/apply.js
import Map3 from "ol/Map.js";
import View from "ol/View.js";
import { getTopLeft } from "ol/extent.js";
import GeoJSON from "ol/format/GeoJSON.js";
import MVT from "ol/format/MVT.js";
import { WORKER_OFFSCREEN_CANVAS as WORKER_OFFSCREEN_CANVAS2 } from "ol/has.js";
import LayerGroup from "ol/layer/Group.js";
import Layer from "ol/layer/Layer.js";
import TileLayer from "ol/layer/Tile.js";
import VectorLayer from "ol/layer/Vector.js";
import VectorTileLayer from "ol/layer/VectorTile.js";
import { bbox as bboxStrategy } from "ol/loadingstrategy.js";
import {
  equivalent,
  fromLonLat as fromLonLat2,
  get as getProjection,
  getUserProjection
} from "ol/proj.js";
import { METERS_PER_UNIT } from "ol/proj/Units.js";
import Source from "ol/source/Source.js";
import TileJSON from "ol/source/TileJSON.js";
import VectorSource from "ol/source/Vector.js";
import VectorTileSource, { defaultLoadFunction } from "ol/source/VectorTile.js";
import { createXYZ } from "ol/tilegrid.js";
import TileGrid from "ol/tilegrid/TileGrid.js";

// node_modules/ol-mapbox-style/src/expressions.js
import { fromString } from "ol/color.js";
function hsla(ctx, args) {
  const h = args[0].evaluate(ctx);
  const s = args[1].evaluate(ctx);
  const l = args[2].evaluate(ctx);
  const alpha = args[3] ? args[3].evaluate(ctx) : 1;
  return Color.parse(`hsla(${h}, ${s}%, ${l}%, ${alpha})`);
}
function rgbaToHsla(rgba2) {
  const r = rgba2[0] / 255;
  const g = rgba2[1] / 255;
  const b = rgba2[2] / 255;
  const a = rgba2[3];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h, s;
  if (max === min) {
    h = 0;
    s = 0;
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
      default:
        h = 0;
    }
    h /= 6;
  }
  return [h * 360, s * 100, l * 100, a];
}
function wrapImageExtraArgs(expression) {
  if (Array.isArray(expression)) {
    if (expression.length === 0) {
      return expression;
    }
    const op = expression[0];
    if (op === "literal") {
      return expression;
    }
    if (op === "image" && expression.length === 3 && typeof expression[2] === "object" && expression[2] !== null && !Array.isArray(expression[2])) {
      const newExpression = [
        "image-config",
        wrapImageExtraArgs(expression[1]),
        ["literal", expression[2]]
      ];
      return newExpression;
    }
    const length = expression.length;
    for (let i = 1; i < length; ++i) {
      const arg = expression[i];
      const newArg = wrapImageExtraArgs(arg);
      if (newArg !== arg) {
        const newExpression = [op];
        for (let j = 1; j < i; ++j) {
          newExpression.push(expression[j]);
        }
        newExpression.push(newArg);
        for (let j = i + 1; j < length; ++j) {
          newExpression.push(wrapImageExtraArgs(expression[j]));
        }
        return newExpression;
      }
    }
  }
  return expression;
}
var styleConfig = {};
var cameraObj = { zoom: 0, distanceFromCenter: 0 };
CompoundExpression.register(expressions, {
  ...CompoundExpression.definitions,
  "pitch": [{ kind: "number" }, [], (ctx) => cameraObj.pitch || 0],
  "distance-from-center": [
    { kind: "number" },
    [],
    (ctx) => cameraObj.distanceFromCenter || 0
  ],
  "to-hsla": [
    { kind: "array", itemType: { kind: "number" }, N: 4 },
    [{ kind: "string" }],
    (ctx, [v]) => {
      return rgbaToHsla(fromString(v.evaluate(ctx)));
    }
  ],
  "hsl": [
    { kind: "color" },
    [{ kind: "number" }, { kind: "number" }, { kind: "number" }],
    hsla
  ],
  "hsla": [
    { kind: "color" },
    [{ kind: "number" }, { kind: "number" }, { kind: "number" }, { kind: "number" }],
    hsla
  ],
  "image-config": [
    { kind: "value" },
    [{ kind: "string" }, { kind: "value" }],
    (ctx, [v, c]) => v.evaluate(ctx)
  ],
  "measure-light": [{ kind: "number" }, [{ kind: "value" }], () => 1],
  "config": [
    { kind: "value" },
    [{ kind: "string" }],
    (ctx, [key]) => {
      const value = styleConfig[key.evaluate(ctx)];
      return value === void 0 ? {} : value;
    }
  ]
});

// node_modules/ol-mapbox-style/src/mapbox.js
var mapboxBaseUrl = "https://api.mapbox.com";
function getMapboxPath(url) {
  const startsWith = "mapbox://";
  if (url.indexOf(startsWith) !== 0) {
    return "";
  }
  return url.slice(startsWith.length);
}
function normalizeSpriteDefinition(sprite, token, styleUrl) {
  if (typeof sprite === "string") {
    return [
      {
        "id": "default",
        "url": normalizeSpriteUrl(sprite, token, styleUrl)
      }
    ];
  }
  for (const spriteObj of sprite) {
    spriteObj.url = normalizeSpriteUrl(spriteObj.url, token, styleUrl);
  }
  return sprite;
}
function normalizeSpriteUrl(url, token, styleUrl) {
  const mapboxPath = getMapboxPath(url);
  if (!token || !mapboxPath) {
    return decodeURI(new URL(url, styleUrl).href);
  }
  const startsWith = "sprites/";
  if (mapboxPath.indexOf(startsWith) !== 0) {
    throw new Error(`unexpected sprites url: ${url}`);
  }
  const sprite = mapboxPath.slice(startsWith.length);
  return `${mapboxBaseUrl}/styles/v1/${sprite}/sprite?access_token=${token}`;
}
function normalizeStyleUrl(url, token) {
  const mapboxPath = getMapboxPath(url);
  if (!mapboxPath || !token) {
    return decodeURI(new URL(url, location.href).href);
  }
  const startsWith = "styles/";
  if (mapboxPath.indexOf(startsWith) !== 0) {
    throw new Error(`unexpected style url: ${url}`);
  }
  const style = mapboxPath.slice(startsWith.length);
  return `${mapboxBaseUrl}/styles/v1/${style}?&access_token=${token}`;
}
var mapboxSubdomains = ["a", "b", "c", "d"];
function normalizeSourceUrl(url, token, tokenParam, styleUrl) {
  const urlObject = new URL(url, styleUrl || location.href);
  const mapboxPath = getMapboxPath(url);
  if (!mapboxPath) {
    if (!token) {
      return [decodeURI(urlObject.href)];
    }
    if (!urlObject.searchParams.has(tokenParam)) {
      urlObject.searchParams.set(tokenParam, token);
    }
    return [decodeURI(urlObject.href)];
  }
  if (mapboxPath === "mapbox.satellite") {
    const sizeFactor = window.devicePixelRatio >= 1.5 ? "@2x" : "";
    return [
      `https://api.mapbox.com/v4/${mapboxPath}/{z}/{x}/{y}${sizeFactor}.webp?access_token=${token}`
    ];
  }
  return mapboxSubdomains.map(
    (sub) => `https://${sub}.tiles.mapbox.com/v4/${mapboxPath}/{z}/{x}/{y}.vector.pbf?access_token=${token}`
  );
}

// node_modules/ol-mapbox-style/src/rasterfunction.js
import { getCenter as getCenter2 } from "ol/extent.js";
import ImageLayer from "ol/layer/Image.js";
import { getPointResolution } from "ol/proj.js";
import Raster from "ol/source/Raster.js";

// node_modules/ol-mapbox-style/src/shaders.js
function hillshade(inputs, data) {
  const elevationImage = (
    /** @type {ImageData} */
    inputs[0]
  );
  const width = elevationImage.width;
  const height = elevationImage.height;
  const elevationData = elevationImage.data;
  const shadeData = new Uint8ClampedArray(elevationData.length);
  const dp = data.resolution * 2;
  const maxX = width - 1;
  const maxY = height - 1;
  const pixel = [0, 0, 0, 0];
  const PI = Math.PI;
  const encoding = data.encoding;
  const intensity = data.exaggeration;
  const zoom = data.zoom;
  const method = data.method || "standard";
  const accentColor = data.accentColor;
  const shadowColors = data.shadowColors || [data.shadowColor];
  const highlightColors = data.highlightColors || [data.highlightColor];
  const azimuths = data.azimuths || [data.sunAz];
  const azimuthsRad = azimuths.map((a) => a * PI / 180);
  const altitudes = data.altitudes || [45];
  const altitudesRad = altitudes.map((a) => a * PI / 180);
  const numSources = Math.min(
    azimuthsRad.length,
    altitudesRad.length,
    shadowColors.length,
    highlightColors.length,
    4
  );
  const exaggerationFactor = zoom < 2 ? 0.4 : zoom < 4.5 ? 0.35 : 0.3;
  const zoomExaggeration = zoom < 15 ? Math.pow(2, (15 - zoom) * exaggerationFactor) : 1;
  function calculateElevation(pixel2, encoding2 = "mapbox") {
    if (encoding2 === "mapbox") {
      return (pixel2[0] * 256 * 256 + pixel2[1] * 256 + pixel2[2]) * 0.1 - 1e4;
    }
    if (encoding2 === "terrarium") {
      return pixel2[0] * 256 + pixel2[1] + pixel2[2] / 256 - 32768;
    }
    return 0;
  }
  function getAspect(dzdx2, dzdy2) {
    if (dzdx2 !== 0) {
      return Math.atan2(dzdy2, -dzdx2);
    }
    return PI / 2 * (dzdy2 > 0 ? 1 : -1);
  }
  function standardShade(dzdx2, dzdy2) {
    const azimuth = azimuthsRad[0] + PI;
    const slope = Math.atan(0.625 * Math.sqrt(dzdx2 * dzdx2 + dzdy2 * dzdy2));
    const aspect = getAspect(dzdx2, dzdy2);
    const base = 1.875 - intensity * 1.75;
    const maxValue = 0.5 * PI;
    const scaledSlope = intensity !== 0.5 ? (Math.pow(base, slope) - 1) / (Math.pow(base, maxValue) - 1) * maxValue : slope;
    const accent = Math.cos(scaledSlope);
    const intensityScale = Math.min(Math.max(intensity * 2, 0), 1);
    const accentScale = (1 - accent) * intensityScale;
    const ac = accentColor;
    const ar = ac.r * accentScale;
    const ag = ac.g * accentScale;
    const ab = ac.b * accentScale;
    const aa = ac.a * accentScale;
    let val = (aspect + azimuth) / PI + 0.5;
    val = val % 2;
    if (val < 0) {
      val += 2;
    }
    const shade = Math.abs(val - 1);
    const shadeScale = Math.sin(scaledSlope) * intensityScale;
    const sc = shadowColors[0];
    const hc = highlightColors[0];
    const sr = (sc.r * (1 - shade) + hc.r * shade) * shadeScale;
    const sg = (sc.g * (1 - shade) + hc.g * shade) * shadeScale;
    const sb = (sc.b * (1 - shade) + hc.b * shade) * shadeScale;
    const sa = (sc.a * (1 - shade) + hc.a * shade) * shadeScale;
    return [
      ar * (1 - sa) + sr,
      ag * (1 - sa) + sg,
      ab * (1 - sa) + sb,
      aa * (1 - sa) + sa
    ];
  }
  function igorShade(dzdx2, dzdy2) {
    dzdx2 *= intensity * 2;
    dzdy2 *= intensity * 2;
    const aspect = getAspect(dzdx2, dzdy2);
    const azimuth = azimuthsRad[0] + PI;
    const slopeStrength = Math.atan(Math.sqrt(dzdx2 * dzdx2 + dzdy2 * dzdy2)) * (2 / PI);
    let val = (aspect + azimuth) / PI + 0.5;
    val = val % 2;
    if (val < 0) {
      val += 2;
    }
    const aspectStrength = 1 - Math.abs(val - 1);
    const shadowStr = slopeStrength * aspectStrength;
    const highlightStr = slopeStrength * (1 - aspectStrength);
    const sc = shadowColors[0];
    const hc = highlightColors[0];
    return [
      sc.r * shadowStr + hc.r * highlightStr,
      sc.g * shadowStr + hc.g * highlightStr,
      sc.b * shadowStr + hc.b * highlightStr,
      sc.a * shadowStr + hc.a * highlightStr
    ];
  }
  function basicShade(dzdx2, dzdy2) {
    dzdx2 *= intensity * 2;
    dzdy2 *= intensity * 2;
    const azimuth = azimuthsRad[0] + PI;
    const cosAz = Math.cos(azimuth);
    const sinAz = Math.sin(azimuth);
    const cosAlt = Math.cos(altitudesRad[0]);
    const sinAlt = Math.sin(altitudesRad[0]);
    const cang = (sinAlt - (dzdy2 * cosAz * cosAlt - dzdx2 * sinAz * cosAlt)) / Math.sqrt(1 + dzdx2 * dzdx2 + dzdy2 * dzdy2);
    const shade = Math.max(0, Math.min(1, cang));
    if (shade > 0.5) {
      const f2 = 2 * shade - 1;
      const c2 = highlightColors[0];
      return [c2.r * f2, c2.g * f2, c2.b * f2, c2.a * f2];
    }
    const f = 1 - 2 * shade;
    const c = shadowColors[0];
    return [c.r * f, c.g * f, c.b * f, c.a * f];
  }
  function combinedShade(dzdx2, dzdy2) {
    dzdx2 *= intensity * 2;
    dzdy2 *= intensity * 2;
    const azimuth = azimuthsRad[0] + PI;
    const cosAz = Math.cos(azimuth);
    const sinAz = Math.sin(azimuth);
    const cosAlt = Math.cos(altitudesRad[0]);
    const sinAlt = Math.sin(altitudesRad[0]);
    let cang = Math.acos(
      (sinAlt - (dzdy2 * cosAz * cosAlt - dzdx2 * sinAz * cosAlt)) / Math.sqrt(1 + dzdx2 * dzdx2 + dzdy2 * dzdy2)
    );
    cang = Math.max(0, Math.min(PI / 2, cang));
    const slopeAtan = Math.atan(Math.sqrt(dzdx2 * dzdx2 + dzdy2 * dzdy2)) * (4 / PI / PI);
    const shade = cang * slopeAtan;
    const highlight = (PI / 2 - cang) * slopeAtan;
    const sc = shadowColors[0];
    const hc = highlightColors[0];
    return [
      sc.r * shade + hc.r * highlight,
      sc.g * shade + hc.g * highlight,
      sc.b * shade + hc.b * highlight,
      sc.a * shade + hc.a * highlight
    ];
  }
  function multidirectionalShade(dzdx2, dzdy2) {
    dzdx2 *= intensity * 2;
    dzdy2 *= intensity * 2;
    const dotDeriv = dzdx2 * dzdx2 + dzdy2 * dzdy2;
    const sqrtDot = Math.sqrt(1 + dotDeriv);
    let rr = 0;
    let rg = 0;
    let rb = 0;
    let ra = 0;
    for (let i = 0; i < numSources; i++) {
      const cosAlt = Math.cos(altitudesRad[i]);
      const sinAlt = Math.sin(altitudesRad[i]);
      const cosAz = -Math.cos(azimuthsRad[i]);
      const sinAz = -Math.sin(azimuthsRad[i]);
      const cang = (sinAlt - (dzdy2 * cosAz * cosAlt - dzdx2 * sinAz * cosAlt)) / sqrtDot;
      const shade = Math.max(0, Math.min(1, cang));
      const sc = shadowColors[Math.min(i, shadowColors.length - 1)];
      const hc = highlightColors[Math.min(i, highlightColors.length - 1)];
      if (shade > 0.5) {
        const f = (2 * shade - 1) / numSources;
        rr += hc.r * f;
        rg += hc.g * f;
        rb += hc.b * f;
        ra += hc.a * f;
      } else {
        const f = (1 - 2 * shade) / numSources;
        rr += sc.r * f;
        rg += sc.g * f;
        rb += sc.b * f;
        ra += sc.a * f;
      }
    }
    return [rr, rg, rb, ra];
  }
  const shadeFn = method === "igor" ? igorShade : method === "basic" ? basicShade : method === "combined" ? combinedShade : method === "multidirectional" ? multidirectionalShade : standardShade;
  let pixelX, pixelY, x0, x1, y0, y1, offset, z0, z1, dzdx, dzdy;
  for (pixelY = 0; pixelY <= maxY; ++pixelY) {
    y0 = pixelY === 0 ? 0 : pixelY - 1;
    y1 = pixelY === maxY ? maxY : pixelY + 1;
    for (pixelX = 0; pixelX <= maxX; ++pixelX) {
      x0 = pixelX === 0 ? 0 : pixelX - 1;
      x1 = pixelX === maxX ? maxX : pixelX + 1;
      offset = (pixelY * width + x0) * 4;
      pixel[0] = elevationData[offset];
      pixel[1] = elevationData[offset + 1];
      pixel[2] = elevationData[offset + 2];
      pixel[3] = elevationData[offset + 3];
      z0 = calculateElevation(pixel, encoding);
      offset = (pixelY * width + x1) * 4;
      pixel[0] = elevationData[offset];
      pixel[1] = elevationData[offset + 1];
      pixel[2] = elevationData[offset + 2];
      pixel[3] = elevationData[offset + 3];
      z1 = calculateElevation(pixel, encoding);
      dzdx = (z1 - z0) / dp * zoomExaggeration;
      offset = (y0 * width + pixelX) * 4;
      pixel[0] = elevationData[offset];
      pixel[1] = elevationData[offset + 1];
      pixel[2] = elevationData[offset + 2];
      pixel[3] = elevationData[offset + 3];
      z0 = calculateElevation(pixel, encoding);
      offset = (y1 * width + pixelX) * 4;
      pixel[0] = elevationData[offset];
      pixel[1] = elevationData[offset + 1];
      pixel[2] = elevationData[offset + 2];
      pixel[3] = elevationData[offset + 3];
      z1 = calculateElevation(pixel, encoding);
      dzdy = (z1 - z0) / dp * zoomExaggeration;
      const result = shadeFn(dzdx, dzdy);
      const a = result[3];
      offset = (pixelY * width + pixelX) * 4;
      if (a > 0) {
        shadeData[offset] = result[0] / a * 255;
        shadeData[offset + 1] = result[1] / a * 255;
        shadeData[offset + 2] = result[2] / a * 255;
      }
      shadeData[offset + 3] = a * 255;
    }
  }
  return new ImageData(shadeData, width, height);
}
function raster(inputs, data) {
  const image = (
    /** @type {ImageData} */
    inputs[0]
  );
  const width = image.width;
  const height = image.height;
  const imageData = image.data;
  const shadeData = new Uint8ClampedArray(imageData.length);
  const maxX = width - 1;
  const maxY = height - 1;
  const pixel = [0, 0, 0, 0];
  let pixelX, pixelY, offset;
  function calculateContrastFactor(contrast) {
    return contrast > 0 ? 1 / (1 - contrast) : 1 + contrast;
  }
  function calculateSaturationFactor(saturation) {
    return saturation > 0 ? 1 - 1 / (1.001 - saturation) : -saturation;
  }
  function generateSpinWeights(angle) {
    angle *= Math.PI / 180;
    const s = Math.sin(angle);
    const c = Math.cos(angle);
    return [
      (2 * c + 1) / 3,
      (-Math.sqrt(3) * s - c + 1) / 3,
      (Math.sqrt(3) * s - c + 1) / 3
    ];
  }
  const sFactor = calculateSaturationFactor(data.saturation);
  const cFactor = calculateContrastFactor(data.contrast);
  const cSpinWeights = generateSpinWeights(data.hueRotate);
  const cSpinWeightsXYZ = cSpinWeights;
  const cSpinWeightsZXY = [cSpinWeights[2], cSpinWeights[0], cSpinWeights[1]];
  const cSpinWeightsYZX = [cSpinWeights[1], cSpinWeights[2], cSpinWeights[0]];
  const bLow = data.brightnessLow;
  const bHigh = data.brightnessHigh;
  for (pixelY = 0; pixelY <= maxY; ++pixelY) {
    for (pixelX = 0; pixelX <= maxX; ++pixelX) {
      offset = (pixelY * width + pixelX) * 4;
      pixel[0] = imageData[offset];
      pixel[1] = imageData[offset + 1];
      pixel[2] = imageData[offset + 2];
      pixel[3] = imageData[offset + 3];
      const or = pixel[0];
      const og = pixel[1];
      const ob = pixel[2];
      const dotProduct = (vector1, vector2) => {
        let result = 0;
        for (let i = 0; i < vector1.length; i++) {
          result += vector1[i] * vector2[i];
        }
        return result;
      };
      let r = dotProduct([or, og, ob], cSpinWeightsXYZ);
      let g = dotProduct([or, og, ob], cSpinWeightsZXY);
      let b = dotProduct([or, og, ob], cSpinWeightsYZX);
      const average = (r + g + b) / 3;
      r += (average - r) * sFactor;
      g += (average - g) * sFactor;
      b += (average - b) * sFactor;
      r = (r - 127.5) * cFactor + 127.5;
      g = (g - 127.5) * cFactor + 127.5;
      b = (b - 127.5) * cFactor + 127.5;
      r = bLow * (255 - r) + bHigh * r;
      g = bLow * (255 - g) + bHigh * g;
      b = bLow * (255 - b) + bHigh * b;
      shadeData[offset] = r;
      shadeData[offset + 1] = g;
      shadeData[offset + 2] = b;
      shadeData[offset + 3] = pixel[3];
    }
  }
  return new ImageData(shadeData, width, height);
}

// node_modules/mapbox-to-css-font/index.js
var fontWeights = {
  thin: 100,
  hairline: 100,
  "ultra-light": 200,
  "extra-light": 200,
  light: 300,
  book: 300,
  regular: 400,
  normal: 400,
  plain: 400,
  roman: 400,
  standard: 400,
  medium: 500,
  "semi-bold": 600,
  "demi-bold": 600,
  bold: 700,
  "extra-bold": 800,
  "ultra-bold": 800,
  heavy: 900,
  black: 900,
  "heavy-black": 900,
  fat: 900,
  poster: 900,
  "ultra-black": 950,
  "extra-black": 950
};
var sp = " ";
var italicRE = /(italic|oblique)$/i;
var fontCache = {};
function mapbox_to_css_font_default(fonts, size, lineHeight) {
  var cssData = fontCache[fonts];
  if (!cssData) {
    if (!Array.isArray(fonts)) {
      fonts = [fonts];
    }
    var weight = 400;
    var style = "normal";
    var fontFamilies = [];
    var haveWeight, haveStyle;
    for (var i = 0, ii = fonts.length; i < ii; ++i) {
      var font = fonts[i];
      var parts = font.split(" ");
      var maybeWeight = parts[parts.length - 1].toLowerCase();
      if (maybeWeight == "normal" || maybeWeight == "italic" || maybeWeight == "oblique") {
        style = haveStyle ? style : maybeWeight;
        haveStyle = true;
        parts.pop();
        maybeWeight = parts[parts.length - 1].toLowerCase();
      } else if (italicRE.test(maybeWeight)) {
        maybeWeight = maybeWeight.replace(italicRE, "");
        style = haveStyle ? style : parts[parts.length - 1].replace(maybeWeight, "");
        haveStyle = true;
      }
      for (var w in fontWeights) {
        var previousPart = parts.length > 1 ? parts[parts.length - 2].toLowerCase() : "";
        if (maybeWeight == w || maybeWeight == w.replace("-", "") || previousPart + "-" + maybeWeight == w) {
          weight = haveWeight ? weight : fontWeights[w];
          parts.pop();
          if (previousPart && w.startsWith(previousPart)) {
            parts.pop();
          }
          break;
        }
      }
      if (!haveWeight && typeof maybeWeight == "number") {
        weight = maybeWeight;
        haveWeight = true;
      }
      var fontFamily = parts.join(sp).replace("Klokantech Noto Sans", "Noto Sans").replace("DIN Pro", "Barlow").replace("Arial Unicode MS", "Arial");
      if (fontFamily.indexOf(sp) !== -1) {
        fontFamily = '"' + fontFamily + '"';
      }
      fontFamilies.push(fontFamily);
    }
    cssData = fontCache[fonts] = [style, weight, fontFamilies];
  }
  return cssData[0] + sp + cssData[1] + sp + size + "px" + (lineHeight ? "/" + lineHeight : "") + sp + cssData[2];
}

// node_modules/ol-mapbox-style/src/stylefunction.js
import Map2 from "ol/Map.js";
import { distance } from "ol/coordinate.js";
import { getCenter } from "ol/extent.js";
import { toPromise as toPromise2 } from "ol/functions.js";
import RenderFeature from "ol/render/Feature.js";
import Circle from "ol/style/Circle.js";
import Fill from "ol/style/Fill.js";
import Icon from "ol/style/Icon.js";
import Stroke from "ol/style/Stroke.js";
import Style from "ol/style/Style.js";
import Text from "ol/style/Text.js";

// node_modules/ol-mapbox-style/src/text.js
import { WORKER_OFFSCREEN_CANVAS } from "ol/has.js";
import { checkedFonts } from "ol/render/canvas.js";

// node_modules/ol-mapbox-style/src/util.js
import { VectorTile } from "ol";
import TileState from "ol/TileState.js";
import { toPromise } from "ol/functions.js";
import { getUid } from "ol/util.js";
var emptyObj = Object.freeze({});
var functionCacheByStyleId = {};
var filterCacheByStyleId = {};
var styleId = 0;
function getStyleId(glStyle) {
  if (!glStyle.id) {
    glStyle.id = styleId++;
  }
  return glStyle.id;
}
function getStyleFunctionKey(glStyle, olLayer) {
  return getStyleId(glStyle) + "." + getUid(olLayer);
}
function getFunctionCache(glStyle) {
  let functionCache = functionCacheByStyleId[glStyle.id];
  if (!functionCache) {
    functionCache = {};
    functionCacheByStyleId[getStyleId(glStyle)] = functionCache;
  }
  return functionCache;
}
function getFilterCache(glStyle) {
  let filterCache = filterCacheByStyleId[glStyle.id];
  if (!filterCache) {
    filterCache = {};
    filterCacheByStyleId[getStyleId(glStyle)] = filterCache;
  }
  return filterCache;
}
function deg2rad2(degrees) {
  return degrees * Math.PI / 180;
}
var defaultResolutions = (function() {
  const resolutions = [];
  for (let res = 78271.51696402048; resolutions.length <= 24; res /= 2) {
    resolutions.push(res);
  }
  return resolutions;
})();
function createCanvas(width, height) {
  if (typeof WorkerGlobalScope !== "undefined" && self instanceof WorkerGlobalScope && typeof OffscreenCanvas !== "undefined") {
    return (
      /** @type {?} */
      new OffscreenCanvas(width, height)
    );
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}
function getZoomForResolution(resolution, resolutions) {
  let i = 0;
  const ii = resolutions.length;
  for (; i < ii; ++i) {
    const candidate = resolutions[i];
    if (candidate < resolution && i + 1 < ii) {
      const zoomFactor = resolutions[i] / resolutions[i + 1];
      return i + Math.log(resolutions[i] / resolution) / Math.log(zoomFactor);
    }
  }
  return ii - 1;
}
function getResolutionForZoom(zoom, resolutions) {
  const base = Math.floor(zoom);
  const factor = Math.pow(2, zoom - base);
  return resolutions[base] / factor;
}
var pendingRequests = {};
function fetchResource(resourceType, url, options = {}, metadata) {
  if (url in pendingRequests) {
    if (metadata) {
      metadata.url = pendingRequests[url][0].url;
    }
    return pendingRequests[url][1];
  }
  const transformedRequest = options.transformRequest ? options.transformRequest(url, resourceType) || url : url;
  const handleError = function(error2) {
    delete pendingRequests[url];
    return Promise.reject(new Error("Error fetching source " + url));
  };
  const handleResponse = function(response) {
    delete pendingRequests[url];
    return response.ok ? response.json() : Promise.reject(new Error("Error fetching source " + url));
  };
  const pendingRequest = toPromise(() => transformedRequest).then((transformedRequest2) => {
    if (transformedRequest2 instanceof Response) {
      if (metadata) {
        metadata.url = transformedRequest2.url;
      }
      return handleResponse(transformedRequest2);
    }
    if (!(transformedRequest2 instanceof Request)) {
      transformedRequest2 = new Request(transformedRequest2);
    }
    if (!transformedRequest2.headers.get("Accept")) {
      transformedRequest2.headers.set("Accept", "application/json");
    }
    if (metadata) {
      metadata.url = transformedRequest2.url;
    }
    return fetch(transformedRequest2).then(handleResponse).catch(handleError);
  }).catch(handleError);
  pendingRequests[url] = [transformedRequest, pendingRequest];
  return pendingRequest;
}
function getGlStyle(glStyleOrUrl, options) {
  if (typeof glStyleOrUrl === "string") {
    if (glStyleOrUrl.trim().startsWith("{")) {
      try {
        const glStyle = JSON.parse(glStyleOrUrl);
        return Promise.resolve(glStyle);
      } catch (error2) {
        return Promise.reject(error2);
      }
    } else {
      glStyleOrUrl = normalizeStyleUrl(glStyleOrUrl, options.accessToken);
      return fetchResource("Style", glStyleOrUrl, options);
    }
  } else {
    return Promise.resolve(glStyleOrUrl);
  }
}
var tilejsonCache = {};
function getTileJson(glSource, styleUrl, options = {}) {
  const cacheKey = [styleUrl, JSON.stringify(glSource)].toString();
  let promise = tilejsonCache[cacheKey];
  if (!promise || options.transformRequest) {
    let tileLoadFunction;
    if (options.transformRequest) {
      tileLoadFunction = (tile, src) => {
        const transformedRequest = options.transformRequest ? options.transformRequest(src, "Tiles") || src : src;
        if (tile instanceof VectorTile) {
          tile.setLoader((extent, resolution, projection) => {
            const handleResponse = function(response) {
              response.arrayBuffer().then((data) => {
                const format2 = tile.getFormat();
                const features = format2.readFeatures(data, {
                  extent,
                  featureProjection: projection
                });
                tile.setFeatures(features);
              });
            };
            toPromise(() => transformedRequest).then((transformedRequest2) => {
              if (transformedRequest2 instanceof Response) {
                return handleResponse(transformedRequest2);
              }
              fetch(transformedRequest2).then(handleResponse).catch((e) => tile.setState(TileState.ERROR));
            }).catch((e) => tile.setState(TileState.ERROR));
          });
        } else {
          const img = tile.getImage();
          toPromise(() => transformedRequest).then((transformedRequest2) => {
            if (typeof transformedRequest2 === "string") {
              img.src = transformedRequest2;
              return;
            }
            const handleResponse = (response) => response.blob().then((blob) => {
              const url2 = URL.createObjectURL(blob);
              img.addEventListener("load", () => URL.revokeObjectURL(url2));
              img.addEventListener("error", () => URL.revokeObjectURL(url2));
              img.src = url2;
            });
            if (transformedRequest2 instanceof Response) {
              return handleResponse(transformedRequest2);
            }
            fetch(transformedRequest2).then(handleResponse).catch((e) => tile.setState(TileState.ERROR));
          }).catch((e) => tile.setState(TileState.ERROR));
        }
      };
    }
    const url = glSource.url;
    if (url && !glSource.tiles) {
      const normalizedSourceUrl = normalizeSourceUrl(
        url,
        options.accessToken,
        options.accessTokenParam || "access_token",
        styleUrl || location.href
      );
      if (url.startsWith("mapbox://")) {
        promise = Promise.resolve({
          tileJson: Object.assign({}, glSource, {
            url: void 0,
            tiles: normalizedSourceUrl
          }),
          tileLoadFunction
        });
      } else {
        const metadata = {};
        promise = fetchResource(
          "Source",
          normalizedSourceUrl[0],
          options,
          metadata
        ).then(function(tileJson) {
          tileJson.tiles = tileJson.tiles.map(function(tileUrl) {
            if (tileJson.scheme === "tms") {
              tileUrl = tileUrl.replace("{y}", "{-y}");
            }
            return normalizeSourceUrl(
              tileUrl,
              options.accessToken,
              options.accessTokenParam || "access_token",
              metadata.url
            )[0];
          });
          return Promise.resolve({ tileJson, tileLoadFunction });
        });
      }
    } else if (glSource.tiles) {
      glSource = Object.assign({}, glSource, {
        tiles: glSource.tiles.map(function(tileUrl) {
          if (glSource.scheme === "tms") {
            tileUrl = tileUrl.replace("{y}", "{-y}");
          }
          return normalizeSourceUrl(
            tileUrl,
            options.accessToken,
            options.accessTokenParam || "access_token",
            styleUrl || location.href
          )[0];
        })
      });
      promise = Promise.resolve({
        tileJson: Object.assign({}, glSource),
        tileLoadFunction
      });
    } else {
      promise = Promise.reject(new Error("source has no `tiles` nor `url`"));
    }
    tilejsonCache[cacheKey] = promise;
  }
  return promise;
}
function drawIconHalo(spriteImage, spriteImageData, haloWidth, haloColor) {
  const imgSize = [
    2 * haloWidth * spriteImageData.pixelRatio + spriteImageData.width,
    2 * haloWidth * spriteImageData.pixelRatio + spriteImageData.height
  ];
  const imageCanvas = createCanvas(imgSize[0], imgSize[1]);
  const imageContext = imageCanvas.getContext("2d");
  imageContext.drawImage(
    spriteImage,
    spriteImageData.x,
    spriteImageData.y,
    spriteImageData.width,
    spriteImageData.height,
    haloWidth * spriteImageData.pixelRatio,
    haloWidth * spriteImageData.pixelRatio,
    spriteImageData.width,
    spriteImageData.height
  );
  const imageData = imageContext.getImageData(0, 0, imgSize[0], imgSize[1]);
  imageContext.globalCompositeOperation = "destination-over";
  imageContext.fillStyle = `rgba(${haloColor.r * 255},${haloColor.g * 255},${haloColor.b * 255},${haloColor.a})`;
  const data = imageData.data;
  for (let i = 0, ii = imageData.width; i < ii; ++i) {
    for (let j = 0, jj = imageData.height; j < jj; ++j) {
      const index = (j * ii + i) * 4;
      const alpha = data[index + 3];
      if (alpha > 0) {
        imageContext.arc(
          i,
          j,
          haloWidth * spriteImageData.pixelRatio,
          0,
          2 * Math.PI
        );
      }
    }
  }
  imageContext.fill();
  return imageCanvas;
}
function smoothstep(min, max, value) {
  const x = Math.max(0, Math.min(1, (value - min) / (max - min)));
  return x * x * (3 - 2 * x);
}
function drawSDF(image, area, color) {
  const imageCanvas = createCanvas(area.width, area.height);
  const imageContext = imageCanvas.getContext("2d");
  imageContext.drawImage(
    image,
    area.x,
    area.y,
    area.width,
    area.height,
    0,
    0,
    area.width,
    area.height
  );
  const imageData = imageContext.getImageData(0, 0, area.width, area.height);
  const data = imageData.data;
  for (let i = 0, ii = imageData.width; i < ii; ++i) {
    for (let j = 0, jj = imageData.height; j < jj; ++j) {
      const index = (j * ii + i) * 4;
      const dist = data[index + 3] / 255;
      const buffer = 0.75;
      const gamma = 0.1;
      const alpha = smoothstep(buffer - gamma, buffer + gamma, dist);
      if (alpha > 0) {
        data[index + 0] = Math.round(255 * color.r * alpha);
        data[index + 1] = Math.round(255 * color.g * alpha);
        data[index + 2] = Math.round(255 * color.b * alpha);
        data[index + 3] = Math.round(255 * alpha);
      } else {
        data[index + 3] = 0;
      }
    }
  }
  imageContext.putImageData(imageData, 0, 0);
  return imageCanvas;
}

// node_modules/ol-mapbox-style/src/text.js
var hairSpacePool = Array(256).join("\u200A");
function applyLetterSpacing(text, letterSpacing) {
  if (letterSpacing >= 0.05) {
    let textWithLetterSpacing = "";
    const lines = text.split("\n");
    const joinSpaceString = hairSpacePool.slice(
      0,
      Math.round(letterSpacing / 0.1)
    );
    for (let l = 0, ll = lines.length; l < ll; ++l) {
      if (l > 0) {
        textWithLetterSpacing += "\n";
      }
      textWithLetterSpacing += lines[l].split("").join(joinSpaceString);
    }
    return textWithLetterSpacing;
  }
  return text;
}
var measureContext;
function getMeasureContext() {
  if (!measureContext) {
    measureContext = createCanvas(1, 1).getContext("2d");
  }
  return measureContext;
}
function fitWeight(fontWeight, weight) {
  if (/\d+ \d+/.test(fontWeight)) {
    const [start, end] = fontWeight.split(" ").map(Number);
    return start <= weight && weight <= end;
  }
  return fontWeight == weight;
}
function measureText(text, letterSpacing) {
  return getMeasureContext().measureText(text).width + (text.length - 1) * letterSpacing;
}
var measureCache = {};
checkedFonts.on("propertychange", () => {
  for (const key in measureCache) {
    delete measureCache[key];
  }
});
function wrapText(text, font, em, letterSpacing) {
  if (text.indexOf("\n") !== -1) {
    const hardLines = text.split("\n");
    const lines = [];
    for (let i = 0, ii = hardLines.length; i < ii; ++i) {
      lines.push(wrapText(hardLines[i], font, em, letterSpacing));
    }
    return lines.join("\n");
  }
  const key = em + "," + font + "," + text + "," + letterSpacing;
  let wrappedText = measureCache[key];
  if (!wrappedText) {
    const words = text.split(" ");
    if (words.length > 1) {
      const ctx = getMeasureContext();
      ctx.font = font;
      const oneEm = ctx.measureText("M").width;
      const maxWidth = oneEm * em;
      let line = "";
      const lines = [];
      for (let i = 0, ii = words.length; i < ii; ++i) {
        const word = words[i];
        const testLine = line + (line ? " " : "") + word;
        if (measureText(testLine, letterSpacing) <= maxWidth) {
          line = testLine;
        } else {
          if (line) {
            lines.push(line);
          }
          line = word;
        }
      }
      if (line) {
        lines.push(line);
      }
      for (let i = 0, ii = lines.length; i < ii && ii > 1; ++i) {
        const line2 = lines[i];
        if (measureText(line2, letterSpacing) < maxWidth * 0.35) {
          const prevWidth = i > 0 ? measureText(lines[i - 1], letterSpacing) : Infinity;
          const nextWidth = i < ii - 1 ? measureText(lines[i + 1], letterSpacing) : Infinity;
          lines.splice(i, 1);
          ii -= 1;
          if (prevWidth < nextWidth) {
            lines[i - 1] += " " + line2;
            i -= 1;
          } else {
            lines[i] = line2 + " " + lines[i];
          }
        }
      }
      for (let i = 0, ii = lines.length - 1; i < ii; ++i) {
        const line2 = lines[i];
        const next = lines[i + 1];
        if (measureText(line2, letterSpacing) > maxWidth * 0.7 && measureText(next, letterSpacing) < maxWidth * 0.6) {
          const lineWords = line2.split(" ");
          const lastWord = lineWords.pop();
          if (measureText(lastWord, letterSpacing) < maxWidth * 0.2) {
            lines[i] = lineWords.join(" ");
            lines[i + 1] = lastWord + " " + next;
          }
          ii -= 1;
        }
      }
      wrappedText = lines.join("\n");
    } else {
      wrappedText = text;
    }
    wrappedText = applyLetterSpacing(wrappedText, letterSpacing);
    measureCache[key] = wrappedText;
  }
  return wrappedText;
}
var webSafeFonts = [
  "Arial",
  "Courier New",
  "Times New Roman",
  "Verdana",
  "sans-serif",
  "serif",
  "monospace",
  "cursive",
  "fantasy"
];
var processedFontFamilies = {};
function getFonts(fonts, templateUrl = "https://cdn.jsdelivr.net/npm/@fontsource/{font-family}/{fontweight}{-fontstyle}.css") {
  if (WORKER_OFFSCREEN_CANVAS) {
    return fonts;
  }
  let fontDescriptions;
  for (let i = 0, ii = fonts.length; i < ii; ++i) {
    const font = fonts[i];
    if (font in processedFontFamilies) {
      continue;
    }
    processedFontFamilies[font] = true;
    const cssFont = mapbox_to_css_font_default(font, 16);
    const parts = cssFont.split(" ");
    if (!fontDescriptions) {
      fontDescriptions = [];
    }
    fontDescriptions.push([
      parts.slice(3).join(" ").replace(/"/g, ""),
      parts[1],
      parts[0]
    ]);
  }
  if (!fontDescriptions) {
    return fonts;
  }
  (async () => {
    await document.fonts.ready;
    for (let i = 0, ii = fontDescriptions.length; i < ii; ++i) {
      const fontDescription = fontDescriptions[i];
      const family = fontDescription[0];
      if (webSafeFonts.includes(family)) {
        continue;
      }
      const weight = fontDescription[1];
      const style = fontDescription[2];
      const loaded = await document.fonts.load(
        `${style} ${weight} 16px "${family}"`
      );
      if (!loaded.some(
        (f) => f.family.replace(/^['"]|['"]$/g, "").toLowerCase() === family.toLowerCase() && fitWeight(f.weight, weight) && f.style === style
      )) {
        const fontUrl = templateUrl.replace("{font-family}", family.replace(/ /g, "-").toLowerCase()).replace("{Font+Family}", family.replace(/ /g, "+")).replace("{fontweight}", weight).replace(
          "{-fontstyle}",
          style.replace("normal", "").replace(/(.+)/, "-$1")
        ).replace("{fontstyle}", style);
        if (!document.querySelector('link[href="' + fontUrl + '"]')) {
          const markup = document.createElement("link");
          markup.href = fontUrl;
          markup.rel = "stylesheet";
          document.head.appendChild(markup);
        }
      }
    }
  })();
  return fonts;
}

// node_modules/ol-mapbox-style/src/stylefunction.js
var types3 = {
  "Point": 1,
  "MultiPoint": 1,
  "LineString": 2,
  "MultiLineString": 2,
  "Polygon": 3,
  "MultiPolygon": 3
};
var anchor = {
  "center": [0.5, 0.5],
  "left": [0, 0.5],
  "right": [1, 0.5],
  "top": [0.5, 0],
  "bottom": [0.5, 1],
  "top-left": [0, 0],
  "top-right": [1, 0],
  "bottom-left": [0, 1],
  "bottom-right": [1, 1]
};
var expressionData = function(rawExpression, rootKey, propertySpec) {
  let compiledExpression = createPropertyExpression(
    rawExpression,
    rootKey,
    propertySpec
  );
  if (compiledExpression.result === "error") {
    const wrappedExpression = wrapImageExtraArgs(rawExpression);
    if (wrappedExpression !== rawExpression) {
      compiledExpression = createPropertyExpression(
        wrappedExpression,
        rootKey,
        propertySpec
      );
    }
  }
  if (compiledExpression.result === "error") {
    const err = compiledExpression.value[0];
    console.error(
      "Error parsing expression:",
      rawExpression,
      err.key,
      err.message
    );
    return {
      evaluate: () => {
        return propertySpec.default;
      }
    };
  }
  return compiledExpression.value;
};
var renderFeatureCoordinates;
var renderFeature;
function getValue(layer, layoutOrPaint, property, feature, functionCache, featureState) {
  const layerId = layer.id;
  if (!functionCache) {
    functionCache = {};
    console.warn("No functionCache provided to getValue()");
  }
  if (!functionCache[layerId]) {
    functionCache[layerId] = {};
  }
  const functions = functionCache[layerId];
  if (!functions[property]) {
    let value = (layer[layoutOrPaint] || emptyObj)[property];
    const rootKey = `layers[${layerId}].${layoutOrPaint}.${property}`;
    const propertySpec = latest[`${layoutOrPaint}_${layer.type}`] && latest[`${layoutOrPaint}_${layer.type}`][property];
    if (value === void 0) {
      if (propertySpec) {
        value = propertySpec.default;
      }
    }
    let isExpr = isExpression(value);
    if (!isExpr && isFunction(value)) {
      value = convertFunction(value, propertySpec);
      isExpr = true;
    }
    if (isExpr) {
      const compiledExpression = expressionData(value, rootKey, propertySpec);
      functions[property] = compiledExpression.evaluate.bind(compiledExpression);
    } else {
      const type = propertySpec ? propertySpec.type : typeof value;
      if (type === "color" || type === "colorArray") {
        value = Color.parse(value);
      }
      let hasExpr = false;
      if (type === "array") {
        for (let i = 0; i < value.length; ++i) {
          const item = value[i];
          if (isExpression(item) || isFunction(item)) {
            hasExpr = true;
            break;
          }
        }
      }
      if (hasExpr) {
        const itemPropertySpec = Object.assign({}, propertySpec, {
          type: propertySpec.value
        });
        const itemExpressions = [];
        for (let i = 0; i < value.length; ++i) {
          let item = value[i];
          if (!isExpression(item) && isFunction(item)) {
            item = convertFunction(item, itemPropertySpec);
          }
          if (isExpression(item)) {
            const compiledExpression = expressionData(
              item,
              `${rootKey}[${i}]`,
              itemPropertySpec
            );
            itemExpressions.push(
              compiledExpression.evaluate.bind(compiledExpression)
            );
          } else {
            itemExpressions.push(function() {
              return item;
            });
          }
        }
        functions[property] = function(globalProperties, feature2, featureState2) {
          const result = [];
          for (let i = 0; i < itemExpressions.length; ++i) {
            result[i] = itemExpressions[i](
              globalProperties,
              feature2,
              featureState2
            );
          }
          return result;
        };
      } else {
        functions[property] = function() {
          return value;
        };
      }
    }
  }
  return functions[property](cameraObj, feature, featureState);
}
function getDeclutterMode(layer, feature, prefix, functionCache) {
  const allowOverlap = getValue(
    layer,
    "layout",
    `${prefix}-allow-overlap`,
    feature,
    functionCache
  );
  if (!allowOverlap) {
    return "declutter";
  }
  const ignorePlacement = getValue(
    layer,
    "layout",
    `${prefix}-ignore-placement`,
    feature,
    functionCache
  );
  if (!ignorePlacement) {
    return "obstacle";
  }
  return "none";
}
function evaluateFilter(layerId, filter, feature, filterCache) {
  if (!filterCache) {
    console.warn("No filterCache provided to evaluateFilter()");
  }
  if (!(layerId in filterCache)) {
    try {
      filterCache[layerId] = featureFilter(
        filter,
        `layers[${layerId}].filter`
      ).filter;
    } catch (e) {
      console.warn(
        "Filter will evaluate to false: " + /** @type {Error} */
        e.message
      );
      filterCache[layerId] = function() {
        return false;
      };
    }
  }
  return filterCache[layerId](cameraObj, feature);
}
var renderTransparentEnabled = false;
function colorWithOpacity(color, opacity) {
  if (color) {
    if (!renderTransparentEnabled && (color.a === 0 || opacity === 0)) {
      return void 0;
    }
    const a = color.a;
    opacity = opacity === void 0 ? 1 : opacity;
    return a === 0 ? "transparent" : "rgba(" + Math.round(color.r * 255 / a) + "," + Math.round(color.g * 255 / a) + "," + Math.round(color.b * 255 / a) + "," + a * opacity + ")";
  }
  return color;
}
var templateRegEx = /\{[^{}}]*\}/g;
function fromTemplate(text, properties) {
  return text.replace(templateRegEx, function(match) {
    return properties[match.slice(1, -1)] || "";
  });
}
function getSpriteImageForIcon(icon, spriteImages) {
  let prefix = icon.split(":")[0];
  if (prefix === icon) {
    prefix = "default";
  }
  return spriteImages[prefix];
}
var recordLayer = false;
var styleFunctionArgs = {};
function stylefunction(olLayer, glStyle, sourceOrLayers, resolutions = defaultResolutions, spriteData = void 0, spriteImageUrl = void 0, getFonts2 = void 0, getImage = void 0) {
  if (typeof glStyle == "string") {
    glStyle = JSON.parse(glStyle);
  }
  if (glStyle.schema) {
    for (const key in glStyle.schema) {
      const config = glStyle.schema[key];
      if ("default" in config) {
        styleConfig[key] = config.default;
      }
    }
  }
  if (glStyle.version != 8) {
    throw new Error("glStyle version 8 required.");
  }
  styleFunctionArgs[getStyleFunctionKey(glStyle, olLayer)] = Array.from(arguments);
  const spriteImages = {};
  if (typeof spriteImageUrl === "string" || spriteImageUrl instanceof Request || spriteImageUrl instanceof Response || spriteImageUrl instanceof Promise) {
    spriteImageUrl = { "default": spriteImageUrl };
  }
  for (const prefix in spriteImageUrl) {
    const imageUrl = spriteImageUrl[prefix];
    toPromise2(() => imageUrl).then(async (imageUrl2) => {
      let blobUrl;
      if (typeof Image !== "undefined") {
        const img = new Image();
        if (typeof imageUrl2 === "string") {
          img.crossOrigin = "anonymous";
          img.src = imageUrl2;
        } else {
          let response;
          if (imageUrl2 instanceof Request) {
            response = await fetch(imageUrl2);
          } else if (imageUrl2 instanceof Response) {
            response = imageUrl2;
          }
          const blob = await response.blob();
          blobUrl = URL.createObjectURL(blob);
          img.src = blobUrl;
        }
        img.addEventListener("load", function load() {
          img.removeEventListener("load", load);
          spriteImages[prefix] = {
            image: img,
            size: [img.width, img.height]
          };
          olLayer.changed();
          if (blobUrl) {
            URL.revokeObjectURL(blobUrl);
          }
        });
        img.addEventListener("error", function error2() {
          URL.revokeObjectURL(blobUrl);
          img.removeEventListener("error", error2);
        });
      } else if (typeof WorkerGlobalScope !== "undefined" && self instanceof WorkerGlobalScope) {
        const worker = (
          /** @type {*} */
          self
        );
        worker.postMessage({
          action: "loadImage",
          src: imageUrl2
        });
        worker.addEventListener("message", function handler(event) {
          if (event.data.action === "imageLoaded" && event.data.src === imageUrl2) {
            spriteImages[prefix] = {
              image: event.data.image,
              size: [event.data.image.width, event.data.image.height]
            };
          }
        });
      }
    });
  }
  const allLayers = derefLayers(glStyle.layers);
  const layersBySourceLayer = {};
  const mapboxLayers = [];
  const iconImageCache = {};
  const patternCache = {};
  const functionCache = getFunctionCache(glStyle);
  const filterCache = getFilterCache(glStyle);
  let mapboxSource;
  for (let i = 0, ii = allLayers.length; i < ii; ++i) {
    const layer = allLayers[i];
    const layerId = layer.id;
    if (typeof sourceOrLayers == "string" && layer.source == sourceOrLayers || Array.isArray(sourceOrLayers) && sourceOrLayers.indexOf(layerId) !== -1) {
      const sourceLayer = layer["source-layer"];
      if (!mapboxSource) {
        mapboxSource = layer.source;
        const source = glStyle.sources[mapboxSource];
        if (!source) {
          throw new Error(`Source "${mapboxSource}" is not defined`);
        }
        const type = source.type;
        if (type !== "vector" && type !== "geojson") {
          throw new Error(
            `Source "${mapboxSource}" is not of type "vector" or "geojson", but "${type}"`
          );
        }
      } else if (layer.source !== mapboxSource) {
        throw new Error(
          `Layer "${layerId}" does not use source "${mapboxSource}`
        );
      }
      let layers = layersBySourceLayer[sourceLayer];
      if (!layers) {
        layers = [];
        layersBySourceLayer[sourceLayer] = layers;
      }
      layers.push({
        layer,
        index: i
      });
      mapboxLayers.push(layerId);
    }
  }
  const styles = [];
  const styleFunction = function(feature, resolution, onlyLayer) {
    const layerProperty = (
      //@ts-ignore
      olLayer.getSource?.()?.format_?.layerName_ ?? "mvt:layer"
    );
    const properties = feature.getProperties();
    const layers = layersBySourceLayer[properties[layerProperty]];
    if (!layers) {
      return void 0;
    }
    let zoom = resolutions.indexOf(resolution);
    if (zoom == -1) {
      zoom = getZoomForResolution(resolution, resolutions);
    }
    cameraObj.zoom = zoom;
    cameraObj.distanceFromCenter = 0;
    const featureGeometry = feature.getGeometry();
    const type = types3[featureGeometry.getType()];
    const map = olLayer.get("map");
    if (map && map instanceof Map2 && type === 1) {
      const size = map.getSize();
      if (size) {
        const mapCenter = map.getView().getCenter();
        const featureCenter = getCenter(featureGeometry.getExtent());
        cameraObj.distanceFromCenter = distance(mapCenter, featureCenter) / resolution / size[1];
      }
    }
    const f = {
      id: feature.getId(),
      properties,
      type
    };
    const featureState = olLayer.get("mapbox-featurestate")[feature.getId()];
    let stylesLength = -1;
    let featureBelongsToLayer;
    for (let i = 0, ii = layers.length; i < ii; ++i) {
      const layerData = layers[i];
      const layer = layerData.layer;
      const layerId = layer.id;
      if (onlyLayer !== void 0 && onlyLayer !== layerId) {
        continue;
      }
      const layout = layer.layout || emptyObj;
      const paint = layer.paint || emptyObj;
      const visibility = getValue(
        layer,
        "layout",
        "visibility",
        f,
        functionCache,
        featureState
      );
      if (visibility === "none" || "minzoom" in layer && zoom < layer.minzoom || "maxzoom" in layer && zoom >= layer.maxzoom) {
        continue;
      }
      const filter = layer.filter;
      if (!filter || evaluateFilter(layerId, filter, f, filterCache)) {
        featureBelongsToLayer = layer;
        let color, opacity, fill, stroke, strokeColor, style;
        const index = layerData.index;
        if (type == 3 && (layer.type == "fill" || layer.type == "fill-extrusion")) {
          opacity = getValue(
            layer,
            "paint",
            layer.type + "-opacity",
            f,
            functionCache,
            featureState
          );
          if (layer.type + "-pattern" in paint) {
            const fillIcon = getValue(
              layer,
              "paint",
              layer.type + "-pattern",
              f,
              functionCache,
              featureState
            );
            if (fillIcon) {
              const icon2 = typeof fillIcon === "string" ? fromTemplate(fillIcon, properties) : fillIcon.toString();
              const spriteImage = getSpriteImageForIcon(icon2, spriteImages);
              if (spriteData && spriteData[icon2] && spriteImage) {
                ++stylesLength;
                style = styles[stylesLength];
                if (!style || !style.getFill() || style.getStroke() || style.getText()) {
                  style = new Style({
                    fill: new Fill()
                  });
                  styles[stylesLength] = style;
                }
                fill = style.getFill();
                style.setZIndex(index);
                const icon_cache_key = icon2 + "." + opacity;
                let pattern = patternCache[icon_cache_key];
                if (!pattern) {
                  const spriteImageData = spriteData[icon2];
                  const canvas = createCanvas(
                    spriteImageData.width,
                    spriteImageData.height
                  );
                  const ctx = (
                    /** @type {CanvasRenderingContext2D} */
                    canvas.getContext("2d")
                  );
                  ctx.globalAlpha = opacity;
                  ctx.drawImage(
                    spriteImage.image,
                    spriteImageData.x,
                    spriteImageData.y,
                    spriteImageData.width,
                    spriteImageData.height,
                    0,
                    0,
                    spriteImageData.width,
                    spriteImageData.height
                  );
                  pattern = ctx.createPattern(canvas, "repeat");
                  patternCache[icon_cache_key] = pattern;
                }
                fill.setColor(pattern);
              }
            }
          } else {
            color = colorWithOpacity(
              getValue(
                layer,
                "paint",
                layer.type + "-color",
                f,
                functionCache,
                featureState
              ),
              opacity
            );
            if (layer.type + "-outline-color" in paint) {
              strokeColor = colorWithOpacity(
                getValue(
                  layer,
                  "paint",
                  layer.type + "-outline-color",
                  f,
                  functionCache,
                  featureState
                ),
                opacity
              );
            }
            if (!strokeColor) {
              strokeColor = color;
            }
            if (color || strokeColor) {
              ++stylesLength;
              style = styles[stylesLength];
              if (!style || color && !style.getFill() || !color && style.getFill() || strokeColor && !style.getStroke() || !strokeColor && style.getStroke() || style.getText()) {
                style = new Style({
                  fill: color ? new Fill() : void 0,
                  stroke: strokeColor ? new Stroke() : void 0
                });
                styles[stylesLength] = style;
              }
              if (color) {
                fill = style.getFill();
                fill.setColor(color);
              }
              if (layer.type === "fill-extrusion") {
                const height = getValue(
                  layer,
                  "paint",
                  "fill-extrusion-height",
                  f,
                  functionCache,
                  featureState
                );
                if (height > 0) {
                  const darkenFactor = Math.max(
                    0.1,
                    0.9 - Math.min(height, 225) / 280
                  );
                  if (strokeColor && strokeColor !== "transparent") {
                    const rgba2 = Color.parse(strokeColor);
                    strokeColor = `rgba(${Math.round(rgba2.r * 255 * darkenFactor)},${Math.round(rgba2.g * 255 * darkenFactor)},${Math.round(rgba2.b * 255 * darkenFactor)},${rgba2.a})`;
                  }
                }
              }
              if (strokeColor) {
                stroke = style.getStroke();
                stroke.setColor(strokeColor);
                stroke.setWidth(0.5);
              }
              style.setZIndex(index);
            }
          }
        }
        if (type != 1 && layer.type == "line") {
          if (!("line-pattern" in paint)) {
            color = colorWithOpacity(
              getValue(
                layer,
                "paint",
                "line-color",
                f,
                functionCache,
                featureState
              ),
              getValue(
                layer,
                "paint",
                "line-opacity",
                f,
                functionCache,
                featureState
              )
            );
          } else {
            color = void 0;
          }
          const width = getValue(
            layer,
            "paint",
            "line-width",
            f,
            functionCache,
            featureState
          );
          if (color && width > 0) {
            ++stylesLength;
            style = styles[stylesLength];
            if (!style || !style.getStroke() || style.getFill() || style.getText()) {
              style = new Style({
                stroke: new Stroke()
              });
              styles[stylesLength] = style;
            }
            stroke = style.getStroke();
            stroke.setLineCap(
              getValue(
                layer,
                "layout",
                "line-cap",
                f,
                functionCache,
                featureState
              )
            );
            stroke.setLineJoin(
              getValue(
                layer,
                "layout",
                "line-join",
                f,
                functionCache,
                featureState
              )
            );
            stroke.setMiterLimit(
              getValue(
                layer,
                "layout",
                "line-miter-limit",
                f,
                functionCache,
                featureState
              )
            );
            stroke.setColor(color);
            stroke.setWidth(width);
            stroke.setLineDash(
              paint["line-dasharray"] ? getValue(
                layer,
                "paint",
                "line-dasharray",
                f,
                functionCache,
                featureState
              ).map(function(x) {
                return x * width;
              }) : null
            );
            if (typeof stroke.setOffset === "function") {
              stroke.setOffset(
                getValue(
                  layer,
                  "paint",
                  "line-offset",
                  f,
                  functionCache,
                  featureState
                )
              );
            }
            style.setZIndex(index);
          }
        }
        let hasImage = false;
        let text = null;
        let placementAngle = 0;
        let icon, iconImg, skipLabel;
        if ((type == 1 || type == 2) && "icon-image" in layout) {
          const iconImage = getValue(
            layer,
            "layout",
            "icon-image",
            f,
            functionCache,
            featureState
          );
          if (iconImage) {
            icon = typeof iconImage === "string" ? fromTemplate(iconImage, properties) : iconImage.toString();
            let styleGeom = void 0;
            const imageElement = getImage ? getImage(olLayer, icon) : void 0;
            const spriteImage = getSpriteImageForIcon(icon, spriteImages);
            if (spriteData && spriteData[icon] && spriteImage || imageElement) {
              const placement = getValue(
                layer,
                "layout",
                "symbol-placement",
                f,
                functionCache,
                featureState
              );
              const iconRotationAlignment = getValue(
                layer,
                "layout",
                "icon-rotation-alignment",
                f,
                functionCache,
                featureState
              );
              const iconAlignedWithMap = iconRotationAlignment === "auto" ? placement !== "point" : iconRotationAlignment === "map";
              if (type == 2) {
                const geom = (
                  /** @type {*} */
                  feature.getGeometry()
                );
                if (geom.getFlatMidpoint || geom.getFlatMidpoints) {
                  const extent = geom.getExtent();
                  const size = Math.sqrt(
                    Math.max(
                      Math.pow((extent[2] - extent[0]) / resolution, 2),
                      Math.pow((extent[3] - extent[1]) / resolution, 2)
                    )
                  );
                  if (size > 150) {
                    const midpoint = geom.getType() === "MultiLineString" ? geom.getFlatMidpoints() : geom.getFlatMidpoint();
                    if (!renderFeature) {
                      renderFeatureCoordinates = [NaN, NaN];
                      renderFeature = new RenderFeature(
                        "Point",
                        renderFeatureCoordinates,
                        [],
                        2,
                        {},
                        void 0
                      );
                    }
                    styleGeom = renderFeature;
                    renderFeatureCoordinates[0] = midpoint[0];
                    renderFeatureCoordinates[1] = midpoint[1];
                    if (placement === "line" && iconAlignedWithMap) {
                      const stride = geom.getStride();
                      const coordinates = geom.getFlatCoordinates();
                      for (let i2 = 0, ii2 = coordinates.length - stride; i2 < ii2; i2 += stride) {
                        const x1 = coordinates[i2];
                        const y1 = coordinates[i2 + 1];
                        const x2 = coordinates[i2 + stride];
                        const y2 = coordinates[i2 + stride + 1];
                        const minX = Math.min(x1, x2);
                        const maxX = Math.max(x1, x2);
                        const xM = midpoint[0];
                        const yM = midpoint[1];
                        const dotProduct = (y2 - y1) * (xM - x1) - (x2 - x1) * (yM - y1);
                        if (Math.abs(dotProduct) < 1e-3 && //midpoint is aligned with the segment
                        xM <= maxX && xM >= minX) {
                          placementAngle = Math.atan2(y1 - y2, x2 - x1);
                          break;
                        }
                      }
                    }
                  }
                }
              }
              if (type !== 2 || styleGeom) {
                const iconSize = getValue(
                  layer,
                  "layout",
                  "icon-size",
                  f,
                  functionCache,
                  featureState
                );
                const iconColor = paint["icon-color"] !== void 0 ? getValue(
                  layer,
                  "paint",
                  "icon-color",
                  f,
                  functionCache,
                  featureState
                ) : null;
                if (!iconColor || iconColor.a !== 0) {
                  const haloColor = getValue(
                    layer,
                    "paint",
                    "icon-halo-color",
                    f,
                    functionCache,
                    featureState
                  );
                  const haloWidth = getValue(
                    layer,
                    "paint",
                    "icon-halo-width",
                    f,
                    functionCache,
                    featureState
                  );
                  let iconCacheKey = `${icon}.${iconSize}.${haloWidth}.${haloColor}.${iconAlignedWithMap}`;
                  if (iconColor !== null) {
                    iconCacheKey += `.${iconColor}`;
                  }
                  iconImg = iconImageCache[iconCacheKey];
                  if (!iconImg) {
                    const declutterMode = getDeclutterMode(
                      layer,
                      f,
                      "icon",
                      functionCache
                    );
                    let displacement;
                    if ("icon-offset" in layout) {
                      displacement = getValue(
                        layer,
                        "layout",
                        "icon-offset",
                        f,
                        functionCache,
                        featureState
                      ).slice(0);
                      displacement[0] *= iconSize;
                      displacement[1] *= -iconSize;
                    }
                    let color2 = iconColor ? [
                      iconColor.r * 255,
                      iconColor.g * 255,
                      iconColor.b * 255,
                      iconColor.a
                    ] : void 0;
                    if (imageElement) {
                      const iconOptions = {
                        color: color2,
                        rotateWithView: iconAlignedWithMap,
                        displacement,
                        declutterMode,
                        scale: iconSize
                      };
                      if (typeof imageElement === "string") {
                        iconOptions.src = imageElement;
                      } else {
                        iconOptions.img = imageElement;
                        iconOptions.imgSize = [
                          imageElement.width,
                          imageElement.height
                        ];
                      }
                      iconImg = new Icon(iconOptions);
                    } else {
                      const spriteImageData = spriteData[icon];
                      let img, size, offset;
                      if (haloWidth) {
                        if (spriteImageData.sdf) {
                          img = drawIconHalo(
                            drawSDF(
                              spriteImage.image,
                              spriteImageData,
                              iconColor || [0, 0, 0, 1]
                            ),
                            {
                              x: 0,
                              y: 0,
                              width: spriteImageData.width,
                              height: spriteImageData.height,
                              pixelRatio: spriteImageData.pixelRatio
                            },
                            haloWidth,
                            haloColor
                          );
                          color2 = void 0;
                        } else {
                          img = drawIconHalo(
                            spriteImage.image,
                            spriteImageData,
                            haloWidth,
                            haloColor
                          );
                        }
                      } else {
                        if (spriteImageData.sdf) {
                          if (!spriteImage.unSDFed) {
                            const spriteImageUnSDFed = drawSDF(
                              spriteImage.image,
                              {
                                x: 0,
                                y: 0,
                                width: spriteImage.size[0],
                                height: spriteImage.size[1]
                              },
                              { r: 1, g: 1, b: 1, a: 1 }
                            );
                            spriteImage.image = spriteImageUnSDFed;
                            spriteImage.unSDFed = true;
                          }
                        }
                        img = spriteImage.image;
                        size = [spriteImageData.width, spriteImageData.height];
                        offset = [spriteImageData.x, spriteImageData.y];
                      }
                      iconImg = new Icon({
                        color: color2,
                        img,
                        // @ts-ignore
                        imgSize: spriteImage.size,
                        size,
                        offset,
                        rotateWithView: iconAlignedWithMap,
                        scale: iconSize / spriteImageData.pixelRatio,
                        displacement,
                        declutterMode
                      });
                    }
                    iconImageCache[iconCacheKey] = iconImg;
                  }
                }
                if (iconImg) {
                  ++stylesLength;
                  style = styles[stylesLength];
                  if (!style || !style.getImage() || style.getFill() || style.getStroke()) {
                    style = new Style();
                    styles[stylesLength] = style;
                  }
                  style.setGeometry(styleGeom);
                  iconImg.setRotation(
                    placementAngle + deg2rad2(
                      getValue(
                        layer,
                        "layout",
                        "icon-rotate",
                        f,
                        functionCache,
                        featureState
                      )
                    )
                  );
                  iconImg.setOpacity(
                    getValue(
                      layer,
                      "paint",
                      "icon-opacity",
                      f,
                      functionCache,
                      featureState
                    )
                  );
                  iconImg.setAnchor(
                    anchor[getValue(
                      layer,
                      "layout",
                      "icon-anchor",
                      f,
                      functionCache,
                      featureState
                    )]
                  );
                  style.setImage(iconImg);
                  text = style.getText();
                  style.setText(void 0);
                  style.setZIndex(index);
                  hasImage = true;
                  skipLabel = false;
                }
              } else {
                skipLabel = true;
              }
            }
          }
        }
        if (type == 1 && layer.type === "circle") {
          ++stylesLength;
          style = styles[stylesLength];
          if (!style || !style.getImage() || style.getFill() || style.getStroke()) {
            style = new Style();
            styles[stylesLength] = style;
          }
          const circleRadius = "circle-radius" in paint ? getValue(
            layer,
            "paint",
            "circle-radius",
            f,
            functionCache,
            featureState
          ) : 5;
          const circleStrokeColor = colorWithOpacity(
            getValue(
              layer,
              "paint",
              "circle-stroke-color",
              f,
              functionCache,
              featureState
            ),
            getValue(
              layer,
              "paint",
              "circle-stroke-opacity",
              f,
              functionCache,
              featureState
            )
          );
          const circleTranslate = getValue(
            layer,
            "paint",
            "circle-translate",
            f,
            functionCache,
            featureState
          );
          const circleColor = colorWithOpacity(
            getValue(
              layer,
              "paint",
              "circle-color",
              f,
              functionCache,
              featureState
            ),
            getValue(
              layer,
              "paint",
              "circle-opacity",
              f,
              functionCache,
              featureState
            )
          );
          const circleStrokeWidth = getValue(
            layer,
            "paint",
            "circle-stroke-width",
            f,
            functionCache,
            featureState
          );
          const cache_key = circleRadius + "." + circleStrokeColor + "." + circleColor + "." + circleStrokeWidth + "." + circleTranslate[0] + "." + circleTranslate[1];
          iconImg = iconImageCache[cache_key];
          if (!iconImg) {
            iconImg = new Circle({
              radius: circleRadius,
              displacement: [circleTranslate[0], -circleTranslate[1]],
              stroke: circleStrokeColor && circleStrokeWidth > 0 ? new Stroke({
                width: circleStrokeWidth,
                color: circleStrokeColor
              }) : void 0,
              fill: circleColor ? new Fill({
                color: circleColor
              }) : void 0,
              declutterMode: "none"
            });
            iconImageCache[cache_key] = iconImg;
          }
          style.setImage(iconImg);
          text = style.getText();
          style.setText(void 0);
          style.setGeometry(void 0);
          style.setZIndex(index);
          hasImage = true;
        }
        let label, font, textLineHeight, textSize, letterSpacing, maxTextWidth;
        if ("text-field" in layout) {
          textSize = Math.round(
            getValue(
              layer,
              "layout",
              "text-size",
              f,
              functionCache,
              featureState
            )
          );
          const fontArray = getValue(
            layer,
            "layout",
            "text-font",
            f,
            functionCache,
            featureState
          );
          textLineHeight = getValue(
            layer,
            "layout",
            "text-line-height",
            f,
            functionCache,
            featureState
          );
          font = mapbox_to_css_font_default(
            getFonts2 ? getFonts2(
              fontArray,
              glStyle.metadata ? glStyle.metadata["ol:webfonts"] : void 0
            ) : fontArray,
            textSize,
            textLineHeight
          );
          if (!font.includes("sans-serif")) {
            font += ",sans-serif";
          }
          letterSpacing = getValue(
            layer,
            "layout",
            "text-letter-spacing",
            f,
            functionCache,
            featureState
          );
          maxTextWidth = getValue(
            layer,
            "layout",
            "text-max-width",
            f,
            functionCache,
            featureState
          );
          const textField = getValue(
            layer,
            "layout",
            "text-field",
            f,
            functionCache,
            featureState
          );
          if (typeof textField === "object" && textField.sections) {
            if (textField.sections.length === 1) {
              label = textField.toString();
            } else {
              label = textField.sections.reduce((acc, chunk, i2) => {
                const fonts = chunk.fontStack ? chunk.fontStack.split(",") : fontArray;
                const chunkFont = mapbox_to_css_font_default(
                  getFonts2 ? getFonts2(fonts) : fonts,
                  textSize * (chunk.scale || 1),
                  textLineHeight
                );
                let text2 = chunk.text;
                if (text2 === "\n") {
                  acc.push("\n", "");
                  return acc;
                }
                if (type == 2) {
                  acc.push(applyLetterSpacing(text2, letterSpacing), chunkFont);
                  return acc;
                }
                text2 = wrapText(
                  text2,
                  chunkFont,
                  maxTextWidth,
                  letterSpacing
                ).split("\n");
                for (let i3 = 0, ii2 = text2.length; i3 < ii2; ++i3) {
                  if (i3 > 0) {
                    acc.push("\n", "");
                  }
                  acc.push(text2[i3], chunkFont);
                }
                return acc;
              }, []);
            }
          } else {
            label = fromTemplate(textField, properties).trim();
          }
          opacity = getValue(
            layer,
            "paint",
            "text-opacity",
            f,
            functionCache,
            featureState
          );
        }
        if (label && opacity && !skipLabel) {
          if (!hasImage) {
            ++stylesLength;
            style = styles[stylesLength];
            if (!style || !style.getText() || style.getFill() || style.getStroke()) {
              style = new Style();
              styles[stylesLength] = style;
            }
            style.setImage(void 0);
            style.setGeometry(void 0);
          }
          const declutterMode = getDeclutterMode(
            layer,
            f,
            "text",
            functionCache
          );
          if (!style.getText()) {
            style.setText(text);
          }
          text = style.getText();
          if (!text || "getDeclutterMode" in text && text.getDeclutterMode() !== declutterMode) {
            text = new Text({
              padding: [2, 2, 2, 2],
              // @ts-ignore
              declutterMode
            });
            style.setText(text);
          }
          const textTransform = getValue(
            layer,
            "layout",
            "text-transform",
            f,
            functionCache,
            featureState
          );
          if (textTransform == "uppercase") {
            label = Array.isArray(label) ? label.map((t, i2) => i2 % 2 ? t : t.toUpperCase()) : label.toUpperCase();
          } else if (textTransform == "lowercase") {
            label = Array.isArray(label) ? label.map((t, i2) => i2 % 2 ? t : t.toLowerCase()) : label.toLowerCase();
          }
          const wrappedLabel = Array.isArray(label) ? label : type == 2 ? applyLetterSpacing(label, letterSpacing) : wrapText(label, font, maxTextWidth, letterSpacing);
          text.setText(wrappedLabel);
          text.setFont(font);
          text.setRotation(
            deg2rad2(
              getValue(
                layer,
                "layout",
                "text-rotate",
                f,
                functionCache,
                featureState
              )
            )
          );
          if (typeof text.setKeepUpright === "function") {
            const keepUpright = getValue(
              layer,
              "layout",
              "text-keep-upright",
              f,
              functionCache,
              featureState
            );
            text.setKeepUpright(keepUpright);
          }
          const textAnchor = getValue(
            layer,
            "layout",
            "text-anchor",
            f,
            functionCache,
            featureState
          );
          const placement = hasImage || type == 1 ? "point" : getValue(
            layer,
            "layout",
            "symbol-placement",
            f,
            functionCache,
            featureState
          );
          let textAlign;
          if (placement === "line-center") {
            text.setPlacement("line");
            textAlign = "center";
          } else {
            text.setPlacement(placement);
          }
          if (placement === "line" && typeof text.setRepeat === "function") {
            const symbolSpacing = getValue(
              layer,
              "layout",
              "symbol-spacing",
              f,
              functionCache,
              featureState
            );
            text.setRepeat(symbolSpacing * 2);
          }
          text.setOverflow(placement === "point");
          let textHaloWidth = getValue(
            layer,
            "paint",
            "text-halo-width",
            f,
            functionCache,
            featureState
          );
          const textOffset = getValue(
            layer,
            "layout",
            "text-offset",
            f,
            functionCache,
            featureState
          );
          const textTranslate = getValue(
            layer,
            "paint",
            "text-translate",
            f,
            functionCache,
            featureState
          );
          let vOffset = 0;
          let hOffset = 0;
          if (placement == "point") {
            textAlign = "center";
            if (textAnchor.indexOf("left") !== -1) {
              textAlign = "left";
              hOffset = textHaloWidth;
            } else if (textAnchor.indexOf("right") !== -1) {
              textAlign = "right";
              hOffset = -textHaloWidth;
            }
            const textRotationAlignment = getValue(
              layer,
              "layout",
              "text-rotation-alignment",
              f,
              functionCache,
              featureState
            );
            text.setRotateWithView(textRotationAlignment == "map");
          } else {
            text.setMaxAngle(
              deg2rad2(
                getValue(
                  layer,
                  "layout",
                  "text-max-angle",
                  f,
                  functionCache,
                  featureState
                )
              ) * label.length / wrappedLabel.length
            );
            text.setRotateWithView(false);
          }
          text.setTextAlign(textAlign);
          let textBaseline = "middle";
          if (textAnchor.indexOf("bottom") == 0) {
            textBaseline = "bottom";
            vOffset = -textHaloWidth - 0.5 * (textLineHeight - 1) * textSize;
          } else if (textAnchor.indexOf("top") == 0) {
            textBaseline = "top";
            vOffset = textHaloWidth + 0.5 * (textLineHeight - 1) * textSize;
          }
          text.setTextBaseline(textBaseline);
          const textJustify = getValue(
            layer,
            "layout",
            "text-justify",
            f,
            functionCache,
            featureState
          );
          text.setJustify(textJustify === "auto" ? void 0 : textJustify);
          text.setOffsetX(
            textOffset[0] * textSize + hOffset + textTranslate[0]
          );
          text.setOffsetY(
            textOffset[1] * textSize + vOffset + textTranslate[1]
          );
          const textFill = text.getFill() || new Fill();
          textFill.setColor(
            colorWithOpacity(
              getValue(
                layer,
                "paint",
                "text-color",
                f,
                functionCache,
                featureState
              ),
              opacity
            )
          );
          text.setFill(textFill);
          const haloColor = colorWithOpacity(
            getValue(
              layer,
              "paint",
              "text-halo-color",
              f,
              functionCache,
              featureState
            ),
            opacity
          );
          if (haloColor && textHaloWidth > 0) {
            const textStroke = text.getStroke() || new Stroke();
            textStroke.setColor(haloColor);
            textHaloWidth *= 2;
            const halfTextSize = 0.5 * textSize;
            textStroke.setWidth(
              textHaloWidth <= halfTextSize ? textHaloWidth : halfTextSize
            );
            text.setStroke(textStroke);
          } else {
            text.setStroke(void 0);
          }
          const textPadding = getValue(
            layer,
            "layout",
            "text-padding",
            f,
            functionCache,
            featureState
          );
          const padding = text.getPadding();
          if (textPadding !== padding[0]) {
            padding[0] = textPadding;
            padding[1] = textPadding;
            padding[2] = textPadding;
            padding[3] = textPadding;
          }
          style.setZIndex(index);
        }
      }
    }
    if (stylesLength > -1) {
      styles.length = stylesLength + 1;
      if (recordLayer) {
        if ("set" in feature) {
          feature.set("mapbox-layer", featureBelongsToLayer);
        } else {
          feature.getProperties()["mapbox-layer"] = featureBelongsToLayer;
        }
      }
      return styles;
    }
    return void 0;
  };
  olLayer.setStyle(styleFunction);
  olLayer.set("mapbox-layers", mapboxLayers);
  olLayer.set("mapbox-source", mapboxSource);
  olLayer.set("mapbox-featurestate", olLayer.get("mapbox-featurestate") || {});
  return styleFunction;
}

// node_modules/ol-mapbox-style/src/rasterfunction.js
var defaultShadowColor = Color.parse("#000000");
var defaultHighlightColor = Color.parse("#FFFFFF");
var defaultAccentColor = Color.parse("#000000");
function createRasterOpLayer(tileLayer) {
  return new ImageLayer({
    source: new Raster({
      operationType: "image",
      operation: raster,
      sources: [tileLayer]
    })
  });
}
function createHillshadeLayer(tileLayer) {
  return new ImageLayer({
    source: new Raster({
      operationType: "image",
      operation: hillshade,
      sources: [tileLayer]
    })
  });
}
function configureRasterOpLayer(layer, glLayer, options, functionCache) {
  layer.getSource().on("beforeoperations", function(event) {
    cameraObj.zoom = getZoomForResolution(
      event.resolution,
      options.resolutions || defaultResolutions
    );
    cameraObj.distanceFromCenter = 0;
    const data = event.data;
    data.saturation = getValue(
      glLayer,
      "paint",
      "raster-saturation",
      emptyObj,
      functionCache
    );
    data.contrast = getValue(
      glLayer,
      "paint",
      "raster-contrast",
      emptyObj,
      functionCache
    );
    data.brightnessHigh = getValue(
      glLayer,
      "paint",
      "raster-brightness-max",
      emptyObj,
      functionCache
    );
    data.brightnessLow = getValue(
      glLayer,
      "paint",
      "raster-brightness-min",
      emptyObj,
      functionCache
    );
    data.hueRotate = getValue(
      glLayer,
      "paint",
      "raster-hue-rotate",
      emptyObj,
      functionCache
    );
  });
}
function configureHillshadeLayer(layer, glSource, glLayer, options, functionCache) {
  layer.getSource().on("beforeoperations", function(event) {
    const data = event.data;
    data.resolution = getPointResolution(
      options.projection || "EPSG:3857",
      event.resolution,
      getCenter2(event.extent),
      "m"
    );
    const zoom = getZoomForResolution(
      event.resolution,
      options.resolutions || defaultResolutions
    );
    cameraObj.zoom = zoom;
    cameraObj.distanceFromCenter = 0;
    data.zoom = zoom;
    data.encoding = glSource.encoding;
    data.method = getValue(glLayer, "paint", "hillshade-method", emptyObj, functionCache) || "standard";
    data.exaggeration = getValue(
      glLayer,
      "paint",
      "hillshade-exaggeration",
      emptyObj,
      functionCache
    );
    let dirValue = getValue(
      glLayer,
      "paint",
      "hillshade-illumination-direction",
      emptyObj,
      functionCache
    );
    if (dirValue === null || dirValue === void 0) {
      dirValue = 335;
    }
    data.azimuths = Array.isArray(dirValue) ? dirValue : [dirValue];
    data.sunAz = data.azimuths[0];
    let altValue = getValue(
      glLayer,
      "paint",
      "hillshade-illumination-altitude",
      emptyObj,
      functionCache
    );
    if (altValue === null || altValue === void 0) {
      altValue = 45;
    }
    data.altitudes = Array.isArray(altValue) ? altValue : [altValue];
    function unwrapColor(val) {
      if (val && val.values) {
        return val.values[0];
      }
      return val;
    }
    function getColorArray(property) {
      const raw = glLayer.paint?.[property];
      if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === "string" && Color.parse(raw[0]) !== void 0) {
        return raw.map((c) => Color.parse(c));
      }
      let val = getValue(glLayer, "paint", property, emptyObj, functionCache);
      val = unwrapColor(val);
      return val ? [val] : void 0;
    }
    data.highlightColors = getColorArray("hillshade-highlight-color");
    data.highlightColor = data.highlightColors?.[0] || defaultHighlightColor;
    if (!data.highlightColors) {
      data.highlightColors = [data.highlightColor];
    }
    data.shadowColors = getColorArray("hillshade-shadow-color");
    data.shadowColor = data.shadowColors?.[0] || defaultShadowColor;
    if (!data.shadowColors) {
      data.shadowColors = [data.shadowColor];
    }
    data.accentColor = unwrapColor(
      getValue(
        glLayer,
        "paint",
        "hillshade-accent-color",
        emptyObj,
        functionCache
      )
    ) || defaultAccentColor;
  });
}
var rasterOperationKeys = [
  "raster-saturation",
  "raster-contrast",
  "raster-brightness-max",
  "raster-brightness-min",
  "raster-hue-rotate"
];
function prerenderRasterLayer(glLayer, layer, functionCache) {
  let zoom = null;
  return function(event) {
    if (glLayer.paint && "raster-opacity" in glLayer.paint && event.frameState.viewState.zoom !== zoom) {
      zoom = event.frameState.viewState.zoom;
      delete functionCache[glLayer.id];
      updateRasterLayerProperties(glLayer, layer, zoom, functionCache);
    }
  };
}
function updateRasterLayerProperties(glLayer, layer, zoom, functionCache) {
  cameraObj.zoom = zoom;
  cameraObj.distanceFromCenter = 0;
  const opacity = getValue(
    glLayer,
    "paint",
    "raster-opacity",
    emptyObj,
    functionCache
  );
  layer.setOpacity(opacity);
}

// node_modules/ol-mapbox-style/src/apply.js
var SUPPORTED_LAYER_TYPES = [
  "background",
  "circle",
  "fill",
  "fill-extrusion",
  "line",
  "symbol",
  "raster",
  "hillshade"
];
function getTileResolutions(projection, tileSize = 512) {
  return projection.getExtent() ? createXYZ({
    extent: projection.getExtent(),
    tileSize,
    maxZoom: 22
  }).getResolutions() : defaultResolutions;
}
function completeOptions(styleUrl, options) {
  if (!options.accessToken) {
    options = Object.assign({}, options);
    const searchParams = new URL(styleUrl).searchParams;
    searchParams.forEach((value, key) => {
      options.accessToken = value;
      options.accessTokenParam = key;
    });
  }
  return options;
}
function applyStyle(layer, glStyle, sourceOrLayersOrOptions = "", optionsOrPath = {}, resolutions = void 0) {
  let styleUrl, sourceId;
  let options;
  let sourceOrLayers;
  let updateSource = true;
  if (typeof sourceOrLayersOrOptions !== "string" && !Array.isArray(sourceOrLayersOrOptions)) {
    options = sourceOrLayersOrOptions;
    sourceOrLayers = options.source || options.layers;
    optionsOrPath = options;
  } else {
    sourceOrLayers = sourceOrLayersOrOptions;
  }
  if (typeof optionsOrPath === "string") {
    styleUrl = optionsOrPath;
    options = {};
  } else {
    styleUrl = optionsOrPath.styleUrl;
    options = optionsOrPath;
  }
  if (options.updateSource === false) {
    updateSource = false;
  }
  if (!resolutions) {
    resolutions = options.resolutions;
  }
  if (!styleUrl && typeof glStyle === "string" && !glStyle.trim().startsWith("{")) {
    styleUrl = glStyle;
  }
  if (styleUrl) {
    styleUrl = styleUrl.startsWith("data:") ? location.href : normalizeStyleUrl(styleUrl, options.accessToken);
    options = completeOptions(styleUrl, options);
  }
  return new Promise(function(resolve, reject) {
    getGlStyle(glStyle, options).then(function(glStyle2) {
      if (glStyle2.version != 8) {
        return reject(new Error("glStyle version 8 required."));
      }
      if (!(layer instanceof VectorLayer || layer instanceof VectorTileLayer)) {
        return reject(
          new Error("Can only apply to VectorLayer or VectorTileLayer")
        );
      }
      const type = layer instanceof VectorTileLayer ? "vector" : "geojson";
      if (!sourceOrLayers) {
        sourceId = glStyle2.layers.find(function(layer2) {
          return layer2.source && glStyle2.sources[layer2.source].type === type;
        }).source;
        sourceOrLayers = sourceId;
      } else if (Array.isArray(sourceOrLayers)) {
        sourceId = glStyle2.layers.find(function(layer2) {
          return layer2.id === sourceOrLayers[0];
        }).source;
      } else {
        sourceId = sourceOrLayers;
      }
      if (!sourceId) {
        return reject(new Error(`No ${type} source found in the glStyle.`));
      }
      function assignSource() {
        if (!updateSource) {
          return Promise.resolve();
        }
        if (layer instanceof VectorTileLayer) {
          return setupVectorSource(
            glStyle2.sources[sourceId],
            styleUrl,
            options
          ).then(function(source2) {
            const targetSource2 = layer.getSource();
            if (!targetSource2) {
              layer.setSource(source2);
            } else if (source2 !== targetSource2) {
              targetSource2.setTileUrlFunction(source2.getTileUrlFunction());
              if (typeof targetSource2.setUrls === "function" && typeof source2.getUrls === "function") {
                targetSource2.setUrls(source2.getUrls());
              }
              if (!targetSource2.format_) {
                targetSource2.format_ = source2.format_;
              }
              if (!targetSource2.getAttributions()) {
                targetSource2.setAttributions(source2.getAttributions());
              }
              if (targetSource2.getTileLoadFunction() === defaultLoadFunction) {
                targetSource2.setTileLoadFunction(
                  source2.getTileLoadFunction()
                );
              }
              if (equivalent(
                targetSource2.getProjection(),
                source2.getProjection()
              )) {
                targetSource2.tileGrid = source2.getTileGrid();
              }
            }
            const tileGrid = layer.getSource().getTileGrid();
            if (!isFinite(layer.getMaxResolution()) && !isFinite(layer.getMinZoom()) && tileGrid.getMinZoom() > 0) {
              layer.setMaxResolution(
                getResolutionForZoom(
                  Math.max(0, tileGrid.getMinZoom() - 1e-12),
                  tileGrid.getResolutions()
                )
              );
            }
          });
        }
        const glSource = glStyle2.sources[sourceId];
        let source = layer.getSource();
        if (!source || source.get("mapbox-source") !== glSource) {
          source = setupGeoJSONSource(glSource, styleUrl, options);
        }
        const targetSource = (
          /** @type {VectorSource} */
          layer.getSource()
        );
        if (!targetSource) {
          layer.setSource(source);
        } else if (source !== targetSource) {
          if (!targetSource.getAttributions()) {
            targetSource.setAttributions(source.getAttributions());
          }
          if (!targetSource.format_) {
            targetSource.format_ = source.getFormat();
          }
          targetSource.url_ = source.getUrl();
        }
        return Promise.resolve();
      }
      let spriteScale, style;
      const spriteData = {};
      const spriteImageUrl = {};
      function onChange() {
        if (!style && (!glStyle2.sprite || spriteData)) {
          if (options.projection && !resolutions) {
            const projection = getProjection(options.projection);
            const units = projection.getUnits();
            if (units !== "m") {
              resolutions = defaultResolutions.map(
                (resolution) => resolution / METERS_PER_UNIT[units]
              );
            }
          }
          let layerProperty;
          const source = layer.getSource();
          if (source instanceof VectorTileSource) {
            if (source.format_ instanceof MVT) {
              layerProperty = source.format_.layerName_;
            }
          }
          style = stylefunction(
            layer,
            glStyle2,
            sourceOrLayers,
            resolutions,
            spriteData,
            spriteImageUrl,
            (fonts, templateUrl = options.webfonts) => getFonts(fonts, templateUrl),
            options.getImage,
            layerProperty
          );
          if (!layer.getStyle()) {
            reject(new Error(`Nothing to show for source [${sourceId}]`));
          } else {
            assignSource().then(resolve).catch(reject);
          }
        } else if (style) {
          layer.setStyle(style);
          assignSource().then(resolve).catch(reject);
        } else {
          reject(new Error("Something went wrong trying to apply style."));
        }
      }
      if (glStyle2.sprite) {
        const sprites = normalizeSpriteDefinition(
          glStyle2.sprite,
          options.accessToken,
          styleUrl || location.href
        );
        spriteScale = WORKER_OFFSCREEN_CANVAS2 ? 1 : window.devicePixelRatio >= 1.5 ? 0.5 : 1;
        const sizeFactor = spriteScale == 0.5 ? "@2x" : "";
        Promise.all(
          sprites.map(function(sprite) {
            const spriteBaseUrl = new URL(sprite.url);
            let spriteUrl = spriteBaseUrl.origin + spriteBaseUrl.pathname + sizeFactor + ".json" + spriteBaseUrl.search;
            return new Promise(function(resolve2, reject2) {
              fetchResource("Sprite", spriteUrl, options).then(resolve2).catch(function(error2) {
                spriteUrl = spriteBaseUrl.origin + spriteBaseUrl.pathname + ".json" + spriteBaseUrl.search;
                fetchResource("Sprite", spriteUrl, options).then(resolve2).catch(reject2);
              });
            }).then(function(spritesJson) {
              if (spritesJson === void 0) {
                reject(new Error("No sprites found."));
              }
              let imageUrl;
              imageUrl = spriteBaseUrl.origin + spriteBaseUrl.pathname + sizeFactor + ".png" + spriteBaseUrl.search;
              if (options.transformRequest) {
                const transformed = options.transformRequest(imageUrl, "SpriteImage") || imageUrl;
                if (transformed instanceof Request || transformed instanceof Promise) {
                  imageUrl = transformed;
                }
              }
              spriteImageUrl[sprite.id] = imageUrl;
              for (const spriteName in spritesJson) {
                const key = sprite.id == "default" ? spriteName : `${sprite.id}:${spriteName}`;
                spriteData[key] = spritesJson[spriteName];
              }
            }).catch(function(err) {
              reject(
                new Error(
                  `Sprites cannot be loaded: ${spriteUrl}: ${err.message}`
                )
              );
            });
          })
        ).then(onChange).catch(reject);
      } else {
        onChange();
      }
    }).catch(reject);
  });
}
var REF_INHERITED_PROPS = [
  "type",
  "source",
  "source-layer",
  "minzoom",
  "maxzoom",
  "filter",
  "layout"
];
function resolveRef(layers, glLayer) {
  if (!glLayer.ref) {
    return glLayer;
  }
  const refLayer = layers.find((layer) => layer.id === glLayer.ref);
  if (!refLayer) {
    return glLayer;
  }
  const resolved = Object.assign({}, glLayer);
  for (const key of REF_INHERITED_PROPS) {
    if (!(key in resolved) && key in refLayer) {
      resolved[key] = refLayer[key];
    }
  }
  return resolved;
}
function extentFromTileJSON(tileJSON, projection) {
  const bounds = tileJSON.bounds;
  if (bounds) {
    const ll = fromLonLat2([bounds[0], bounds[1]], projection);
    const tr = fromLonLat2([bounds[2], bounds[3]], projection);
    return [ll[0], ll[1], tr[0], tr[1]];
  }
  return getProjection(projection).getExtent();
}
function sourceOptionsFromTileJSON(glSource, tileJSON, options) {
  const tileJSONSource = new TileJSON({
    tileJSON,
    tileSize: glSource.tileSize || tileJSON.tileSize || 512
  });
  const tileJSONDoc = tileJSONSource.getTileJSON();
  const tileGrid = tileJSONSource.getTileGrid();
  const projection = getProjection(options.projection || "EPSG:3857");
  const extent = extentFromTileJSON(tileJSONDoc, projection);
  const projectionExtent = projection.getExtent();
  const minZoom = tileJSONDoc.minzoom || 0;
  const maxZoom = tileJSONDoc.maxzoom || 22;
  const sourceOptions = {
    attributions: tileJSONSource.getAttributions(),
    projection,
    tileGrid: new TileGrid({
      origin: projectionExtent ? getTopLeft(projectionExtent) : tileGrid.getOrigin(0),
      extent: extent || tileGrid.getExtent(),
      minZoom,
      resolutions: getTileResolutions(projection, tileJSON.tileSize).slice(
        0,
        maxZoom + 1
      ),
      tileSize: tileGrid.getTileSize(0)
    })
  };
  if (Array.isArray(tileJSONDoc.tiles)) {
    sourceOptions.urls = tileJSONDoc.tiles;
  } else {
    sourceOptions.url = tileJSONDoc.tiles;
  }
  return sourceOptions;
}
function getBackgroundColor(glLayer, resolution, options, functionCache) {
  const background = {
    id: glLayer.id,
    type: glLayer.type
  };
  const paint = glLayer.paint || {};
  background["paint"] = paint;
  cameraObj.zoom = getZoomForResolution(
    resolution,
    options.resolutions || defaultResolutions
  );
  cameraObj.distanceFromCenter = 0;
  let opacity;
  const bg = getValue(
    background,
    "paint",
    "background-color",
    emptyObj,
    functionCache
  );
  if (paint["background-opacity"] !== void 0) {
    opacity = getValue(
      background,
      "paint",
      "background-opacity",
      emptyObj,
      functionCache
    );
  }
  return getValue(
    background,
    "layout",
    "visibility",
    emptyObj,
    functionCache
  ) === "none" ? void 0 : colorWithOpacity(bg, opacity);
}
function setupBackgroundLayer(glLayer, options, functionCache) {
  const div = WORKER_OFFSCREEN_CANVAS2 ? (
    /** @type { HTMLDivElement } */
    { style: {} }
  ) : document.createElement("div");
  div.className = "ol-mapbox-style-background";
  div.style.position = "absolute";
  div.style.width = "100%";
  div.style.height = "100%";
  return new Layer({
    source: new Source({}),
    render(frameState) {
      const color = getBackgroundColor(
        glLayer,
        frameState.viewState.resolution,
        options,
        functionCache
      );
      div.style.backgroundColor = color;
      return div;
    }
  });
}
function setupVectorSource(glSource, styleUrl, options) {
  return new Promise(function(resolve, reject) {
    getTileJson(glSource, styleUrl, options).then(function({ tileJson, tileLoadFunction }) {
      const sourceOptions = sourceOptionsFromTileJSON(
        glSource,
        tileJson,
        options
      );
      sourceOptions.tileLoadFunction = tileLoadFunction;
      sourceOptions.format = new MVT({ layerName: "mvt:layer" });
      const source = new VectorTileSource(sourceOptions);
      source.set("mapbox-source", glSource);
      resolve(source);
    }).catch(reject);
  });
}
function setupVectorLayer(glSource, styleUrl, options) {
  const layer = new VectorTileLayer({
    declutter: true,
    visible: false
  });
  setupVectorSource(glSource, styleUrl, options).then(function(source) {
    layer.setSource(source);
  }).catch(function(error2) {
    layer.setSource(void 0);
  });
  return layer;
}
function getBboxTemplate(projection) {
  const projCode = projection ? projection.getCode() : "EPSG:3857";
  return `{bbox-${projCode.toLowerCase().replace(/[^a-z0-9]/g, "-")}}`;
}
function setupRasterSource(glSource, styleUrl, options) {
  return new Promise(function(resolve, reject) {
    getTileJson(glSource, styleUrl, options).then(function({ tileJson, tileLoadFunction }) {
      const source = new TileJSON({
        interpolate: options.interpolate === void 0 ? true : options.interpolate,
        transition: 0,
        crossOrigin: "anonymous",
        tileJSON: tileJson
      });
      source.tileGrid = sourceOptionsFromTileJSON(
        glSource,
        tileJson,
        options
      ).tileGrid;
      if (options.projection) {
        source.projection = getProjection(options.projection);
      }
      const getTileUrl = source.getTileUrlFunction();
      if (tileLoadFunction) {
        source.setTileLoadFunction(tileLoadFunction);
      }
      source.setTileUrlFunction(function(tileCoord, pixelRatio, projection) {
        const bboxTemplate = getBboxTemplate(projection);
        let src = getTileUrl(tileCoord, pixelRatio, projection);
        if (src.indexOf(bboxTemplate) != -1) {
          const bbox = source.getTileGrid().getTileCoordExtent(tileCoord);
          src = src.replace(bboxTemplate, bbox.toString());
        }
        return src;
      });
      source.set("mapbox-source", glSource);
      resolve(source);
    }).catch(function(error2) {
      reject(error2);
    });
  });
}
function setupRasterLayer(glSource, styleUrl, options) {
  const layer = new TileLayer();
  setupRasterSource(glSource, styleUrl, options).then(function(source) {
    layer.setSource(source);
  }).catch(function() {
    layer.setSource(void 0);
  });
  return layer;
}
function setupGeoJSONSource(glSource, styleUrl, options) {
  const geoJsonFormat = options.projection ? new GeoJSON({ dataProjection: options.projection }) : new GeoJSON();
  const data = glSource.data;
  const sourceOptions = {};
  if (typeof data == "string") {
    const [geoJsonUrl] = normalizeSourceUrl(
      data,
      options.accessToken,
      options.accessTokenParam || "access_token",
      styleUrl || location.href
    );
    if (/\{bbox-[0-9a-z-]+\}/.test(geoJsonUrl)) {
      const extentUrl = (extent, resolution, projection) => {
        const bboxTemplate = getBboxTemplate(projection);
        return geoJsonUrl.replace(bboxTemplate, `${extent.join(",")}`);
      };
      const source3 = new VectorSource({
        attributions: glSource.attribution,
        format: geoJsonFormat,
        loader: (extent, resolution, projection, success2, failure) => {
          const url = typeof extentUrl === "function" ? extentUrl(extent, resolution, projection) : extentUrl;
          fetchResource("GeoJSON", url, options).then((json) => {
            const features = (
              /** @type {*} */
              source3.getFormat().readFeatures(json, { featureProjection: projection })
            );
            source3.addFeatures(features);
            success2(features);
          }).catch((response) => {
            source3.removeLoadedExtent(extent);
            failure();
          });
        },
        strategy: bboxStrategy
      });
      source3.set("mapbox-source", glSource);
      return source3;
    }
    const source2 = new VectorSource({
      attributions: glSource.attribution,
      format: geoJsonFormat,
      url: geoJsonUrl,
      loader: (extent, resolution, projection, success2, failure) => {
        fetchResource("GeoJSON", geoJsonUrl, options).then((json) => {
          const features = (
            /** @type {*} */
            source2.getFormat().readFeatures(json, { featureProjection: projection })
          );
          source2.addFeatures(features);
          success2(features);
        }).catch((response) => {
          source2.removeLoadedExtent(extent);
          failure();
        });
      }
    });
    return source2;
  }
  sourceOptions.features = geoJsonFormat.readFeatures(data, {
    featureProjection: getUserProjection() || "EPSG:3857"
  });
  const source = new VectorSource(
    Object.assign(
      {
        attributions: glSource.attribution,
        format: geoJsonFormat
      },
      sourceOptions
    )
  );
  source.set("mapbox-source", glSource);
  return (
    /** @type {VectorSource} */
    source
  );
}
function setupGeoJSONLayer(glSource, styleUrl, options) {
  return new VectorLayer({
    declutter: true,
    source: setupGeoJSONSource(glSource, styleUrl, options),
    visible: false
  });
}
function manageVisibility(layer, mapOrGroup, functionCache) {
  function onChange() {
    const glStyle = mapOrGroup.get("mapbox-style");
    if (!glStyle) {
      return;
    }
    const mapboxLayers = derefLayers(glStyle.layers);
    const layerMapboxLayerids = layer.get("mapbox-layers");
    const visible = mapboxLayers.filter(function(mapboxLayer) {
      return layerMapboxLayerids.includes(mapboxLayer.id);
    }).some(function(mapboxLayer) {
      return !mapboxLayer.layout || getValue(
        mapboxLayer,
        "layout",
        "visibility",
        emptyObj,
        functionCache
      ) === "visible";
    });
    if (layer.get("visible") !== visible) {
      layer.setVisible(visible);
    }
  }
  layer.on("change", onChange);
  onChange();
}
function setupLayer(glStyle, styleUrl, glLayer, options) {
  glLayer = resolveRef(glStyle.layers, glLayer);
  const functionCache = getFunctionCache(glStyle);
  const type = glLayer.type;
  let glSourceId = glLayer.source;
  const glSource = glStyle.sources[glSourceId];
  let layer;
  if (type == "background") {
    layer = setupBackgroundLayer(glLayer, options, functionCache);
    glSourceId = void 0;
  } else if (glSource.type == "vector") {
    layer = setupVectorLayer(glSource, styleUrl, options);
  } else if (glSource.type == "raster") {
    const requiresOperations = !!Object.keys(glLayer.paint || {}).find(
      (key) => {
        return rasterOperationKeys.includes(key);
      }
    );
    if (requiresOperations) {
      const tileLayer = setupRasterLayer(glSource, styleUrl, options);
      layer = createRasterOpLayer(tileLayer);
      configureRasterOpLayer(layer, glLayer, options, functionCache);
    } else {
      layer = setupRasterLayer(glSource, styleUrl, options);
    }
    layer.setVisible(
      glLayer.layout ? getValue(glLayer, "layout", "visibility", emptyObj, functionCache) !== "none" : true
    );
    layer.on("prerender", prerenderRasterLayer(glLayer, layer, functionCache));
  } else if (glSource.type == "geojson") {
    layer = setupGeoJSONLayer(glSource, styleUrl, options);
  } else if (glSource.type == "raster-dem" && glLayer.type == "hillshade") {
    const tileLayer = setupRasterLayer(glSource, styleUrl, options);
    layer = createHillshadeLayer(tileLayer);
    configureHillshadeLayer(layer, glSource, glLayer, options, functionCache);
    layer.setVisible(
      glLayer.layout ? getValue(glLayer, "layout", "visibility", emptyObj, functionCache) !== "none" : true
    );
  }
  if (layer) {
    layer.set("mapbox-source", glSourceId);
  }
  return layer;
}
function processStyle(glStyle, mapOrGroup, styleUrl, options) {
  if (glStyle.schema) {
    Object.assign(
      styleConfig,
      Object.keys(glStyle.schema).reduce((config, key) => {
        config[key] = glStyle.schema[key]?.default;
        return config;
      }, {})
    );
  }
  const promises = [];
  let view = null;
  if (mapOrGroup instanceof Map3) {
    view = mapOrGroup.getView();
    if (!view.isDef() && !view.getRotation() && !view.getResolutions()) {
      const projection = options.projection ? getProjection(options.projection) : view.getProjection();
      view = new View(
        Object.assign(view.getProperties(), {
          maxResolution: defaultResolutions[0] / METERS_PER_UNIT[projection.getUnits()],
          projection: options.projection || view.getProjection()
        })
      );
      mapOrGroup.setView(view);
    }
    if ("center" in glStyle && !view.getCenter()) {
      view.setCenter(fromLonLat2(glStyle.center, view.getProjection()));
    }
    if ("zoom" in glStyle && view.getZoom() === void 0) {
      view.setResolution(
        defaultResolutions[0] / METERS_PER_UNIT[view.getProjection().getUnits()] / Math.pow(2, glStyle.zoom)
      );
    }
    if (!view.getCenter() || view.getZoom() === void 0) {
      view.fit(view.getProjection().getExtent(), {
        nearest: true,
        size: mapOrGroup.getSize()
      });
    }
  }
  mapOrGroup.set("mapbox-style", glStyle);
  mapOrGroup.set("mapbox-metadata", { styleUrl, options });
  const glLayers = glStyle.layers;
  let layerIds = [];
  let layer, glSourceId, id;
  for (let i = 0, ii = glLayers.length; i < ii; ++i) {
    const glLayer = resolveRef(glLayers, glLayers[i]);
    const type = glLayer.type;
    if (!SUPPORTED_LAYER_TYPES.includes(type)) {
      console.warn(`layers[${i}].type "${type}" not supported`);
      continue;
    } else {
      id = glLayer.source;
      if (!id || id != glSourceId) {
        if (layerIds.length) {
          promises.push(
            finalizeLayer(
              layer,
              layerIds,
              glStyle,
              styleUrl,
              mapOrGroup,
              options
            )
          );
          layerIds = [];
        }
        layer = setupLayer(glStyle, styleUrl, glLayer, options);
        if (!(layer instanceof VectorLayer || layer instanceof VectorTileLayer)) {
          layerIds = [];
        }
        glSourceId = layer.get("mapbox-source");
      }
      layerIds.push(glLayer.id);
    }
  }
  promises.push(
    finalizeLayer(layer, layerIds, glStyle, styleUrl, mapOrGroup, options)
  );
  return Promise.all(promises);
}
function apply(mapOrGroupOrElement, style, options = {}) {
  let promise;
  let mapOrGroup;
  if (WORKER_OFFSCREEN_CANVAS2) {
    if (!(mapOrGroupOrElement instanceof Map3) && !(mapOrGroupOrElement instanceof LayerGroup)) {
      throw new Error(
        "ol-mapbox-style in a web worker requires a Map or a LayerGroup as first argument"
      );
    }
    mapOrGroup = mapOrGroupOrElement;
  } else {
    if (typeof mapOrGroupOrElement === "string" || mapOrGroupOrElement instanceof HTMLElement) {
      mapOrGroup = new Map3({
        target: mapOrGroupOrElement
      });
    } else {
      mapOrGroup = mapOrGroupOrElement;
    }
  }
  if (typeof style === "string") {
    const styleUrl = style.startsWith("data:") ? location.href : normalizeStyleUrl(style, options.accessToken);
    options = completeOptions(styleUrl, options);
    promise = new Promise(function(resolve, reject) {
      getGlStyle(style, options).then(function(glStyle) {
        processStyle(glStyle, mapOrGroup, styleUrl, options).then(function() {
          resolve(mapOrGroup);
        }).catch(reject);
      }).catch(function(err) {
        reject(new Error(`Could not load ${style}: ${err.message}`));
      });
    });
  } else {
    promise = new Promise(function(resolve, reject) {
      processStyle(
        style,
        mapOrGroup,
        !options.styleUrl || options.styleUrl.startsWith("data:") ? location.href : normalizeStyleUrl(options.styleUrl, options.accessToken),
        options
      ).then(function() {
        resolve(mapOrGroup);
      }).catch(reject);
    });
  }
  return promise;
}
function finalizeLayer(layer, layerIds, glStyle, styleUrl, mapOrGroup, options = {}) {
  let minZoom = 24;
  let maxZoom = 0;
  const glLayers = glStyle.layers;
  for (let i = 0, ii = glLayers.length; i < ii; ++i) {
    const glLayer = glLayers[i];
    if (layerIds.indexOf(glLayer.id) !== -1) {
      minZoom = Math.min("minzoom" in glLayer ? glLayer.minzoom : 0, minZoom);
      maxZoom = Math.max("maxzoom" in glLayer ? glLayer.maxzoom : 24, maxZoom);
    }
  }
  return new Promise(function(resolve, reject) {
    const setStyle = function() {
      const source = layer.getSource();
      if (!source || source.getState() === "error") {
        reject(
          new Error(
            "Error accessing data for source " + layer.get("mapbox-source")
          )
        );
        return;
      }
      if ("getTileGrid" in source) {
        const tileGrid = (
          /** @type {import("ol/source/Tile.js").default|import("ol/source/VectorTile.js").default} */
          source.getTileGrid()
        );
        if (tileGrid) {
          const sourceMinZoom = tileGrid.getMinZoom();
          if (minZoom > 0 || sourceMinZoom > 0) {
            layer.setMaxResolution(
              Math.min(
                getResolutionForZoom(
                  Math.max(0, minZoom - 1e-12),
                  defaultResolutions
                ),
                getResolutionForZoom(
                  Math.max(0, sourceMinZoom - 1e-12),
                  tileGrid.getResolutions()
                )
              )
            );
          }
          if (maxZoom < 24) {
            layer.setMinResolution(
              getResolutionForZoom(maxZoom, defaultResolutions)
            );
          }
        }
      } else {
        if (minZoom > 0) {
          layer.setMaxResolution(
            getResolutionForZoom(
              Math.max(0, minZoom - 1e-12),
              defaultResolutions
            )
          );
        }
      }
      if (source instanceof VectorSource || source instanceof VectorTileSource) {
        applyStyle(
          /** @type {import("ol/layer/Vector.js").default|import("ol/layer/VectorTile.js").default} */
          layer,
          glStyle,
          layerIds,
          Object.assign({ styleUrl }, options)
        ).then(function() {
          manageVisibility(layer, mapOrGroup, getFunctionCache(glStyle));
          resolve();
        }).catch(reject);
      } else {
        resolve();
      }
    };
    layer.set("mapbox-layers", layerIds);
    const layers = mapOrGroup.getLayers();
    if (layers.getArray().indexOf(layer) === -1) {
      layers.push(layer);
    }
    if (layer.getSource()) {
      setStyle();
    } else {
      layer.once("change:source", setStyle);
    }
  });
}

// node_modules/ol-mapbox-style/src/MapboxVectorLayer.js
import BaseEvent from "ol/events/Event.js";
import EventType from "ol/events/EventType.js";
import MVT2 from "ol/format/MVT.js";
import VectorTileLayer2 from "ol/layer/VectorTile.js";
import VectorTileSource2 from "ol/source/VectorTile.js";

// js/rover_map.js
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
import VectorLayer2 from "ol/layer/Vector.js";
import VectorSource2 from "ol/source/Vector.js";
import Circle2 from "ol/style/Circle.js";
import Fill2 from "ol/style/Fill.js";
import Stroke2 from "ol/style/Stroke.js";
import Style2 from "ol/style/Style.js";
var PENDING_COLOR = "#2563eb";
var TYPES = /* @__PURE__ */ new Set(["Point", "LineString", "Polygon"]);
function drawTypeFor(type) {
  return TYPES.has(type) ? type : null;
}
var DrawLayer = class {
  constructor() {
    this.source = new VectorSource2({ wrapX: false });
    this.layer = new VectorLayer2({
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
  return new Style2({
    stroke: new Stroke2({ color: PENDING_COLOR, width: 2, lineDash: [6, 5] }),
    fill: new Fill2({ color: [37, 99, 235, 0.08] }),
    // A drawn Point has no stroke or fill to show.
    image: new Circle2({
      radius: 5,
      fill: new Fill2({ color: PENDING_COLOR }),
      stroke: new Stroke2({ color: "rgba(255, 255, 255, 0.9)", width: 2 })
    })
  });
}

// js/heatmap.js
import Feature from "ol/Feature.js";
import Point from "ol/geom/Point.js";
import HeatmapLayerOl from "ol/layer/Heatmap.js";
import VectorSource3 from "ol/source/Vector.js";
var HeatmapLayer = class {
  constructor() {
    this.source = new VectorSource3({ wrapX: false });
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
import VectorLayer3 from "ol/layer/Vector.js";
import Cluster from "ol/source/Cluster.js";
import VectorSource4 from "ol/source/Vector.js";

// js/styles.js
import Style3 from "ol/style/Style.js";
import Circle3 from "ol/style/Circle.js";
import Icon2 from "ol/style/Icon.js";
import Text2 from "ol/style/Text.js";
import Fill3 from "ol/style/Fill.js";
import Stroke3 from "ol/style/Stroke.js";
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
  const styles = marker.emoji ? [new Style3({ text: emojiText(marker.emoji, scale) })] : [new Style3({ image: pinImage(marker, scale) })];
  if (marker.label) {
    const label = labelText(marker.label);
    if (marker.emoji) {
      styles.push(new Style3({ text: label }));
    } else {
      styles[0].setText(label);
    }
  }
  return styles;
}
function pinImage(marker, scale) {
  return marker.icon ? new Icon2({ src: marker.icon, anchor: [0.5, 1], scale }) : new Icon2({ src: pinDataUri(marker.color || DEFAULT_COLOR), anchor: [0.5, 1], scale });
}
function emojiText(emoji, scale) {
  return new Text2({
    text: emoji,
    font: `${Math.round(22 * scale)}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`,
    // Sit the glyph on the coordinate the way a pin's tip does.
    textBaseline: "bottom",
    offsetY: 4
  });
}
function labelText(text) {
  return new Text2({
    text,
    font: "500 12px ui-sans-serif, system-ui, -apple-system, sans-serif",
    offsetY: 8,
    textBaseline: "top",
    fill: new Fill3({ color: "#111827" }),
    // A halo rather than a background box: legible over any tile, without
    // drawing a rectangle over the map.
    stroke: new Stroke3({ color: "rgba(255, 255, 255, 0.92)", width: 3 }),
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
    style = new Style3({
      image: new Circle3({
        radius,
        fill: new Fill3({ color: withAlpha(CLUSTER_COLOR, 0.85) }),
        stroke: new Stroke3({ color: "rgba(255, 255, 255, 0.9)", width: 2 })
      }),
      text: new Text2({
        text: String(count),
        font: "600 12px ui-sans-serif, system-ui, -apple-system, sans-serif",
        fill: new Fill3({ color: "#ffffff" })
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
    this.source = new VectorSource4({ wrapX: false });
    this.layer = new VectorLayer3({
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
import GeoJSON2 from "ol/format/GeoJSON.js";
import VectorLayer4 from "ol/layer/Vector.js";
import VectorSource5 from "ol/source/Vector.js";
import Fill4 from "ol/style/Fill.js";
import Stroke4 from "ol/style/Stroke.js";
import Style4 from "ol/style/Style.js";
import Text3 from "ol/style/Text.js";
var SHAPE_KEY = "roverShape";
var DEFAULT_COLOR2 = "#2563eb";
var DEFAULT_WIDTH = 2;
var DEFAULT_FILL_OPACITY = 0.12;
var CACHE_LIMIT2 = 256;
var cache2 = /* @__PURE__ */ new Map();
var format = new GeoJSON2({
  dataProjection: "EPSG:4326",
  featureProjection: "EPSG:3857"
});
var ShapeLayer = class {
  constructor() {
    this.source = new VectorSource5({ wrapX: false });
    this.layer = new VectorLayer4({
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
  } catch (error2) {
    console.error(`[rover] shape ${shape.id} has unreadable geometry:`, error2, shape.geometry);
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
  const style = new Style4({
    stroke: new Stroke4({ color, width: shape.width || DEFAULT_WIDTH }),
    fill: new Fill4({ color: withOpacity(shape.fill_color || color, opacity) })
  });
  if (shape.label) {
    style.setText(
      new Text3({
        text: shape.label,
        font: "500 12px ui-sans-serif, system-ui, -apple-system, sans-serif",
        fill: new Fill4({ color: "#111827" }),
        stroke: new Stroke4({ color: "rgba(255, 255, 255, 0.92)", width: 3 }),
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
    this.basemapLayer = new TileLayer2({ zIndex: 0, visible: false });
    this.map = new Map4({
      target: element,
      // OpenLayers listens for keys on this element, and by default that is the
      // viewport it builds *inside* the target. Nothing ever focuses that, so
      // KeyboardPan and KeyboardZoom — both already in defaultInteractions() —
      // were present and unreachable. The target is the element the component
      // gives a tabindex, so a keydown on the focused map now reaches them.
      keyboardEventTarget: element,
      layers: [
        this.basemapLayer,
        this.heatmapLayer.layer,
        this.shapeLayer.layer,
        this.drawLayer.layer,
        this.markerLayer.layer
      ],
      controls: buildControls(this.config),
      interactions: buildInteractions(this.config),
      view: new View2({
        center: project(this.config.center[0], this.config.center[1]),
        zoom: this.config.zoom,
        minZoom: this.config.minZoom,
        maxZoom: this.config.maxZoom,
        constrainResolution: true
      })
    });
    this.applyTiles(this.config.tiles);
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
  /**
   * Builds whichever layer type the resolved config calls for and swaps it into
   * slot 0 of the map's layer array, replacing whatever basemap was there before.
   *
   * A vector style is applied to the group asynchronously (`ol-mapbox-style`'s
   * `apply()` resolves once the style, sprite and first tiles have loaded), so
   * the group is inserted into the map immediately and populates progressively
   * as that promise resolves — the same way a raster `XYZ` layer already renders
   * tile by tile as they arrive.
   */
  applyTiles(tiles) {
    const next = buildBasemapLayer(tiles);
    next.setZIndex(0);
    const layers = this.map.getLayers();
    layers.remove(this.basemapLayer);
    this.basemapLayer.dispose();
    layers.insertAt(0, next);
    this.basemapLayer = next;
    if (tiles && tiles.type === "vector") {
      apply(next, tiles.styleUrl).then((group) => setVectorAttributions(group, tiles.attributions)).catch((error2) => console.error("[rover] could not load vector basemap style:", error2));
    }
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
function buildBasemapLayer(tiles) {
  if (!tiles) return new TileLayer2({ visible: false });
  if (tiles.type === "vector") return new LayerGroup2();
  return new TileLayer2({
    source: new XYZ({
      url: resolveRetina(tiles.url),
      attributions: tiles.attributions || void 0,
      maxZoom: tiles.maxZoom ?? 19,
      crossOrigin: "anonymous"
    })
  });
}
function setVectorAttributions(group, attributions) {
  group.getLayers().forEach((layer) => {
    const source = layer.getSource && layer.getSource();
    if (source && source.setAttributions) source.setAttributions(attributions || void 0);
  });
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
  } catch (error2) {
    console.error(`[rover] could not parse ${attribute}:`, error2, json);
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
