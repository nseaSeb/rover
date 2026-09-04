# Vector basemaps alongside raster

## Context

Rover renders basemaps through OpenLayers as raster `XYZ` tile layers. Carto,
one of the two providers Rover ships presets for, is retiring its raster (PNG)
basemap endpoints in favor of vector tiles (MapLibre-style GL JSON served as
MVT). Carto's own guidance (https://docs.carto.com/faqs/carto-basemaps) is
unambiguous: vector is sharper at any zoom and pixel density, kept on a
fresher data cadence (raster data updates may stop entirely), restyleable at
runtime, and cheaper to serve. Raster is not disappearing on any fixed date,
but it is the deprecated path, and current Rover users already carry a Carto
API key (added for the raster watermark requirement) that vector tiles will
also need.

Rover should offer both, so:

- Existing raster presets (`:carto_light`, `:carto_dark`, `:carto_voyager`,
  and the non-Carto presets) keep working exactly as they do today. No
  breaking change.
- New vector presets exist alongside them, so a caller migrates by changing
  one atom.
- A generic vector escape hatch exists, mirroring the existing `{:xyz, url}`
  raster hatch, for any MapLibre-compatible style beyond Carto's own.

Runtime restyling (recoloring, toggling label layers) is explicitly out of
scope. This change lands vector *rendering* at parity with what raster offers
today; mutating a live style is a separate capability for a later change once
the base vector layer exists to mutate.

## Decisions

1. **New preset atoms, not a breaking rename.** `:carto_light_vector`,
   `:carto_dark_vector`, `:carto_voyager_vector` are added. The existing
   `:carto_light`, `:carto_dark`, `:carto_voyager` keep their current raster
   behavior. Anyone who wants vector opts in by changing the atom they pass
   to `tiles=`.
2. **Render vector tiles with `ol-mapbox-style`.** Rover already renders
   through OpenLayers; `ol-mapbox-style` converts a MapLibre/Mapbox
   `style.json` into native OL vector tile layers, so markers, shapes, and
   the heatmap layer — which all sit in the same OL map — need no changes.
   Embedding a second full map library (MapLibre GL JS) underneath OL, or
   hand-writing an OL style against the OpenMapTiles schema, were both
   rejected: more moving parts / two render loops in the first case, and
   Rover taking on cartographic-styling maintenance it does not need in the
   second.
3. **Both a Carto-specific and a generic vector hatch.** Named presets cover
   Carto out of the box, matching the existing preset list. A `{:vector,
   style_url}` / `{:vector, style_url, opts}` hatch, symmetric with `{:xyz,
   url}`, covers MapTiler, Mapbox, or self-hosted styles without Rover
   needing a named preset for every provider.
4. **Restyling is future work.** Not designed or built here.

## Elixir API (`Rover.Tiles`)

### New presets

```elixir
@presets %{
  # ...unchanged raster presets...
  carto_light_vector: %{
    style_url: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
    attributions: @carto_attribution
  },
  carto_dark_vector: %{
    style_url: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
    attributions: @carto_attribution
  },
  carto_voyager_vector: %{
    style_url: "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json",
    attributions: @carto_attribution
  }
}
```

Vector presets carry no `max_zoom` ceiling in the same sense raster presets
do — there is no pixelation cutoff to respect, because vector tiles render
crisply past their source data's native zoom via overzooming. `resolve!/1`
gives vector entries a generous `max_zoom` (documented, not magic) so
`fitMaxZoom/2` and the view's zoom ceiling do not clamp a vector map the way
they correctly clamp a raster one.

### Tagged resolution shape

`resolve!/1` currently returns an untagged map (`%{url:, attributions:,
max_zoom:}`) for every non-`:none` input. It now returns a `:type`-tagged map
so the JS runtime knows which OL layer construction path to take:

```elixir
# raster (existing presets, {:xyz, ...}) — unchanged fields, new :type key
%{type: :raster, url: "...", attributions: "...", max_zoom: 19}

# vector (new presets, {:vector, ...})
%{type: :vector, style_url: "...", attributions: "...", max_zoom: 24}
```

This is an internal shape change to the map Rover hands to the JS hook, not a
change to the public preset-atom contract. Existing callers who only ever
pass preset atoms or `{:xyz, ...}` see no difference in behavior.

### Generic vector hatch

```elixir
def resolve!({:vector, style_url}), do: resolve!({:vector, style_url, []})

def resolve!({:vector, style_url, opts}) when is_binary(style_url) and is_list(opts) do
  %{
    type: :vector,
    style_url: style_url,
    attributions: Keyword.get(opts, :attributions),
    max_zoom: Keyword.get(opts, :max_zoom, 24)
  }
end
```

```elixir
<.map id="m" tiles={{:vector, "https://api.maptiler.com/maps/streets/style.json?key=YOUR_KEY"}} ... />
```

### Carto API keys extend to vector presets

