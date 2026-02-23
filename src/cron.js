const cron = require('node-cron');
const { query } = require('./db');

/**
 * Corre todos los días a las 6:00 AM hora Santo Domingo (UTC-4)
 * = 10:00 AM UTC
 *
 * Si motor_cierre_loteria ya creó las jornadas del día siguiente
 * al completar la última lotería del día, el ON CONFLICT DO NOTHING
 * en generar_jornadas() garantiza que no haya duplicados.
 *
 * El cron es respaldo por si el servidor estuvo caído en la noche.
 */
const iniciarCron = () => {
  cron.schedule('0 10 * * *', async () => {
    console.log('[CRON] Ejecutando generar_jornadas()...');
    try {
      const result = await query('SELECT generar_jornadas()');
      const data   = result.rows[0].generar_jornadas;

      console.log(`[CRON] Jornadas generadas para: ${data.fecha}`);

      if (data.alertas && data.alertas.length > 0) {
        console.warn('[CRON] ⚠ Alertas de jornadas incompletas:');
        data.alertas.forEach(a => {
          console.warn(`  [${a.tipo}] ${a.loteria} ${a.fecha}: ${a.mensaje}`);
        });

        // Aquí puedes integrar notificaciones:
        // await enviarEmailAdmin(data.alertas);
        // await enviarSlack(data.alertas);
      }

    } catch (err) {
      console.error('[CRON] Error en generar_jornadas:', err.message);
    }
  }, {
    timezone: 'America/Santo_Domingo'
  });

  console.log('[CRON] Tarea programada: generar_jornadas() a las 6:00 AM RD');
};

module.exports = { iniciarCron };
