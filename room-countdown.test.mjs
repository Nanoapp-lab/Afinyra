import assert from 'node:assert/strict';
import { roomCountdown } from './room-countdown.mjs';

const now = Date.parse('2026-11-25T12:00:00.000Z');
const future = ms => new Date(now + ms).toISOString();

assert.deepEqual(roomCountdown(future(2 * 3600_000 + 19_000), now), {
  seconds: 7219, text: '02:00:19', phase: 'normal'
}, 'Cronometro exibe horas, minutos e segundos');
assert.equal(roomCountdown(future(900_001), now).phase, 'normal', 'Mais de quinze minutos permanece normal');
assert.equal(roomCountdown(future(900_000), now).phase, 'warning', 'Alerta a quinze minutos');
assert.equal(roomCountdown(future(61_000), now).phase, 'warning');
assert.equal(roomCountdown(future(60_000), now).phase, 'final', 'Alerta mais forte a um minuto');
assert.equal(roomCountdown(future(999), now).text, '00:00:01', 'Arredondamento evita zerar antes do servidor');
assert.deepEqual(roomCountdown(future(-1), now), {
  seconds: 0, text: '00:00:00', phase: 'expired'
}, 'Prazo vencido para em zero');
assert.equal(roomCountdown(null, now), null, 'Global ou sala sem prazo nao mostra temporizador');

console.log('OK: temporizador e avisos de 15 min, 1 min e sala vencida.');
