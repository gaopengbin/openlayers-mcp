/**
 * openlayers-mcp-runtime — MCP Server for OpenLayers
 *
 * 架构：
 *   AI Agent <-> MCP Server (stdio) <-> WebSocket <-> Browser (openlayers-mcp-bridge)
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { WebSocketServer, WebSocket, type RawData } from 'ws'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'

// ==================== WebSocket Bridge ====================

const WS_PORT = parseInt(process.env.OL_MCP_PORT ?? '9300')

const browserClients = new Map<string, WebSocket>()
const pendingRequests = new Map<string, {
  resolve: (result: unknown) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}>()

let requestIdCounter = 0
const DEFAULT_SESSION_ID = process.env.DEFAULT_SESSION_ID ?? 'default'

function getDefaultBrowser(): WebSocket | null {
  if (browserClients.size === 0) return null
  const preferred = browserClients.get(DEFAULT_SESSION_ID)
  if (preferred && preferred.readyState === WebSocket.OPEN) return preferred
  return browserClients.values().next().value ?? null
}

function sendToBrowser(action: string, params: Record<string, unknown>, timeoutMs = 30000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const ws = getDefaultBrowser()
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      reject(new Error('No browser connected. Open your OpenLayers app with the bridge loaded.'))
      return
    }
    const reqId = `req_${++requestIdCounter}`
    const timer = setTimeout(() => {
      pendingRequests.delete(reqId)
      reject(new Error(`Browser response timeout (${timeoutMs}ms)`))
    }, timeoutMs)
    pendingRequests.set(reqId, { resolve, reject, timer })
    ws.send(JSON.stringify({ jsonrpc: '2.0', id: reqId, method: action, params }))
  })
}

// ==================== HTTP + WebSocket Server ====================

const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ status: 'ok', clients: browserClients.size }))
    return
  }

  if (req.method === 'POST' && req.url === '/api/command') {
    let body = ''
    req.on('data', (chunk: Buffer) => { body += chunk.toString() })
    req.on('end', async () => {
      try {
        const { action, params } = JSON.parse(body)
        const result = await sendToBrowser(action, params ?? {})
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, result }))
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: (err as Error).message }))
      }
    })
    return
  }

  res.writeHead(404)
  res.end('Not found')
})

const wss = new WebSocketServer({ server: httpServer })

wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`)
  const sessionId = url.searchParams.get('sessionId') ?? DEFAULT_SESSION_ID
  browserClients.set(sessionId, ws)
  process.stderr.write(`[openlayers-mcp] Browser connected (session: ${sessionId})\n`)

  ws.on('message', (raw: RawData) => {
    try {
      const msg = JSON.parse(raw.toString()) as { id?: string; result?: unknown; error?: { message: string } }
      if (msg.id && pendingRequests.has(msg.id)) {
        const pending = pendingRequests.get(msg.id)!
        pendingRequests.delete(msg.id)
        clearTimeout(pending.timer)
        if (msg.error) {
          pending.reject(new Error(msg.error.message))
        } else {
          pending.resolve(msg.result)
        }
      }
    } catch { /* ignore parse errors */ }
  })

  ws.on('close', () => {
    browserClients.delete(sessionId)
    process.stderr.write(`[openlayers-mcp] Browser disconnected (session: ${sessionId})\n`)
  })
})

httpServer.listen(WS_PORT, () => {
  process.stderr.write(`[openlayers-mcp] HTTP + WebSocket server on http://localhost:${WS_PORT}\n`)
})

// ==================== MCP Server ====================

const server = new McpServer({
  name: 'openlayers-mcp',
  version: '0.1.0',
}, {
  capabilities: { tools: {} },
})

// ==================== Toolsets ====================

const TOOLSETS: Record<string, string[]> = {
  view: ['flyTo', 'setView', 'getView', 'fitExtent', 'zoomIn', 'zoomOut'],
  layer: ['addTileLayer', 'addVectorLayer', 'removeLayer', 'listLayers', 'setLayerVisibility', 'setLayerOpacity', 'setLayerZIndex'],
  feature: ['addFeature', 'addGeoJSON', 'removeFeature', 'updateFeature', 'listFeatures'],
  interaction: ['screenshot', 'getFeatureAtPixel'],
  overlay: ['addOverlay', 'removeOverlay', 'updateOverlay', 'listOverlays'],
  style: ['setFeatureStyle', 'setLayerStyle'],
  draw: ['enableDraw', 'disableDraw', 'getDrawnFeatures'],
}

const TOOLSET_DESCRIPTIONS: Record<string, string> = {
  view: 'Camera/view controls (flyTo, setView, getView, fitExtent, zoom)',
  layer: 'Layer management (tile layers, vector layers, visibility, opacity)',
  feature: 'Feature CRUD (add/remove/update points, lines, polygons, GeoJSON)',
  interaction: 'User interaction (screenshot, feature picking)',
  overlay: 'HTML overlay management (popups, labels)',
  style: 'Style management (feature and layer styling)',
  draw: 'Drawing tools (enable interactive drawing on map)',
}

