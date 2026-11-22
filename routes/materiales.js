const express = require('express');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs/promises');
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

// Fotos de materiales: fuera de public para evitar que se suban archivos ejecutables al sitio.
const carpetaFotos = path.join(__dirname, '..', 'uploads', 'materiales');
const formatos = {
  'image/jpeg': { ext: 'jpg', valido: b => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/png': { ext: 'png', valido: b => b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) },
  'image/webp': { ext: 'webp', valido: b => b.length >= 12 && b.toString('ascii',0,4) === 'RIFF' && b.toString('ascii',8,12) === 'WEBP' }
};
const subirFotos = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024, files: 3, fields: 6, fieldSize: 8 * 1024 },
  fileFilter: (_req, archivo, cb) => {
    if (!Object.hasOwn(formatos, archivo.mimetype)) return cb(new Error('Solo se permiten fotos JPG, PNG o WebP.'));
    cb(null, true);
  }
});
function fotosValidas(files = []) {
  return files.every(f => formatos[f.mimetype]?.valido(f.buffer));
}
async function adjuntarFotosAMateriales(materiales) {
  if (!materiales.length) return;
  const ids = materiales.map(m => m.id_material);
  const [fotos] = await pool.query(
    `SELECT id_foto, id_material FROM fotos_materiales
     WHERE id_material IN (${ids.map(() => '?').join(',')}) ORDER BY id_foto`, ids
  );
  const mapa = new Map();
  for (const foto of fotos) {
    if (!mapa.has(Number(foto.id_material))) mapa.set(Number(foto.id_material), []);
    mapa.get(Number(foto.id_material)).push({ id_foto: foto.id_foto, url: `/api/materiales/fotos/${foto.id_foto}` });
  }
  for (const material of materiales) material.fotos = mapa.get(Number(material.id_material)) || [];
}
async function guardarFotos(conn, idMaterial, files, guardadas) {
  if (!files?.length) return;
  await fs.mkdir(carpetaFotos, { recursive: true });
  for (const file of files) {
    const nombre = `${crypto.randomUUID()}.${formatos[file.mimetype].ext}`;
    const destino = path.join(carpetaFotos, nombre);
    await fs.writeFile(destino, file.buffer, { flag: 'wx' });
    guardadas.push(destino);
    await conn.execute(
      `INSERT INTO fotos_materiales (id_material, archivo, nombre_original, mime) VALUES (?, ?, ?, ?)`,
      [idMaterial, nombre, String(file.originalname || 'foto').slice(0, 255), file.mimetype]
    );
  }
}
async function limpiarFotos(files) {
  await Promise.all(files.map(f => fs.unlink(f).catch(() => {})));
}


// El alcance de ProHogar contempla únicamente sobrantes de estas cuatro categorías.
const nombresPermitidos = ['pintura', 'cable', 'madera', 'zinc'];
const unidadesPermitidas = new Set(['litros', 'metros', 'm²', 'kg', 'planchas', 'tablas', 'rollos', 'latas']);
const estadosPermitidos = new Set(['disponible', 'agotado']);

const consultaBase = `
  SELECT m.id_material, m.id_usuario, m.id_categoria_material, m.nombre,
         m.cantidad, m.unidad, m.precio, m.estado,
         c.nombre AS categoria, u.nombre AS publicado_por
  FROM materiales m
  JOIN categorias_materiales c ON c.id_categoria_material = m.id_categoria_material
  JOIN usuarios u ON u.id_usuario = m.id_usuario
`;

