const express = require("express");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const SECRET = "superbett_secret_key"; // luego lo movemos a env

// Usuario de prueba (simula base de datos)
const usuarioDemo = {
  id: 1,
  username: "admin",
  password: bcrypt.hashSync("123456", 10) // contraseña encriptada
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

// -------- MIDDLEWARE --------
function verificarToken(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ error: "Token requerido" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, SECRET);
    req.usuario = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Token inválido" });
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
