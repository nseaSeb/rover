import { Socket } from "../../deps/phoenix/priv/static/phoenix.mjs"
import { LiveSocket } from "../../deps/phoenix_live_view/priv/static/phoenix_live_view.esm.js"

// The playground builds Rover from source rather than from priv/static, so that
// `npm run watch` reflects an edit to the runtime immediately.
import { RoverHooks } from "../../assets/js/index.js"

const csrfToken = document.querySelector("meta[name='csrf-token']").getAttribute("content")

const liveSocket = new LiveSocket("/live", Socket, {
  params: { _csrf_token: csrfToken },
  hooks: { ...RoverHooks },
})

liveSocket.connect()
window.liveSocket = liveSocket
