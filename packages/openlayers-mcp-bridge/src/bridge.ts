import Map from 'ol/Map'
import View from 'ol/View'
import { fromLonLat, toLonLat, transformExtent } from 'ol/proj'
import TileLayer from 'ol/layer/Tile'
import VectorLayer from 'ol/layer/Vector'
import VectorSource from 'ol/source/Vector'
import OSM from 'ol/source/OSM'
import XYZ from 'ol/source/XYZ'
import GeoJSON from 'ol/format/GeoJSON'
import Feature from 'ol/Feature'
import Point from 'ol/geom/Point'
import LineString from 'ol/geom/LineString'
import Polygon from 'ol/geom/Polygon'
import Circle from 'ol/geom/Circle'
import Overlay from 'ol/Overlay'
import { Style, Fill, Stroke, Circle as CircleStyle, Icon, Text } from 'ol/style'
import { Draw } from 'ol/interaction'
import type {
  BridgeCommand,
  BridgeResult,
  FlyToParams,
  SetViewParams,
  ViewState,
  FitExtentParams,
  AddTileLayerParams,
  AddVectorLayerParams,
  LayerInfo,
  AddFeatureParams,
  AddGeoJSONParams,
  UpdateFeatureParams,
  RemoveFeatureParams,
  FeatureStyleParams,
  AddOverlayParams,
  UpdateOverlayParams,
  ScreenshotResult,
  GetFeatureAtPixelParams,
  EnableDrawParams,
} from './types'

let _idCounter = 0
function genId(prefix = 'ol'): string {
  return `${prefix}_${++_idCounter}_${Date.now().toString(36)}`
}

/**
 * OpenLayersBridge -- AI Agent 操控 OpenLayers 的统一执行层
 *
 * 所有 OpenLayers 操作通过此类暴露，支持两种调用方式：
 * 1. 类型安全的方法调用：bridge.flyTo({...})
 * 2. 命令分发（兼容 MCP）：bridge.execute({ action: 'flyTo', params: {...} })
 */
export class OpenLayersBridge {
  private _map: Map
  private _ws: WebSocket | null = null
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private _drawInteraction: Draw | null = null
  private _drawLayer: VectorLayer<VectorSource> | null = null

  constructor(map: Map) {
    this._map = map
  }

  get map(): Map { return this._map }

  // ==================== WebSocket ====================

