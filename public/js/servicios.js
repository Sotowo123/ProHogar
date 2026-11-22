import { state, registrarReinicioSesion } from './state.js';
import { $, api, mensaje } from './core.js';
import { abrirAcceso, crearListaAreas } from './cuenta.js';


export function limpiarSeleccionSolicitud() {
  state.categoriaElegida = null;
  state.servicioElegido = null;
  $('panel-solicitud').hidden = true;
  $('panel-profesionales').hidden = true;
  $('form-solicitud').reset();
  $('detalle-seleccion').textContent = '';
  $('resultado-solicitud').hidden = true;
  $('resultado-solicitud').textContent = '';
  $('ayuda-fotos').textContent = 'Puedes adjuntar hasta 3 fotos JPG, PNG o WebP (máximo 3 MB por foto).';
  for (const boton of $('categorias').querySelectorAll('button')) {
    boton.classList.remove('categoria-activa');
    boton.setAttribute('aria-pressed', 'false');
  }
}

async function mostrarProfesionales(categoria) {
  state.categoriaElegida = categoria;
  state.servicioElegido = null;
  $('panel-solicitud').hidden = true;
  $('panel-profesionales').hidden = false;
  $('titulo-profesionales').textContent = `2. Profesionales en ${categoria.nombre}`;
  $('lista-profesionales').textContent = 'Buscando profesionales…';
  for (const boton of $('categorias').querySelectorAll('button')) {
    const activo = Number(boton.dataset.categoria) === Number(categoria.id_categoria_servicio);
    boton.classList.toggle('categoria-activa', activo);
    boton.setAttribute('aria-pressed', String(activo));
  }
  try {
    const { profesionales } = await api(`/api/catalogo/profesionales?categoria=${encodeURIComponent(categoria.id_categoria_servicio)}`);
    $('lista-profesionales').replaceChildren();
    if (!profesionales.length) {
      $('lista-profesionales').textContent = 'Todavía no hay profesionales registrados en esta categoría.';
      return;
    }
    for (const profesional of profesionales) {
      const tarjeta = document.createElement('article');
      tarjeta.className = 'tarjeta-profesional';
      const titulo = document.createElement('h3');
      titulo.textContent = profesional.profesional;
      const especialidad = document.createElement('p');
      especialidad.className = 'profesional-especialidad';
      especialidad.textContent = profesional.categoria;
      const descripcion = document.createElement('p');
      descripcion.className = 'profesional-descripcion';
      descripcion.textContent = profesional.descripcion_servicio || profesional.descripcion_profesional ||
        'Profesional disponible para recibir solicitudes en esta categoría.';
      const boton = document.createElement('button');
      boton.type = 'button';
      boton.className = 'boton';
      boton.textContent = 'Solicitar trabajo';
      boton.addEventListener('click', () => elegirProfesional(profesional));
      tarjeta.append(titulo, especialidad, descripcion, boton);
      $('lista-profesionales').append(tarjeta);
    }
  } catch (error) {
    $('lista-profesionales').textContent = `No se pudieron cargar profesionales: ${error.message}`;
  }
}

