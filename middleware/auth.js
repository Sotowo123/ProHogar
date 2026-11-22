const jwt = require('jsonwebtoken');
const pool = require('../db');

// La versión de sesión invalida cookies existentes tras restablecer una contraseña.
async function requireAuth(req, res, next) {
  const token = req.cookies?.prohogar_session;
  if (!token) return res.status(401).json({ error: 'Debes iniciar sesión.' });
  let datos;
  try {
    datos = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
  } catch {
    return res.status(401).json({ error: 'Sesión vencida o no válida.' });
  }
  try {
    const [usuarios] = await pool.execute(
      'SELECT tipo_usuario, session_version FROM usuarios WHERE id_usuario = ? LIMIT 1',
      [datos.id]
    );
    if (usuarios.length !== 1 || usuarios[0].tipo_usuario !== datos.rol ||
        Number(usuarios[0].session_version) !== Number(datos.version)) {
      res.clearCookie('prohogar_session', {
        path: '/', sameSite: 'strict', secure: process.env.NODE_ENV === 'production'
      });
      return res.status(401).json({ error: 'Sesión no válida. Vuelve a iniciar sesión.' });
    }
    req.user = datos;
    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = { requireAuth };
