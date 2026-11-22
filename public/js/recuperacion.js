import { state } from './state.js';
import { $, api, mensaje, borrarEnlaceRestablecimiento } from './core.js';
import { cambiarVista } from './navegacion.js';
import { abrirAcceso, mostrarSesion } from './cuenta.js';

function mostrarPantallaRecuperacion(tipo) {
  (tipo === 'solicitar' ? $('form-recuperacion') : $('form-restablecer')).reset();
  cambiarVista('cuenta');
  $('invitado').hidden = true;
  $('panel-usuario').hidden = true;
  $('form-recuperacion').hidden = tipo !== 'solicitar';
  $('form-restablecer').hidden = tipo !== 'restablecer';
  $('cuenta-titulo').textContent = tipo === 'solicitar' ? 'Recupera tu acceso' : 'Nueva contraseña';
  $('cuenta-subtitulo').textContent = 'Protegemos el acceso a tu cuenta ProHogar.';
  (tipo === 'solicitar' ? $('form-recuperacion') : $('form-restablecer'))
    .querySelector('input').focus({ preventScroll: true });
}
export function abrirEnlaceRestablecimiento() {
  const hash = window.location.hash;
  if (!hash.startsWith('#restablecer?')) return false;
  const params = new URLSearchParams(hash.slice('#restablecer?'.length));
  const token = params.get('token');
  if (!token || !/^[a-f0-9]{64}$/.test(token)) {
    borrarEnlaceRestablecimiento();
    abrirAcceso('ingresar');
    mensaje('El enlace de recuperación no es válido. Solicita otro.', true);
    return true;
  }
  state.tokenRestablecimiento = token;
  $('estado-restablecer').textContent = '';
  mostrarPantallaRecuperacion('restablecer');
  return true;
}
$('btn-olvido-password').addEventListener('click', () => {
  borrarEnlaceRestablecimiento();
  $('estado-recuperacion').textContent = '';
  mostrarPantallaRecuperacion('solicitar');
});
for (const boton of document.querySelectorAll('.btn-volver-ingreso')) {
  boton.addEventListener('click', () => abrirAcceso('ingresar'));
}
$('form-recuperacion').addEventListener('submit', async (evento) => {
  evento.preventDefault();
  const formulario = evento.currentTarget;
  const boton = formulario.querySelector('button[type="submit"]');
  boton.disabled = true;
  $('estado-recuperacion').textContent = '';
  try {
    const correo = formulario.elements.correo.value.trim();
    const respuesta = await api('/api/auth/recuperar-password', {
      method: 'POST', body: JSON.stringify({ correo })
    });
    $('estado-recuperacion').textContent = respuesta.mensaje;
  } catch (error) {
    $('estado-recuperacion').textContent = error.message;
  } finally {
    boton.disabled = false;
  }
});
$('form-restablecer').addEventListener('submit', async (evento) => {
  evento.preventDefault();
  const formulario = evento.currentTarget;
  const boton = formulario.querySelector('button[type="submit"]');
  const password = formulario.elements.password.value;
  const confirmar = formulario.elements.confirmar.value;
  if (password !== confirmar) {
    $('estado-restablecer').textContent = 'Las contraseñas no coinciden.';
    return;
  }
  if (!state.tokenRestablecimiento) {
    $('estado-restablecer').textContent = 'Enlace no válido. Solicita otro.';
    return;
  }
  boton.disabled = true;
  try {
    const resultado = await api('/api/auth/restablecer-password', {
      method: 'POST', body: JSON.stringify({ token: state.tokenRestablecimiento, password })
    });
    borrarEnlaceRestablecimiento();
    formulario.reset();
    mostrarSesion(null);
    abrirAcceso('ingresar');
    mensaje(resultado.mensaje);
  } catch (error) {
    $('estado-restablecer').textContent = error.message;
  } finally {
    boton.disabled = false;
  }
});
window.addEventListener('hashchange', abrirEnlaceRestablecimiento);
