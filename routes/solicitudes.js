'use strict';
const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs/promises');
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

// Guardar las imágenes fuera de /public para impedir accesos directos.
const carpetaFotos = path.join(__dirname, '..', 'uploads', 'solicitudes');
const maxBytes = 3 * 1024 * 1024;
const formatos = {
  'image/jpeg': { extension: 'jpg', valido: (buf) => buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff },
  'image/png': { extension: 'png', valido: (buf) => buf.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) },
  'image/webp': { extension: 'webp', valido: (buf) => buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP' }
};
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 3, fileSize: maxBytes, fields: 3, fieldSize: 8 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!Object.hasOwn(formatos, file.mimetype)) return cb(new Error('Solo se permiten imágenes JPG, PNG o WebP.'));
    cb(null, true);
  }
});


// El filtro por el usuario conectado se ejecuta EN MYSQL, no solo en la interfaz.
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const rol = req.user.rol;
    if (!['cliente','profesional'].includes(rol)) return res.status(403).json({ error: 'Perfil no autorizado.' });
    const condiciones = rol === 'cliente' ? 's.id_cliente = ?' : 'p.id_usuario = ?';
    const [solicitudes] = await pool.execute(
      `SELECT s.id_solicitud, s.descripcion, s.direccion, s.estado, s.fecha_solicitud,
              cat.nombre AS categoria, profesional.nombre AS profesional,
              cliente.nombre AS cliente
       FROM solicitudes s
       JOIN usuarios cliente ON cliente.id_usuario = s.id_cliente
       JOIN servicios_profesionales sp ON sp.id_servicio_profesional = s.id_servicio_profesional
       JOIN perfiles_profesionales p ON p.id_profesional = sp.id_profesional
       JOIN usuarios profesional ON profesional.id_usuario = p.id_usuario
       JOIN categorias_servicios cat ON cat.id_categoria_servicio = sp.id_categoria_servicio
       WHERE ${condiciones}
       ORDER BY s.fecha_solicitud DESC, s.id_solicitud DESC LIMIT 50`,
      [req.user.id]
    );
    if (solicitudes.length) {
      const ids = solicitudes.map((s) => s.id_solicitud);
      const [fotos] = await pool.query(
        `SELECT id_foto, id_solicitud FROM fotos_solicitudes WHERE id_solicitud IN (${ids.map(() => '?').join(',')}) ORDER BY id_foto`, ids
      );
      for (const solicitud of solicitudes) {
        solicitud.fotos = fotos.filter((f) => Number(f.id_solicitud) === Number(solicitud.id_solicitud))
          .map((f) => ({ id_foto: f.id_foto, url: `/api/solicitudes/fotos/${f.id_foto}` }));
      }
    }
    res.set('Cache-Control', 'no-store');
    res.json({ solicitudes });
  } catch (err) { next(err); }
});

// El profesional destinatario puede aceptar, rechazar o finalizar solicitudes.
// La condición sobre el estado original impide cambios contradictorios o duplicados.
router.patch('/:id/estado', requireAuth, async (req, res, next) => {
  if (req.user.rol !== 'profesional') {
    return res.status(403).json({ error: 'Solo el profesional destinatario puede cambiar el estado.' });
  }
  const id = Number(req.params.id);
  const nuevoEstado = req.body?.estado;
  if (!Number.isSafeInteger(id) || id < 1) {
    return res.status(400).json({ error: 'Identificador de solicitud inválido.' });
  }
  const estadoAnterior = {
    aceptada: 'pendiente',
    rechazada: 'pendiente',
    finalizada: 'aceptada'
  }[nuevoEstado];
  if (!estadoAnterior) {
    return res.status(400).json({ error: 'Estado no permitido.' });
  }
  try {
    // El filtro por usuario se ejecuta en MySQL, no depende del frontend.
    const [resultado] = await pool.execute(
      `UPDATE solicitudes s
       JOIN servicios_profesionales sp
         ON sp.id_servicio_profesional = s.id_servicio_profesional
       JOIN perfiles_profesionales p ON p.id_profesional = sp.id_profesional
       SET s.estado = ?
       WHERE s.id_solicitud = ?
         AND p.id_usuario = ?
         AND s.estado = ?`,
      [nuevoEstado, id, req.user.id, estadoAnterior]
    );
    if (!resultado.affectedRows) {
      return res.status(409).json({
        error: 'No se pudo actualizar. La solicitud no te corresponde o su estado ya cambió. Actualiza la lista.'
      });
    }
    res.set('Cache-Control', 'no-store');
    return res.json({ mensaje: 'Estado actualizado correctamente.', id_solicitud: id, estado: nuevoEstado });
  } catch (err) { next(err); }
});

