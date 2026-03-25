import * as React from 'react';
import {useState, useRef, useEffect, useContext, useMemo, useImperativeHandle} from 'react';

import {MountedMapsContext} from './use-map';
import GtelMaps, {GtelMapsProps} from '../gtelmaps/gtelmaps';
import createRef, {MapRef} from '../gtelmaps/create-ref';

import type {CSSProperties} from 'react';
import useIsomorphicLayoutEffect from '../utils/use-isomorphic-layout-effect';
import setGlobals, {GlobalSettings} from '../utils/set-globals';
import type {MapLib, MapOptions} from '../types/lib';

export type MapContextValue = {
  mapLib: MapLib;
  map: MapRef;
};

export const MapContext = React.createContext<MapContextValue>(null);

type MapInitOptions = Omit<
  MapOptions,
  // Omit maplibre specific options
  | 'style'
  | 'container'
  | 'bounds'
  | 'fitBoundsOptions'
  | 'center'
  | 'attributionControl'
  // Omit gtelmaps specific options
  | 'navigationControl'
  | 'terrainControl'
  | 'geolocateControl'
  | 'scaleControl'
  | 'fullscreenControl'
  | 'customControls'
  | 'forceNoAttributionControl'
  | 'projectionControl'
  | 'gtelmapsLogo'
  | 'minimap'
  | 'terrain'
  | 'geolocate'
  | 'customAttribution'
  | 'logoPosition'
>;

export type MapProps = MapInitOptions &
  GtelMapsProps &
  GlobalSettings & {
    mapLib?: MapLib | Promise<MapLib>;
    reuseMaps?: boolean;
    /** Map container id */
    id?: string;
    /** Map container CSS style */
    style?: CSSProperties;
    children?: any;
  };

function _Map(props: MapProps, ref: React.Ref<MapRef>) {
  const mountedMapsContext = useContext(MountedMapsContext);
  const [mapInstance, setMapInstance] = useState<GtelMaps>(null);
  const containerRef = useRef();

  const {current: contextValue} = useRef<MapContextValue>({mapLib: null, map: null});

  useEffect(() => {
    const mapLib = props.mapLib;
    let isMounted = true;
    let gtelmaps: GtelMaps;

    Promise.resolve(mapLib || import('@gis/gtelmaps-sdk-js'))
      .then((module: MapLib | {default: MapLib}) => {
        if (!isMounted) {
          return;
        }
        if (!module) {
          throw new Error('Invalid mapLib');
        }
        const mapboxgl = 'Map' in module ? module : module.default;
        if (!mapboxgl.Map) {
          throw new Error('Invalid mapLib');
        }

        setGlobals(mapboxgl, props);
        if (props.reuseMaps) {
          gtelmaps = GtelMaps.reuse(props, containerRef.current);
        }
        if (!gtelmaps) {
          gtelmaps = new GtelMaps(mapboxgl.Map, props, containerRef.current);
        }
        contextValue.map = createRef(gtelmaps);
        contextValue.mapLib = mapboxgl;

        setMapInstance(gtelmaps);
        mountedMapsContext?.onMapMount(contextValue.map, props.id);
      })
      .catch(error => {
        const {onError} = props;
        if (onError) {
          onError({
            type: 'error',
            target: null,
            originalEvent: null,
            error
          });
        } else {
          console.error(error); // eslint-disable-line
        }
      });

    return () => {
      isMounted = false;
      if (gtelmaps) {
        mountedMapsContext?.onMapUnmount(props.id);
        if (props.reuseMaps) {
          gtelmaps.recycle();
        } else {
          gtelmaps.destroy();
        }
      }
    };
  }, []);

  useIsomorphicLayoutEffect(() => {
    if (mapInstance) {
      mapInstance.setProps(props);
    }
  });

  useImperativeHandle(ref, () => contextValue.map, [mapInstance]);

  const style: CSSProperties = useMemo(
    () => ({
      position: 'relative',
      width: '100%',
      height: '100%',
      ...props.style
    }),
    [props.style]
  );

  const CHILD_CONTAINER_STYLE = {
    height: '100%'
  };

  return (
    <div id={props.id} ref={containerRef} style={style}>
      {mapInstance && (
        <MapContext.Provider value={contextValue}>
          <div mapboxgl-children="" style={CHILD_CONTAINER_STYLE}>
            {props.children}
          </div>
        </MapContext.Provider>
      )}
    </div>
  );
}

export const Map = React.forwardRef(_Map);
