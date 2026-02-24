require('dotenv').config();

const express = require('express');
const cors    = require('cors');

// Rutas
const authRoutes     = require('./src/routes/auth');
const jornadasRoutes = require('./src/routes/jornadas');
const ticketsRoutes  = require('./src/routes/tickets');
const premiosRoutes  = require('./src/routes/premios');
const reportesRoutes = require('./src/routes/reportes');
const adminRoutes    = require('./src/routes/admin');
const bancasRoutes   = require('./src/routes/bancas');

// Cron
const { iniciarCron } = require('./src/cron');

const app  = express();
const PORT = process.env.PORT || 3000;

// =============================================
// MIDDLEWARES GLOBALES
// =============================================
app.use(cors());
app.use(express.json());

// Log de requests en desarrollo
if (process.env.NODE_ENV !== 'production') {
  app.use((req, _res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
  });
}

// =============================================
// RUTAS
// =============================================
app.use('/api/auth',     authRoutes);
app.use('/api/jornadas', jornadasRoutes);
app.use('/api/tickets',  ticketsRoutes);
app.use('/api/premios',  premiosRoutes);
app.use('/api/reportes', reportesRoutes);
app.use('/api/admin',    adminRoutes);
app.use('/api/bancas',   bancasRoutes);

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 404
app.use((_req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});

// Error global
app.use((err, _req, res, _next) => {
  console.error('Error no manejado:', err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

// =============================================
// INICIO
// =============================================
app.listen(PORT, () => {
  console.log(`\n SuperBett API corriendo en puerto ${PORT}`);
  console.log(`   Entorno: ${process.env.NODE_ENV || 'development'}\n`);
  iniciarCron();
});
