const express = require("express");

const app = express();

app.get("/saludo", (req, res) => {
  res.json({ mensaje: "API SuperBett funcionando 🚀" });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Servidor corriendo en puerto " + PORT);
});
