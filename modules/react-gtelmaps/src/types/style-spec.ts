/*
 * GTEL Maps Style Specification types
 * Type names are aligned with mapbox and maplibre
 */
export type {
  // Layers
  ModelLayerSpecification,
  LayerSpecification,
  FillLayerSpecification,
  LineLayerSpecification,
  SymbolLayerSpecification,
  CircleLayerSpecification,
  HeatmapLayerSpecification,
  FillExtrusionLayerSpecification,
  RasterLayerSpecification,
  HillshadeLayerSpecification,
  BackgroundLayerSpecification,

  // Sources
  ModelSourceSpecification,
  SourceSpecification,
  VectorSourceSpecification,
  RasterSourceSpecification,
  RasterDEMSourceSpecification,
  GeoJSONSourceSpecification,
  VideoSourceSpecification,
  ImageSourceSpecification,
  CanvasSourceSpecification,

  // Style
  RadialGradientLayerConstructorOptions as GradientSpecification,
  CubemapLayerConstructorOptions as CubemapSpecification,
  StyleSpecificationWithMetaData,
  StyleSpecification,
  SkySpecification,
  LightSpecification,
  TerrainSpecification,
  ProjectionSpecification
} from '@gis/gtelmaps-sdk-js';
