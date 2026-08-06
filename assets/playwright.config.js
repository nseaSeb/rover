import { defineConfig, devices } from "@playwright/test"

// A port of its own, so a playground you left running on 4020 does not get tested
// instead of the one this suite booted. Getting that wrong once cost an hour of
// believing a fix had not worked.
const PORT = 4030

export default defineConfig({
  testDir: "./browser",
  // Everything here drives one shared server; running files in parallel would
  // have them fighting over the same map.
  workers: 1,
  fullyParallel: false,
  // A flaky guard is worse than no guard: it teaches you to ignore red.
  retries: 0,
  reporter: process.env.CI ? "list" : "line",
  timeout: 30_000,

  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    // Deterministic geometry: the specs convert coordinates to pixels through the
    // map itself, but a fixed viewport keeps failures reproducible.
    viewport: { width: 1280, height: 800 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  webServer: {
    // `mix dev` also starts the esbuild watcher, which performs an initial build,
    // so the bundle the suite exercises is always the current source.
    command: "mix dev",
    cwd: "..",
    env: { PORT: String(PORT) },
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
})
