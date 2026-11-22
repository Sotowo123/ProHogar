const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { rateLimit } = require('express-rate-limit');
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const roles = new Set(['cliente', 'profesional']);
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Cada profesional puede ofrecer varias categorías. Se guardan en
// servicios_profesionales (id_profesional, id_categoria_servicio).
function leerAreas(areas) {
  if (!Array.isArray(areas) || areas.length < 1 || areas.length > 30) return null;
  const numeros = areas.map((id) => Number(id));
  if (numeros.some((id) => !Number.isSafeInteger(id) || id <= 0)) return null;
  const unicas = [...new Set(numeros)];
  return unicas.length ? unicas : null;
}

async function areasExisten(conn, areas) {
  const placeholders = areas.map(() => '?').join(', ');
  const [rows] = await conn.execute(
    `SELECT id_categoria_servicio FROM categorias_servicios WHERE id_categoria_servicio IN (${placeholders})`,
    areas
  );
  return rows.length === areas.length;
}

async function obtenerAreas(idUsuario, conn = pool) {
  const [rows] = await conn.execute(
    `SELECT c.id_categoria_servicio, c.nombre
     FROM perfiles_profesionales p
     JOIN servicios_profesionales sp ON sp.id_profesional = p.id_profesional
     JOIN categorias_servicios c ON c.id_categoria_servicio = sp.id_categoria_servicio
     WHERE p.id_usuario = ? ORDER BY c.nombre`,
    [idUsuario]
  );
  return rows;
}

async function actualizarAreas(conn, idProfesional, areas) {
  const [actuales] = await conn.execute(
    'SELECT id_categoria_servicio FROM servicios_profesionales WHERE id_profesional = ?',
    [idProfesional]
  );
  const existentes = new Set(actuales.map(({ id_categoria_servicio }) => Number(id_categoria_servicio)));
  const seleccionadas = new Set(areas);
  // Conserva la descripción de las áreas que el profesional mantiene.
  for (const { id_categoria_servicio } of actuales) {
    if (!seleccionadas.has(Number(id_categoria_servicio))) {
      await conn.execute(
        'DELETE FROM servicios_profesionales WHERE id_profesional = ? AND id_categoria_servicio = ?',
        [idProfesional, id_categoria_servicio]
      );
    }
  }
  for (const id of areas) {
    if (!existentes.has(id)) {
      await conn.execute(
        'INSERT INTO servicios_profesionales (id_profesional, id_categoria_servicio, descripcion) VALUES (?, ?, ?)',
        [idProfesional, id, '']
      );
    }
  }
}

function setSession(res, user) {
  const token = jwt.sign(
    { id: user.id_usuario, rol: user.tipo_usuario, version: Number(user.session_version || 0) },
    process.env.JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '2h' }
  );
  res.cookie('prohogar_session', token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 2 * 60 * 60 * 1000,
    path: '/'
  });
}