const DEFAULT_TOOLSETS = ['view', 'layer', 'feature', 'interaction']

const _tsEnv = process.env.OL_TOOLSETS?.trim()
const _allMode = _tsEnv === 'all'
const _enabledSets = new Set<string>(
  _allMode ? Object.keys(TOOLSETS)
    : _tsEnv ? _tsEnv.split(',').map(s => s.trim()).filter(s => s in TOOLSETS)
    : DEFAULT_TOOLSETS,
)

const _enabledTools = new Set<string>()
for (const setName of _enabledSets) {
  for (const tool of TOOLSETS[setName]!) _enabledTools.add(tool)
}

const _toolDefs = new Map<string, unknown[]>()

const _registerTool = ((...args: unknown[]) => {
  const name = args[0] as string
  _toolDefs.set(name, args)
  if (_enabledTools.has(name)) {
    ;(server.tool as Function).apply(server, args)
  }
}) as typeof server.tool

function _enableToolset(setName: string): string[] {
  const tools = TOOLSETS[setName]
  if (!tools) return []
  const added: string[] = []
  for (const toolName of tools) {
    if (!_enabledTools.has(toolName)) {
      _enabledTools.add(toolName)
      const def = _toolDefs.get(toolName)
      if (def) {
        ;(server.tool as Function).apply(server, def)
        added.push(toolName)
      }
    }
  }
  _enabledSets.add(setName)
  return added
}

// ==================== Meta Tools ====================

server.tool(
  'list_toolsets',
  'List all available toolsets and their status',
  {},
  async () => {
    const list = Object.entries(TOOLSETS).map(([name, tools]) => ({
      name,
      description: TOOLSET_DESCRIPTIONS[name] ?? '',
      enabled: _enabledSets.has(name),
      toolCount: tools.length,
      tools,
    }))
    return { content: [{ type: 'text' as const, text: JSON.stringify(list, null, 2) }] }
  },
)

server.tool(
  'enable_toolset',
  'Enable a toolset to register its tools',
  { name: z.string().describe('Toolset name') },
  async ({ name }) => {
    if (!(name in TOOLSETS)) {
      return { content: [{ type: 'text' as const, text: `Unknown toolset: ${name}. Available: ${Object.keys(TOOLSETS).join(', ')}` }] }
    }
    if (_enabledSets.has(name)) {
      return { content: [{ type: 'text' as const, text: `Toolset "${name}" is already enabled.` }] }
    }
    const added = _enableToolset(name)
    return { content: [{ type: 'text' as const, text: `Enabled toolset "${name}". Registered ${added.length} tools: ${added.join(', ')}` }] }
  },
)

// ==================== View Tools ====================

_registerTool(
  'flyTo',
  'Fly to a location with animation',
  {
    longitude: z.number().describe('Longitude (-180 to 180)'),
    latitude: z.number().describe('Latitude (-90 to 90)'),
    zoom: z.number().optional().describe('Zoom level'),
    duration: z.number().optional().describe('Animation duration (ms), default 2000'),
  },
  async (params: Record<string, unknown>) => {
    const result = await sendToBrowser('flyTo', params)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
  },
)

_registerTool(
  'setView',
  'Set view instantly (no animation)',
  {
    longitude: z.number().describe('Longitude'),
    latitude: z.number().describe('Latitude'),
    zoom: z.number().optional().describe('Zoom level'),
    rotation: z.number().optional().describe('Rotation (radians)'),
  },
  async (params: Record<string, unknown>) => {
    const result = await sendToBrowser('setView', params)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
  },
)

_registerTool(
  'getView',
  'Get current view state (center, zoom, rotation, extent)',
  {},
  async () => {
    const result = await sendToBrowser('getView', {})
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
  },
)

_registerTool(
  'fitExtent',
  'Fit view to geographic extent',
  {
    west: z.number().describe('West longitude'),
    south: z.number().describe('South latitude'),
    east: z.number().describe('East longitude'),
    north: z.number().describe('North latitude'),
    duration: z.number().optional().describe('Animation duration (ms)'),
    maxZoom: z.number().optional().describe('Maximum zoom level'),
  },
  async (params: Record<string, unknown>) => {
    const result = await sendToBrowser('fitExtent', params)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
  },
)

_registerTool(
  'zoomIn',
  'Zoom in one level',
  {},
  async () => {
    const result = await sendToBrowser('zoomIn', {})
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
  },
)

_registerTool(
  'zoomOut',
  'Zoom out one level',
  {},
  async () => {
    const result = await sendToBrowser('zoomOut', {})
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
  },
)

