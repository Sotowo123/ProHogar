import { state } from './state.js';
import { $, api, mensaje } from './core.js';

async function actualizarEstadoSolicitud(idSolicitud, nuevoEstado, botones) {
  if (!state.usuarioActual || state.usuarioActual.tipo_usuario !== 'profesional') return;
  if (nuevoEstado === 'rechazada' && !window.confirm('¿Rechazar esta solicitud?')) return;
  const turnoSesion = state.sessionEpoch;
  botones.forEach((boton) => { boton.disabled = true; });
  try {
    const respuesta = await api(`/api/solicitudes/${encodeURIComponent(idSolicitud)}/estado`, {
      method: 'PATCH', body: JSON.stringify({ estado: nuevoEstado })
    });
    if (turnoSesion !== state.sessionEpoch) return;
    mensaje(`Solicitud #${idSolicitud}: ${respuesta.estado}.`);
    await cargarRegistros();
  } catch (error) {
    if (turnoSesion !== state.sessionEpoch) return;
    mensaje(error.message, true);
    await cargarRegistros();
  }
}

$('filtro-estado-solicitudes').addEventListener('change', () => {
  void cargarRegistros();
});

export async function cargarRegistros() {
  const lista = $('lista-registros');
  const turno = ++state.registrosEpoch;
  const sesion = state.sessionEpoch;
  if (!state.usuarioActual) {
    lista.textContent = 'Inicia sesión desde Mi cuenta para consultar tus solicitudes.';
    return;
  }

  lista.textContent = 'Cargando tus solicitudes…';
  try {
    const { solicitudes } = await api('/api/solicitudes');
    if (turno !== state.registrosEpoch || sesion !== state.sessionEpoch) return;
    lista.replaceChildren();
    const filtro = $('filtro-estado-solicitudes').value;
    const solicitudesFiltradas = filtro === 'todas'
      ? solicitudes
      : solicitudes.filter((solicitud) => solicitud.estado === filtro);
    $('resumen-filtro-solicitudes').textContent =
      `Mostrando ${solicitudesFiltradas.length} de ${solicitudes.length} solicitud(es)`;
    if (!solicitudes.length) {
      lista.textContent = 'No tienes solicitudes registradas todavía.';
      return;
    }
    if (!solicitudesFiltradas.length) {
      lista.textContent = 'No tienes solicitudes con este estado.';
      return;
    }
    for (const solicitud of solicitudesFiltradas) {
      const tarjeta = document.createElement('article');
      tarjeta.className = 'tarjeta-registro';
      const titulo = document.createElement('h2');
      titulo.textContent = `Solicitud #${solicitud.id_solicitud} · ${solicitud.categoria}`;
      const meta = document.createElement('p');
      meta.className = 'registro-meta';
      const persona = state.usuarioActual.tipo_usuario === 'cliente'
        ? `Profesional: ${solicitud.profesional}`
        : `Cliente: ${solicitud.cliente}`;
      const fecha = solicitud.fecha_solicitud ? new Date(solicitud.fecha_solicitud) : null;
      const fechaTexto = fecha && !Number.isNaN(fecha.getTime()) ? fecha.toLocaleString('es-CL') : 'Sin fecha';
      meta.textContent = `${persona} · ${fechaTexto}`;
      const direccion = document.createElement('p');
      direccion.className = 'registro-meta';
      direccion.textContent = solicitud.direccion
        ? `Dirección del trabajo: ${solicitud.direccion}`
        : 'Dirección del trabajo: no registrada';
      const descripcion = document.createElement('p');
      descripcion.className = 'registro-descripcion';
      descripcion.textContent = solicitud.descripcion;
      const estado = document.createElement('span');
      // colores por estado de solicitudes
      const estadosPermitidos = ['pendiente', 'aceptada', 'rechazada', 'finalizada'];
      const codigoEstado = String(solicitud.estado || '').toLowerCase();
      estado.className = `registro-estado ${estadosPermitidos.includes(codigoEstado) ? `estado-${codigoEstado}` : ''}`;
      estado.textContent = `Estado: ${solicitud.estado}`;
      tarjeta.append(titulo, meta, direccion, descripcion, estado);
      if (state.usuarioActual.tipo_usuario === 'profesional') {
        const acciones = [];
        if (solicitud.estado === 'pendiente') {
          acciones.push(['aceptada', 'Aceptar solicitud'], ['rechazada', 'Rechazar solicitud']);
        } else if (solicitud.estado === 'aceptada') {
          acciones.push(['finalizada', 'Marcar como finalizada']);
        }
        if (acciones.length) {
          const fila = document.createElement('div');
          fila.className = 'registro-acciones';
          const botones = [];
          for (const [valor, etiqueta] of acciones) {
            const boton = document.createElement('button');
            boton.type = 'button';
            boton.className = valor === 'rechazada' ? 'boton secundario' : 'boton';
            boton.textContent = etiqueta;
            botones.push(boton);
            boton.addEventListener('click', () => actualizarEstadoSolicitud(solicitud.id_solicitud, valor, botones));
            fila.append(boton);
          }
          tarjeta.append(fila);
        }
      }
      if (solicitud.fotos?.length) {
        const fotos = document.createElement('div');
        fotos.className = 'registro-fotos';
        for (const [index, foto] of solicitud.fotos.entries()) {
          const enlace = document.createElement('a');
          enlace.href = foto.url;
          enlace.target = '_blank';
          enlace.rel = 'noopener noreferrer';
          const imagen = document.createElement('img');
          imagen.src = foto.url;
          imagen.alt = `Foto ${index + 1} de la solicitud ${solicitud.id_solicitud}`;
          imagen.loading = 'lazy';
          enlace.append(imagen);
          fotos.append(enlace);
        }
        tarjeta.append(fotos);
      }
      lista.append(tarjeta);
    }
  } catch (error) {
    if (turno !== state.registrosEpoch || sesion !== state.sessionEpoch) return;
    lista.textContent = `No se pudieron cargar las solicitudes: ${error.message}`;
  }
}