router.post('/registro', async (req, res, next) => {
  const { nombre, correo, password, tipo_usuario, telefono, descripcion, areas } = req.body || {};
  const nombreLimpio = typeof nombre === 'string' ? nombre.trim() : '';
  const correoLimpio = typeof correo === 'string' ? correo.trim().toLowerCase() : '';

  if (nombreLimpio.length < 2 || nombreLimpio.length > 100 ||
      !emailPattern.test(correoLimpio) || correoLimpio.length > 150 ||
      typeof password !== 'string' || password.length < 10 || password.length > 72 ||
      !roles.has(tipo_usuario)) {
    return res.status(400).json({ error: 'Revisa el nombre, correo, contraseña (10 a 72 caracteres) y perfil.' });
  }
  if (tipo_usuario === 'profesional' && (
      (telefono != null && (typeof telefono !== 'string' || telefono.length > 20)) ||
      (descripcion != null && (typeof descripcion !== 'string' || descripcion.length > 1500))
  )) {
    return res.status(400).json({ error: 'Teléfono o descripción no válidos.' });
  }

  const areasSeleccionadas = tipo_usuario === 'profesional' ? leerAreas(areas) : [];
  if (tipo_usuario === 'profesional' && !areasSeleccionadas) {
    return res.status(400).json({ error: 'Selecciona al menos un área de trabajo válida.' });
  }

  let conn;
  try {
    const hash = await bcrypt.hash(password, 12);
    conn = await pool.getConnection();
    await conn.beginTransaction();
    if (tipo_usuario === 'profesional' && !(await areasExisten(conn, areasSeleccionadas))) {
      await conn.rollback();
      return res.status(400).json({ error: 'Una de las áreas seleccionadas no existe.' });
    }
    const [result] = await conn.execute(
      'INSERT INTO usuarios (nombre, correo, password_hash, tipo_usuario) VALUES (?, ?, ?, ?)',
      [nombreLimpio, correoLimpio, hash, tipo_usuario]
    );
    if (tipo_usuario === 'profesional') {
      const [perfilCreado] = await conn.execute(
        'INSERT INTO perfiles_profesionales (id_usuario, descripcion, telefono) VALUES (?, ?, ?)',
        [result.insertId, typeof descripcion === 'string' ? descripcion.trim() : null,
          typeof telefono === 'string' ? telefono.trim() : null]
      );
      await actualizarAreas(conn, perfilCreado.insertId, areasSeleccionadas);
    }
    await conn.commit();
    const usuario = {
      id_usuario: result.insertId,
      nombre: nombreLimpio,
      correo: correoLimpio,
      tipo_usuario
    };
    setSession(res, usuario);
    return res.status(201).json({ mensaje: 'Cuenta creada correctamente.', usuario });
  } catch (err) {
    if (conn) await conn.rollback().catch(() => {});
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Ese correo ya está registrado.' });
    }
    return next(err);
  } finally {
    if (conn) conn.release();
  }
});

router.post('/ingreso', async (req, res, next) => {
  const { correo, password } = req.body || {};
  if (typeof correo !== 'string' || typeof password !== 'string' ||
      correo.length > 150 || password.length > 200) {
    return res.status(400).json({ error: 'Ingresa correo y contraseña válidos.' });
  }
  try {
    const [rows] = await pool.execute(
      'SELECT id_usuario, nombre, correo, password_hash, tipo_usuario, session_version FROM usuarios WHERE correo = ? LIMIT 1',
      [correo.trim().toLowerCase()]
    );
    if (rows.length !== 1 || !(await bcrypt.compare(password, rows[0].password_hash))) {
      return res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
    }
    const { password_hash, session_version, ...usuario } = rows[0];
    setSession(res, { ...usuario, session_version });
    return res.json({ mensaje: 'Sesión iniciada.', usuario });
  } catch (err) {
    return next(err);
  }
});

router.get('/yo', requireAuth, async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id_usuario, nombre, correo, tipo_usuario FROM usuarios WHERE id_usuario = ? LIMIT 1',
      [req.user.id]
    );
    if (rows.length !== 1 || rows[0].tipo_usuario !== req.user.rol) {
      res.clearCookie('prohogar_session', { path: '/' });
      return res.status(401).json({ error: 'Cuenta o sesión no válida.' });
    }
    res.json({ usuario: rows[0] });
  } catch (err) {
    next(err);
  }
});

router.post('/salir', (_req, res) => {
  res.clearCookie('prohogar_session', {
    path: '/',
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production'
  });
  res.json({ mensaje: 'Sesión cerrada.' });
});


