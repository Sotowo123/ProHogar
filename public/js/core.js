import { state } from './state.js';

export const $ = (id) => document.getElementById(id);

export async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    // configuracion de contenido a travez de FormData para adjuntar fotos
    headers: options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Error HTTP ${response.status}`);
  return data;
}

export function mensaje(texto, error = false) {
  $('estado').textContent = texto;
  $('estado').className = error ? 'estado error' : 'estado exito';
  $('estado').hidden = !texto;
}

export function borrarEnlaceRestablecimiento() {
  state.tokenRestablecimiento = null;
  if (window.location.hash.startsWith('#restablecer?')) {
    history.replaceState(null, '', window.location.pathname + window.location.search);
  }
}