function numId(valor) {
  const n = Number(valor);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function decimalValido(valor, ceroPermitido) {
  if (typeof valor !== 'string' && typeof valor !== 'number') return null;
  const texto = String(valor).trim();
  if (!/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(texto)) return null;
  const numero = Number(texto);
  if (!Number.isFinite(numero) || numero > 9999999999.99 || (ceroPermitido ? numero < 0 : numero <= 0)) return null;
  return numero;
}

function precioEnteroValido(valor) {
  if (typeof valor !== 'string' && typeof valor !== 'number') return null;
  const texto = String(valor).trim();
  if (!/^(?:0|[1-9]\d{0,9})$/.test(texto)) return null;
  const precio = Number(texto);
  return Number.isSafeInteger(precio) && precio <= 9999999999 ? precio : null;
}

function validarPublicacion(body) {
  const nombre = typeof body?.nombre === 'string' ? body.nombre.trim() : '';
  const idCategoria = numId(body?.id_categoria_material);
  const cantidad = decimalValido(body?.cantidad, false);
  const unidad = typeof body?.unidad === 'string' ? body.unidad.trim() : '';
  const precio = precioEnteroValido(body?.precio === '' || body?.precio == null ? '0' : body.precio);
  if (nombre.length < 4 || nombre.length > 150 || !idCategoria || cantidad === null ||
      !unidadesPermitidas.has(unidad) || precio === null) return null;
  return { nombre, idCategoria, cantidad, unidad, precio };
}

async function categoriaPermitida(id) {
  const [rows] = await pool.execute(
    `SELECT id_categoria_material FROM categorias_materiales
     WHERE id_categoria_material = ? AND LOWER(TRIM(nombre)) IN ('pintura','cable','madera','zinc') LIMIT 1`,
    [id]
  );
  return rows.length === 1;
}

router.get('/categorias', async (_req, res, next) => {
  try {
    const [categorias] = await pool.execute(
      `SELECT id_categoria_material, nombre FROM categorias_materiales
       WHERE LOWER(TRIM(nombre)) IN ('pintura','cable','madera','zinc') ORDER BY nombre`
    );
    res.set('Cache-Control', 'no-store');
    res.json({ categorias });
  } catch (err) { next(err); }
});

// Solo se publican materiales disponibles. No se exponen correos ni teléfonos.
router.get('/', async (_req, res, next) => {
  try {
    const [materiales] = await pool.execute(
      consultaBase + ` WHERE m.estado = 'disponible'
       AND LOWER(TRIM(c.nombre)) IN ('pintura','cable','madera','zinc')
       ORDER BY m.id_material DESC LIMIT 100`
    );
    await adjuntarFotosAMateriales(materiales);
    res.set('Cache-Control', 'no-store');
    res.json({ materiales });
  } catch (err) { next(err); }
});

// Todos los materiales del usuario conectado, incluso si se agotaron.
router.get('/mios', requireAuth, async (req, res, next) => {
  try {
    const [materiales] = await pool.execute(
      consultaBase + ` WHERE m.id_usuario = ?
       AND LOWER(TRIM(c.nombre)) IN ('pintura','cable','madera','zinc')
       ORDER BY m.id_material DESC LIMIT 100`,
      [req.user.id]
    );
    await adjuntarFotosAMateriales(materiales);
    res.set('Cache-Control', 'no-store');
    res.json({ materiales });
  } catch (err) { next(err); }
});

// Compras de materiales: solicitud sin pago en línea.
// Solo se entregan correos de contacto cuando el vendedor acepta la compra.
router.get('/compras', requireAuth, async (req, res, next) => {
  try {
    const [filas] = await pool.execute(
      `SELECT sc.id_compra, sc.id_material, sc.id_comprador,
              m.id_usuario AS id_vendedor, m.nombre AS material,
              m.cantidad, m.unidad, sc.precio_publicado, sc.estado,
              sc.fecha_solicitud, sc.fecha_respuesta,
              v.nombre AS vendedor, b.nombre AS comprador,
              CASE WHEN sc.estado = 'aceptada'
                   THEN CASE WHEN sc.id_comprador = ? THEN v.correo ELSE b.correo END
                   ELSE NULL END AS correo_contacto
       FROM solicitudes_compra_materiales sc
       JOIN materiales m ON m.id_material = sc.id_material
       JOIN usuarios v ON v.id_usuario = m.id_usuario
       JOIN usuarios b ON b.id_usuario = sc.id_comprador
       WHERE sc.id_comprador = ? OR m.id_usuario = ?
       ORDER BY sc.fecha_solicitud DESC, sc.id_compra DESC LIMIT 200`,
      [req.user.id, req.user.id, req.user.id]
    );
    res.set('Cache-Control', 'no-store');
    res.json({
      compras: filas.filter(x => Number(x.id_comprador) === Number(req.user.id)),
      recibidas: filas.filter(x => Number(x.id_vendedor) === Number(req.user.id))
    });
  } catch (err) { next(err); }
});

// El botón «Comprar» envía una solicitud por el lote completo; NO procesa pagos.
router.post('/:id/comprar', requireAuth, async (req, res, next) => {
  const id = numId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Publicación inválida.' });
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const [filas] = await conn.execute(
      'SELECT id_usuario, estado, precio FROM materiales WHERE id_material = ? FOR UPDATE', [id]
    );
    const material = filas[0];
    if (!material) {
      await conn.rollback();
      return res.status(404).json({ error: 'La publicación no existe.' });
    }
    if (Number(material.id_usuario) === Number(req.user.id)) {
      await conn.rollback();
      return res.status(403).json({ error: 'No puedes comprar tus propios materiales.' });
    }
    if (material.estado !== 'disponible') {
      await conn.rollback();
      return res.status(409).json({ error: 'El material ya no está disponible.' });
    }
    const [resultado] = await conn.execute(
      `INSERT INTO solicitudes_compra_materiales
         (id_material, id_comprador, precio_publicado, estado)
       VALUES (?, ?, ?, 'pendiente')`,
      [id, req.user.id, material.precio]
    );
    await conn.commit();
    res.set('Cache-Control', 'no-store');
    return res.status(201).json({
      mensaje: 'Solicitud de compra enviada. El vendedor debe aceptarla; aún no es una compra confirmada.',
      id_compra: resultado.insertId
    });
  } catch (err) {
    if (conn) await conn.rollback().catch(() => {});
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Ya enviaste una solicitud de compra para este material. Consulta Mis compras.' });
    }
    next(err);
  } finally { if (conn) conn.release(); }
});

