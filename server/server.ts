import { createApp, server, analytics } from '@databricks/appkit';
import { resample } from './resample/index.js';

const appkit = await createApp({
  plugins: [
    server({ autoStart: false }),
    analytics(),
    resample({
      source: {
        queryKey: 'flight_parameters',
        timeColumn: 'timestamp',
        valueColumns: ['altitude', 'speed', 'oil_pressure', 'battery_voltage', 'in_air'],
        entityColumn: 'flight_id',
      },
    }),
  ],
});

appkit.resample.setAnalytics(appkit.analytics);

await appkit.server.start();
