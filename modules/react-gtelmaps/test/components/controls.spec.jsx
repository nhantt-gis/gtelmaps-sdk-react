/* global document */
import test from 'tape-promise/tape';
import * as React from 'react';
import {createRoot} from 'react-dom/client';
import {
  Map,
  AttributionControl,
  FullscreenControl,
  GeolocateControl,
  NavigationControl,
  ScaleControl
} from '@gis/gtelmaps-map-react';

import {sleep, waitForMapLoad} from '../utils/test-utils';
import {GtelMapsApiKey} from '../utils/key';

test('Controls', async t => {
  const rootContainer = document.createElement('div');
  const root = createRoot(rootContainer);
  const mapRef = {current: null};

  root.render(
    <Map ref={mapRef} gtelmapsApiKey={GtelMapsApiKey}>
      <AttributionControl />
    </Map>
  );
  await waitForMapLoad(mapRef);
  await sleep(1);
  t.ok(rootContainer.querySelector('.maplibregl-ctrl-attrib'), 'Rendered <AttributionControl />');

  root.render(
    <Map ref={mapRef} gtelmapsApiKey={GtelMapsApiKey}>
      <FullscreenControl />
    </Map>
  );
  await sleep(1);
  t.ok(
    rootContainer.querySelector('.maplibregl-ctrl-fullscreen'),
    'Rendered <FullscreenControl />'
  );

  const geolocateControlRef = {current: null};
  root.render(
    <Map ref={mapRef} gtelmapsApiKey={GtelMapsApiKey}>
      <GeolocateControl ref={geolocateControlRef} />
    </Map>
  );
  await sleep(1);
  t.ok(rootContainer.querySelector('.maplibregl-ctrl-geolocate'), 'Rendered <GeolocateControl />');
  t.ok(geolocateControlRef.current, 'GeolocateControl created');

  root.render(
    <Map ref={mapRef} gtelmapsApiKey={GtelMapsApiKey}>
      <NavigationControl />
    </Map>
  );
  await sleep(1);
  t.ok(rootContainer.querySelector('.maplibregl-ctrl-zoom-in'), 'Rendered <NavigationControl />');

  root.render(
    <Map ref={mapRef} gtelmapsApiKey={GtelMapsApiKey}>
      <ScaleControl />
    </Map>
  );
  await sleep(1);
  t.ok(rootContainer.querySelector('.maplibregl-ctrl-scale'), 'Rendered <ScaleControl />');

  root.unmount();

  t.end();
});
