<div align="center">

  <h1>OpenLayers MCP</h1>

  <p><strong>通过 Model Context Protocol 实现 AI 驱动的 OpenLayers 地图控制</strong></p>

  <p>将任意 MCP 兼容的 AI 代理连接到 <a href="https://openlayers.org/">OpenLayers</a> —— 视图、图层、要素、样式、绘制，全部通过自然语言完成。</p>

  <p>
    <a href="https://www.npmjs.com/package/openlayers-mcp-runtime"><img src="https://img.shields.io/npm/v/openlayers-mcp-runtime.svg" alt="npm version"></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT"></a>
    <a href="https://github.com/gaopengbin/openlayers-mcp"><img src="https://img.shields.io/github/stars/gaopengbin/openlayers-mcp?style=flat" alt="GitHub stars"></a>
  </p>

  <p>
    <a href="README.md">English</a>
  </p>
</div>

---

## 架构

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

## 组件

| 包名 | 说明 |
|------|------|
| [openlayers-mcp-runtime](packages/openlayers-mcp-runtime/) | MCP 服务端 (stdio) — 30+ 工具，7 个工具集，WebSocket 桥接浏览器 |
| [openlayers-mcp-bridge](packages/openlayers-mcp-bridge/) | 浏览器 SDK — 通过 WebSocket 接收指令并控制 OpenLayers 地图 |

## 快速开始

### 1. 安装 & 构建

```bash
git clone https://github.com/gaopengbin/openlayers-mcp.git
cd openlayers-mcp
npm install
npm run build
```

### 2. 启动 MCP Runtime

```bash
npx openlayers-mcp-runtime
# => HTTP + WebSocket 在 http://localhost:9300
# => MCP Server 运行中 (stdio), 30+ 工具已注册
```

### 3. 连接浏览器

在浏览器中打开 `examples/minimal/index.html`，Bridge 会自动连接到 `ws://localhost:9300`。

或在你的项目中集成 Bridge：

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

### 4. 连接 AI Agent

在 MCP 客户端配置中添加（Claude Desktop、Cursor 等）：

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

然后对 AI 说：*"展示巴黎的地图，在卢浮宫周围画一个多边形"*

## 使用示例

- "飞到东京，缩放级别 12"
- "从这个 GeoJSON URL 添加一个矢量图层"
- "在地图上画一个多边形，然后导出为 GeoJSON"
- "把图层透明度设为 50%"
- "在埃菲尔铁塔位置添加一个带弹窗的标记"
- "截取当前地图视图"

## 30+ 可用工具

工具按 **7 个工具集** 组织。默认启用 4 个核心工具集，使用 `list_toolsets` 和 `enable_toolset` 动态激活更多。

| 工具集 | 工具 | 默认启用 |
|--------|------|----------|
| **view** | `flyTo`, `setView`, `getView`, `fitExtent`, `zoomIn`, `zoomOut` | 是 |
| **layer** | `addTileLayer`, `addVectorLayer`, `removeLayer`, `listLayers`, `setLayerVisibility`, `setLayerOpacity`, `setLayerZIndex` | 是 |
| **feature** | `addFeature`, `addGeoJSON`, `removeFeature`, `updateFeature`, `listFeatures` | 是 |
| **interaction** | `screenshot`, `getFeatureAtPixel`, `getFeaturesInExtent` | 是 |
| **overlay** | `addOverlay`, `removeOverlay`, `updateOverlay`, `listOverlays` | 否 |
| **style** | `setFeatureStyle`, `setLayerStyle` | 否 |
| **draw** | `enableDraw`, `disableDraw`, `getDrawnFeatures` | 否 |

### Meta 工具（始终可用）

| 工具 | 说明 |
|------|------|
| `list_toolsets` | 列出所有工具集及其启用状态 |
| `enable_toolset` | 启用一个工具集以注册其工具 |

## 为什么选择 OpenLayers？

- **真正开源** — BSD 2-Clause 许可，基础功能无需 API Key
- **投影支持** — 原生 EPSG:4326、EPSG:3857 及自定义坐标系
- **丰富生态** — WMS、WMTS、WFS、GeoJSON、KML、GeoTIFF、MVT 等
- **成熟稳定** — 15+ 年开发历史，广泛应用于政府和企业

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `OL_MCP_PORT` | `9300` | WebSocket 服务端口 |
| `OL_TOOLSETS` | `view,layer,feature,interaction` | 默认启用的工具集 |

## 相关项目

- [cesium-mcp](https://github.com/gaopengbin/cesium-mcp) — AI 控制 CesiumJS 3D 地球
- [mapbox-mcp](https://github.com/gaopengbin/mapbox-mcp) — AI 控制 Mapbox GL JS

## 许可证

MIT
