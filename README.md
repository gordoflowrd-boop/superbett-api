# SuperBett API

## Instalación

```bash
npm install
cp .env.example .env
# Editar .env con las credenciales de Railway
npm start
```

## Autenticación

Todos los endpoints (excepto `/api/auth/login`) requieren:
```
Authorization: Bearer <token>
```

---

## Endpoints

### AUTH
| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/auth/login` | Login → devuelve JWT |
| GET  | `/api/auth/me`    | Info del usuario autenticado |

**Login body:**
```json
{ "username": "admin", "password": "1234" }
```

---

### JORNADAS
| Método | Ruta | Roles | Descripción |
|--------|------|-------|-------------|
| GET  | `/api/jornadas/abiertas`      | todos   | Jornadas disponibles para vender ahora |
| GET  | `/api/jornadas`               | admin   | Listado con estado y ventas |
| GET  | `/api/jornadas/incompletas`   | admin   | Jornadas pasadas sin completar |
| POST | `/api/jornadas/generar`       | admin   | Crear jornadas manualmente |
| POST | `/api/jornadas/:id/cerrar`    | admin   | Cerrar jornada |
| POST | `/api/jornadas/:id/reabrir`   | admin   | Reabrir jornada cerrada |

---

### TICKETS
| Método | Ruta | Roles | Descripción |
|--------|------|-------|-------------|
| POST | `/api/tickets`            | vendedor | Crear ticket Q/P/T |
| POST | `/api/tickets/super-pale` | vendedor | Crear Super Palé |
| GET  | `/api/tickets/:numero`    | todos    | Consultar ticket |
| POST | `/api/tickets/:id/anular` | vendedor | Anular ticket |
| POST | `/api/tickets/:id/pagar`  | vendedor | Pagar ticket ganador |
| GET  | `/api/tickets`            | admin    | Listado de tickets |

**Crear ticket body:**
```json
{
  "jornada_id": "uuid",
  "jugadas": [
    { "modalidad": "Q", "numeros": "15", "cantidad": 5 },
    { "modalidad": "P", "numeros": "1542", "cantidad": 3 }
  ]
}
```

**Super Palé body:**
```json
{
  "jornadas": ["jornada_uuid_1", "jornada_uuid_2"],
  "jugadas": [
    { "numeros": "1527", "cantidad": 10 }
  ]
}
```

---

### PREMIOS
| Método | Ruta | Roles | Descripción |
|--------|------|-------|-------------|
| POST | `/api/premios/registrar` | admin | Guardar números (sin activar) |
| POST | `/api/premios/activar`   | admin | Activar → dispara motor de ganadores |
| GET  | `/api/premios`           | admin | Listado de premios |

**Registrar body:**
```json
{ "jornada_id": "uuid", "q1": 15, "q2": 42, "q3": 7 }
```

**Activar body:**
```json
{ "jornada_id": "uuid" }
```

---

### REPORTES
| Método | Ruta | Roles | Descripción |
|--------|------|-------|-------------|
| GET | `/api/reportes/ganadores`  | admin | Ganadores del día |
| GET | `/api/reportes/resumen`    | admin | Resumen por banca (ventas/premios/resultado) |
| GET | `/api/reportes/banca`      | admin | Detalle de una banca |
| GET | `/api/reportes/exposicion` | admin | Riesgo acumulado por número/jornada |

**Query params comunes:** `?fecha=2026-02-23&loteria_id=uuid&banca_id=uuid&jornada_id=uuid`

---

### ADMIN
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET    | `/api/admin/usuarios`               | Listar usuarios |
| POST   | `/api/admin/usuarios`               | Crear usuario |
| PATCH  | `/api/admin/usuarios/:id`           | Actualizar usuario |
| POST   | `/api/admin/usuarios/:id/bancas`    | Asignar comisión usuario-banca |
| GET    | `/api/admin/bancas`                 | Listar bancas |
| POST   | `/api/admin/bancas`                 | Crear banca |
| PATCH  | `/api/admin/bancas/:id`             | Actualizar banca |
| GET    | `/api/admin/loterias`               | Listar loterías |
| POST   | `/api/admin/loterias`               | Crear lotería |
| GET    | `/api/admin/esquemas/precios`       | Esquemas de precios |
| GET    | `/api/admin/esquemas/pagos`         | Esquemas de pagos (multiplicadores) |

---

## Roles

| Rol | Acceso |
|-----|--------|
| `admin`    | Todo |
| `central`  | Jornadas, premios, reportes |
| `rifero`   | Reportes de banca |
| `vendedor` | Vender, consultar y pagar tickets de su banca |

---

## Flujo operativo

```
1. generar_jornadas() → cron 6am o automático al completar último premio
2. GET /api/jornadas/abiertas → POS obtiene jornadas disponibles
3. POST /api/tickets → ventas durante el día
4. POST /api/premios/registrar → admin ingresa números
5. POST /api/premios/activar → dispara motor, calcula ganadores
6. POST /api/tickets/:id/pagar → pagar ganadores
```
