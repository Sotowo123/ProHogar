require('dotenv').config();
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const { rateLimit } = require('express-rate-limit');
const pool = require('./db');
const authRoutes = require('./routes/auth');
const catalogoRoutes = require('./routes/catalogo');
const solicitudesRoutes = require('./routes/solicitudes');
const materialesRoutes = require('./routes/materiales');

const app = express();

// alwaysdata usa un proxy HTTPS delante del servidor Node.js.
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.IP || '127.0.0.1';

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32 ||
    process.env.JWT_SECRET.startsWith('REEMPLAZAR')) {
  console.error('ERROR: configura un JWT_SECRET privado de 32+ caracteres en .env');
  process.exit(1);
}

app.use(helmet());
app.use(express.json({ limit: '16kb' }));
app.use(cookieParser());


app.use('/api', (req, res, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    const origin = req.get('origin');
    if (origin && origin !== `${req.protocol}://${req.get('host')}`) {
      return res.status(403).json({ error: 'Origen no autorizado.' });
    }
    const ruta = req.originalUrl.split('?')[0];
    const cargaFotosSolicitud = req.method === 'POST' && ruta === '/api/solicitudes';
    const cargaFotosMaterial = (req.method === 'POST' && ruta === '/api/materiales') ||
      (req.method === 'PUT' && /^\/api\/materiales\/\d+$/.test(ruta));
    const multipartPermitido = (cargaFotosSolicitud || cargaFotosMaterial) && req.is('multipart/form-data');
    if (req.get('content-type') && !req.is('application/json') && !multipartPermitido) {
      return res.status(415).json({ error: 'Se requiere JSON, salvo al adjuntar fotografías a una solicitud o material.' });
    }
  }
  next();
});

const authLimiter = rateLimit({
  windowMs: 3 * 60 * 1000,
  limit: 25,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Intenta nuevamente en unos minutos.' }
});

app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/catalogo', catalogoRoutes);
app.use('/api/materiales', materialesRoutes);
const solicitudesLimiter = rateLimit({ windowMs: 5 * 60 * 1000, limit: 100,
  message: { error: 'Demasiadas solicitudes por ahora.' } });
app.use('/api/solicitudes', solicitudesLimiter, solicitudesRoutes);
app.get('/api/salud', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ servidor: 'ok', base_de_datos: 'ok' });
  } catch {
    res.status(503).json({ servidor: 'ok', base_de_datos: 'sin conexión' });
  }
});

app.use(express.static(path.join(__dirname, 'public')));
app.use((err, _req, res, _next) => {
  console.error('Error interno:', err.code || err.message);
  res.status(500).json({ error: 'Ocurrió un error interno. Revisa la terminal.' });
});

async function start() {
  try {
    await pool.query('SELECT 1');
    console.log('Conexión MySQL correcta.');
    app.listen(PORT, HOST, () => {
      console.log(`ProHogar escuchando en ${HOST}:${PORT}`);
    });
  } catch (err) {
    console.error('No se pudo conectar a MySQL:', err.code || err.message);
    console.error('Comprueba que MySQL esté iniciado y revisa DB_USER/DB_PASSWORD/DB_NAME en .env.');
    process.exitCode = 1;
    await pool.end();
  }
}
start();
