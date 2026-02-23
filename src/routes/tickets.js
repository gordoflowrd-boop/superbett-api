const express = require('express');
const { withTransaction, query } = require('../db');
const { authMiddleware, requireRol } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// =============================================
// POST /api/tickets
// Crear ticket normal (Q / P / T)
// Body: { jornada_id, jugadas: [{modalidad, numeros, cantidad}] }
// =============================================
router.post('/', async (req, res) => {
  const { jornada_id, jugadas } = req.body;
  const usuario_id = req.usuario.id;
  const banca_id   = req.usuario.banca_id;

  if (!jornada_id || !jugadas || !jugadas.length) {
    return res.status(400).json({ error: 'jornada_id y jugadas son requeridos' });
  }
  if (!banca_id) {
    return res.status(400).json({ error: 'Usuario no tiene banca asignada' });
  }

  // Validar estructura de jugadas
  for (const j of jugadas) {
    if (!j.modalidad || !j.numeros || !j.cantidad) {
      return res.status(400).json({ error: 'Cada jugada requiere modalidad, numeros y cantidad' });
    }
    if (!['Q','P','T'].includes(j.modalidad)) {
      return res.status(400).json({ error: `Modalidad inválida: ${j.modalidad}. Use Q, P o T` });
    }
    if (j.cantidad <= 0) {
      return res.status(400).json({ error: 'La cantidad debe ser mayor a 0' });
    }
  }

  try {
    // BEGIN/COMMIT es crítico aquí: validar_limite_jugada usa FOR UPDATE
    const resultado = await withTransaction(async (client) => {
      const res = await client.query(
        'SELECT crear_ticket($1, $2, $3, $4::jsonb)',
        [usuario_id, banca_id, jornada_id, JSON.stringify(jugadas)]
      );
      return res.rows[0].crear_ticket;
    });

    if (resultado.estado === 'ok') {
      res.status(201).json(resultado);
    } else {
      res.status(422).json(resultado);
    }

  } catch (err) {
    console.error('Error crear_ticket:', err);
    res.status(500).json({ error: 'Error al crear el ticket' });
  }
});

// =============================================
// POST /api/tickets/super-pale
// Crear Super Palé (cruza 2 jornadas/loterías)
// Body: { jornadas: [jornada_id_1, jornada_id_2], jugadas: [{numeros, cantidad}] }
// =============================================
router.post('/super-pale', async (req, res) => {
  const { jornadas, jugadas } = req.body;
  const usuario_id = req.usuario.id;
  const banca_id   = req.usuario.banca_id;

  if (!jornadas || jornadas.length !== 2) {
    return res.status(400).json({ error: 'Se requieren exactamente 2 jornadas para Super Palé' });
  }
  if (!jugadas || !jugadas.length) {
    return res.status(400).json({ error: 'jugadas es requerido' });
  }
  if (!banca_id) {
    return res.status(400).json({ error: 'Usuario no tiene banca asignada' });
  }

  for (const j of jugadas) {
    if (!j.numeros || !j.cantidad || j.cantidad <= 0) {
      return res.status(400).json({ error: 'Cada jugada requiere numeros y cantidad > 0' });
    }
  }

  try {
    const resultado = await withTransaction(async (client) => {
      const res = await client.query(
        'SELECT crear_super_pale($1, $2, $3::uuid[], $4::jsonb)',
        [usuario_id, banca_id, jornadas, JSON.stringify(jugadas)]
      );
      return res.rows[0].crear_super_pale;
    });

    if (resultado.estado === 'ok') {
      res.status(201).json(resultado);
    } else {
      res.status(422).json(resultado);
    }

  } catch (err) {
    console.error('Error crear_super_pale:', err);
    res.status(500).json({ error: 'Error al crear el Super Palé' });
  }
});

// =============================================
// GET /api/tickets/:numero
// Consultar ticket por número (vendedor ve estado y jugadas)
// =============================================
router.get('/:numero', async (req, res) => {
  try {
    const result = await query(
      'SELECT consultar_ticket($1)',
      [req.params.numero.toUpperCase()]
    );
    const data = result.rows[0].consultar_ticket;

    if (data.estado === 'error') {
      return res.status(404).json(data);
    }

    // Vendedor solo puede ver tickets de su banca
    if (req.usuario.rol === 'vendedor') {
      const check = await query(
        'SELECT banca_id FROM tickets WHERE numero_ticket = $1',
        [req.params.numero.toUpperCase()]
      );
      if (check.rows[0]?.banca_id !== req.usuario.banca_id) {
        return res.status(403).json({ error: 'Ticket no pertenece a tu banca' });
      }
    }

    res.json(data);

  } catch (err) {
    console.error('Error consultar_ticket:', err);
    res.status(500).json({ error: 'Error al consultar el ticket' });
  }
});

