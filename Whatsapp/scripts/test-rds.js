const { Pool } = require('pg');

const pool = new Pool({
  host: 'talentwale.cbme0ei2myk1.ap-south-1.rds.amazonaws.com',
  port: 5432,
  user: 'postgres', // the default user is usually postgres, but we will use 'postgres' if 'Email' fails. Let's try 'postgres' first or stick to their script? Their script said user: 'Email' but password: Gyanu2328. Let's use user: 'postgres' as default in AWS.
  password: 'Gyanu2328',
  database: 'postgres',
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 5000
});

async function test() {
  try {
    const res = await pool.query('SELECT version()');
    console.log('Connected to RDS successfully!');
    console.log(res.rows[0].version);
  } catch (err) {
    console.error('RDS connection failed:', err);
  } finally {
    await pool.end();
  }
}
test();
