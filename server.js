const express = require("express");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const SECRET = "superbett_secret_key";

// Usuario demo
const usuarioDemo = {
  id: 1,
  username: "admin",
  password: bcrypt.hashSync("123456", 10)
};

// -------- LOGIN --------
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

// -------- DEBUG --------
app.get("/debug", (req, res) => {
  res.json({
    authorizationHeader: req.headers.authorization || null
  });
});

// -------- MIDDLEWARE --------
function verificarToken(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ error: "Token requerido" });
  }

  // Validar formato
  if (!authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Formato inválido. Debe ser Bearer <token>" });
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

// -------- RUTA PROTEGIDA --------
app.get("/perfil", verificarToken, (req, res) => {
  res.json({
    mensaje: "Ruta protegida",
    usuario: req.usuario
  });
});

app.listen(PORT, () => {
  console.log("Servidor corriendo en puerto " + PORT);
});
