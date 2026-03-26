// GeoJSON types (avoid dependency on @types/geojson)
interface GeoJSONFeature {
  type: 'Feature'
  geometry: { type: string; coordinates: unknown }
  properties?: Record<string, unknown> | null
}

interface GeoJSONFeatureCollection {
  type: 'FeatureCollection'
  features: GeoJSONFeature[]
}

// ==================== Command Types ====================

export interface BridgeCommand {
  action: string
  params: Record<string, unknown>
}

export interface BridgeResult {
  success: boolean
  data?: unknown
  error?: string
}

// ==================== View ====================

export interface FlyToParams {
  longitude: number
  latitude: number
  zoom?: number
  duration?: number
  rotation?: number
}

export interface SetViewParams {
  longitude: number
  latitude: number
  zoom?: number
  rotation?: number
}

export interface ViewState {
  center: [number, number]
  zoom: number
  rotation: number
  extent: [number, number, number, number]
}

export interface FitExtentParams {
  west: number
  south: number
  east: number
  north: number
  duration?: number
  maxZoom?: number
}

// ==================== Layer ====================

export interface AddTileLayerParams {
  id?: string
  name?: string
  type: 'osm' | 'xyz' | 'wmts' | 'wms'
  url?: string
  layers?: string
  opacity?: number
  visible?: boolean
}

export interface AddVectorLayerParams {
  id?: string
  name?: string
  data?: GeoJSONFeatureCollection | GeoJSONFeature
  url?: string
  style?: FeatureStyleParams
}

export interface LayerInfo {
  id: string
  name: string
  type: string
  visible: boolean
  opacity: number
  zIndex: number
}

// ==================== Feature ====================

export interface AddFeatureParams {
  layerId?: string
  type: 'Point' | 'LineString' | 'Polygon' | 'Circle'
  coordinates: number[] | number[][] | number[][][]
  radius?: number
  properties?: Record<string, unknown>
  style?: FeatureStyleParams
  id?: string
}

export interface AddGeoJSONParams {
  layerId?: string
  data?: GeoJSONFeatureCollection | GeoJSONFeature
  url?: string
  style?: FeatureStyleParams
  name?: string
}

export interface UpdateFeatureParams {
  featureId: string
  layerId?: string
  coordinates?: number[] | number[][] | number[][][]
  properties?: Record<string, unknown>
  style?: FeatureStyleParams
}

export interface RemoveFeatureParams {
  featureId: string
  layerId?: string
}

export interface FeatureStyleParams {
  fillColor?: string
  fillOpacity?: number
  strokeColor?: string
  strokeWidth?: number
  strokeDash?: number[]
  pointRadius?: number
  pointColor?: string
  iconUrl?: string
  iconScale?: number
  text?: string
  textFont?: string
  textFillColor?: string
  textStrokeColor?: string
  textStrokeWidth?: number
  textOffsetY?: number
}

// ==================== Overlay ====================

export interface AddOverlayParams {
  id?: string
  longitude: number
  latitude: number
  html: string
  offset?: [number, number]
  positioning?: string
}

export interface UpdateOverlayParams {
  id: string
  longitude?: number
  latitude?: number
  html?: string
}

// ==================== Interaction ====================

export interface ScreenshotResult {
  dataUrl: string
  width: number
  height: number
}

export interface GetFeatureAtPixelParams {
  x: number
  y: number
  layerId?: string
}

export interface GetFeaturesInExtentParams {
  west: number
  south: number
  east: number
  north: number
  layerId?: string
}

// ==================== Draw ====================

export interface EnableDrawParams {
  type: 'Point' | 'LineString' | 'Polygon' | 'Circle'
  freehand?: boolean
  style?: FeatureStyleParams
}