function elegirProfesional(profesional) {
  if (!state.usuarioActual) {
    abrirAcceso('ingresar');
    mensaje('Inicia sesión como cliente para solicitar un trabajo.');
    return;
  }
  if (state.usuarioActual.tipo_usuario !== 'cliente') {
    mensaje('Solo los clientes pueden solicitar trabajos. Para ofrecer servicios, usa tu perfil profesional.', true);
    return;
  }
  state.servicioElegido = profesional;
  $('id-servicio-seleccionado').value = profesional.id_servicio_profesional;
  $('detalle-seleccion').textContent = `${profesional.categoria} · ${profesional.profesional}`;
  $('form-solicitud').elements.descripcion.value = '';
  $('form-solicitud').elements.direccion.value = '';
  $('fotos-solicitud').value = '';
  $('ayuda-fotos').textContent = 'Puedes adjuntar hasta 3 fotos JPG, PNG o WebP (máximo 3 MB por foto).';
  $('resultado-solicitud').hidden = true;
  $('panel-solicitud').hidden = false;
  $('panel-solicitud').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

$('btn-cancelar-solicitud').addEventListener('click', () => {
  state.servicioElegido = null;
  $('panel-solicitud').hidden = true;
  $('resultado-solicitud').hidden = true;
});

$('fotos-solicitud').addEventListener('change', (evento) => {
  const archivos = Array.from(evento.currentTarget.files || []);
  const valido = archivos.length <= 3 && archivos.every((f) =>
    f.size <= 3 * 1024 * 1024 && ['image/jpeg','image/png','image/webp'].includes(f.type));
  if (!valido) {
    evento.currentTarget.value = '';
    $('ayuda-fotos').textContent = 'Máximo 3 fotos JPG, PNG o WebP, de hasta 3 MB cada una.';
    mensaje('Revisa la cantidad, tamaño y formato de las fotos.', true);
  } else {
    $('ayuda-fotos').textContent = archivos.length
      ? `${archivos.length} foto(s) seleccionada(s).` : 'Puedes adjuntar hasta 3 fotos.';
  }
});

$('form-solicitud').addEventListener('submit', async (evento) => {
  evento.preventDefault();
  if (!state.servicioElegido || !state.usuarioActual || state.usuarioActual.tipo_usuario !== 'cliente') return;
  const formulario = evento.currentTarget;
  const boton = formulario.querySelector('[type="submit"]');
  const usuarioEnEnvio = state.usuarioActual.id_usuario;
  const sesionEnEnvio = state.sessionEpoch;
  boton.disabled = true;
  const resultado = $('resultado-solicitud');
  resultado.hidden = true;
  try {
    const datos = new FormData();
    datos.set('id_servicio_profesional', String(state.servicioElegido.id_servicio_profesional));
    datos.set('descripcion', formulario.elements.descripcion.value.trim());
    datos.set('direccion', formulario.elements.direccion.value.trim());
    const archivos = Array.from($('fotos-solicitud').files || []);
    if (archivos.length > 3 || archivos.some(f => f.size > 3 * 1024 * 1024)) {
      throw new Error('Puedes adjuntar un máximo de 3 fotos de hasta 3 MB cada una.');
    }
    for (const archivo of archivos) datos.append('fotos', archivo, archivo.name);
    const respuesta = await api('/api/solicitudes', { method: 'POST', body: datos });
    if (sesionEnEnvio !== state.sessionEpoch || state.usuarioActual?.id_usuario !== usuarioEnEnvio) return;
    resultado.textContent = `${respuesta.mensaje} Número: ${respuesta.id_solicitud}. Estado: ${respuesta.estado}. ${respuesta.fotos ? `${respuesta.fotos} foto(s) adjuntada(s).` : ''}`;
    resultado.className = 'resultado-solicitud exito';
    resultado.hidden = false;
    formulario.elements.descripcion.value = '';
    formulario.elements.direccion.value = '';
    $('fotos-solicitud').value = '';
    $('ayuda-fotos').textContent = 'Puedes adjuntar hasta 3 fotos JPG, PNG o WebP (máximo 3 MB por foto).';
  } catch (error) {
    if (sesionEnEnvio !== state.sessionEpoch || state.usuarioActual?.id_usuario !== usuarioEnEnvio) return;
    resultado.textContent = error.message;
    resultado.className = 'resultado-solicitud error';
    resultado.hidden = false;
  } finally {
    boton.disabled = false;
  }
});

export async function cargarCategorias() {
  try {
    const { categorias } = await api('/api/catalogo/categorias');
    $('categorias').replaceChildren();
    if (!categorias.length) {
      $('categorias').textContent = 'Todavía no hay categorías de servicios registradas.';
      return;
    }
    for (const categoria of categorias) {
      const boton = document.createElement('button');
      boton.type = 'button';
      boton.className = 'categoria';
      boton.dataset.categoria = categoria.id_categoria_servicio;
      boton.setAttribute('aria-pressed', 'false');
      boton.textContent = categoria.nombre;
      boton.addEventListener('click', () => mostrarProfesionales(categoria));
      $('categorias').appendChild(boton);
    }
    crearListaAreas('areas-registro', categorias, 'registro');
    crearListaAreas('areas-edicion', categorias, 'edicion');
  } catch (error) {
    $('categorias').textContent = `No se pudieron cargar las categorías: ${error.message}`;
  }
}

registrarReinicioSesion(limpiarSeleccionSolicitud);