// Las fotos se entregan solamente a quien creó la solicitud o al profesional destinatario.
router.get('/fotos/:id', requireAuth, async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: 'Foto inválida.' });
  try {
    const [filas] = await pool.execute(
      `SELECT f.archivo, f.mime
       FROM fotos_solicitudes f
       JOIN solicitudes s ON s.id_solicitud = f.id_solicitud
       JOIN servicios_profesionales sp ON sp.id_servicio_profesional = s.id_servicio_profesional
       JOIN perfiles_profesionales p ON p.id_profesional = sp.id_profesional
       WHERE f.id_foto = ? AND (s.id_cliente = ? OR p.id_usuario = ?) LIMIT 1`,
      [id, req.user.id, req.user.id]
    );
    if (!filas.length) return res.status(404).json({ error: 'Foto no disponible.' });
    const { archivo, mime } = filas[0];
    if (!/^[0-9a-f-]{36}\.(jpg|png|webp)$/.test(archivo) || !formatos[mime]) {
      return res.status(404).json({ error: 'Foto no disponible.' });
    }
    res.set({ 'Cache-Control': 'private, no-store', 'Content-Type': mime, 'X-Content-Type-Options': 'nosniff' });
    res.sendFile(path.join(carpetaFotos, archivo), (err) => {
      if (err && !res.headersSent) next(err);
    });
  } catch (err) { next(err); }
});

router.post('/', requireAuth, upload.array('fotos', 3), async (req, res, next) => {
  if (req.user.rol !== 'cliente') return res.status(403).json({ error: 'Solo los clientes pueden crear solicitudes.' });
  const servicioId = Number(req.body?.id_servicio_profesional);
  const descripcion = typeof req.body?.descripcion === 'string' ? req.body.descripcion.trim() : '';
  const direccion = typeof req.body?.direccion === 'string' ? req.body.direccion.trim() : '';
  if (!Number.isSafeInteger(servicioId) || servicioId < 1 || descripcion.length < 15 || descripcion.length > 1000) {
    return res.status(400).json({ error: 'Selecciona un profesional y escribe una descripción de 15 a 1000 caracteres.' });
  }
  if (direccion.length < 5 || direccion.length > 255) {
    return res.status(400).json({ error: 'Ingresa la dirección del trabajo (entre 5 y 255 caracteres).' });
  }
  const archivos = [];
  let conn;
  try {
    for (const file of req.files || []) {
      if (!formatos[file.mimetype]?.valido(file.buffer)) {
        return res.status(400).json({ error: 'Una foto no corresponde a un formato de imagen válido.' });
      }
    }
    const [clientes] = await pool.execute(
      `SELECT id_usuario FROM usuarios WHERE id_usuario = ? AND tipo_usuario = 'cliente' LIMIT 1`,
      [req.user.id]
    );
    if (!clientes.length) return res.status(401).json({ error: 'Cuenta no válida.' });
    const [servicios] = await pool.execute(
      `SELECT sp.id_servicio_profesional FROM servicios_profesionales sp
       JOIN perfiles_profesionales p ON p.id_profesional = sp.id_profesional
       JOIN usuarios u ON u.id_usuario = p.id_usuario
       WHERE sp.id_servicio_profesional = ? AND u.tipo_usuario = 'profesional' LIMIT 1`,
      [servicioId]
    );
    if (!servicios.length) return res.status(404).json({ error: 'El servicio ya no está disponible.' });
    // Crear siempre la solicitud con un estado valido en MySQL y MariaDB.
    const estado = 'pendiente';

    conn = await pool.getConnection();
    await conn.beginTransaction();
    const [resultado] = await conn.execute(
      `INSERT INTO solicitudes (id_cliente, id_servicio_profesional, descripcion, direccion, estado, fecha_solicitud)
       VALUES (?, ?, ?, ?, 'pendiente', NOW())`, [req.user.id, servicioId, descripcion, direccion]
    );
    // Comprobar la escritura antes de confirmar la transacción.
    const [[creada]] = await conn.execute(
      'SELECT estado FROM solicitudes WHERE id_solicitud = ? LIMIT 1',
      [resultado.insertId]
    );
    if (!creada || creada.estado !== 'pendiente') {
      throw new Error('El estado inicial de la solicitud no se guardó correctamente.');
    }
    if (req.files?.length) await fs.mkdir(carpetaFotos, { recursive: true });
    for (const file of req.files || []) {
      const nombre = `${crypto.randomUUID()}.${formatos[file.mimetype].extension}`;
      const destino = path.join(carpetaFotos, nombre);
      await fs.writeFile(destino, file.buffer, { flag: 'wx' });
      archivos.push(destino);
      await conn.execute(
        `INSERT INTO fotos_solicitudes (id_solicitud, archivo, nombre_original, mime)
         VALUES (?, ?, ?, ?)`, [resultado.insertId, nombre, file.originalname.slice(0, 255), file.mimetype]
      );
    }
    await conn.commit();
    res.status(201).json({ mensaje: 'Solicitud enviada correctamente.', id_solicitud: resultado.insertId,
      estado, fotos: (req.files || []).length });
  } catch (err) {
    if (conn) await conn.rollback().catch(() => {});
    await Promise.all(archivos.map((archivo) => fs.unlink(archivo).catch(() => {})));
    next(err);
  } finally {
    if (conn) conn.release();
  }
});

router.use((err, _req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({
      error: err.code === 'LIMIT_FILE_SIZE' ? 'Cada foto puede pesar hasta 3 MB.' : 'Máximo 3 fotos por solicitud.'
    });
  }
  if (err.message === 'Solo se permiten imágenes JPG, PNG o WebP.') {
    return res.status(400).json({ error: err.message });
  }
  next(err);
});

module.exports = router;
