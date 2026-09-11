defmodule RoverDev.GeoJSONController do
  @moduledoc false
  # What an application serving `shape_source` actually writes. Read-only, and
  # answered from the session rather than from anything in the URL — a GET is
  # not covered by `protect_from_forgery`, so the endpoint has to be safe to
  # request from anywhere.
  use Phoenix.Controller, formats: [:json]

  # Four fields around Lyon, well clear of the markers so the browser suite can
  # click one without hitting anything else.
  @fields [
    {"F-01", "Sud", [[4.860, 45.735], [4.880, 45.735], [4.880, 45.745], [4.860, 45.745]]},
    {"F-02", "Est", [[4.890, 45.750], [4.910, 45.750], [4.910, 45.760], [4.890, 45.760]]},
    {"F-03", "Nord", [[4.870, 45.790], [4.890, 45.790], [4.890, 45.800], [4.870, 45.800]]},
    {"F-04", "Ouest", [[4.700, 45.760], [4.720, 45.760], [4.720, 45.770], [4.700, 45.770]]}
  ]

  def parcels(conn, params) do
    # With a rev in the URL this answer can never go stale: a changed file is a
    # changed rev is a different URL, so the browser may keep it forever.
    # Without one, nothing distinguishes one version from the next, and it has
    # to ask again every time.
    cache =
      if params["rev"], do: "private, max-age=31536000, immutable", else: "private, max-age=0"

    features =
      Enum.map(@fields, fn {id, name, ring} ->
        %{
          "type" => "Feature",
          "id" => id,
          "properties" => %{"name" => name},
          "geometry" => %{"type" => "Polygon", "coordinates" => [ring ++ [hd(ring)]]}
        }
      end)

    conn
    |> put_resp_content_type("application/geo+json")
    # Private, because these are one user's rows.
    |> put_resp_header("cache-control", cache)
    # And `vary`, because `private` only shuts out shared caches, not the
    # browser's own: without it the next person to sign in on this machine is
    # served the previous one's geometry from disk, with no request made.
    |> put_resp_header("vary", "cookie")
    |> send_resp(200, Jason.encode!(%{"type" => "FeatureCollection", "features" => features}))
  end
end