// Solo el vendedor puede aceptar o rechazar. Una aceptación agota el lote
// y rechaza automáticamente el resto de solicitudes pendientes para evitar doble venta.
router.patch('/compras/:id/responder', requireAuth, async (req, res, next) => {
  const id = numId(req.params.id);
  const decision = req.body?.estado;
  if (!id || !['aceptada','rechazada'].includes(decision)) {
    return res.status(400).json({ error: 'Respuesta inválida.' });
  }
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const [relaciones] = await conn.execute(
      'SELECT id_material FROM solicitudes_compra_materiales WHERE id_compra = ?', [id]
    );
    if (!relaciones.length) {
      await conn.rollback();
      return res.status(404).json({ error: 'Solicitud de compra no encontrada.' });
    }
    const idMaterial = relaciones[0].id_material;
    // Orden de bloqueos: material -> solicitud, también usado al comprar.
    const [materiales] = await conn.execute(
      'SELECT id_usuario, estado FROM materiales WHERE id_material = ? FOR UPDATE', [idMaterial]
    );
    if (!materiales.length || Number(materiales[0].id_usuario) !== Number(req.user.id)) {
      await conn.rollback();
      return res.status(403).json({ error: 'Solo el vendedor puede responder esta solicitud.' });
    }
    const [compras] = await conn.execute(
      'SELECT estado FROM solicitudes_compra_materiales WHERE id_compra = ? FOR UPDATE', [id]
    );
    if (!compras.length || compras[0].estado !== 'pendiente') {
      await conn.rollback();
      return res.status(409).json({ error: 'Esta solicitud ya fue respondida o cancelada.' });
    }
    if (decision === 'aceptada' && materiales[0].estado !== 'disponible') {
      await conn.rollback();
      return res.status(409).json({ error: 'El material ya no está disponible para vender.' });
    }
    await conn.execute(
      `UPDATE solicitudes_compra_materiales SET estado = ?, fecha_respuesta = NOW()
       WHERE id_compra = ? AND estado = 'pendiente'`,
      [decision, id]
    );
    if (decision === 'aceptada') {
      await conn.execute(
        "UPDATE materiales SET estado = 'agotado' WHERE id_material = ? AND estado = 'disponible'",
        [idMaterial]
      );
      await conn.execute(
        `UPDATE solicitudes_compra_materiales
         SET estado = 'rechazada', fecha_respuesta = NOW()
         WHERE id_material = ? AND id_compra <> ? AND estado = 'pendiente'`,
        [idMaterial, id]
      );
    }
    await conn.commit();
    res.set('Cache-Control','no-store');
    res.json({ mensaje: decision === 'aceptada'
      ? 'Compra aceptada. El material quedó agotado.'
      : 'Solicitud de compra rechazada.' });
  } catch (err) {
    if (conn) await conn.rollback().catch(() => {});
    next(err);
  } finally { if (conn) conn.release(); }
});

// El comprador puede retirar una solicitud que aún esté pendiente.
router.patch('/compras/:id/cancelar', requireAuth, async (req, res, next) => {
  const id = numId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Solicitud inválida.' });
  try {
    const [result] = await pool.execute(
      `UPDATE solicitudes_compra_materiales SET estado = 'cancelada', fecha_respuesta = NOW()
       WHERE id_compra = ? AND id_comprador = ? AND estado = 'pendiente'`,
      [id, req.user.id]
    );
    if (!result.affectedRows) return res.status(409).json({ error: 'No se puede cancelar esta solicitud.' });
    res.set('Cache-Control','no-store');
    res.json({ mensaje: 'Solicitud de compra cancelada.' });
  } catch (err) { next(err); }
});

