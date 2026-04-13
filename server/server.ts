import { createApp, server, analytics } from '@databricks/appkit';
import { resample } from './resample/index.js';

await createApp({
  plugins: [
    server(),
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
