defmodule Rover do
  @moduledoc """
  Maps for Phoenix LiveView, powered by [OpenLayers](https://openlayers.org/).

  OpenLayers is a serious mapping engine — projections, tile pyramids, vector
  layers, styling, interactions. It is also a lot to learn before you can put
  three pins on a map. Rover keeps the engine and hides the ceremony:

      <.map id="clients" center={{45.75, 4.85}} zoom={12} markers={@clients} />

      assign(socket,
        clients: [
          %{id: 1, lat: 45.76, lon: 4.83, label: "Atelier"},
          %{id: 2, lat: 45.74, lon: 4.86, label: "Dépôt"}
        ]
      )

  No `Feature`, no `VectorSource`, no `Style`. Assign a list, get a map. Assign a
  different list, and only the markers that changed are touched.

  ## Installation

  Add the dependency:

      def deps do
        [{:rover, "~> 0.1"}]
      end

  Register the hook in `assets/js/app.js`. Rover ships a prebuilt bundle with
  OpenLayers already inside, so there is nothing to install with `npm`:

      import { RoverHooks } from "../../deps/rover/priv/static/rover.js"

      const liveSocket = new LiveSocket("/live", Socket, {
        params: { _csrf_token: csrfToken },
        hooks: { ...RoverHooks }
      })

  Import the stylesheet in `assets/css/app.css`:

      @import "../../deps/rover/priv/static/rover.css";

  And import the component where you need it — typically once, in the
  `html_helpers` block of your `*_web.ex`:

      import Rover.Components

  ## Where to go next

  * `Rover.Components` — the `<.map>` component, its attributes and its events.
  * `Rover.Marker` — what counts as a marker, and how to map your own schemas.
  * `Rover.Tiles` — basemaps, and the attribution you are required to keep.
  * `Rover.Geo` — coordinates, bounding boxes, distances.

  ## Bring your own OpenLayers

  If your app already builds JavaScript with `npm` and you want to control the
  OpenLayers version, import the peer build instead and add `ol` yourself:

      // package.json: "ol": "^10.0.0"
      import { RoverHooks } from "../../deps/rover/priv/static/rover.external.js"

  Rover is tested against the version it bundles; the peer build is offered for
  applications that need to share a single OpenLayers instance with their own
  code.
  """
end
