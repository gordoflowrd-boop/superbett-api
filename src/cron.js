const cron = require('node-cron');
const { query } = require('./db');

async function _ejecutar() {
  console.log('[CRON] Ejecutando generar_jornadas()...');
  try {
    const result = await query('SELECT generar_jornadas()');
    const data   = result.rows[0].generar_jornadas;
    console.log(`[CRON] Jornadas generadas para: ${data.fecha}`);
    if (data.alertas && data.alertas.length > 0) {
      data.alertas.forEach(a =>
        console.warn(`  [${a.tipo}] ${a.loteria} ${a.fecha}: ${a.mensaje}`)
      );
    }
  } catch (err) {
    console.error('[CRON] Error en generar_jornadas:', err.message);
  }
}

const iniciarCron = async () => {
  // Leer hora RD desde configuracion (default 2 AM)
  let horaRD = 2;
  try {
    const r = await query(
      `SELECT valor FROM configuracion WHERE clave = 'hora_jornada'`
    );
    if (r.rows.length) horaRD = parseInt(r.rows[0].valor, 10) || 2;
  } catch { /* usa default */ }

  // RD es UTC-4
  const horaUTC = (horaRD + 4) % 24;

  cron.schedule(`0 ${horaUTC} * * *`, _ejecutar, { timezone: 'UTC' });

  console.log(`[CRON] generar_jornadas() programado: ${horaRD}:00 AM RD (${horaUTC}:00 UTC)`);
};

module.exports = { iniciarCron };
