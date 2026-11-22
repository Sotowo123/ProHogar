const express = require('express');
const pool = require('../db');
const router = express.Router();

router.get('/categorias', async (_req, res, next) => {
  try {
    const [categorias] = await pool.execute(
      'SELECT id_categoria_servicio, nombre FROM categorias_servicios ORDER BY nombre ASC'
    );
    res.json({ categorias });
  } catch (err) { next(err); }
});

// Profesionales reales registrados para una categoría concreta.
// Las consultas parametrizadas impiden inyección SQL mediante el ID.
router.get('/profesionales', async (req, res, next) => {
  const idCategoria = Number(req.query.categoria);
  if (!Number.isSafeInteger(idCategoria) || idCategoria < 1) {
    return res.status(400).json({ error: 'Selecciona una categoría válida.' });
  }
  try {
    const [profesionales] = await pool.execute(
      `SELECT sp.id_servicio_profesional, c.nombre AS categoria,
              u.nombre AS profesional, p.descripcion AS descripcion_profesional,
              sp.descripcion AS descripcion_servicio
       FROM servicios_profesionales sp
       JOIN perfiles_profesionales p ON p.id_profesional = sp.id_profesional
       JOIN usuarios u ON u.id_usuario = p.id_usuario
       JOIN categorias_servicios c ON c.id_categoria_servicio = sp.id_categoria_servicio
       WHERE sp.id_categoria_servicio = ? AND u.tipo_usuario = 'profesional'
       ORDER BY u.nombre, sp.id_servicio_profesional`,
      [idCategoria]
    );
    res.json({ profesionales });
  } catch (err) { next(err); }
});

module.exports = router;
