// Contagem visual. O horario de encerramento e imposto pelo Supabase;
// o navegador apenas apresenta o tempo restante, sem poder estender salas.
export function roomCountdown(expiresAt, nowMs = Date.now()) {
  const untilMs = Date.parse(expiresAt);
  if (!Number.isFinite(untilMs)) return null;
  const seconds = Math.max(0, Math.ceil((untilMs - nowMs) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  const pad = number => String(number).padStart(2, '0');
  return {
    seconds,
    text: `${pad(hours)}:${pad(minutes)}:${pad(remainingSeconds)}`,
    phase: seconds === 0 ? 'expired' : seconds <= 60 ? 'final' : seconds <= 900 ? 'warning' : 'normal'
  };
}
