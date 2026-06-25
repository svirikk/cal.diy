// apps/web/pages/api/webhooks/booking-telegram.ts
// Webhook-ендпоінт для Cal.diy.
// Cal.diy надсилає POST-запит на цей URL при кожному новому/скасованому записі.
//
// НАЛАШТУВАННЯ В CAL.DIY:
// Налаштування → Webhooks → Додати webhook
// URL: https://your-domain.com/api/webhooks/booking-telegram
// Події: BOOKING_CREATED, BOOKING_CANCELLED, BOOKING_RESCHEDULED
//
// ВИПРАВЛЕННЯ #5:
// Імпорт типу тепер з локального файлу apps/web/types/booking-webhook.ts
// замість відносного шляху до telegram-bot/src/... який ламався між пакетами.

import type { NextApiRequest, NextApiResponse } from "next";
import type { BookingWebhookPayload } from "../../../types/booking-webhook";

const WEBHOOK_SECRET = process.env.CALDIY_WEBHOOK_SECRET ?? "";
const BOT_INTERNAL_URL = process.env.BOT_INTERNAL_WEBHOOK_URL ?? "";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Верифікація секрету від Cal.diy (якщо налаштовано)
  if (WEBHOOK_SECRET) {
    const signature =
      req.headers["x-cal-signature-256"] ??
      req.headers["x-webhook-secret"];

    if (signature !== WEBHOOK_SECRET) {
      return res.status(401).json({ error: "Unauthorized" });
    }
  }

  const body = req.body as BookingWebhookPayload;

  if (!body?.triggerEvent || !body?.payload) {
    return res.status(400).json({ error: "Invalid payload" });
  }

  // Логуємо для дебагу (можна прибрати у продакшні)
  console.log(
    `[webhook/booking-telegram] triggerEvent=${body.triggerEvent}`,
    `uid=${body.payload.uid}`
  );

  try {
    if (!BOT_INTERNAL_URL) {
      console.warn(
        "[webhook/booking-telegram] BOT_INTERNAL_WEBHOOK_URL не вказано — " +
        "подія отримана але не передана боту."
      );
      return res.status(200).json({ ok: true, forwarded: false });
    }

    // ВИПРАВЛЕННЯ #10: передаємо секрет у заголовку для верифікації у боті
    const internalSecret = process.env.BOT_INTERNAL_SECRET ?? "";
    await fetch(`${BOT_INTERNAL_URL}/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(internalSecret ? { "x-internal-secret": internalSecret } : {}),
      },
      body: JSON.stringify(body),
    });

    return res.status(200).json({ ok: true, forwarded: true });
  } catch (err) {
    console.error("[webhook/booking-telegram] Помилка передачі боту:", err);
    // Повертаємо 200 щоб Cal.diy не ретраїв нескінченно
    return res.status(200).json({ ok: true, forwarded: false, error: String(err) });
  }
}
