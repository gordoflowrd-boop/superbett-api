const express = require('express');
const { withTransaction, query } = require('../db');
const { authMiddleware, requireRol } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// POST /api/tickets
router.post('/', async (req, res) => {
  const { jornada_id, jugadas } = req.body;
  const usuario_id = req.usuario.id;
  const banca_id   = req.usuario.banca_id;

  if (!jornada_id || !jugadas || !jugadas.length)
    return res.status(400).json({ error: 'jornada_id y jugadas son requeridos' });
  if (!banca_id)
    return res.status(400).json({ error: 'Usuario no tiene banca asignada' });

  for (const j of jugadas) {
    if (!j.modalidad || !j.numeros || !j.cantidad)
      return res.status(400).json({ error: 'Cada jugada requiere modalidad, numeros y cantidad' });
    if (!['Q','P','T'].includes(j.modalidad))
      return res.status(400).json({ error: `Modalidad inválida: ${j.modalidad}` });
    if (j.cantidad <= 0)
      return res.status(400).json({ error: 'La cantidad debe ser mayor a 0' });
  }

  try {
    const resultado = await withTransaction(async (client) => {
      const r = await client.query(
        'SELECT crear_ticket($1, $2, $3, $4::jsonb)',
        [usuario_id, banca_id, jornada_id, JSON.stringify(jugadas)]
      );
      return r.rows[0].crear_ticket;
    });
    return resultado.estado === 'ok'
      ? res.status(201).json(resultado)
      : res.status(422).json(resultado);
  } catch (err) {
    console.error('Error crear_ticket:', err);
    res.status(500).json({ error: 'Error al crear el ticket' });
  }
});

// POST /api/tickets/super-pale
router.post('/super-pale', async (req, res) => {
  const { jornadas, jugadas } = req.body;
  const usuario_id = req.usuario.id;
  const banca_id   = req.usuario.banca_id;

  if (!jornadas || jornadas.length !== 2)
    return res.status(400).json({ error: 'Se requieren exactamente 2 jornadas' });
  if (!jugadas || !jugadas.length)
    return res.status(400).json({ error: 'jugadas es requerido' });
  if (!banca_id)
    return res.status(400).json({ error: 'Usuario no tiene banca asignada' });

  try {
    const resultado = await withTransaction(async (client) => {
      const r = await client.query(
        'SELECT crear_super_pale($1, $2, $3::uuid[], $4::jsonb)',
        [usuario_id, banca_id, jornadas, JSON.stringify(jugadas)]
      );
      return r.rows[0].crear_super_pale;
    });
    return resultado.estado === 'ok'
      ? res.status(201).json(resultado)
      : res.status(422).json(resultado);
  } catch (err) {
    console.error('Error crear_super_pale:', err);
    res.status(500).json({ error: 'Error al crear el Super Palé' });
  }
});

// =============================================
// RUTAS ESTÁTICAS GET — DEBEN IR ANTES DE /:numero
// =============================================

