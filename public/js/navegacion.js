import { $, mensaje } from './core.js';

// Comunicacion entre navegacion y modulos.
const cargadores = { registros: () => {}, materiales: () => {} };
export function configurarCargadores({ cargarRegistros, cargarMateriales }) {
  cargadores.registros = cargarRegistros;
  cargadores.materiales = cargarMateriales;
}

export function cerrarMenu() {
  $('menu-cuenta').hidden = true;
  $('btn-cuenta').setAttribute('aria-expanded', 'false');
}
export function cambiarVista(nombre) {
  for (const vista of document.querySelectorAll('[data-vista-pagina]')) {
    vista.hidden = vista.dataset.vistaPagina !== nombre;
  }
  for (const enlace of document.querySelectorAll('.navegacion a')) {
    enlace.classList.toggle('nav-activo', enlace.dataset.vista === nombre);
  }
  cerrarMenu();
  mensaje('');
  if (nombre === 'registros') void cargadores.registros();
  if (nombre === 'materiales') void cargadores.materiales();
  window.scrollTo({ top: 0, behavior: 'instant' });
}

document.addEventListener('click', (evento) => {
  const enlace = evento.target.closest('[data-vista]');
  if (!enlace) return;
  evento.preventDefault();
  cambiarVista(enlace.dataset.vista);
});
