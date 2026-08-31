export { Rover, RoverHooks } from "./hook.js"

// Exposed for applications that outgrow `<.map>` and want to reach the
// OpenLayers map itself. Everything below this line is a supported escape
// hatch, not the road you are expected to take.
export { RoverMap } from "./rover_map.js"
export { MarkerLayer } from "./markers.js"
export { ShapeLayer } from "./shapes.js"
export { DrawLayer } from "./draw.js"
export { HeatmapLayer } from "./heatmap.js"
export { project, unproject, extentToBbox } from "./coords.js"

import { RoverHooks } from "./hook.js"
export default RoverHooks
