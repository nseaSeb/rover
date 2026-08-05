defmodule RoverDev.Layouts do
  @moduledoc false
  use Phoenix.Component

  def root(assigns) do
    ~H"""
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="csrf-token" content={Phoenix.Controller.get_csrf_token()} />
        <%!-- Stops the browser asking for /favicon.ico, which the playground does not serve. --%>
        <link rel="icon" href="data:," />
        <title>Rover — playground</title>
        <link phx-track-static rel="stylesheet" href="/assets/app.css" />
        <script defer phx-track-static type="module" src="/assets/app.js">
        </script>
      </head>
      <body>
        <main>
          {@inner_content}
        </main>
      </body>
    </html>
    """
  end
end