// GET /api/tickets
router.get('/', async (req, res) => {
  const { jornada_id, banca_id, fecha, fecha_desde, fecha_hasta } = req.query;
  const bancaFiltro = req.usuario.rol === 'vendedor' ? req.usuario.banca_id : (banca_id || null);
  const desde = fecha_desde || fecha || null;
  const hasta  = fecha_hasta || fecha || null;

  try {
    const result = await query(
      `SELECT t.id, t.numero_ticket, t.fecha, t.hora,
              t.total_monto, t.anulado,
              u.username AS vendedor,
              b.nombre   AS banca,
              l.nombre   AS loteria,
              COALESCE(SUM(g.monto), 0) AS total_ganado,
              COUNT(g.id) FILTER (WHERE g.pagado = false AND g.id IS NOT NULL) AS premios_pendientes
       FROM tickets t
       JOIN usuarios u  ON u.id = t.usuario_id
       JOIN bancas b    ON b.id = t.banca_id
       JOIN jornadas j  ON j.id = t.jornada_id
       JOIN loterias l  ON l.id = j.loteria_id
       LEFT JOIN ganadores_loteria g ON g.ticket_id = t.id
       WHERE ($1::uuid IS NULL OR t.jornada_id = $1)
         AND ($2::uuid IS NULL OR t.banca_id   = $2)
         AND ($3::date IS NULL OR t.fecha      >= $3)
         AND ($4::date IS NULL OR t.fecha      <= $4)
         AND t.anulado = false
       GROUP BY t.id, u.username, b.nombre, l.nombre
       ORDER BY t.fecha DESC, t.hora DESC
       LIMIT 1000`,
      [jornada_id || null, bancaFiltro, desde, hasta]
    );
    res.json({ tickets: result.rows });
  } catch (err) {
    console.error('Error listado tickets:', err);
    res.status(500).json({ error: 'Error al obtener tickets' });
  }
});

// GET /api/tickets/ventas-lista
router.get('/ventas-lista', async (req, res) => {
  const { fecha, loteria_id } = req.query;
  const banca_id = req.usuario.banca_id;

  if (!banca_id)
    return res.status(400).json({ error: 'Usuario sin banca asignada' });

  const fechaFiltro = fecha || new Date().toISOString().slice(0, 10);

  try {
    const normales = await query(
      `SELECT td.modalidad,
              td.numeros       AS jugada,
              l.nombre         AS loteria,
              l.id             AS loteria_id,
              SUM(td.cantidad) AS cantidad,
              SUM(td.monto)    AS monto
       FROM ticket_detalles td
       JOIN tickets t  ON t.id = td.ticket_id
       JOIN jornadas j ON j.id = t.jornada_id
       JOIN loterias l ON l.id = j.loteria_id
       WHERE t.banca_id    = $1
         AND t.fecha       = $2
         AND t.anulado     = false
         AND td.modalidad != 'SP'
         AND ($3::uuid IS NULL OR j.loteria_id = $3)
       GROUP BY td.modalidad, td.numeros, l.nombre, l.id
       ORDER BY td.modalidad, SUM(td.cantidad) DESC`,
      [banca_id, fechaFiltro, loteria_id || null]
    );

    const superPale = await query(
      `SELECT 'SP'                                                     AS modalidad,
              td.numeros                                               AS jugada,
              string_agg(DISTINCT l.nombre, ' + ' ORDER BY l.nombre)  AS loteria,
              SUM(td.cantidad)                                         AS cantidad,
              SUM(td.monto)                                            AS monto
       FROM ticket_detalles td
       JOIN tickets t        ON t.id          = td.ticket_id
       JOIN ticket_loterias  tl ON tl.ticket_id = t.id
       JOIN loterias l       ON l.id          = tl.loteria_id
       WHERE t.banca_id    = $1
         AND t.fecha       = $2
         AND t.anulado     = false
         AND td.modalidad  = 'SP'
         AND ($3::uuid IS NULL OR tl.loteria_id = $3)
       GROUP BY td.numeros
       ORDER BY SUM(td.cantidad) DESC`,
      [banca_id, fechaFiltro, loteria_id || null]
    );

    const totales = await query(
      `SELECT COALESCE(SUM(total_monto), 0) AS total_general
       FROM tickets
       WHERE banca_id = $1 AND fecha = $2 AND anulado = false`,
      [banca_id, fechaFiltro]
    );

    const loterias = await query(
      `SELECT DISTINCT l.id, l.nombre
       FROM jornadas j
       JOIN loterias l ON l.id = j.loteria_id
       WHERE j.fecha = $1
       ORDER BY l.nombre`,
      [fechaFiltro]
    );

    res.json({
      fecha:         fechaFiltro,
      normales:      normales.rows,
      super_pale:    superPale.rows,
      total_general: totales.rows[0].total_general,
      loterias:      loterias.rows,
    });

  } catch (err) {
    console.error('Error ventas-lista:', err);
    res.status(500).json({ error: 'Error al obtener ventas por lista' });
  }
});

