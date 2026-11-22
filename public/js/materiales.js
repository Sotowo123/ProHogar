import { state, registrarReinicioSesion } from './state.js';
import { $, api, mensaje } from './core.js';
import { abrirAcceso } from './cuenta.js';
import { solicitarCompraMaterial, cargarComprasMateriales, configurarAccionesCompras } from './compras.js';

//MATERIALES DE APROVECHAMIENTO

export function reiniciarMaterialesAlCambiarSesion() {
  state.vistaMateriales = 'disponibles';
  state.materialEditandoId = null;
  state.fotosMaterialEditado = [];
  state.materialesEnVista = [];
  $('form-material').hidden = true;
  $('form-material').reset();
  $('fotos-material-existentes').replaceChildren();
  $('fotos-material-existentes').hidden = true;
  $('lista-materiales').textContent = 'Abre Materiales para ver publicaciones disponibles.';
  $('mensaje-material').hidden = true;
  $('mensaje-material').textContent = '';
  $('buscar-material').value = '';
  $('filtro-categoria-material').value = 'todas';
  $('cantidad-materiales').textContent = '';
  $('panel-compras-materiales').hidden = true;
  $('lista-mis-compras').replaceChildren();
  $('lista-ventas-recibidas').replaceChildren();
  $('lista-materiales').hidden = false;
  $('cantidad-materiales').hidden = false;
  $('filtro-categoria-material').closest('.filtros-materiales').hidden = false;
  actualizarBotonesMateriales();
}

function mensajeMaterial(texto, error = false) {
  const ele = $('mensaje-material');
  ele.textContent = texto;
  ele.className = error ? 'estado error' : 'estado exito';
  ele.hidden = !texto;
}

function actualizarBotonesMateriales() {
  $('btn-listar-materiales').setAttribute('aria-pressed', String(state.vistaMateriales === 'disponibles'));
  $('btn-mis-materiales').setAttribute('aria-pressed', String(state.vistaMateriales === 'mios'));
  $('btn-compras-materiales').setAttribute('aria-pressed', String(state.vistaMateriales === 'compras'));
  const viendoCompras = state.vistaMateriales === 'compras';
  $('panel-compras-materiales').hidden = !viendoCompras;
  $('lista-materiales').hidden = viendoCompras;
  $('cantidad-materiales').hidden = viendoCompras;
  $('filtro-categoria-material').closest('.filtros-materiales').hidden = viendoCompras;
}

function cerrarFormMaterial() {
  state.materialEditandoId = null;
  state.fotosMaterialEditado = [];
  $('form-material').hidden = true;
  $('form-material').reset();
  $('fotos-material-existentes').replaceChildren();
  $('fotos-material-existentes').hidden = true;
  $('titulo-form-material').textContent = 'Publicar material';
  $('btn-guardar-material').textContent = 'Publicar';
}

function dibujarFotosEnEdicion() {
  const caja = $('fotos-material-existentes');
  caja.replaceChildren();
  caja.hidden = !state.materialEditandoId || !state.fotosMaterialEditado.length;
  if (caja.hidden) return;
  const titulo = document.createElement('p');
  titulo.className = 'nota';
  titulo.textContent = `Fotografías actuales (${state.fotosMaterialEditado.length}/3). Puedes eliminarlas para dejar espacio a otras.`;
  caja.append(titulo);
  const galeria = document.createElement('div');
  galeria.className = 'galeria-material';
  for (const foto of state.fotosMaterialEditado) {
    const celda = document.createElement('div');
    celda.className = 'foto-edicion-material';
    const img = document.createElement('img');
    img.src = foto.url;
    img.alt = 'Fotografía actual del material';
    img.loading = 'lazy';
    const boton = document.createElement('button');
    boton.type = 'button';
    boton.className = 'boton secundario';
    boton.textContent = 'Quitar foto';
    boton.addEventListener('click', async () => {
      const sesion = state.sessionEpoch;
      const idActual = state.materialEditandoId;
      if (!state.usuarioActual || !idActual) return;
      boton.disabled = true;
      try {
        await api(`/api/materiales/${idActual}/fotos/${foto.id_foto}`, { method: 'DELETE' });
        if (sesion !== state.sessionEpoch || idActual !== state.materialEditandoId) return;
        state.fotosMaterialEditado = state.fotosMaterialEditado.filter(f => Number(f.id_foto) !== Number(foto.id_foto));
        dibujarFotosEnEdicion();
        mensajeMaterial('Fotografía eliminada.');
        void cargarMateriales();
      } catch (error) {
        if (sesion === state.sessionEpoch) mensajeMaterial(error.message, true);
        boton.disabled = false;
      }
    });
    celda.append(img, boton);
    galeria.append(celda);
  }
  caja.append(galeria);
}

