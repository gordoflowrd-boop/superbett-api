const express = require("express");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { Pool } = require("pg");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const SECRET = "superbett_secret_key";

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
// USUARIO DEMO
// =============================
const usuarioDemo = {
  id: 1,
  username: "admin",
  password: bcrypt.hashSync("123456", 10)
};

// =============================
// LOGIN
// =============================
app.post("/login", async (req, res) => {
  const { username, password } = req.body;

  if (username !== usuarioDemo.username) {
    return res.status(401).json({ error: "Usuario incorrecto" });
  }

  const passwordValido = await bcrypt.compare(password, usuarioDemo.password);

  if (!passwordValido) {
    return res.status(401).json({ error: "Contraseña incorrecta" });
  }

  const token = jwt.sign(
    { id: usuarioDemo.id, username: usuarioDemo.username },
    SECRET,
    { expiresIn: "1h" }
  );

  res.json({ token });
});

// =============================
// DEBUG HEADER
// =============================
app.get("/debug", (req, res) => {
  res.json({
    authorizationHeader: req.headers.authorization || null
  });
});

// =============================
// TEST VARIABLES DE ENTORNO
// =============================
app.get("/env-test", (req, res) => {
  res.json({
    databaseUrlExiste: !!process.env.DATABASE_URL,
    databaseUrlLength: process.env.DATABASE_URL
      ? process.env.DATABASE_URL.length
      : 0
  });
});

// =============================
// TEST CONEXIÓN BD
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