  connect(url = 'ws://localhost:9300'): void {
    if (this._ws?.readyState === WebSocket.OPEN) return
    const ws = new WebSocket(url)
    this._ws = ws

    ws.onopen = () => {
      console.log('[OpenLayersBridge] Connected to', url)
      if (this._reconnectTimer) {
        clearTimeout(this._reconnectTimer)
        this._reconnectTimer = null
      }
    }

    ws.onmessage = async (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as { jsonrpc: string; id?: string; method?: string; params?: Record<string, unknown> }
        if (msg.method) {
          const result = await this.execute({ action: msg.method, params: msg.params ?? {} })
          if (msg.id) {
            ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }))
          }
        }
      } catch (err) {
        console.error('[OpenLayersBridge] message error:', err)
      }
    }

    ws.onclose = () => {
      console.log('[OpenLayersBridge] Disconnected, retry in 3s...')
      this._reconnectTimer = setTimeout(() => this.connect(url), 3000)
    }

    ws.onerror = (err) => {
      console.error('[OpenLayersBridge] WS error:', err)
      ws.close()
    }
  }

  disconnect(): void {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer)
      this._reconnectTimer = null
    }
    this._ws?.close()
    this._ws = null
  }

  // ==================== Command Dispatch ====================

  async execute(cmd: BridgeCommand): Promise<BridgeResult> {
    try {
      const data = await this._dispatch(cmd.action, cmd.params)
      return { success: true, data }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  }

  private async _dispatch(action: string, params: Record<string, unknown>): Promise<unknown> {
    switch (action) {
      // View
      case 'flyTo': return this.flyTo(params as unknown as FlyToParams)
      case 'setView': return this.setView(params as unknown as SetViewParams)
      case 'getView': return this.getView()
      case 'fitExtent': return this.fitExtent(params as unknown as FitExtentParams)
      case 'zoomIn': return this.zoomIn()
      case 'zoomOut': return this.zoomOut()

      // Layer
      case 'addTileLayer': return this.addTileLayer(params as unknown as AddTileLayerParams)
      case 'addVectorLayer': return this.addVectorLayer(params as unknown as AddVectorLayerParams)
      case 'removeLayer': return this.removeLayer(params as { id: string })
      case 'listLayers': return this.listLayers()
      case 'setLayerVisibility': return this.setLayerVisibility(params as { id: string; visible: boolean })
      case 'setLayerOpacity': return this.setLayerOpacity(params as { id: string; opacity: number })
      case 'setLayerZIndex': return this.setLayerZIndex(params as { id: string; zIndex: number })

      // Feature
      case 'addFeature': return this.addFeature(params as unknown as AddFeatureParams)
      case 'addGeoJSON': return this.addGeoJSON(params as unknown as AddGeoJSONParams)
      case 'removeFeature': return this.removeFeature(params as unknown as RemoveFeatureParams)
      case 'updateFeature': return this.updateFeature(params as unknown as UpdateFeatureParams)
      case 'listFeatures': return this.listFeatures(params as { layerId?: string })

      // Overlay
      case 'addOverlay': return this.addOverlay(params as unknown as AddOverlayParams)
      case 'removeOverlay': return this.removeOverlay(params as { id: string })
      case 'updateOverlay': return this.updateOverlay(params as unknown as UpdateOverlayParams)
      case 'listOverlays': return this.listOverlays()

      // Interaction
      case 'screenshot': return this.screenshot()
      case 'getFeatureAtPixel': return this.getFeatureAtPixel(params as unknown as GetFeatureAtPixelParams)

      // Style
      case 'setFeatureStyle': return this.setFeatureStyle(params as { featureId: string; layerId?: string; style: FeatureStyleParams })
      case 'setLayerStyle': return this.setLayerStyle(params as { layerId: string; style: FeatureStyleParams })

      // Draw
      case 'enableDraw': return this.enableDraw(params as unknown as EnableDrawParams)
      case 'disableDraw': return this.disableDraw()
      case 'getDrawnFeatures': return this.getDrawnFeatures()

      default:
        throw new Error(`Unknown action: ${action}`)
    }
  }

  // ==================== View Methods ====================

  flyTo(p: FlyToParams): ViewState {
    const view = this._map.getView()
    view.animate({
      center: fromLonLat([p.longitude, p.latitude]),
      zoom: p.zoom ?? view.getZoom() ?? 10,
      duration: p.duration ?? 2000,
      rotation: p.rotation ?? 0,
    })
    return this.getView()
  }

  setView(p: SetViewParams): ViewState {
    const view = this._map.getView()
    view.setCenter(fromLonLat([p.longitude, p.latitude]))
    if (p.zoom != null) view.setZoom(p.zoom)
    if (p.rotation != null) view.setRotation(p.rotation)
    return this.getView()
  }

  getView(): ViewState {
    const view = this._map.getView()
    const center = toLonLat(view.getCenter() ?? [0, 0])
    const extent = view.calculateExtent(this._map.getSize())
    const lonLatExtent = transformExtent(extent, view.getProjection(), 'EPSG:4326')
    return {
      center: [center[0], center[1]] as [number, number],
      zoom: view.getZoom() ?? 0,
      rotation: view.getRotation(),
      extent: lonLatExtent as [number, number, number, number],
    }
  }

  fitExtent(p: FitExtentParams): ViewState {
    const extent = transformExtent([p.west, p.south, p.east, p.north], 'EPSG:4326', this._map.getView().getProjection())
    this._map.getView().fit(extent, {
      duration: p.duration ?? 1000,
      maxZoom: p.maxZoom,
    })
    return this.getView()
  }

  zoomIn(): ViewState {
    const view = this._map.getView()
    view.animate({ zoom: (view.getZoom() ?? 2) + 1, duration: 300 })
    return this.getView()
  }

  zoomOut(): ViewState {
    const view = this._map.getView()
    view.animate({ zoom: (view.getZoom() ?? 2) - 1, duration: 300 })
    return this.getView()
  }

  // ==================== Layer Methods ====================

  private _findLayer(id: string) {
    return this._map.getLayers().getArray().find(l => l.get('id') === id)
  }

  addTileLayer(p: AddTileLayerParams): { layerId: string } {
    const id = p.id ?? genId('tile')
    let source
    switch (p.type) {
      case 'osm': source = new OSM(); break
      case 'xyz': source = new XYZ({ url: p.url }); break
      default: source = new OSM(); break
    }
    const layer = new TileLayer({
      source,
      visible: p.visible ?? true,
      opacity: p.opacity ?? 1,
    })
    layer.set('id', id)
    layer.set('name', p.name ?? id)
    this._map.addLayer(layer)
    return { layerId: id }
  }

  addVectorLayer(p: AddVectorLayerParams): { layerId: string } {
    const id = p.id ?? genId('vec')
    const source = new VectorSource()
    if (p.data) {
      const features = new GeoJSON().readFeatures(p.data, {
        featureProjection: this._map.getView().getProjection(),
      })
      source.addFeatures(features)
    }
    const layer = new VectorLayer({
      source,
      style: p.style ? this._buildStyle(p.style) : undefined,
    })
    layer.set('id', id)
    layer.set('name', p.name ?? id)
    this._map.addLayer(layer)
    return { layerId: id }
  }

  removeLayer(p: { id: string }): boolean {
    const layer = this._findLayer(p.id)
    if (!layer) return false
    this._map.removeLayer(layer)
    return true
  }

  listLayers(): LayerInfo[] {
    return this._map.getLayers().getArray().map((l, i) => ({
      id: l.get('id') ?? `layer_${i}`,
      name: l.get('name') ?? '',
      type: l instanceof VectorLayer ? 'vector' : l instanceof TileLayer ? 'tile' : 'unknown',
      visible: l.getVisible(),
      opacity: l.getOpacity(),
      zIndex: l.getZIndex() ?? i,
    }))
  }

  setLayerVisibility(p: { id: string; visible: boolean }): boolean {
    const layer = this._findLayer(p.id)
    if (!layer) return false
    layer.setVisible(p.visible)
    return true
  }

  setLayerOpacity(p: { id: string; opacity: number }): boolean {
    const layer = this._findLayer(p.id)
    if (!layer) return false
    layer.setOpacity(p.opacity)
    return true
  }

  setLayerZIndex(p: { id: string; zIndex: number }): boolean {
    const layer = this._findLayer(p.id)
    if (!layer) return false
    layer.setZIndex(p.zIndex)
    return true
  }

  // ==================== Feature Methods ====================

  private _getOrCreateDefaultVectorLayer(): VectorLayer<VectorSource> {
    let defaultLayer = this._findLayer('__default_features__') as VectorLayer<VectorSource> | undefined
    if (!defaultLayer) {
      const source = new VectorSource()
      defaultLayer = new VectorLayer({ source })
      defaultLayer.set('id', '__default_features__')
      defaultLayer.set('name', 'Features')
      this._map.addLayer(defaultLayer)
    }
    return defaultLayer
  }

  private _getVectorLayer(layerId?: string): VectorLayer<VectorSource> {
    if (layerId) {
      const layer = this._findLayer(layerId)
      if (layer && layer instanceof VectorLayer) return layer as VectorLayer<VectorSource>
      throw new Error(`Vector layer not found: ${layerId}`)
    }
    return this._getOrCreateDefaultVectorLayer()
  }

  addFeature(p: AddFeatureParams): { featureId: string } {
    const id = p.id ?? genId('feat')
    let geom
    switch (p.type) {
      case 'Point':
        geom = new Point(fromLonLat(p.coordinates as [number, number]))
        break
      case 'LineString':
        geom = new LineString((p.coordinates as number[][]).map(c => fromLonLat(c as [number, number])))
        break
      case 'Polygon':
        geom = new Polygon((p.coordinates as number[][][]).map(ring => ring.map(c => fromLonLat(c as [number, number]))))
        break
      case 'Circle':
        geom = new Circle(fromLonLat(p.coordinates as [number, number]), p.radius ?? 1000)
        break
      default:
        throw new Error(`Unsupported geometry type: ${p.type}`)
    }
    const feature = new Feature({ geometry: geom, ...p.properties })
    feature.setId(id)
    if (p.style) feature.setStyle(this._buildStyle(p.style))
    const layer = this._getVectorLayer(p.layerId)
    layer.getSource()!.addFeature(feature)
    return { featureId: id }
  }

  addGeoJSON(p: AddGeoJSONParams): { layerId: string; featureCount: number } {
    const layer = this._getVectorLayer(p.layerId)
    const format = new GeoJSON()
    let features: Feature[] = []
    if (p.data) {
      features = format.readFeatures(p.data, { featureProjection: this._map.getView().getProjection() })
    }
    if (p.style) {
      const style = this._buildStyle(p.style)
      features.forEach(f => f.setStyle(style))
    }
    layer.getSource()!.addFeatures(features)
    return { layerId: layer.get('id'), featureCount: features.length }
  }

  removeFeature(p: RemoveFeatureParams): boolean {
    const layer = this._getVectorLayer(p.layerId)
    const source = layer.getSource()!
    const feature = source.getFeatureById(p.featureId)
    if (!feature) return false
    source.removeFeature(feature)
    return true
  }

  updateFeature(p: UpdateFeatureParams): boolean {
    const layer = this._getVectorLayer(p.layerId)
    const feature = layer.getSource()!.getFeatureById(p.featureId)
    if (!feature) return false
    if (p.properties) {
      for (const [k, v] of Object.entries(p.properties)) {
        feature.set(k, v)
      }
    }
    if (p.style) feature.setStyle(this._buildStyle(p.style))
    return true
  }

  listFeatures(p: { layerId?: string }): { id: string | number; type: string; properties: Record<string, unknown> }[] {
    const layer = this._getVectorLayer(p.layerId)
    return layer.getSource()!.getFeatures().map(f => ({
      id: f.getId() ?? '',
      type: f.getGeometry()?.getType() ?? 'unknown',
      properties: f.getProperties(),
    }))
  }

  // ==================== Overlay Methods ====================

  addOverlay(p: AddOverlayParams): { overlayId: string } {
    const id = p.id ?? genId('overlay')
    const el = document.createElement('div')
    el.innerHTML = p.html
    el.className = 'ol-mcp-overlay'
    const overlay = new Overlay({
      id,
      element: el,
      position: fromLonLat([p.longitude, p.latitude]),
      offset: p.offset,
      positioning: (p.positioning as 'bottom-center') ?? 'bottom-center',
    })
    this._map.addOverlay(overlay)
    return { overlayId: id }
  }

  removeOverlay(p: { id: string }): boolean {
    const overlay = this._map.getOverlayById(p.id)
    if (!overlay) return false
    this._map.removeOverlay(overlay)
    return true
  }

  updateOverlay(p: UpdateOverlayParams): boolean {
    const overlay = this._map.getOverlayById(p.id)
    if (!overlay) return false
    if (p.longitude != null && p.latitude != null) {
      overlay.setPosition(fromLonLat([p.longitude, p.latitude]))
    }
    if (p.html != null) {
      const el = overlay.getElement()
      if (el) el.innerHTML = p.html
    }
    return true
  }

  listOverlays(): { id: string; position: [number, number] | null }[] {
    return this._map.getOverlays().getArray().map(o => ({
      id: String(o.getId() ?? ''),
      position: o.getPosition() ? toLonLat(o.getPosition()!) as [number, number] : null,
    }))
  }

  // ==================== Interaction Methods ====================

  screenshot(): ScreenshotResult {
    const canvas = this._map.getViewport().querySelector('canvas')
    if (!canvas) throw new Error('No canvas found')
    return {
      dataUrl: canvas.toDataURL('image/png'),
      width: canvas.width,
      height: canvas.height,
    }
  }

  getFeatureAtPixel(p: GetFeatureAtPixelParams): { featureId: string | number; properties: Record<string, unknown> } | null {
    const pixel: [number, number] = [p.x, p.y]
    let result: { featureId: string | number; properties: Record<string, unknown> } | null = null
    this._map.forEachFeatureAtPixel(pixel, (feature) => {
      if (!result) {
        result = {
          featureId: (feature as Feature).getId() ?? '',
          properties: (feature as Feature).getProperties(),
        }
      }
    }, p.layerId ? { layerFilter: l => l.get('id') === p.layerId } : undefined)
    return result
  }

  // ==================== Style Methods ====================

  setFeatureStyle(p: { featureId: string; layerId?: string; style: FeatureStyleParams }): boolean {
    const layer = this._getVectorLayer(p.layerId)
    const feature = layer.getSource()!.getFeatureById(p.featureId)
    if (!feature) return false
    feature.setStyle(this._buildStyle(p.style))
    return true
  }

  setLayerStyle(p: { layerId: string; style: FeatureStyleParams }): boolean {
    const layer = this._findLayer(p.layerId)
    if (!layer || !(layer instanceof VectorLayer)) return false
    ;(layer as VectorLayer<VectorSource>).setStyle(this._buildStyle(p.style))
    return true
  }

  // ==================== Draw Methods ====================

  enableDraw(p: EnableDrawParams): boolean {
    this.disableDraw()
    if (!this._drawLayer) {
      const source = new VectorSource()
      this._drawLayer = new VectorLayer({ source })
      this._drawLayer.set('id', '__draw__')
      this._drawLayer.set('name', 'Draw')
      this._map.addLayer(this._drawLayer)
    }
    this._drawInteraction = new Draw({
      source: this._drawLayer.getSource()!,
      type: p.type,
      freehand: p.freehand ?? false,
      style: p.style ? this._buildStyle(p.style) : undefined,
    })
    this._map.addInteraction(this._drawInteraction)
    return true
  }

  disableDraw(): boolean {
    if (this._drawInteraction) {
      this._map.removeInteraction(this._drawInteraction)
      this._drawInteraction = null
    }
    return true
  }

  getDrawnFeatures(): { featureCount: number; geojson: object } {
    if (!this._drawLayer) return { featureCount: 0, geojson: { type: 'FeatureCollection', features: [] } }
    const format = new GeoJSON()
    const features = this._drawLayer.getSource()!.getFeatures()
    const geojson = JSON.parse(format.writeFeatures(features, { featureProjection: this._map.getView().getProjection() }))
    return { featureCount: features.length, geojson }
  }

  // ==================== Style Builder ====================

  private _buildStyle(p: FeatureStyleParams): Style {
    return new Style({
      fill: (p.fillColor || p.fillOpacity != null) ? new Fill({
        color: this._withAlpha(p.fillColor ?? '#3B82F6', p.fillOpacity ?? 0.4),
      }) : undefined,
      stroke: (p.strokeColor || p.strokeWidth) ? new Stroke({
        color: p.strokeColor ?? '#3B82F6',
        width: p.strokeWidth ?? 2,
        lineDash: p.strokeDash,
      }) : undefined,
      image: p.iconUrl
        ? new Icon({ src: p.iconUrl, scale: p.iconScale ?? 1 })
        : (p.pointRadius || p.pointColor) ? new CircleStyle({
          radius: p.pointRadius ?? 6,
          fill: new Fill({ color: p.pointColor ?? '#3B82F6' }),
          stroke: new Stroke({ color: '#fff', width: 2 }),
        }) : undefined,
      text: p.text ? new Text({
        text: p.text,
        font: p.textFont ?? '14px sans-serif',
        fill: new Fill({ color: p.textFillColor ?? '#333' }),
        stroke: p.textStrokeColor ? new Stroke({ color: p.textStrokeColor, width: p.textStrokeWidth ?? 3 }) : undefined,
        offsetY: p.textOffsetY ?? -20,
      }) : undefined,
    })
  }

  private _withAlpha(color: string, alpha: number): string {
    if (color.startsWith('#') && color.length === 7) {
      const a = Math.round(alpha * 255).toString(16).padStart(2, '0')
      return color + a
    }
    return color
  }
}
