// Envía SMS con la API REST de Twilio (sin SDK). Si no hay credenciales,
// imprime el mensaje en la consola para que puedas probar sin cuenta.

export async function sendSms(to, body) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;

  if (!sid || !token || !from || !to) {
    console.log(`\n[SMS simulado → ${to || 'sin número'}]\n${body}\n`);
    return { simulated: true };
  }

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ To: to, From: from, Body: body }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`[SMS] Error ${res.status} enviando a ${to}: ${text}`);
    return { ok: false, status: res.status };
  }
  return { ok: true };
}
