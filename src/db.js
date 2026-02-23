const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  console.error('PostgreSQL pool error:', err);
});

/**
 * Ejecuta una query simple
 */
const query = (text, params) => pool.query(text, params);

/**
 * Obtiene un cliente para transacciones manuales (BEGIN/COMMIT/ROLLBACK)
 */
const getClient = () => pool.connect();

/**
 * Ejecuta una función dentro de una transacción automática.
 * Si falla, hace ROLLBACK automático.
 */
const withTransaction = async (fn) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

module.exports = { query, getClient, withTransaction };
