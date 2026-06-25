// src/services/webhookServer.ts
// Мінімальний HTTP-сервер всередині Telegram-бота.
// Приймає POST /webhook від apps/web/pages/api/webhooks/booking-telegram.ts
// та запускає відповідну логіку сповіщень.
//
// ВИПРАВЛЕННЯ #10: додано верифікацію секрету WEBHOOK_INTERNAL_SECRET.
// Без верифікації будь-хто, хто знає порт, міг надіслати фейковий запис.
// Секрет передається у заголовку x-internal-secret — збігається з тим,
// що встановлено у .env і у apps/web як BOT_INTERNAL_SECRET.

import http from "http";
import type { Telegraf } from "telegraf";
import {
  notifyNewBooking,
  notifyCancelledBooking,
  type BookingWebhookPayload,
} from "./bookingNotifier";

const WEBHOOK_PORT = parseInt(process.env.BOT_WEBHOOK_PORT ?? "3001", 10);

// Секрет для верифікації що запит прийшов від apps/web, а не ззовні
const INTERNAL_SECRET = process.env.BOT_INTERNAL_SECRET ?? "";

export function startWebhookServer(bot: Telegraf): void {
  const server = http.createServer(async (req, res) => {
    // Приймаємо лише POST /webhook
    if (req.method !== "POST" || req.url !== "/webhook") {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    // ВИПРАВЛЕННЯ #10: перевіряємо секрет якщо він налаштований
    if (INTERNAL_SECRET) {
      const incoming = req.headers["x-internal-secret"];
      if (incoming !== INTERNAL_SECRET) {
        console.warn("[WebhookServer] Невірний секрет — запит відхилено");
        res.writeHead(401);
        res.end("Unauthorized");
        return;
      }
    }

    // Обмежуємо розмір тіла запиту — не більше 1MB
    let body = "";
    let bodySize = 0;
    const MAX_BODY_SIZE = 1_000_000;

    req.on("data", (chunk: Buffer) => {
      bodySize += chunk.length;
      if (bodySize > MAX_BODY_SIZE) {
        res.writeHead(413);
        res.end("Payload Too Large");
        req.destroy();
        return;
      }
      body += chunk.toString();
    });

    req.on("end", async () => {
      try {
        const payload = JSON.parse(body) as BookingWebhookPayload;

        if (payload.triggerEvent === "BOOKING_CREATED") {
          await notifyNewBooking(bot, payload.payload);
        } else if (payload.triggerEvent === "BOOKING_CANCELLED") {
          await notifyCancelledBooking(bot, payload.payload);
        }
        // BOOKING_RESCHEDULED: надсилаємо як скасування + створення
        else if (payload.triggerEvent === "BOOKING_RESCHEDULED") {
          await notifyCancelledBooking(bot, payload.payload);
          await notifyNewBooking(bot, payload.payload);
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        console.error("[WebhookServer] Помилка обробки:", err);
        res.writeHead(400);
        res.end("Bad request");
      }
    });
  });

  server.listen(WEBHOOK_PORT, "127.0.0.1", () => {
    // ВИПРАВЛЕННЯ #10: слухаємо лише на localhost (127.0.0.1), не на 0.0.0.0
    // Це додатковий захист — порт недоступний ззовні навіть без firewall
    console.log(
      `[WebhookServer] Слухає на 127.0.0.1:${WEBHOOK_PORT} (POST /webhook)`
    );
  });
}
