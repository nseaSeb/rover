defmodule RoverDev.Router do
  @moduledoc false
  use Phoenix.Router

  import Phoenix.LiveView.Router

  pipeline :browser do
    plug :accepts, ["html"]
    plug :fetch_session
    plug :put_root_layout, html: {RoverDev.Layouts, :root}
    plug :protect_from_forgery
  end

  # No session, no CSRF: a read-only GET answering with geometry. The pipeline a
  # real application would use is its own — this one only has to be honest about
  # the content type.
  pipeline :geojson do
    plug :accepts, ["json"]
    # Without this `conn.params` is empty: nothing else in this pipeline fetches
    # the query string, so the controller's `rev` — and the caching decision it
    # makes — would never see one.
    plug :fetch_query_params
  end

  scope "/" do
    pipe_through :browser

    live "/", RoverDev.DemoLive, :index
  end

  scope "/api" do
    pipe_through :geojson

    get "/parcels.geojson", RoverDev.GeoJSONController, :parcels
  end
end
