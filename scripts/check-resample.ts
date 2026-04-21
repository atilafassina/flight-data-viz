import { createLakebasePool } from '@databricks/appkit';

const pool = createLakebasePool();

const { rows } = await pool.query(
  `SELECT n.nspname AS schema,
          pg_catalog.pg_get_userbyid(n.nspowner) AS owner,
          COALESCE(pg_catalog.array_to_string(n.nspacl, E'\n'), '(no explicit ACL)') AS grants
   FROM pg_namespace n
   WHERE n.nspname IN ('resample', 'appkit')`
);

for (const r of rows) {
  console.log(`\nschema: ${r.schema}`);
  console.log(`owner:  ${r.owner}`);
  console.log(`grants:\n  ${String(r.grants).replace(/\n/g, '\n  ')}`);
}

await pool.end();
