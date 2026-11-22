export const state = {
  usuarioActual: null,
  perfilActual: null,
  sessionEpoch: 0,
  registrosEpoch: 0,
  materialesEpoch: 0,
  tokenRestablecimiento: null,
  categoriaElegida: null,
  servicioElegido: null,
  vistaMateriales: 'disponibles',
  materialEditandoId: null,
  materialesEnVista: [],
  categoriasDeMateriales: [],
  fotosMaterialEditado: [],
};

const reinicios = [];
export function registrarReinicioSesion(funcion) { reinicios.push(funcion); }
export function notificarCambioSesion() { for (const reiniciar of reinicios) reiniciar(); }
