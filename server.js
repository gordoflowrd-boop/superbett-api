const express = require("express");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { Pool } = require("pg");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const SECRET = process.env.JWT_SECRET || "superbett_secret_key";

// =============================
// CONEXIÓN POSTGRES
// =============================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL
    ? { rejectUnauthorized: false }
    : false
});

// =============================
// SETUP BASE DE DATOS (ejecutar 1 vez)
// =============================
app.get("/setup-db", async (req, res) => {
  try {
    await pool.query(`
      CREATE EXTENSION IF NOT EXISTS "pgcrypto";

      CREATE TABLE IF NOT EXISTS usuarios (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        username text NOT NULL UNIQUE,
        password text NOT NULL,
        nombre text NOT NULL,
        rol text NOT NULL,
        activo boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT rol_valido CHECK (
          rol IN ('admin','central','vendedor','premios')
        )
      );

      CREATE INDEX IF NOT EXISTS idx_usuarios_username
      ON usuarios(username);
    `);

    res.json({ ok: true, message: "Tabla usuarios lista" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// =============================
// CREAR ADMIN INICIAL (1 vez)
// =============================
app.get("/crear-admin", async (req, res) => {
  try {
    const hash = await bcrypt.hash("123456", 10);

    await pool.query(
      `INSERT INTO usuarios (username, password, nombre, rol)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (username) DO NOTHING`,
      ["admin", hash, "Administrador", "admin"]
    );

    res.json({ ok: true, message: "Admin creado o ya existe" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// =============================
// LOGIN REAL
// =============================
app.post("/login", async (req, res) => {
  const { username, password } = req.body;

  try {
    const result = await pool.query(
      "SELECT * FROM usuarios WHERE username = $1 AND activo = true",
      [username]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: "Usuario no encontrado" });
    }

    const usuario = result.rows[0];

    const passwordValido = await bcrypt.compare(password, usuario.password);

    if (!passwordValido) {
      return res.status(401).json({ error: "Contraseña incorrecta" });
    }

    const token = jwt.sign(
      {
        id: usuario.id,
        rol: usuario.rol
      },
      SECRET,
      { expiresIn: "1h" }
    );

    res.json({ token });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// =============================
// TEST BD
// =============================
app.get("/db-test", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");
    res.json({
      conectado: true,
      servidor: result.rows[0]
    });
  } catch (error) {
    res.status(500).json({
      conectado: false,
      error: error.message
    });
  }
});

// =============================
// MIDDLEWARE TOKEN
// =============================
function verificarToken(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ error: "Token requerido" });
  }

  if (!authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Formato inválido" });
  }

  const token = authHeader.substring(7).trim();

  try {
    const decoded = jwt.verify(token, SECRET);
    req.usuario = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Token inválido o expirado" });
  }
}

// =============================
// RUTA PROTEGIDA
// =============================
app.get("/perfil", verificarToken, (req, res) => {
  res.json({
    mensaje: "Ruta protegida",
    usuario: req.usuario
  });
});

app.listen(PORT, () => {
  console.log("Servidor corriendo en puerto " + PORT);
});
