import {transformToViewState, applyViewStateToTransform} from '../utils/transform';
import {normalizeStyle} from '../utils/style-utils';
import {deepEqual} from '../utils/deep-equal';

import type {
  LanguageInfo, 
  CubemapLayerConstructorOptions, 
  RadialGradientLayerConstructorOptions
} from '@gis/gtelmaps-sdk-js';
import type {TransformLike} from '../types/internal';
import type {
  ViewState,
  Point,
  PointLike,
  PaddingOptions,
  ImmutableLike,
  LngLatBoundsLike,
  MapGeoJSONFeature
} from '../types/common';
import type {
  StyleSpecification,
  SkySpecification,
  LightSpecification,
  TerrainSpecification,
  ProjectionSpecification
} from '../types/style-spec';
import type {MapInstance} from '../types/lib';
import type {
  MapCallbacks,
  ViewStateChangeEvent,
  MapEvent,
  ErrorEvent,
  MapMouseEvent
} from '../types/events';

export type GtelMapsProps = Partial<ViewState> &
  MapCallbacks & {
    // Init options
    gtelmapsApiKey?: string;

    /** Camera options used when constructing the Map instance */
    initialViewState?: Partial<ViewState> & {
      /** The initial bounds of the map. If bounds is specified, it overrides longitude, latitude and zoom options. */
      bounds?: LngLatBoundsLike;
      /** A fitBounds options object to use only when setting the bounds option. */
      fitBoundsOptions?: {
        offset?: PointLike;
        minZoom?: number;
        maxZoom?: number;
        padding?: number | PaddingOptions;
      };
    };

    /** If provided, render into an external WebGL context */
    gl?: WebGLRenderingContext;

    /** For external controller to override the camera state */
    viewState?: ViewState & {
      width: number;
      height: number;
    };

    // Styling

    /** GTEL Maps style */
    mapStyle?: string | StyleSpecification | ImmutableLike<StyleSpecification>;
    /** Enable diffing when the map style changes
     * @default true
     */
    styleDiffing?: boolean;
    /** The projection property of the style. Must conform to the Projection Style Specification.
     * @default 'mercator'
     */
    projection?: ProjectionSpecification | 'mercator' | 'globe';
    /** Light properties of the map. */
    light?: LightSpecification;
    /** Terrain property of the style. 
     * - If `boolean`: Uses gtelmaps-sdk-js built-in terrain logic (enableTerrain/disableTerrain)
     * - If `TerrainSpecification`: Uses maplibre-gl-js custom terrain logic (setTerrain)
     * - If `undefined` is provided, removes terrain from the map. */
    terrain?: TerrainSpecification | boolean;
    /** Sky properties of the map. Must conform to the Sky Style Specification. */
    sky?: SkySpecification;
    
    /** Space properties of the map (cubemap layer). */
    space?: CubemapLayerConstructorOptions | boolean;
    /** Halo properties of the map (radial gradient layer). */
    halo?: RadialGradientLayerConstructorOptions | boolean;
    /** Primary language of the map */
    language?: LanguageInfo | string;
    /** Terrain exaggeration (multiplier for terrain elevation) */
    terrainExaggeration?: number;

    /** Default layers to query on pointer events */
    interactiveLayerIds?: string[];
    /** CSS cursor */
    cursor?: string;
  };

const DEFAULT_STYLE = {version: 8, sources: {}, layers: []} as StyleSpecification;