// Consulta los datos de la cuenta autenticada (sin devolver el hash de contraseña).
async function cargarPerfil(id, conexion = pool) {
  const [rows] = await conexion.execute(
    `SELECT u.id_usuario, u.nombre, u.correo, u.tipo_usuario,
            p.telefono, p.descripcion
     FROM usuarios u
     LEFT JOIN perfiles_profesionales p ON p.id_usuario = u.id_usuario
     WHERE u.id_usuario = ? LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

router.get('/perfil', requireAuth, async (req, res, next) => {
  try {
    const perfil = await cargarPerfil(req.user.id);
    if (!perfil || perfil.tipo_usuario !== req.user.rol) {
      return res.status(401).json({ error: 'Cuenta o sesión no válida.' });
    }
    if (perfil.tipo_usuario === 'profesional') {
      perfil.areas = await obtenerAreas(req.user.id);
    }
    res.json({ perfil });
  } catch (err) {
    next(err);
  }
});

router.put('/perfil', requireAuth, async (req, res, next) => {
  const { nombre, correo, telefono, descripcion, areas } = req.body || {};
  const nombreLimpio = typeof nombre === 'string' ? nombre.trim() : '';
  const correoLimpio = typeof correo === 'string' ? correo.trim().toLowerCase() : '';
  if (nombreLimpio.length < 2 || nombreLimpio.length > 100 ||
      !emailPattern.test(correoLimpio) || correoLimpio.length > 150) {
    return res.status(400).json({ error: 'Ingresa un nombre y correo válidos.' });
  }
  if ((telefono != null && (typeof telefono !== 'string' || telefono.length > 20)) ||
      (descripcion != null && (typeof descripcion !== 'string' || descripcion.length > 1500))) {
    return res.status(400).json({ error: 'Teléfono o descripción no válidos.' });
  }
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const perfilAnterior = await cargarPerfil(req.user.id, conn);
    if (!perfilAnterior || perfilAnterior.tipo_usuario !== req.user.rol) {
      await conn.rollback();
      return res.status(401).json({ error: 'Cuenta o sesión no válida.' });
    }
    await conn.execute(
      'UPDATE usuarios SET nombre = ?, correo = ? WHERE id_usuario = ?',
      [nombreLimpio, correoLimpio, req.user.id]
    );
    if (perfilAnterior.tipo_usuario === 'profesional') {
      const areasSeleccionadas = leerAreas(areas);
      if (!areasSeleccionadas) {
        await conn.rollback();
        return res.status(400).json({ error: 'Selecciona al menos un área de trabajo válida.' });
      }
      if (!(await areasExisten(conn, areasSeleccionadas))) {
        await conn.rollback();
        return res.status(400).json({ error: 'Una de las áreas seleccionadas no existe.' });
      }
      await conn.execute(
        'UPDATE perfiles_profesionales SET telefono = ?, descripcion = ? WHERE id_usuario = ?',
        [typeof telefono === 'string' ? telefono.trim() : null,
         typeof descripcion === 'string' ? descripcion.trim() : null,
         req.user.id]
      );
      const [perfiles] = await conn.execute(
        'SELECT id_profesional FROM perfiles_profesionales WHERE id_usuario = ? LIMIT 1',
        [req.user.id]
      );
      if (!perfiles.length) {
        throw new Error('El perfil profesional no existe.');
      }
      await actualizarAreas(conn, perfiles[0].id_profesional, areasSeleccionadas);
    }
    const perfil = await cargarPerfil(req.user.id, conn);
    if (perfil.tipo_usuario === 'profesional') {
      perfil.areas = await obtenerAreas(req.user.id, conn);
    }
    await conn.commit();
    res.json({ mensaje: 'Perfil actualizado correctamente.', perfil });
  } catch (err) {
    if (conn) await conn.rollback().catch(() => {});
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Ese correo ya está registrado.' });
    }
    return next(err);
  } finally {
    if (conn) conn.release();
  }
});



// Recuperación de contraseña por correo. No revela si una dirección está registrada.
const limiteRecuperacion = rateLimit({
  windowMs: 30 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Vuelve a intentarlo más tarde.' }
});
const RESPUESTA_GENERICA = 'Si el correo está registrado, recibirás un enlace para cambiar tu contraseña.';
function correoConfigurado() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_PORT &&
    process.env.SMTP_USER && process.env.SMTP_PASS);
}
function crearTransporteCorreo() {
  const port = Number(process.env.SMTP_PORT);
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: process.env.SMTP_SECURE === 'true' || (process.env.SMTP_SECURE !== 'false' && port === 465),
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000
  });
}
router.post('/recuperar-password', limiteRecuperacion, async (req, res, next) => {
  const correo = typeof req.body?.correo === 'string' ? req.body.correo.trim().toLowerCase() : '';
  if (!emailPattern.test(correo) || correo.length > 150) {
    return res.status(400).json({ error: 'Ingresa un correo electrónico válido.' });
  }
  if (!correoConfigurado()) {
    return res.status(503).json({ error: 'El envío de correos todavía no está configurado en ProHogar.' });
  }
  let digest;
  try {
    const [usuarios] = await pool.execute(
      'SELECT id_usuario FROM usuarios WHERE correo = ? LIMIT 1', [correo]
    );
    if (!usuarios.length) return res.json({ mensaje: RESPUESTA_GENERICA });

    const token = crypto.randomBytes(32).toString('hex');
    digest = crypto.createHash('sha256').update(token).digest('hex');
    const idUsuario = usuarios[0].id_usuario;
    await pool.execute(
      `INSERT INTO recuperaciones_password (id_usuario, token_hash, vence_en)
       VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 30 MINUTE))
       ON DUPLICATE KEY UPDATE token_hash = VALUES(token_hash), vence_en = VALUES(vence_en)`,
      [idUsuario, digest]
    );

    const base = (process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
    const enlace = `${base}/#restablecer?token=${token}`;
    const transporte = crearTransporteCorreo();
    await transporte.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: correo,
      subject: 'ProHogar - Recupera tu contraseña',
      text: `Recibimos una solicitud para cambiar tu contraseña de ProHogar.\n\n` +
        `Abre este enlace en el navegador (válido por 30 minutos, solo una vez):\n${enlace}\n\n` +
        `Si no solicitaste este cambio, ignora este mensaje. No compartas este enlace.`
    });
    res.json({ mensaje: RESPUESTA_GENERICA });
  } catch (error) {
    // No dejar un enlace válido si el correo no se pudo enviar.
    if (digest) {
      await pool.execute('DELETE FROM recuperaciones_password WHERE token_hash = ?', [digest])
        .catch(() => {});
    }
    next(error);
  }
});

