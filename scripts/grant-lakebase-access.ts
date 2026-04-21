import { createLakebasePool } from '@databricks/appkit';

const pool = createLakebasePool();

const schemas = ['resample', 'appkit'];

for (const schema of schemas) {
  const statements = [
    `GRANT USAGE, CREATE ON SCHEMA ${schema} TO PUBLIC`,
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${schema} TO PUBLIC`,
    `GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA ${schema} TO PUBLIC`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema} GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO PUBLIC`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema} GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO PUBLIC`,
  ];
  for (const sql of statements) {
    await pool.query(sql);
    console.log(`✓ ${sql}`);
  }
}

await pool.end();