// Fotografías de publicaciones: visibles como parte del catálogo público.
// Los nombres en disco son UUID generados por el servidor, nunca vienen del navegador.
router.get('/fotos/:id', async (req, res, next) => {
  const id = numId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Foto inválida.' });
  try {
    const [fotos] = await pool.execute(
      `SELECT archivo, mime FROM fotos_materiales WHERE id_foto = ? LIMIT 1`, [id]
    );
    if (!fotos.length) return res.status(404).json({ error: 'Foto no disponible.' });
    const { archivo, mime } = fotos[0];
    if (!/^[0-9a-f-]{36}\.(jpg|png|webp)$/.test(archivo) || !formatos[mime]) {
      return res.status(404).json({ error: 'Foto no disponible.' });
    }
    res.set({ 'Cache-Control': 'public, max-age=60', 'Content-Type': mime, 'X-Content-Type-Options': 'nosniff' });
    res.sendFile(path.join(carpetaFotos, archivo), err => {
      if (err && !res.headersSent) next(err);
    });
  } catch (err) { next(err); }
});

router.post('/', requireAuth, subirFotos.array('fotos', 3), async (req, res, next) => {
  const datos = validarPublicacion(req.body);
  if (!datos) return res.status(400).json({ error: 'Revisa los datos. Cantidad: máximo 2 decimales; precio: solo pesos enteros.' });
  if (!fotosValidas(req.files)) return res.status(400).json({ error: 'Una foto no tiene un formato de imagen válido.' });
  let conn;
  const guardadas = [];
  try {
    if (!['cliente','profesional'].includes(req.user.rol)) {
      return res.status(403).json({ error: 'Usuario no válido.' });
    }
    const [usuarios] = await pool.execute(
      `SELECT id_usuario FROM usuarios WHERE id_usuario = ? AND tipo_usuario IN ('cliente', 'profesional') LIMIT 1`,
      [req.user.id]
    );
    if (!usuarios.length) return res.status(401).json({ error: 'Usuario no válido.' });
    if (!(await categoriaPermitida(datos.idCategoria))) {
      return res.status(400).json({ error: 'Selecciona una categoría válida de materiales.' });
    }
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const [resultado] = await conn.execute(
      `INSERT INTO materiales (id_usuario, id_categoria_material, nombre, cantidad, unidad, precio, estado)
       VALUES (?, ?, ?, ?, ?, ?, 'disponible')`,
      [req.user.id, datos.idCategoria, datos.nombre, datos.cantidad, datos.unidad, datos.precio]
    );
    await guardarFotos(conn, resultado.insertId, req.files, guardadas);
    await conn.commit();
    res.set('Cache-Control', 'no-store');
    res.status(201).json({ mensaje: 'Material publicado correctamente.', id_material: resultado.insertId });
  } catch (err) {
    if (conn) await conn.rollback().catch(() => {});
    await limpiarFotos(guardadas);
    next(err);
  } finally { if (conn) conn.release(); }
});

// Solo el dueño puede editar los datos; conservar el estado actual.
router.put('/:id', requireAuth, subirFotos.array('fotos', 3), async (req, res, next) => {
  const id = numId(req.params.id);
  const datos = validarPublicacion(req.body);
  if (!id || !datos) return res.status(400).json({ error: 'Revisa los datos del material.' });
  if (!fotosValidas(req.files)) return res.status(400).json({ error: 'Una foto no tiene un formato de imagen válido.' });
  let conn;
  const guardadas = [];
  try {
    if (!(await categoriaPermitida(datos.idCategoria))) {
      return res.status(400).json({ error: 'Categoría de material no válida.' });
    }
    conn = await pool.getConnection();
    await conn.beginTransaction();
    // Bloqueamos la fila para que dos ediciones no superen el límite de fotos.
    const [propios] = await conn.execute(
      'SELECT id_material FROM materiales WHERE id_material = ? AND id_usuario = ? LIMIT 1 FOR UPDATE',
      [id, req.user.id]
    );
    if (!propios.length) {
      await conn.rollback();
      return res.status(404).json({ error: 'Publicación no encontrada.' });
    }
    const [[{ total }]] = await conn.execute(
      'SELECT COUNT(*) AS total FROM fotos_materiales WHERE id_material = ?', [id]
    );
    if (Number(total) + (req.files?.length || 0) > 3) {
      await conn.rollback();
      return res.status(400).json({ error: 'Solo se permiten 3 fotos por publicación. Elimina alguna foto antes de agregar más.' });
    }
    await conn.execute(
      `UPDATE materiales SET id_categoria_material = ?, nombre = ?, cantidad = ?, unidad = ?, precio = ?
       WHERE id_material = ? AND id_usuario = ?`,
      [datos.idCategoria, datos.nombre, datos.cantidad, datos.unidad, datos.precio, id, req.user.id]
    );
    await guardarFotos(conn, id, req.files, guardadas);
    await conn.commit();
    res.set('Cache-Control', 'no-store');
    res.json({ mensaje: 'Material actualizado correctamente.' });
  } catch (err) {
    if (conn) await conn.rollback().catch(() => {});
    await limpiarFotos(guardadas);
    next(err);
  } finally { if (conn) conn.release(); }
});