// ==================== Layer Tools ====================

_registerTool(
  'addTileLayer',
  'Add a tile layer (OSM, XYZ, WMS, WMTS)',
  {
    type: z.enum(['osm', 'xyz', 'wms', 'wmts']).describe('Tile source type'),
    url: z.string().optional().describe('Tile URL template (required for xyz/wms/wmts)'),
    layers: z.string().optional().describe('WMS layer name'),
    name: z.string().optional().describe('Display name'),
    id: z.string().optional().describe('Layer ID'),
    opacity: z.number().optional().describe('Opacity (0-1)'),
    visible: z.boolean().optional().describe('Initially visible'),
  },
  async (params: Record<string, unknown>) => {
    const result = await sendToBrowser('addTileLayer', params)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
  },
)

_registerTool(
  'addVectorLayer',
  'Add a vector layer with optional GeoJSON data',
  {
    name: z.string().optional().describe('Display name'),
    id: z.string().optional().describe('Layer ID'),
    data: z.any().optional().describe('GeoJSON FeatureCollection or Feature'),
  },
  async (params: Record<string, unknown>) => {
    const result = await sendToBrowser('addVectorLayer', params)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
  },
)

_registerTool(
  'removeLayer',
  'Remove a layer by ID',
  { id: z.string().describe('Layer ID') },
  async (params: Record<string, unknown>) => {
    const result = await sendToBrowser('removeLayer', params)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
  },
)

_registerTool(
  'listLayers',
  'List all layers with their properties',
  {},
  async () => {
    const result = await sendToBrowser('listLayers', {})
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
  },
)

_registerTool(
  'setLayerVisibility',
  'Show or hide a layer',
  {
    id: z.string().describe('Layer ID'),
    visible: z.boolean().describe('Visible'),
  },
  async (params: Record<string, unknown>) => {
    const result = await sendToBrowser('setLayerVisibility', params)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
  },
)

_registerTool(
  'setLayerOpacity',
  'Set layer opacity',
  {
    id: z.string().describe('Layer ID'),
    opacity: z.number().describe('Opacity (0-1)'),
  },
  async (params: Record<string, unknown>) => {
    const result = await sendToBrowser('setLayerOpacity', params)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
  },
)

_registerTool(
  'setLayerZIndex',
  'Set layer z-index (stacking order)',
  {
    id: z.string().describe('Layer ID'),
    zIndex: z.number().describe('Z-index value'),
  },
  async (params: Record<string, unknown>) => {
    const result = await sendToBrowser('setLayerZIndex', params)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
  },
)

// ==================== Feature Tools ====================

_registerTool(
  'addFeature',
  'Add a geometric feature (point, line, polygon, circle) to the map',
  {
    type: z.enum(['Point', 'LineString', 'Polygon', 'Circle']).describe('Geometry type'),
    coordinates: z.any().describe('Coordinates: [lon,lat] for Point, [[lon,lat],...] for LineString, [[[lon,lat],...]] for Polygon'),
    radius: z.number().optional().describe('Radius in meters (for Circle type)'),
    id: z.string().optional().describe('Feature ID'),
    layerId: z.string().optional().describe('Target vector layer ID'),
    properties: z.record(z.any()).optional().describe('Feature properties'),
    style: z.object({
      fillColor: z.string().optional(),
      strokeColor: z.string().optional(),
      strokeWidth: z.number().optional(),
      pointRadius: z.number().optional(),
      pointColor: z.string().optional(),
      text: z.string().optional(),
    }).optional().describe('Feature style'),
  },
  async (params: Record<string, unknown>) => {
    const result = await sendToBrowser('addFeature', params)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
  },
)

_registerTool(
  'addGeoJSON',
  'Add GeoJSON data to the map',
  {
    data: z.any().describe('GeoJSON FeatureCollection or Feature'),
    layerId: z.string().optional().describe('Target vector layer ID'),
    name: z.string().optional().describe('Layer name'),
  },
  async (params: Record<string, unknown>) => {
    const result = await sendToBrowser('addGeoJSON', params)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
  },
)

_registerTool(
  'removeFeature',
  'Remove a feature by ID',
  {
    featureId: z.string().describe('Feature ID'),
    layerId: z.string().optional().describe('Layer ID containing the feature'),
  },
  async (params: Record<string, unknown>) => {
    const result = await sendToBrowser('removeFeature', params)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
  },
)

_registerTool(
  'updateFeature',
  'Update feature properties or style',
  {
    featureId: z.string().describe('Feature ID'),
    layerId: z.string().optional().describe('Layer ID'),
    properties: z.record(z.any()).optional().describe('New properties'),
    style: z.object({
      fillColor: z.string().optional(),
      strokeColor: z.string().optional(),
      strokeWidth: z.number().optional(),
    }).optional().describe('New style'),
  },
  async (params: Record<string, unknown>) => {
    const result = await sendToBrowser('updateFeature', params)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
  },
)