// =============================================
// RUTAS CON PARÁMETRO DINÁMICO — AL FINAL
// =============================================

// POST /api/tickets/:numero/anular
router.post('/:numero/anular', async (req, res) => {
  const numero   = req.params.numero.toUpperCase();
  const banca_id = req.usuario.banca_id;

  try {
    const check = await query(
      `SELECT t.id, t.banca_id, t.anulado,
              COALESCE(SUM(g.monto) FILTER (WHERE g.pagado = true), 0) AS ya_pagado
       FROM tickets t
       LEFT JOIN ganadores_loteria g ON g.ticket_id = t.id
       WHERE t.numero_ticket = $1
       GROUP BY t.id`,
      [numero]
    );

    if (!check.rows.length)
      return res.status(404).json({ error: 'Ticket no encontrado' });

    const ticket = check.rows[0];

    if (req.usuario.rol === 'vendedor' && ticket.banca_id !== banca_id)
      return res.status(403).json({ error: 'Ticket no pertenece a tu banca' });

    if (ticket.anulado)
      return res.status(400).json({ error: 'El ticket ya está anulado' });

    if (Number(ticket.ya_pagado) > 0)
      return res.status(400).json({ error: 'No se puede anular un ticket con premios pagados' });

    const result = await query('SELECT anular_ticket($1)', [ticket.id]);
    const data   = result.rows[0].anular_ticket;

    if (data.estado === 'error')
      return res.status(422).json({ error: data.mensaje });

    res.json({ estado: 'ok', mensaje: 'Ticket anulado correctamente' });

  } catch (err) {
    console.error('Error anular_ticket:', err);
    res.status(500).json({ error: 'Error al anular el ticket' });
  }
});

// POST /api/tickets/:numero/pagar
router.post('/:numero/pagar', async (req, res) => {
  const numero   = req.params.numero.toUpperCase();
  const banca_id = req.usuario.banca_id;

  try {
    const check = await query(
      'SELECT id, banca_id FROM tickets WHERE numero_ticket = $1',
      [numero]
    );

    if (!check.rows.length)
      return res.status(404).json({ error: 'Ticket no encontrado' });

    const ticket = check.rows[0];

    if (req.usuario.rol === 'vendedor' && ticket.banca_id !== banca_id)
      return res.status(403).json({ error: 'Ticket no pertenece a tu banca' });

    const result = await query('SELECT pagar_ticket($1)', [ticket.id]);
    const data   = result.rows[0].pagar_ticket;

    if (data.estado === 'error')
      return res.status(422).json({ error: data.mensaje });

    res.json(data);

  } catch (err) {
    console.error('Error pagar_ticket:', err);
    res.status(500).json({ error: 'Error al pagar el ticket' });
  }
});

// GET /api/tickets/:numero  ← SIEMPRE AL FINAL
router.get('/:numero', async (req, res) => {
  try {
    const result = await query(
      'SELECT consultar_ticket($1)',
      [req.params.numero.toUpperCase()]
    );
    const data = result.rows[0].consultar_ticket;

    if (!data || data.estado === 'error')
      return res.status(404).json({ error: data?.mensaje || 'Ticket no encontrado' });

    if (req.usuario.rol === 'vendedor') {
      const check = await query(
        'SELECT banca_id FROM tickets WHERE numero_ticket = $1',
        [req.params.numero.toUpperCase()]
      );
      if (check.rows[0]?.banca_id !== req.usuario.banca_id)
        return res.status(403).json({ error: 'Ticket no pertenece a tu banca' });
    }

    res.json(data);

  } catch (err) {
    console.error('Error consultar_ticket:', err);
    res.status(500).json({ error: 'Error al consultar el ticket' });
  }
});

module.exports = router;