const pointerEvents = {
  mousedown: 'onMouseDown',
  mouseup: 'onMouseUp',
  mouseover: 'onMouseOver',
  mousemove: 'onMouseMove',
  click: 'onClick',
  dblclick: 'onDblClick',
  mouseenter: 'onMouseEnter',
  mouseleave: 'onMouseLeave',
  mouseout: 'onMouseOut',
  contextmenu: 'onContextMenu',
  touchstart: 'onTouchStart',
  touchend: 'onTouchEnd',
  touchmove: 'onTouchMove',
  touchcancel: 'onTouchCancel'
};
const cameraEvents = {
  movestart: 'onMoveStart',
  move: 'onMove',
  moveend: 'onMoveEnd',
  dragstart: 'onDragStart',
  drag: 'onDrag',
  dragend: 'onDragEnd',
  zoomstart: 'onZoomStart',
  zoom: 'onZoom',
  zoomend: 'onZoomEnd',
  rotatestart: 'onRotateStart',
  rotate: 'onRotate',
  rotateend: 'onRotateEnd',
  pitchstart: 'onPitchStart',
  pitch: 'onPitch',
  pitchend: 'onPitchEnd'
};
const otherEvents = {
  wheel: 'onWheel',
  boxzoomstart: 'onBoxZoomStart',
  boxzoomend: 'onBoxZoomEnd',
  boxzoomcancel: 'onBoxZoomCancel',
  resize: 'onResize',
  load: 'onLoad',
  render: 'onRender',
  idle: 'onIdle',
  remove: 'onRemove',
  data: 'onData',
  styledata: 'onStyleData',
  sourcedata: 'onSourceData',
  error: 'onError'
};
const settingNames = [
  'minZoom',
  'maxZoom',
  'minPitch',
  'maxPitch',
  'maxBounds',
  'projection',
  'renderWorldCopies'
];
const handlerNames = [
  'scrollZoom',
  'boxZoom',
  'dragRotate',
  'dragPan',
  'keyboard',
  'doubleClickZoom',
  'touchZoomRotate',
  'touchPitch'
];

/**
 * A wrapper for gtelmaps-sdk Map class
 */
export default class GtelMaps {
  private _MapClass: {new (options: any): MapInstance};
  // gtelmapssdk.Map instance
  private _map: MapInstance = null;
  // User-supplied props
  props: GtelMapsProps;

  // Internal states
  private _internalUpdate: boolean = false;
  private _hoveredFeatures: MapGeoJSONFeature[] = null;
  private _propsedCameraUpdate: ViewState | null = null;
  private _styleComponents: {
    light?: LightSpecification;
    sky?: SkySpecification;
    projection?: ProjectionSpecification;
    terrain?: TerrainSpecification | boolean | null;
    space?: CubemapLayerConstructorOptions | boolean;
    halo?: RadialGradientLayerConstructorOptions | boolean;
  } = {};

  static savedMaps: GtelMaps[] = [];

  constructor(
    MapClass: {new (options: any): MapInstance},
    props: GtelMapsProps,
    container: HTMLDivElement
  ) {
    this._MapClass = MapClass;
    this.props = props;
    this._initialize(container);
  }

  get map(): MapInstance {
    return this._map;
  }

  setProps(props: GtelMapsProps) {
    const oldProps = this.props;
    this.props = props;

    const settingsChanged = this._updateSettings(props, oldProps);
    const sizeChanged = this._updateSize(props);
    const viewStateChanged = this._updateViewState(props);
    this._updateStyle(props, oldProps);
    this._updateStyleComponents(props);
    this._updateHandlers(props, oldProps);

    // If 1) view state has changed to match props and
    //    2) the props change is not triggered by map events,
    // it's driven by an external state change. Redraw immediately
    if (settingsChanged || sizeChanged || (viewStateChanged && !this._map.isMoving())) {
      this.redraw();
    }
  }

  static reuse(props: GtelMapsProps, container: HTMLDivElement): GtelMaps {
    const that = GtelMaps.savedMaps.pop();
    if (!that) {
      return null;
    }

    const map = that.map;
    // When reusing the saved map, we need to reparent the map(canvas) and other child nodes
    // intoto the new container from the props.
    // Step 1: reparenting child nodes from old container to new container
    const oldContainer = map.getContainer();
    container.className = oldContainer.className;
    while (oldContainer.childNodes.length > 0) {
      container.appendChild(oldContainer.childNodes[0]);
    }
    // Step 2: replace the internal container with new container from the react component
    // @ts-ignore
    map._container = container;

    // With gtelmaps-sdk as mapLib, map uses ResizeObserver to observe when its container resizes.
    // When reusing the saved map, we need to disconnect the observer and observe the new container.
    // Step 3: telling the ResizeObserver to disconnect and observe the new container
    // @ts-ignore
    const resizeObserver = map._resizeObserver;
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver.observe(container);
    }