function abrirFormMaterial(material = null) {
  if (!state.usuarioActual) {
    abrirAcceso('ingresar');
    mensaje('Inicia sesión para publicar materiales.');
    return;
  }
  mensajeMaterial('');
  state.materialEditandoId = material ? Number(material.id_material) : null;
  state.fotosMaterialEditado = material?.fotos ? [...material.fotos] : [];
  dibujarFotosEnEdicion();
  const f = $('form-material');
  f.reset();
  $('titulo-form-material').textContent = material ? 'Editar publicación' : 'Publicar material';
  $('btn-guardar-material').textContent = material ? 'Guardar cambios' : 'Publicar';
  if (material) {
    f.elements.id_categoria_material.value = String(material.id_categoria_material);
    f.elements.nombre.value = material.nombre;
    f.elements.cantidad.value = material.cantidad;
    f.elements.unidad.value = material.unidad;
    f.elements.precio.value = material.precio;
  }
  f.hidden = false;
  f.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export async function cargarCategoriasMateriales() {
  try {
    const { categorias } = await api('/api/materiales/categorias');
    state.categoriasDeMateriales = categorias;
    for (const id of ['categoria-material-form', 'filtro-categoria-material']) {
      const select = $(id);
      const primero = select.querySelector('option').cloneNode(true);
      select.replaceChildren(primero);
      for (const cat of categorias) {
        const opt = document.createElement('option');
        opt.value = String(cat.id_categoria_material);
        opt.textContent = cat.nombre;
        select.append(opt);
      }
    }
    if (!categorias.length) mensajeMaterial('Primero ejecuta sql/03_categorias_materiales.sql en MySQL Workbench.', true);
  } catch (error) {
    mensajeMaterial(`No se pudieron cargar las categorías: ${error.message}`, true);
  }
}

function dibujarMateriales() {
  const lista = $('lista-materiales');
  const categoria = $('filtro-categoria-material').value;
  const texto = $('buscar-material').value.trim().toLocaleLowerCase('es');
  const filtrados = state.materialesEnVista.filter((m) =>
    (categoria === 'todas' || String(m.id_categoria_material) === categoria) &&
    (!texto || `${m.nombre} ${m.categoria} ${m.publicado_por}`.toLocaleLowerCase('es').includes(texto))
  );
  $('cantidad-materiales').textContent = `Mostrando ${filtrados.length} de ${state.materialesEnVista.length} publicación(es)`;
  lista.replaceChildren();
  if (!filtrados.length) {
    lista.textContent = 'No hay materiales que coincidan con tu búsqueda.';
    return;
  }
  for (const m of filtrados) {
    const tarjeta = document.createElement('article');
    tarjeta.className = 'tarjeta-material';
    const etiqueta = document.createElement('span');
    etiqueta.className = 'material-categoria';
    etiqueta.textContent = m.categoria;
    const titulo = document.createElement('h2');
    titulo.textContent = m.nombre;
    const cantidad = document.createElement('p');
    cantidad.className = 'material-cantidad';
    cantidad.textContent = `Cantidad: ${m.cantidad} ${m.unidad}`;
    const precio = document.createElement('p');
    precio.className = 'material-precio';
    const valor = Number(m.precio);
    precio.textContent = valor === 0 ? 'Gratis' : `${new Intl.NumberFormat('es-CL', { style:'currency', currency:'CLP', maximumFractionDigits: 0 }).format(valor)}`;
    const autor = document.createElement('p');
    autor.className = 'material-autor';
    autor.textContent = `Publicado por: ${m.publicado_por}`;
    const estado = document.createElement('span');
    const estadoValido = m.estado === 'agotado' ? 'agotado' : 'disponible';
    estado.className = `material-estado material-${estadoValido}`;
    estado.textContent = estadoValido === 'agotado' ? 'Agotado' : 'Disponible';
    tarjeta.append(etiqueta);
    if (Array.isArray(m.fotos) && m.fotos.length) {
      const galeria = document.createElement('div');
      galeria.className = 'galeria-material';
      for (const foto of m.fotos) {
        const enlace = document.createElement('a');
        enlace.href = foto.url;
        enlace.target = '_blank';
        enlace.rel = 'noopener noreferrer';
        enlace.setAttribute('aria-label', `Ver fotografía de ${m.nombre}`);
        const img = document.createElement('img');
        img.src = foto.url;
        img.alt = `Fotografía del material ${m.nombre}`;
        img.loading = 'lazy';
        enlace.append(img);
        galeria.append(enlace);
      }
      tarjeta.append(galeria);
    }
    tarjeta.append(titulo, cantidad, precio, autor, estado);
    // Permitir solamente solicitar compras de publicaciones de otros usuarios.
    if (state.vistaMateriales === 'disponibles' &&
        Number(m.id_usuario) !== Number(state.usuarioActual?.id_usuario) && m.estado === 'disponible') {
      const accionesCompra = document.createElement('div');
      accionesCompra.className = 'material-acciones';
      const botonComprar = document.createElement('button');
      botonComprar.type = 'button';
      botonComprar.className = 'boton';
      botonComprar.textContent = 'Comprar';
      botonComprar.addEventListener('click', () => solicitarCompraMaterial(m, botonComprar));
      accionesCompra.append(botonComprar);
      tarjeta.append(accionesCompra);
    }
    if (state.vistaMateriales === 'mios') {
      const acciones = document.createElement('div');
      acciones.className = 'material-acciones';
      const editar = document.createElement('button');
      editar.type = 'button';
      editar.className = 'boton secundario';
      editar.textContent = 'Editar';
      editar.addEventListener('click', () => abrirFormMaterial(m));
      const cambiar = document.createElement('button');
      cambiar.type = 'button';
      cambiar.className = 'boton';
      cambiar.textContent = m.estado === 'agotado' ? 'Volver a publicar' : 'Marcar agotado';
      cambiar.addEventListener('click', () => actualizarEstadoMaterial(m, cambiar));
      acciones.append(editar, cambiar);
      tarjeta.append(acciones);
    }
    lista.append(tarjeta);
  }
}

export async function cargarMateriales() {
  const turno = ++state.materialesEpoch;
  const sesion = state.sessionEpoch;
  const modo = state.vistaMateriales;
  const lista = $('lista-materiales');
  lista.textContent = 'Cargando materiales…';
  if (['mios','compras'].includes(modo) && !state.usuarioActual) {
    lista.textContent = 'Inicia sesión para ver tus publicaciones y compras.';
    return;
  }
  if (modo === 'compras') {
    void cargarComprasMateriales(turno, sesion);
    return;
  }
  try {
    const endpoint = modo === 'mios' ? '/api/materiales/mios' : '/api/materiales';
    const { materiales } = await api(endpoint);
    if (turno !== state.materialesEpoch || sesion !== state.sessionEpoch || modo !== state.vistaMateriales) return;
    state.materialesEnVista = materiales;
    dibujarMateriales();
  } catch (error) {
    if (turno !== state.materialesEpoch || sesion !== state.sessionEpoch) return;
    lista.textContent = `No se pudieron cargar materiales: ${error.message}`;
  }
}

async function actualizarEstadoMaterial(material, boton) {
  if (!state.usuarioActual) return;
  const turnoSesion = state.sessionEpoch;
  const estado = material.estado === 'agotado' ? 'disponible' : 'agotado';
  boton.disabled = true;
  try {
    await api(`/api/materiales/${encodeURIComponent(material.id_material)}/estado`, {
      method: 'PATCH', body: JSON.stringify({ estado })
    });
    if (turnoSesion !== state.sessionEpoch) return;
    mensajeMaterial(estado === 'agotado' ? 'Material marcado como agotado.' : 'Material disponible nuevamente.');
    await cargarMateriales();
  } catch (error) {
    if (turnoSesion !== state.sessionEpoch) return;
    mensajeMaterial(error.message, true);
    boton.disabled = false;
  }
}


// Controles de materiales
function cambiarValorMaterial(campo, direccion) {
  const esCantidad = campo === 'cantidad';
  const entrada = $('form-material').elements[campo];
  if (!entrada) return;
  const anterior = entrada.value === '' ? 0 : Number(entrada.value);
  if (!Number.isFinite(anterior)) return;
  const paso = esCantidad ? 1 : 1000;
  const minimo = esCantidad ? 0.01 : 0;
  const maximo = esCantidad ? 9999999999.99 : 9999999999;
  const siguiente = Math.max(minimo, Math.min(maximo, anterior + direccion * paso));
  entrada.value = esCantidad ? String(Math.round(siguiente * 100) / 100) : String(Math.round(siguiente));
  entrada.dispatchEvent(new Event('input', { bubbles: true }));
}
for (const boton of document.querySelectorAll('.paso-material')) {
  boton.addEventListener('click', () => cambiarValorMaterial(boton.dataset.campoNumero, Number(boton.dataset.direccion)));
}
for (const campo of ['cantidad', 'precio']) {
  $('form-material').elements[campo].addEventListener('keydown', (evento) => {
    if (evento.key !== 'ArrowUp' && evento.key !== 'ArrowDown') return;
    evento.preventDefault();
    cambiarValorMaterial(campo, evento.key === 'ArrowUp' ? 1 : -1);
  });
}

$('btn-listar-materiales').addEventListener('click', () => {
  state.vistaMateriales = 'disponibles';
  actualizarBotonesMateriales();
  cerrarFormMaterial();
  void cargarMateriales();
});
$('btn-mis-materiales').addEventListener('click', () => {
  if (!state.usuarioActual) {
    abrirAcceso('ingresar');
    mensaje('Inicia sesión para ver tus publicaciones.');
    return;
  }
  state.vistaMateriales = 'mios';
  actualizarBotonesMateriales();
  cerrarFormMaterial();
  void cargarMateriales();
});
$('btn-compras-materiales').addEventListener('click', () => {
  if (!state.usuarioActual) return abrirAcceso('ingresar');
  state.vistaMateriales = 'compras';
  actualizarBotonesMateriales();
  cerrarFormMaterial();
  void cargarMateriales();
});
$('btn-publicar-material').addEventListener('click', () => abrirFormMaterial());
$('btn-cancelar-material').addEventListener('click', cerrarFormMaterial);
$('filtro-categoria-material').addEventListener('change', dibujarMateriales);
$('buscar-material').addEventListener('input', dibujarMateriales);
$('form-material').addEventListener('submit', async (evento) => {
  evento.preventDefault();
  if (!state.usuarioActual) return abrirAcceso('ingresar');
  const f = evento.currentTarget; // Guardar la referencia antes de esperar al servidor.
  const boton = $('btn-guardar-material');
  const turnoSesion = state.sessionEpoch;
  const editandoId = state.materialEditandoId;
  const fotos = Array.from($('fotos-material').files || []);
  if (fotos.length + state.fotosMaterialEditado.length > 3) {
    mensajeMaterial('Puedes tener como máximo 3 fotografías por publicación. Quita alguna foto antes de añadir más.', true);
    return;
  }
  if (fotos.some(file => !['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 3 * 1024 * 1024)) {
    mensajeMaterial('Solo fotos JPG, PNG o WebP de 3 MB como máximo.', true);
    return;
  }
  const body = new FormData(f);
  boton.disabled = true;
  mensajeMaterial('');
  try {
    const ruta = editandoId ? `/api/materiales/${editandoId}` : '/api/materiales';
    const respuesta = await api(ruta, {
      method: editandoId ? 'PUT' : 'POST', body
    });
    if (turnoSesion !== state.sessionEpoch) return;
    cerrarFormMaterial();
    state.vistaMateriales = 'mios';
    actualizarBotonesMateriales();
    mensajeMaterial(respuesta.mensaje);
    await cargarMateriales();
  } catch (error) {
    if (turnoSesion !== state.sessionEpoch) return;
    mensajeMaterial(error.message, true);
  } finally {
    boton.disabled = false;
  }
});


// compartir funciones con compras.js
configurarAccionesCompras({ mensajeMaterial, cargarMateriales, cerrarFormMaterial, actualizarBotonesMateriales });
registrarReinicioSesion(reiniciarMaterialesAlCambiarSesion);