// =============================================
// POST /api/tickets/:id/anular
// Anular ticket (vendedor solo puede anular del mismo día y banca)
// =============================================
router.post('/:id/anular', async (req, res) => {
  const ticket_id = req.params.id;

  try {
    // Verificar que el ticket pertenece a la banca del vendedor
    if (req.usuario.rol === 'vendedor') {
      const check = await query(
        'SELECT banca_id, fecha FROM tickets WHERE id = $1',
        [ticket_id]
      );
      const ticket = check.rows[0];
      if (!ticket) {
        return res.status(404).json({ error: 'Ticket no encontrado' });
      }
      if (ticket.banca_id !== req.usuario.banca_id) {
        return res.status(403).json({ error: 'Ticket no pertenece a tu banca' });
      }
    }

    const result = await query('SELECT anular_ticket($1)', [ticket_id]);
    const data = result.rows[0].anular_ticket;

    if (data.estado === 'error') {
      return res.status(422).json(data);
    }
    res.json(data);

  } catch (err) {
    console.error('Error anular_ticket:', err);
    res.status(500).json({ error: 'Error al anular el ticket' });
  }
});

// =============================================
// POST /api/tickets/:id/pagar
// Pagar ticket ganador
// =============================================
router.post('/:id/pagar', async (req, res) => {
  const ticket_id = req.params.id;

  try {
    // Vendedor solo puede pagar tickets de su banca
    if (req.usuario.rol === 'vendedor') {
      const check = await query(
        'SELECT banca_id FROM tickets WHERE id = $1',
        [ticket_id]
      );
      if (check.rows[0]?.banca_id !== req.usuario.banca_id) {
        return res.status(403).json({ error: 'Ticket no pertenece a tu banca' });
      }
    }

    const result = await query('SELECT pagar_ticket($1)', [ticket_id]);
    const data = result.rows[0].pagar_ticket;

    if (data.estado === 'error') {
      return res.status(422).json(data);
    }
    res.json(data);

  } catch (err) {
    console.error('Error pagar_ticket:', err);
    res.status(500).json({ error: 'Error al pagar el ticket' });
  }
});

// =============================================
// GET /api/tickets?jornada_id=&banca_id=&fecha=
// Listado de tickets [admin/central]
// =============================================
router.get('/', requireRol('admin', 'central', 'rifero'), async (req, res) => {
  const { jornada_id, banca_id, fecha } = req.query;

  try {
    const result = await query(
      `SELECT t.id, t.numero_ticket, t.fecha, t.hora,
              t.total_monto, t.anulado,
              u.username AS vendedor,
              b.nombre   AS banca,
              l.nombre   AS loteria,
              COALESCE(SUM(g.monto), 0)       AS total_ganado,
              COUNT(g.id) FILTER (WHERE g.pagado = false AND g.id IS NOT NULL) AS premios_pendientes
       FROM tickets t
       JOIN usuarios u  ON u.id = t.usuario_id
       JOIN bancas b    ON b.id = t.banca_id
       JOIN jornadas j  ON j.id = t.jornada_id
       JOIN loterias l  ON l.id = j.loteria_id
       LEFT JOIN ganadores_loteria g ON g.ticket_id = t.id
       WHERE ($1::uuid IS NULL OR t.jornada_id = $1)
         AND ($2::uuid IS NULL OR t.banca_id   = $2)
         AND ($3::date IS NULL OR t.fecha       = $3)
       GROUP BY t.id, u.username, b.nombre, l.nombre
       ORDER BY t.fecha DESC, t.hora DESC
       LIMIT 500`,
      [jornada_id || null, banca_id || null, fecha || null]
    );
    res.json({ tickets: result.rows });
  } catch (err) {
    console.error('Error listado tickets:', err);
    res.status(500).json({ error: 'Error al obtener tickets' });
  }
});

module.exports = router;