`@carto_presets` grows to include the three vector atoms, so
`carto_api_key` config and the per-call `key:` opt apply uniformly. Key
injection targets whichever URL field is present — `apply_key/2` needs to
branch on `Map.has_key?(tiles, :style_url)` vs `:url` rather than assuming
`:url` unconditionally.

### Type spec and docs

`@type preset` grows the three new atoms. The moduledoc's "Carto is also
retiring these raster tile endpoints..." paragraph is rewritten: it currently
says Rover stays raster-only until it grows a vector layer. That sentence
becomes the changelog entry for this work — replaced with usage guidance for
the new vector presets and a pointer at when to still reach for raster
(existing production configs that have not migrated yet).

## JS runtime (`assets/js/rover_map.js`)

### New dependency

`ol-mapbox-style` added to `assets/package.json` devDependencies (it is a
build-time bundled dependency, same as `ol` itself — Rover ships a built
bundle, not a live npm dependency for consumers).

### Swappable basemap slot

Today `this.tileLayer` is constructed once in the constructor as a fixed
`ol/layer/Tile` and reused for the map's lifetime; `applyTiles()` only ever
calls `setSource()`/`setVisible()` on it. That assumption breaks once the
basemap can be a raster `TileLayer` *or* a vector `ol/layer/Group` (the shape
`ol-mapbox-style`'s `apply()` populates) — the two are different OL layer
classes, not just different sources on the same layer.

`applyTiles()` becomes responsible for constructing whichever layer type the
resolved config calls for and swapping it into slot 0 of the map's layer
array, replacing whatever was there before:

```javascript
applyTiles(tiles) {
  const next = buildBasemapLayer(tiles) // TileLayer, LayerGroup, or null
  const layers = this.map.getLayers()
  layers.removeAt(0)
  layers.insertAt(0, next ?? EMPTY_LAYER)
  this.basemapLayer = next
}
```

(Exact shape — sentinel empty layer vs. tracking "no basemap" separately —
is an implementation detail for the plan, not fixed here.)

- **Raster path** (`type: "raster"`): unchanged — build the `XYZ` source with
  `resolveRetina()`, exactly as today.
- **Vector path** (`type: "vector"`): create an `ol/layer/Group`, call
  `apply(group, tiles.style_url)` (the officially recommended
  `ol-mapbox-style` pattern for embedding a style into an existing map's
  layer stack, as opposed to `apply(map, ...)`, which manages the map's
  entire layer list itself and would fight Rover's marker/shape/heatmap
  layers). `apply()` resolves asynchronously; the group is inserted
  immediately and populates once the style, sprite, and first tiles load —
  matching how a raster `XYZ` layer already renders progressively as tiles
  arrive.
- **Attribution stays Rover's, not the style's.** After `apply()` resolves,
  Rover sets `tiles.attributions` on the resulting vector source(s)
  explicitly, rather than trusting whatever attribution Carto's `style.json`
  happens to declare — same licence-compliance posture as the raster path,
  where Rover already owns the attribution string end to end.
- `resolveRetina()` and the `{r}` placeholder handling apply to the raster
  path only; vector tiles are DPR-aware natively and need no `@2x` request.

### Config diffing

`changed(previous.tiles, next.tiles)` (JSON-string comparison) still gates
whether `applyTiles()` runs on an update — the tagged shape doesn't change
that comparison's correctness, since `:type` is part of the compared map.

## Testing

- **Elixir** (`test/rover/tiles_test.exs` and moduledoc doctests): new
  presets resolve to `type: :vector` maps with the right `style_url` and
  `max_zoom`; the `{:vector, ...}` hatch resolves like `{:xyz, ...}` does
  today; `carto_api_key` / per-call `key:` inject into `style_url` for the
  three new presets exactly as they do into `url` for the existing three.
- **JS unit** (`assets/test/`): config-normalization and layer-type-selection
  logic that doesn't need a browser or network — i.e., "given a `type:
  vector` config, what would `applyTiles` build" at the level that's testable
  without OL's canvas.
- **Browser** (`mix assets.test.browser`, Playwright): the dev playground
  loads a vector preset and the test asserts the canvas actually paints
  something — this is the one place a real style fetch + vector tile render
  can be verified end to end, matching how canvas-level behavior is already
  covered there and nowhere else.

## Docs

- `Rover.Tiles` moduledoc: new preset examples, updated Carto section.
- `README.md` Basemaps section: list the three new presets, add a short
  raster-vs-vector note pointing at Carto's FAQ, keep the API-key
  instructions but note they now cover six presets instead of three.
- `CHANGELOG.md`: new entry for the vector presets and the `{:vector, ...}`
  hatch.
- `dev/demo_live.ex`: the existing basemap-cycling control gets at least one
  vector preset added to its rotation, so the path is exercised interactively
  during `mix dev`, not only in automated tests.

## Out of scope

- Runtime style mutation (an API for recoloring, toggling label layers, or
  otherwise changing a live vector style).
- Named presets for non-Carto vector providers (Mapbox, MapTiler) — covered
  only by the generic `{:vector, url}` hatch.
- Retiring, renaming, or deprecating the raster presets.
