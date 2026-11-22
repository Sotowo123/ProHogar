import { state, notificarCambioSesion } from './state.js';
import { $, api, mensaje, borrarEnlaceRestablecimiento } from './core.js';
import { cambiarVista, cerrarMenu } from './navegacion.js';

// Limpiar formularios de acceso.
function limpiarFormulariosAcceso() {
  $('form-ingreso').reset();
  $('form-registro').reset();
  $('datos-profesional').hidden = true;
}

export function mostrarSesion(usuario) {
  state.sessionEpoch++;
  state.registrosEpoch++;
  state.materialesEpoch++;
  state.usuarioActual = usuario;
  limpiarFormulariosAcceso();
  notificarCambioSesion();
  state.perfilActual = null;
  $('filtro-estado-solicitudes').value = 'todas';
  $('controles-filtro-solicitudes').hidden = !usuario;
  $('resumen-filtro-solicitudes').textContent = '';
  $('lista-registros').textContent = usuario ? 'Abre Mis solicitudes para ver tus trabajos.' : 'Inicia sesión para ver tus solicitudes.';
  $('invitado').hidden = Boolean(usuario);
  $('form-recuperacion').hidden = true;
  $('form-restablecer').hidden = true;
  $('panel-usuario').hidden = !usuario;
  $('menu-invitado').hidden = Boolean(usuario);
  $('menu-autenticado').hidden = !usuario;
  if (usuario) {
    $('nombre-menu').textContent = usuario.nombre;
    $('cuenta-titulo').textContent = 'Mi perfil';
    $('cuenta-subtitulo').textContent = 'Consulta o actualiza tus datos de ProHogar.';
  } else {
    $('nombre-menu').textContent = '';
    $('cuenta-titulo').textContent = 'Accede a ProHogar';
    $('cuenta-subtitulo').textContent = 'Ingresa con tus datos o crea una cuenta nueva.';
  }
  cerrarMenu();
}
function mostrarDatosPerfil(perfil) {
  state.perfilActual = perfil;
  $('perfil-nombre').textContent = perfil.nombre;
  $('perfil-correo').textContent = perfil.correo;
  $('perfil-rol').textContent = perfil.tipo_usuario === 'profesional' ? 'Profesional' : 'Cliente';
  const profesional = perfil.tipo_usuario === 'profesional';
  $('perfil-telefono-fila').hidden = !profesional;
  $('perfil-descripcion-fila').hidden = !profesional;
  $('editar-profesional').hidden = !profesional;
  $('perfil-areas-fila').hidden = !profesional;
  $('perfil-areas').textContent = profesional
    ? (perfil.areas || []).map((area) => area.nombre).join(', ') || 'Todavía no hay áreas seleccionadas'
    : '';
  $('perfil-telefono').textContent = perfil.telefono || 'Sin teléfono';
  $('perfil-descripcion').textContent = perfil.descripcion || 'Sin descripción';
}
async function verPerfil(editar = false) {
  if (!state.usuarioActual) return abrirAcceso('ingresar');
  cambiarVista('cuenta');
  $('perfil-lectura').hidden = editar;
  $('form-editar-perfil').hidden = !editar;
  try {
    const epoch = state.sessionEpoch;
    const { perfil } = await api('/api/auth/perfil');
    if (epoch !== state.sessionEpoch) return;
    mostrarDatosPerfil(perfil);
    $('form-editar-perfil').elements.nombre.value = perfil.nombre;
    $('form-editar-perfil').elements.correo.value = perfil.correo;
    $('form-editar-perfil').elements.telefono.value = perfil.telefono || '';
    $('form-editar-perfil').elements.descripcion.value = perfil.descripcion || '';
    const idsSeleccionados = new Set((perfil.areas || []).map((area) => Number(area.id_categoria_servicio)));
    for (const check of document.querySelectorAll('#areas-edicion input[type="checkbox"]')) {
      check.checked = idsSeleccionados.has(Number(check.value));
    }
  } catch (error) {
    mensaje(error.message, true);
  }
}
export function abrirAcceso(tipo) {
  borrarEnlaceRestablecimiento();
  $('form-recuperacion').hidden = true;
  $('form-restablecer').hidden = true;
  $('invitado').hidden = Boolean(state.usuarioActual);
  cambiarVista('cuenta');
  if (state.usuarioActual) {
    verPerfil(false);
    return;
  }
  limpiarFormulariosAcceso();
  const formulario = tipo === 'registrarse' ? $('form-registro') : $('form-ingreso');
  formulario.querySelector('input').focus({ preventScroll: true });
  formulario.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
async function salir() {
  try {
    await api('/api/auth/salir', { method: 'POST', body: '{}' });
    mostrarSesion(null);
    cambiarVista('inicio');
    mensaje('Sesión cerrada correctamente.');
  } catch (error) {
    mensaje(error.message, true);
  }
}
async function accionMenu(accion) {
  cerrarMenu();
  if (accion === 'ingresar' || accion === 'registrarse') abrirAcceso(accion);
  if (accion === 'ver-perfil') await verPerfil();
  if (accion === 'editar-perfil') await verPerfil(true);
  if (accion === 'salir') await salir();
}

$('btn-cuenta').addEventListener('click', () => {
  const abrir = $('menu-cuenta').hidden;
  $('menu-cuenta').hidden = !abrir;
  $('btn-cuenta').setAttribute('aria-expanded', String(abrir));
});
$('menu-cuenta').addEventListener('click', (evento) => {
  const boton = evento.target.closest('[data-accion]');
  if (boton) accionMenu(boton.dataset.accion);
});
document.addEventListener('click', (evento) => {
  if (!$('cuenta-menu').contains(evento.target)) cerrarMenu();
});
document.addEventListener('keydown', (evento) => {
  if (evento.key === 'Escape') cerrarMenu();
});

$('enlace-perfil-inicio').addEventListener('click', (evento) => {
  evento.preventDefault();
  if (state.usuarioActual) verPerfil();
  else abrirAcceso('ingresar');
});
$('btn-editar-desde-perfil').addEventListener('click', () => verPerfil(true));
$('btn-cancelar-edicion').addEventListener('click', () => verPerfil(false));
$('rol').addEventListener('change', () => {
  $('datos-profesional').hidden = $('rol').value !== 'profesional';
});

function areasMarcadas(selector) {
  return Array.from(document.querySelectorAll(`${selector} input[type="checkbox"]:checked`), (input) => Number(input.value));
}
export function crearListaAreas(contenedor, categorias, sufijo) {
  const destino = $(contenedor);
  destino.replaceChildren();
  if (!categorias.length) {
    destino.textContent = 'No hay áreas disponibles. Contacta con el administrador.';
    return;
  }
  for (const categoria of categorias) {
    const label = document.createElement('label');
    label.className = 'opcion-area';
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.name = 'areas';
    check.id = `area-${sufijo}-${categoria.id_categoria_servicio}`;
    check.value = String(categoria.id_categoria_servicio);
    const texto = document.createElement('span');
    texto.textContent = categoria.nombre;
    label.append(check, texto);
    destino.append(label);
  }
}

$('form-registro').addEventListener('submit', async (evento) => {
  evento.preventDefault();
  const boton = evento.currentTarget.querySelector('button[type="submit"]');
  const values = Object.fromEntries(new FormData(evento.currentTarget).entries());
  delete values.areas;
  if (values.tipo_usuario === 'profesional') {
    values.areas = areasMarcadas('#areas-registro');
    if (!values.areas.length) {
      mensaje('Selecciona al menos un área de trabajo.', true);
      return;
    }
  }
  boton.disabled = true;
  try {
    const { usuario, mensaje: confirmacion } = await api('/api/auth/registro', {
      method: 'POST', body: JSON.stringify(values)
    });
    mostrarSesion(usuario);
    await verPerfil();
    mensaje(confirmacion);
  } catch (error) {
    mensaje(error.message, true);
  } finally {
    boton.disabled = false;
  }
});

$('form-ingreso').addEventListener('submit', async (evento) => {
  evento.preventDefault();
  const boton = evento.currentTarget.querySelector('button[type="submit"]');
  boton.disabled = true;
  try {
    const { usuario, mensaje: confirmacion } = await api('/api/auth/ingreso', {
      method: 'POST',
      body: JSON.stringify(Object.fromEntries(new FormData(evento.currentTarget).entries()))
    });
    mostrarSesion(usuario);
    await verPerfil();
    mensaje(confirmacion);
  } catch (error) {
    mensaje(error.message, true);
  } finally {
    boton.disabled = false;
  }
});
$('form-editar-perfil').addEventListener('submit', async (evento) => {
  evento.preventDefault();
  const boton = evento.currentTarget.querySelector('button[type="submit"]');
  boton.disabled = true;
  try {
    const valores = Object.fromEntries(new FormData(evento.currentTarget).entries());
    delete valores.areas;
    if (state.perfilActual && state.perfilActual.tipo_usuario === 'profesional') {
      valores.areas = areasMarcadas('#areas-edicion');
      if (!valores.areas.length) {
        mensaje('Selecciona al menos un área de trabajo.', true);
        return;
      }
    }
    const { perfil, mensaje: confirmacion } = await api('/api/auth/perfil', {
      method: 'PUT', body: JSON.stringify(valores)
    });
    mostrarDatosPerfil(perfil);
    state.usuarioActual = { ...state.usuarioActual, nombre: perfil.nombre, correo: perfil.correo };
    $('nombre-menu').textContent = perfil.nombre;
    $('perfil-lectura').hidden = false;
    $('form-editar-perfil').hidden = true;
    mensaje(confirmacion);
  } catch (error) {
    mensaje(error.message, true);
  } finally {
    boton.disabled = false;
  }
});


window.addEventListener('pageshow', (evento) => {
  if (evento.persisted && !state.usuarioActual) limpiarFormulariosAcceso();
});
