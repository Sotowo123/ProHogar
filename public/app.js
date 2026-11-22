import { api } from './js/core.js';
import { cambiarVista, configurarCargadores } from './js/navegacion.js';
import { mostrarSesion } from './js/cuenta.js';
import { abrirEnlaceRestablecimiento } from './js/recuperacion.js';
import { cargarRegistros } from './js/solicitudes.js';
import { cargarCategorias } from './js/servicios.js';
import { cargarMateriales, cargarCategoriasMateriales } from './js/materiales.js';

configurarCargadores({ cargarRegistros, cargarMateriales });

(async () => {
  cambiarVista('inicio');
  await cargarCategorias();
  await cargarCategoriasMateriales();
  try {
    const { usuario } = await api('/api/auth/yo');
    mostrarSesion(usuario);
  } catch {
    mostrarSesion(null);
  }
  abrirEnlaceRestablecimiento();
})();