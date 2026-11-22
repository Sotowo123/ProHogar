import { state } from './state.js';
import { $, api, mensaje } from './core.js';
import { abrirAcceso } from './cuenta.js';

// Se inyectan las operaciones de materiales una sola vez durante la inicialización.
let acciones;
export function configurarAccionesCompras(dependencias) { acciones = dependencias; }

// Solicitud Compra de materiales
export async function solicitarCompraMaterial(material, boton) {
  if (!state.usuarioActual) {
    abrirAcceso('ingresar');
    mensaje('Inicia sesión para solicitar la compra de un material.');
    return;
  }
  if (Number(material.id_usuario) === Number(state.usuarioActual.id_usuario)) {
    acciones.mensajeMaterial('No puedes comprar tus propios materiales.', true);
    return;
  }
  const precio = Number(material.precio) === 0 ? 'gratis' :
    new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(Number(material.precio));
  // Envio solicitud de compra al servidor
  const sesion = state.sessionEpoch;
  boton.disabled = true;
  acciones.mensajeMaterial('');
  try {
    const respuesta = await api(`/api/materiales/${encodeURIComponent(material.id_material)}/comprar`, {
      method: 'POST', body: '{}'
    });
    if (sesion !== state.sessionEpoch) return;
    acciones.mensajeMaterial(respuesta.mensaje);
    state.vistaMateriales = 'compras';
    acciones.cerrarFormMaterial();
    acciones.actualizarBotonesMateriales();
    await acciones.cargarMateriales();
  } catch (error) {
    if (sesion === state.sessionEpoch) acciones.mensajeMaterial(error.message, true);
  } finally { boton.disabled = false; }
}

function tarjetaCompra(c, esVendedor) {
  const tarjeta = document.createElement('article');
  tarjeta.className = 'tarjeta-compra-material';
  const titulo = document.createElement('h3');
  titulo.textContent = c.material;
  const meta = document.createElement('p');
  meta.className = 'nota';
  const precio = Number(c.precio_publicado) === 0 ? 'Gratis' :
    new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(Number(c.precio_publicado));
  meta.textContent = `Cantidad: ${c.cantidad} ${c.unidad} · Precio anunciado: ${precio} · ${esVendedor ? 'Comprador: ' + c.comprador : 'Vendedor: ' + c.vendedor}`;
  const estado = document.createElement('span');
  estado.className = `estado-compra estado-compra-${['pendiente','aceptada','rechazada','cancelada'].includes(c.estado) ? c.estado : 'pendiente'}`;
  estado.textContent = `Estado: ${c.estado}`;
  tarjeta.append(titulo, meta, estado);
  if (c.correo_contacto && c.estado === 'aceptada') {
    const correo = document.createElement('p');
    correo.className = 'contacto-compra';
    const etiqueta = document.createElement('span');
    etiqueta.textContent = 'Correo para coordinar: ';
    const enlace = document.createElement('a');
    enlace.textContent = c.correo_contacto;
    enlace.href = `mailto:${encodeURIComponent(c.correo_contacto)}`;
    correo.append(etiqueta, enlace);
    tarjeta.append(correo);
  }
  if (c.estado === 'pendiente') {
    const acciones = document.createElement('div');
    acciones.className = 'material-acciones';
    const opciones = esVendedor
      ? [['aceptada','Aceptar compra'],['rechazada','Rechazar compra']]
      : [['cancelada','Cancelar solicitud']];
    for (const [respuesta, etiqueta] of opciones) {
      const boton = document.createElement('button');
      boton.type = 'button';
      boton.className = respuesta === 'aceptada' ? 'boton' : 'boton secundario';
      boton.textContent = etiqueta;
      boton.addEventListener('click', () => responderCompraMaterial(c.id_compra, respuesta, boton));
      acciones.append(boton);
    }
    tarjeta.append(acciones);
  }
  return tarjeta;
}

async function responderCompraMaterial(id, estado, boton) {
  const texto = estado === 'aceptada' ? '¿Aceptar esta solicitud de compra? El lote quedará agotado.' :
    estado === 'rechazada' ? '¿Rechazar esta solicitud?' : '¿Cancelar esta solicitud pendiente?';
  if (!window.confirm(texto)) return;
  const sesion = state.sessionEpoch;
  boton.disabled = true;
  acciones.mensajeMaterial('');
  try {
    const ruta = estado === 'cancelada' ? `cancelar` : 'responder';
    const respuesta = await api(`/api/materiales/compras/${encodeURIComponent(id)}/${ruta}`, {
      method: 'PATCH', body: estado === 'cancelada' ? '{}' : JSON.stringify({ estado })
    });
    if (sesion !== state.sessionEpoch) return;
    acciones.mensajeMaterial(respuesta.mensaje);
    await acciones.cargarMateriales();
  } catch (error) {
    if (sesion === state.sessionEpoch) acciones.mensajeMaterial(error.message, true);
    boton.disabled = false;
  }
}

export async function cargarComprasMateriales(turno, sesion) {
  const mias = $('lista-mis-compras');
  const recibidas = $('lista-ventas-recibidas');
  mias.textContent = 'Cargando compras…';
  recibidas.textContent = 'Cargando solicitudes recibidas…';
  try {
    const { compras, recibidas: ventas } = await api('/api/materiales/compras');
    if (turno !== state.materialesEpoch || sesion !== state.sessionEpoch || state.vistaMateriales !== 'compras') return;
    mias.replaceChildren();
    recibidas.replaceChildren();
    if (!compras.length) mias.textContent = 'No has solicitado compras todavía.';
    else for (const compra of compras) mias.append(tarjetaCompra(compra, false));
    if (!ventas.length) recibidas.textContent = 'Todavía no recibes solicitudes de compra.';
    else for (const compra of ventas) recibidas.append(tarjetaCompra(compra, true));
  } catch (error) {
    if (turno !== state.materialesEpoch || sesion !== state.sessionEpoch) return;
    mias.textContent = `No se pudieron cargar las compras: ${error.message}`;
    recibidas.textContent = '';
  }
}