// El dueño puede quitar fotos al editar su publicación.
router.delete('/:id/fotos/:fotoId', requireAuth, async (req, res, next) => {
  const id = numId(req.params.id);
  const idFoto = numId(req.params.fotoId);
  if (!id || !idFoto) return res.status(400).json({ error: 'Identificador inválido.' });
  try {
    const [fotos] = await pool.execute(
      `SELECT f.archivo FROM fotos_materiales f
       JOIN materiales m ON m.id_material = f.id_material
       WHERE f.id_foto = ? AND m.id_material = ? AND m.id_usuario = ? LIMIT 1`,
      [idFoto, id, req.user.id]
    );
    if (!fotos.length) return res.status(404).json({ error: 'Foto no encontrada o sin permiso.' });
    await pool.execute('DELETE FROM fotos_materiales WHERE id_foto = ? AND id_material = ?', [idFoto, id]);
    const archivo = fotos[0].archivo;
    if (/^[0-9a-f-]{36}\.(jpg|png|webp)$/.test(archivo)) {
      await fs.unlink(path.join(carpetaFotos, archivo)).catch(() => {});
    }
    res.set('Cache-Control', 'no-store');
    res.json({ mensaje: 'Foto eliminada.' });
  } catch (err) { next(err); }
});

router.patch('/:id/estado', requireAuth, async (req, res, next) => {
  const id = numId(req.params.id);
  const estado = req.body?.estado;
  if (!id || !estadosPermitidos.has(estado)) {
    return res.status(400).json({ error: 'Identificador o estado inválido.' });
  }
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const [propios] = await conn.execute(
      'SELECT id_material FROM materiales WHERE id_material = ? AND id_usuario = ? FOR UPDATE',
      [id, req.user.id]
    );
    if (!propios.length) {
      await conn.rollback();
      return res.status(404).json({ error: 'Publicación no encontrada.' });
    }
    if (estado === 'disponible') {
      const [vendidas] = await conn.execute(
        "SELECT id_compra FROM solicitudes_compra_materiales WHERE id_material = ? AND estado = 'aceptada' LIMIT 1",
        [id]
      );
      if (vendidas.length) {
        await conn.rollback();
        return res.status(409).json({ error: 'Este material ya tiene una compra aceptada. Crea otra publicación si tienes más unidades.' });
      }
    }
    await conn.execute(
      'UPDATE materiales SET estado = ? WHERE id_material = ? AND id_usuario = ?',
      [estado, id, req.user.id]
    );
    if (estado === 'agotado') {
      // Si el dueño retira el anuncio, las solicitudes pendientes ya no pueden aceptarse.
      await conn.execute(
        `UPDATE solicitudes_compra_materiales
         SET estado = 'rechazada', fecha_respuesta = NOW()
         WHERE id_material = ? AND estado = 'pendiente'`, [id]
      );
    }
    await conn.commit();
    res.set('Cache-Control', 'no-store');
    res.json({ mensaje: 'Estado actualizado.', estado });
  } catch (err) {
    if (conn) await conn.rollback().catch(() => {});
    next(err);
  } finally { if (conn) conn.release(); }
});

router.use((err, _req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({
      error: err.code === 'LIMIT_FILE_SIZE'
        ? 'Cada fotografía debe pesar menos de 3 MB.'
        : 'Puedes subir hasta 3 fotografías por material.'
    });
  }
  if (err.message === 'Solo se permiten fotos JPG, PNG o WebP.') {
    return res.status(400).json({ error: err.message });
  }
  next(err);
});

module.exports = router;