router.post('/restablecer-password', limiteRecuperacion, async (req, res, next) => {
  const { token, password } = req.body || {};
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token) ||
      typeof password !== 'string' || password.length < 10 || password.length > 72) {
    return res.status(400).json({ error: 'Enlace no válido o contraseña fuera del rango de 10 a 72 caracteres.' });
  }
  const digest = crypto.createHash('sha256').update(token).digest('hex');
  let conn;
  try {
    // Calcular el hash antes de adquirir el bloqueo sobre la fila del token.
    const nuevoHash = await bcrypt.hash(password, 12);
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const [tokens] = await conn.execute(
      'SELECT id_usuario FROM recuperaciones_password WHERE token_hash = ? AND vence_en > UTC_TIMESTAMP() LIMIT 1 FOR UPDATE',
      [digest]
    );
    if (tokens.length !== 1) {
      await conn.rollback();
      return res.status(400).json({ error: 'El enlace venció o ya fue utilizado. Solicita otro.' });
    }
    const idUsuario = tokens[0].id_usuario;
    await conn.execute(
      'UPDATE usuarios SET password_hash = ?, session_version = session_version + 1 WHERE id_usuario = ?',
      [nuevoHash, idUsuario]
    );
    await conn.execute('DELETE FROM recuperaciones_password WHERE id_usuario = ?', [idUsuario]);
    await conn.commit();
    res.clearCookie('prohogar_session', {
      path: '/', sameSite: 'strict', secure: process.env.NODE_ENV === 'production'
    });
    return res.json({ mensaje: 'Contraseña actualizada. Ya puedes iniciar sesión con la nueva clave.' });
  } catch (error) {
    if (conn) await conn.rollback().catch(() => {});
    next(error);
  } finally {
    if (conn) conn.release();
  }
});

module.exports = router;