_registerTool(
  'listFeatures',
  'List features in a layer',
  { layerId: z.string().optional().describe('Layer ID (defaults to default feature layer)') },
  async (params: Record<string, unknown>) => {
    const result = await sendToBrowser('listFeatures', params)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
  },
)

// ==================== Interaction Tools ====================

_registerTool(
  'screenshot',
  'Capture current map view as PNG',
  {},
  async () => {
    const result = await sendToBrowser('screenshot', {})
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
  },
)

_registerTool(
  'getFeatureAtPixel',
  'Get feature information at a pixel position',
  {
    x: z.number().describe('X pixel coordinate'),
    y: z.number().describe('Y pixel coordinate'),
    layerId: z.string().optional().describe('Filter by layer ID'),
  },
  async (params: Record<string, unknown>) => {
    const result = await sendToBrowser('getFeatureAtPixel', params)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
  },
)

// ==================== Overlay Tools ====================

_registerTool(
  'addOverlay',
  'Add an HTML overlay (popup/label) at a position',
  {
    longitude: z.number().describe('Longitude'),
    latitude: z.number().describe('Latitude'),
    html: z.string().describe('HTML content'),
    id: z.string().optional().describe('Overlay ID'),
    positioning: z.string().optional().describe('Positioning (e.g. "bottom-center")'),
  },
  async (params: Record<string, unknown>) => {
    const result = await sendToBrowser('addOverlay', params)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
  },
)

_registerTool(
  'removeOverlay',
  'Remove an overlay by ID',
  { id: z.string().describe('Overlay ID') },
  async (params: Record<string, unknown>) => {
    const result = await sendToBrowser('removeOverlay', params)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
  },
)

_registerTool(
  'updateOverlay',
  'Update overlay position or content',
  {
    id: z.string().describe('Overlay ID'),
    longitude: z.number().optional().describe('New longitude'),
    latitude: z.number().optional().describe('New latitude'),
    html: z.string().optional().describe('New HTML content'),
  },
  async (params: Record<string, unknown>) => {
    const result = await sendToBrowser('updateOverlay', params)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
  },
)

_registerTool(
  'listOverlays',
  'List all overlays',
  {},
  async () => {
    const result = await sendToBrowser('listOverlays', {})
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
  },
)

// ==================== Style Tools ====================

_registerTool(
  'setFeatureStyle',
  'Set the style of a specific feature',
  {
    featureId: z.string().describe('Feature ID'),
    layerId: z.string().optional().describe('Layer ID'),
    style: z.object({
      fillColor: z.string().optional(),
      fillOpacity: z.number().optional(),
      strokeColor: z.string().optional(),
      strokeWidth: z.number().optional(),
      pointRadius: z.number().optional(),
      pointColor: z.string().optional(),
      text: z.string().optional(),
    }).describe('Style properties'),
  },
  async (params: Record<string, unknown>) => {
    const result = await sendToBrowser('setFeatureStyle', params)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
  },
)

_registerTool(
  'setLayerStyle',
  'Set the default style for all features in a vector layer',
  {
    layerId: z.string().describe('Layer ID'),
    style: z.object({
      fillColor: z.string().optional(),
      fillOpacity: z.number().optional(),
      strokeColor: z.string().optional(),
      strokeWidth: z.number().optional(),
      pointRadius: z.number().optional(),
      pointColor: z.string().optional(),
    }).describe('Style properties'),
  },
  async (params: Record<string, unknown>) => {
    const result = await sendToBrowser('setLayerStyle', params)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
  },
)

// ==================== Draw Tools ====================

_registerTool(
  'enableDraw',
  'Enable interactive drawing on the map',
  {
    type: z.enum(['Point', 'LineString', 'Polygon', 'Circle']).describe('Geometry type to draw'),
    freehand: z.boolean().optional().describe('Enable freehand drawing'),
  },
  async (params: Record<string, unknown>) => {
    const result = await sendToBrowser('enableDraw', params)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
  },
)

_registerTool(
  'disableDraw',
  'Disable drawing mode',
  {},
  async () => {
    const result = await sendToBrowser('disableDraw', {})
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
  },
)

_registerTool(
  'getDrawnFeatures',
  'Get all features drawn by the user as GeoJSON',
  {},
  async () => {
    const result = await sendToBrowser('getDrawnFeatures', {})
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
  },
)

// ==================== Start ====================

const toolCount = _enabledTools.size
process.stderr.write(`[openlayers-mcp] MCP Server starting — ${toolCount} tools registered\n`)

const transport = new StdioServerTransport()
server.connect(transport)