    // Step 4: apply new props
    that.setProps({...props, styleDiffing: false});
    map.resize();
    const {initialViewState} = props;
    if (initialViewState) {
      if (initialViewState.bounds) {
        map.fitBounds(initialViewState.bounds, {...initialViewState.fitBoundsOptions, duration: 0});
      } else {
        that._updateViewState(initialViewState);
      }
    }

    // Simulate load event
    if (map.isStyleLoaded()) {
      map.fire('load');
    } else {
      map.once('style.load', () => map.fire('load'));
    }

    // Force reload
    // @ts-ignore
    map._update();
    return that;
  }

  /* eslint-disable complexity,max-statements */
  private _initialize(container: HTMLDivElement) {
    const {props} = this;
    const {mapStyle = DEFAULT_STYLE} = props;
    const mapOptions = {
      ...props,
      ...props.initialViewState,
      apiKey: props.gtelmapsApiKey || getApiTokenFromEnv() || null,
      container,
      style: normalizeStyle(mapStyle),
      // Only pass terrain to Map constructor if it's a boolean
      // If it's TerrainSpecification, handle it later via setTerrain
      terrain: typeof props.terrain === 'boolean' ? props.terrain : undefined
    };

    const viewState = mapOptions.initialViewState || mapOptions.viewState || mapOptions;
    Object.assign(mapOptions, {
      center: [viewState.longitude || 0, viewState.latitude || 0],
      zoom: viewState.zoom || 0,
      pitch: viewState.pitch || 0,
      bearing: viewState.bearing || 0
    });

    if (props.gl) {
      // eslint-disable-next-line
      const getContext = HTMLCanvasElement.prototype.getContext;
      // Hijack canvas.getContext to return our own WebGLContext
      // This will be called inside the gtelmapssdk.Map constructor
      // @ts-expect-error
      HTMLCanvasElement.prototype.getContext = () => {
        // Unhijack immediately
        HTMLCanvasElement.prototype.getContext = getContext;
        return props.gl;
      };
    }

    const map = new this._MapClass(mapOptions);
    // Props that are not part of constructor options
    if (viewState.padding) {
      map.setPadding(viewState.padding);
    }
    if (props.cursor) {
      map.getCanvas().style.cursor = props.cursor;
    }

    // add listeners
    map.transformCameraUpdate = this._onCameraUpdate;
    map.on('style.load', () => {
      // Map style has changed, this would have wiped out all settings from props
      this._styleComponents = {
        light: map.getLight(),
        sky: map.getSky(),
        // @ts-ignore getProjection() does not exist in v4
        projection: map.getProjection?.(),
        // Store terrain based on type
        terrain: typeof this.props.terrain === 'boolean' ? this.props.terrain : map.getTerrain(),
        // @ts-ignore getSpace() is GTEL Maps specific method
        space: map.getSpace()?.getConfig(),
        // @ts-ignore getHalo() is GTEL Maps specific method
        halo: map.getHalo()?.getConfig()
      };
      this._updateStyleComponents(this.props);
    });
    map.on('sourcedata', () => {
      // Some sources have loaded, we may need them to attach terrain
      this._updateStyleComponents(this.props);
    });
    for (const eventName in pointerEvents) {
      map.on(eventName, this._onPointerEvent);
    }
    for (const eventName in cameraEvents) {
      map.on(eventName, this._onCameraEvent);
    }
    for (const eventName in otherEvents) {
      map.on(eventName, this._onEvent);
    }
    this._map = map;
  }
  /* eslint-enable complexity,max-statements */

  recycle() {
    // Clean up unnecessary elements before storing for reuse.
    const container = this.map.getContainer();
    const children = container.querySelector('[gtelmaps-children]');
    children?.remove();

    GtelMaps.savedMaps.push(this);
  }

  destroy() {
    this._map.remove();
  }

  // Force redraw the map now. Typically resize() and jumpTo() is reflected in the next
  // render cycle, which is managed by Mapbox's animation loop.
  // This removes the synchronization issue caused by requestAnimationFrame.
  redraw() {
    const map = this._map as any;
    // map._render will throw error if style does not exist
    // https://github.com/mapbox/mapbox-gl-js/blob/fb9fc316da14e99ff4368f3e4faa3888fb43c513
    //   /src/ui/map.js#L1834
    if (map.style) {
      // cancel the scheduled update
      if (map._frame) {
        map._frame.cancel();
        map._frame = null;
      }
      // the order is important - render() may schedule another update
      map._render();
    }
  }

  /* Trigger map resize if size is controlled
     @param {object} nextProps
     @returns {bool} true if size has changed
   */
  private _updateSize(nextProps: GtelMapsProps): boolean {
    // Check if size is controlled
    const {viewState} = nextProps;
    if (viewState) {
      const map = this._map;
      if (viewState.width !== map.transform.width || viewState.height !== map.transform.height) {
        map.resize();
        return true;
      }
    }
    return false;
  }

  // Adapted from map.jumpTo
  /* Update camera to match props
     @param {object} nextProps
     @param {bool} triggerEvents - should fire camera events
     @returns {bool} true if anything is changed
   */
  private _updateViewState(nextProps: GtelMapsProps): boolean {
    const map = this._map;
    const tr = map.transform;
    const isMoving = map.isMoving();

    // Avoid manipulating the real transform when interaction/animation is ongoing
    // as it would interfere with Mapbox's handlers
    if (!isMoving) {
      const changes = applyViewStateToTransform(tr, nextProps);
      if (Object.keys(changes).length > 0) {
        this._internalUpdate = true;
        map.jumpTo(changes);
        this._internalUpdate = false;
        return true;
      }
    }

    return false;
  }

  /* Update camera constraints and projection settings to match props
     @param {object} nextProps
     @param {object} currProps
     @returns {bool} true if anything is changed
   */
  private _updateSettings(nextProps: GtelMapsProps, currProps: GtelMapsProps): boolean {
    const map = this._map;
    let changed = false;
    for (const propName of settingNames) {
      if (propName in nextProps && !deepEqual(nextProps[propName], currProps[propName])) {
        changed = true;
        const setter = map[`set${propName[0].toUpperCase()}${propName.slice(1)}`];
        setter?.call(map, nextProps[propName]);
      }
    }
    return changed;
  }

  /* Update map style to match props */
  private _updateStyle(nextProps: GtelMapsProps, currProps: GtelMapsProps): void {
    if (nextProps.cursor !== currProps.cursor) {
      this._map.getCanvas().style.cursor = nextProps.cursor || '';
    }
    if (nextProps.mapStyle !== currProps.mapStyle) {
      const {mapStyle = DEFAULT_STYLE, styleDiffing = true} = nextProps;
      const options: any = {
        diff: styleDiffing
      };
      if ('localIdeographFontFamily' in nextProps) {
        // @ts-ignore Mapbox specific prop
        options.localIdeographFontFamily = nextProps.localIdeographFontFamily;
      }
      this._map.setStyle(normalizeStyle(mapStyle), options);
    }
  }

  /* Update fog, light, projection, terrain, space and halo to match props
   * These props are special because
   * 1. They can not be applied right away. Certain conditions (style loaded, source loaded, etc.) must be met
   * 2. They can be overwritten by mapStyle
   */
  private _updateStyleComponents({light, projection, sky, terrain, space, halo}: GtelMapsProps): void {
    const map = this._map;
    // We can safely manipulate map style once it's loaded
    if (!map.style._loaded) {
      return;
    }

    this._updateLight(light);
    this._updateProjection(projection);
    this._updateSky(sky);
    this._updateTerrain(terrain);
    this._updateSpace(space);
    this._updateHalo(halo);
  }

  /* Update light property */
  private _updateLight(light: LightSpecification | undefined): void {
    const currProps = this._styleComponents;
    if (light && !deepEqual(light, currProps.light)) {
      currProps.light = light;
      this._map.setLight(light);
    }
  }

  /* Update projection property */
  private _updateProjection(projection: ProjectionSpecification | 'mercator' | 'globe' | undefined): void {
    const currProps = this._styleComponents;
    if (
      projection &&
      !deepEqual(projection, currProps.projection) &&
      projection !== currProps.projection?.type
    ) {
      currProps.projection = typeof projection === 'string' ? {type: projection} : projection;
      // @ts-ignore setProjection does not exist in v4
      this._map.setProjection?.(currProps.projection);
    }
  }

  /* Update sky property */
  private _updateSky(sky: SkySpecification | undefined): void {
    const currProps = this._styleComponents;
    if (sky && !deepEqual(sky, currProps.sky)) {
      currProps.sky = sky;
      this._map.setSky(sky);
    }
  }

  /* Update terrain property */
  private _updateTerrain(terrain: TerrainSpecification | boolean | undefined): void {
    const currProps = this._styleComponents;
    if (terrain !== undefined && !deepEqual(terrain, currProps.terrain)) {
      currProps.terrain = terrain;
      
      // Case 1: Boolean terrain - use gtelmaps-sdk-js built-in terrain logic
      if (typeof terrain === 'boolean') {
        if (terrain) {
          // @ts-ignore enableTerrain is GTEL Maps specific method
          this._map.enableTerrain?.();
        } else {
          // @ts-ignore disableTerrain is GTEL Maps specific method
          this._map.disableTerrain?.();
        }
        return;
      } 
      
      // Case 2: TerrainSpecification - use maplibre-gl-js custom terrain logic
      if (typeof terrain === 'object' && this._map.getSource(terrain.source)) {
        this._map.setTerrain(terrain);
      }
    }
  }

  /* Update space layer - space props are constructor options, but we store layer instances */
  private _updateSpace(space: CubemapLayerConstructorOptions | boolean | undefined): void {
    const currProps = this._styleComponents;
    if (this._map.isStyleLoaded()) {
      if (space !== undefined && !deepEqual(space, currProps.space)) {
        currProps.space = space;
        // @ts-ignore setSpace is GTEL Maps specific method
        this._map.setSpace(space);
      }
    }
  }

  /* Update halo layer - halo props are constructor options, but we store layer instances */
  private _updateHalo(halo: RadialGradientLayerConstructorOptions | boolean | undefined): void {
    const currProps = this._styleComponents;
    if (this._map.isStyleLoaded()) {
      if (halo !== undefined && !deepEqual(halo, currProps.halo)) {
        currProps.halo = halo;
        // @ts-ignore setHalo is GTEL Maps specific method
        this._map.setHalo(halo);
      }
    }
  }

  /* Update interaction handlers to match props */
  private _updateHandlers(nextProps: GtelMapsProps, currProps: GtelMapsProps): void {
    const map = this._map;
    for (const propName of handlerNames) {
      const newValue = nextProps[propName] ?? true;
      const oldValue = currProps[propName] ?? true;
      if (!deepEqual(newValue, oldValue)) {
        if (newValue) {
          map[propName].enable(newValue);
        } else {
          map[propName].disable();
        }
      }
    }
    this._updateLanguage(nextProps.language, currProps.language);
    this._updateTerrainExaggeration(nextProps.terrainExaggeration, currProps.terrainExaggeration);
  }

  /* Update language - language can be updated dynamically */
  private _updateLanguage(newLang: LanguageInfo | string, oldLang: LanguageInfo | string): void {
    if (newLang && !deepEqual(newLang, oldLang)) {
      // @ts-ignore setLanguage is GTEL Maps specific method
      this._map.setLanguage?.(newLang);
    }
  }

  private _updateTerrainExaggeration(newExagg: number | undefined, oldExagg: number | undefined): void {
    if (newExagg !== undefined && !deepEqual(newExagg, oldExagg)) {
      // @ts-ignore setTerrainExaggeration is GTEL Maps specific method
      this._map.setTerrainExaggeration?.(newExagg);
    }
  }

  private _onEvent = (e: MapEvent) => {
    // @ts-ignore
    const cb = this.props[otherEvents[e.type]];
    if (cb) {
      cb(e);
    } else if (e.type === 'error') {
      console.error((e as ErrorEvent).error); // eslint-disable-line
    }
  };

  private _onCameraEvent = (e: ViewStateChangeEvent) => {
    if (this._internalUpdate) {
      return;
    }
    e.viewState = this._propsedCameraUpdate || transformToViewState(this._map.transform);
    // @ts-ignore
    const cb = this.props[cameraEvents[e.type]];
    if (cb) {
      cb(e);
    }
  };

  private _onCameraUpdate = (tr: TransformLike) => {
    if (this._internalUpdate) {
      return tr;
    }
    this._propsedCameraUpdate = transformToViewState(tr);
    return applyViewStateToTransform(tr, this.props);
  };

  private _queryRenderedFeatures(point: Point) {
    const map = this._map;
    const {interactiveLayerIds = []} = this.props;
    try {
      return map.queryRenderedFeatures(point, {
        layers: interactiveLayerIds.filter(map.getLayer.bind(map))
      });
    } catch {
      // May fail if style is not loaded
      return [];
    }
  }

  private _updateHover(e: MapMouseEvent) {
    const {props} = this;
    const shouldTrackHoveredFeatures =
      props.interactiveLayerIds && (props.onMouseMove || props.onMouseEnter || props.onMouseLeave);

    if (shouldTrackHoveredFeatures) {
      const eventType = e.type;
      const wasHovering = this._hoveredFeatures?.length > 0;
      const features = this._queryRenderedFeatures(e.point);
      const isHovering = features.length > 0;

      if (!isHovering && wasHovering) {
        e.type = 'mouseleave';
        this._onPointerEvent(e);
      }
      this._hoveredFeatures = features;
      if (isHovering && !wasHovering) {
        e.type = 'mouseenter';
        this._onPointerEvent(e);
      }
      e.type = eventType;
    } else {
      this._hoveredFeatures = null;
    }
  }

  private _onPointerEvent = (e: MapMouseEvent) => {
    if (e.type === 'mousemove' || e.type === 'mouseout') {
      this._updateHover(e);
    }

    // @ts-ignore
    const cb = this.props[pointerEvents[e.type]];
    if (cb) {
      if (this.props.interactiveLayerIds && e.type !== 'mouseover' && e.type !== 'mouseout') {
        e.features = this._hoveredFeatures || this._queryRenderedFeatures(e.point);
      }
      cb(e);
      delete e.features;
    }
  };
}

/**
 * Api key can be provided via one of:
 * gtelmapsApiKey prop
 * apikey query parameter
 * GtelMapsApiKey environment variable
 * REACT_APP_GTELMAPS_API_KEY environment variable
 */
function getApiTokenFromEnv(): string {
  let apiKey = null;

  /* global location, process */
  if (typeof location !== 'undefined') {
    const match = /apikey=([^&\/]*)/.exec(location.search);
    apiKey = match && match[1];
  }

  // Note: This depends on bundler plugins (e.g. webpack) importing environment correctly
  try {
    // eslint-disable-next-line no-process-env
    apiKey = apiKey || process.env.GtelMapsApiKey;
  } catch {
    // ignore
  }

  try {
    // eslint-disable-next-line no-process-env
    apiKey = apiKey || process.env.REACT_APP_GTELMAPS_API_KEY;
  } catch {
    // ignore
  }

  return apiKey;
}