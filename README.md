<div align="center">

  <h1>OpenLayers MCP</h1>

  <p><strong>AI-Powered Map Control via Model Context Protocol for OpenLayers</strong></p>

  <p>Connect any MCP-compatible AI agent to <a href="https://openlayers.org/">OpenLayers</a> — view, layers, features, styles, drawing, all through natural language.</p>

  <p>
    <a href="https://www.npmjs.com/package/openlayers-mcp-runtime"><img src="https://img.shields.io/npm/v/openlayers-mcp-runtime.svg" alt="npm version"></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT"></a>
    <a href="https://github.com/gaopengbin/openlayers-mcp"><img src="https://img.shields.io/github/stars/gaopengbin/openlayers-mcp?style=flat" alt="GitHub stars"></a>
  </p>

  <p>
    <a href="README.zh-CN.md">中文文档</a>
  </p>
</div>

---

## Architecture

```
+----------------+   stdio    +--------------------+  WebSocket  +--------------------+
|   AI Agent     | <--------> |  openlayers-mcp-   | <---------> |  openlayers-mcp-   |
|   (Claude,     |    MCP     |  runtime           |   JSON-RPC  |  bridge            |
|    Cursor...)  |            |  (Node.js)         |    2.0      |  (Browser)         |
+----------------+            +--------------------+             +--------------------+
                                                                         |
                                                                  +------v------+
                                                                  |  OpenLayers |
                                                                  |  Map        |
                                                                  +-------------+
```

## Packages

| Package | Description |
|---------|-------------|
| [openlayers-mcp-runtime](packages/openlayers-mcp-runtime/) | MCP Server (stdio) — 30+ tools across 7 toolsets, WebSocket bridge to browser |
| [openlayers-mcp-bridge](packages/openlayers-mcp-bridge/) | Browser SDK — receives commands via WebSocket and controls OpenLayers map |

## Quick Start

### 1. Install & Build

```bash
git clone https://github.com/gaopengbin/openlayers-mcp.git
cd openlayers-mcp
npm install
npm run build
```

### 2. Start the MCP Runtime

```bash
npx openlayers-mcp-runtime
# => HTTP + WebSocket server on http://localhost:9300
# => MCP Server running (stdio), 30+ tools registered
```

### 3. Connect Browser

Open `examples/minimal/index.html` in a browser. The bridge auto-connects to `ws://localhost:9300`.

Or integrate the bridge in your own app:

```typescript
import { OpenLayersBridge } from 'openlayers-mcp-bridge'
import Map from 'ol/Map'
import View from 'ol/View'
import TileLayer from 'ol/layer/Tile'
import OSM from 'ol/source/OSM'

const map = new Map({
  target: 'map',
  layers: [new TileLayer({ source: new OSM() })],
  view: new View({ center: [0, 0], zoom: 2 })
})

const bridge = new OpenLayersBridge(map)
bridge.connect('ws://localhost:9300')
```

### 4. Connect AI Agent

Add to your MCP client config (Claude Desktop, Cursor, etc.):

```json
{
  "mcpServers": {
    "openlayers": {
      "command": "npx",
      "args": ["-y", "openlayers-mcp-runtime"]
    }
  }
}
```

Now ask your AI: *"Show a map of Paris and add a polygon around the Louvre"*

## Usage Examples

Ask your AI agent natural language questions like:

- "Fly to Tokyo at zoom level 12"
- "Add a vector layer from this GeoJSON URL"
- "Draw a polygon on the map, then export it as GeoJSON"
- "Set the layer opacity to 50%"
- "Add a marker at the Eiffel Tower with a popup label"
- "Take a screenshot of the current map view"

## 30+ Available Tools

Tools are organized into **7 toolsets**. Default mode enables 4 core toolsets. Use `list_toolsets` and `enable_toolset` to dynamically activate more.

| Toolset | Tools | Default |
|---------|-------|---------|
| **view** | `flyTo`, `setView`, `getView`, `fitExtent`, `zoomIn`, `zoomOut` | Yes |
| **layer** | `addTileLayer`, `addVectorLayer`, `removeLayer`, `listLayers`, `setLayerVisibility`, `setLayerOpacity`, `setLayerZIndex` | Yes |
| **feature** | `addFeature`, `addGeoJSON`, `removeFeature`, `updateFeature`, `listFeatures` | Yes |
| **interaction** | `screenshot`, `getFeatureAtPixel`, `getFeaturesInExtent` | Yes |
| **overlay** | `addOverlay`, `removeOverlay`, `updateOverlay`, `listOverlays` | No |
| **style** | `setFeatureStyle`, `setLayerStyle` | No |
| **draw** | `enableDraw`, `disableDraw`, `getDrawnFeatures` | No |

### Meta Tools (always available)

| Tool | Description |
|------|-------------|
| `list_toolsets` | List all available toolsets and their enabled status |
| `enable_toolset` | Enable a toolset to register its tools |

## Why OpenLayers?

- **Truly open source** — BSD 2-Clause, no API key required for basic usage
- **Projection support** — native EPSG:4326, EPSG:3857, and custom CRS
- **Massive ecosystem** — WMS, WMTS, WFS, GeoJSON, KML, GeoTIFF, MVT, and more
- **Mature and stable** — 15+ years of development, used by governments and enterprises worldwide

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OL_MCP_PORT` | `9300` | WebSocket server port |
| `OL_TOOLSETS` | `view,layer,feature,interaction` | Comma-separated default toolsets |

## Related Projects

- [cesium-mcp](https://github.com/gaopengbin/cesium-mcp) — AI control for CesiumJS 3D globe
- [mapbox-mcp](https://github.com/gaopengbin/mapbox-mcp) — AI control for Mapbox GL JS

## License

MIT
