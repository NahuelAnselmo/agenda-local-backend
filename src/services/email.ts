type StaffAccessEmailInput = {
  recipientEmail: string;
  staffName: string;
  businessName: string;
  temporaryPassword: string;
};

type ResendConfig = {
  apiKey: string;
  from: string;
};

export type EmailDeliveryStatus = "sent" | "not_configured" | "failed";

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function staffAccessEmail(input: StaffAccessEmailInput) {
  const frontendUrl = (process.env.FRONTEND_URL ?? "http://localhost:3000").replace(
    /\/$/,
    "",
  );
  const loginUrl = frontendUrl + "/admin";
  const subject = `Tu acceso a la agenda de ${input.businessName}`;
  const text = [
    `Hola ${input.staffName},`,
    "",
    `${input.businessName} creó tu acceso personal para gestionar tus servicios y turnos.`,
    `Ingresá en: ${loginUrl}`,
    `Email: ${input.recipientEmail}`,
    `Contraseña temporal: ${input.temporaryPassword}`,
    "",
    "Cuando ingreses, cambiá la contraseña desde la sección Mi cuenta.",
  ].join("\n");
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#17211d">
      <p>Hola ${escapeHtml(input.staffName)},</p>
      <h1 style="font-size:24px">Ya tenés acceso a tu agenda</h1>
      <p><strong>${escapeHtml(input.businessName)}</strong> creó tu perfil personal para gestionar tus servicios y turnos.</p>
      <div style="padding:18px;background:#f3f0e8;border-radius:8px">
        <p><strong>Email:</strong> ${escapeHtml(input.recipientEmail)}</p>
        <p><strong>Contraseña temporal:</strong> ${escapeHtml(input.temporaryPassword)}</p>
      </div>
      <p style="margin:24px 0">
        <a href="${escapeHtml(loginUrl)}" style="padding:12px 18px;background:#c56647;color:white;text-decoration:none;border-radius:5px">Ingresar a mi agenda</a>
      </p>
      <p>Cuando ingreses, cambiá la contraseña desde <strong>Mi cuenta</strong>.</p>
    </div>
  `;

  return { subject, text, html, loginUrl };
}

export async function deliverWithResend(
  input: StaffAccessEmailInput,
  config: ResendConfig,
  request: typeof fetch = fetch,
) {
  const content = staffAccessEmail(input);
  const response = await request("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      "User-Agent": "agenda-local-api/1.0",
    },
    body: JSON.stringify({
      from: config.from,
      to: [input.recipientEmail],
      subject: content.subject,
      text: content.text,
      html: content.html,
    }),
    signal: AbortSignal.timeout(8_000),
  });

  return response.ok;
}

export async function sendStaffAccessEmail(
  input: StaffAccessEmailInput,
): Promise<EmailDeliveryStatus> {
  if (process.env.NODE_ENV === "test") return "not_configured";

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) return "not_configured";

  try {
    const sent = await deliverWithResend(input, { apiKey, from });
    if (!sent) console.error("Resend rechazó el email de acceso");
    return sent ? "sent" : "failed";
  } catch (error) {
    console.error("No se pudo enviar el email de acceso:", error);
    return "failed";
  }
}
