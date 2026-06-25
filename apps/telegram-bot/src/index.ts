// src/index.ts
// Точка входу Telegram-бота BarberSaaS — ФІНАЛЬНА ВЕРСІЯ (Частини 1 + 2)

import "dotenv/config";
import { Telegraf } from "telegraf";

// Частина 1 — BARBER
import { registerStartHandler } from "./handlers/start";
import { registerHelpHandler } from "./handlers/help";
import { registerBarberStatsHandler } from "./handlers/barber/stats";
import { registerBookingActionHandlers } from "./handlers/barber/bookingActions";

// Частина 2 — OWNER
import {
  registerOwnerReportHandler,
  registerOwnerDailyReportHandler,
} from "./handlers/owner/report";

// Частина 2 — SUPER_ADMIN
import {
  registerAdminManageHandler,
  registerAdminStatsHandler,
} from "./handlers/admin/manage";

// Сервіси
import { startWebhookServer } from "./services/webhookServer";
import { startCronJobs } from "./services/cronJobs";
import prisma from "./prisma";

// ── Перевірка обов'язкових змінних середовища ─────────────────────────────────

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SUPER_ADMIN_ID = process.env.SUPER_ADMIN_TELEGRAM_ID;

if (!BOT_TOKEN) {
  console.error("❌ TELEGRAM_BOT_TOKEN не вказано у .env");
  process.exit(1);
}

if (!SUPER_ADMIN_ID) {
  console.error("❌ SUPER_ADMIN_TELEGRAM_ID не вказано у .env");
  process.exit(1);
}

// ── Ініціалізація бота ────────────────────────────────────────────────────────

const bot = new Telegraf(BOT_TOKEN);

// ── Реєстрація всіх хендлерів ─────────────────────────────────────────────────

registerStartHandler(bot);
registerHelpHandler(bot);

registerBarberStatsHandler(bot);
registerBookingActionHandlers(bot);

registerOwnerReportHandler(bot);
registerOwnerDailyReportHandler(bot);

registerAdminManageHandler(bot);
registerAdminStatsHandler(bot);

// ── Глобальний обробник помилок ───────────────────────────────────────────────

bot.catch((err, ctx) => {
  console.error(`[Bot] Помилка для оновлення ${ctx.updateType}:`, err);
});

// ── Запуск ────────────────────────────────────────────────────────────────────

async function main() {
  // ВИПРАВЛЕННЯ #12: видаляємо Telegram Webhook перед запуском long-polling.
  // Якщо раніше хтось виставив setWebhook() — Telegram надсилатиме апдейти
  // на той URL, а не в наш long-polling. deleteWebhook() усуває конфлікт.
  // dropPendingUpdates: true — ігноруємо накопичені повідомлення під час простою,
  // щоб при рестарті бот не надсилав застарілі сповіщення.
  await bot.telegram.deleteWebhook({ drop_pending_updates: true });
  console.log("🔗 Webhook видалено, запускаємо long-polling...");

  // HTTP-сервер для отримання подій від Cal.diy (внутрішній, не Telegram)
  startWebhookServer(bot);

  // Cron-задачі
  startCronJobs(bot);

  // Telegram long-polling
  await bot.launch();
  console.log("✅ Telegram-бот BarberSaaS запущено (всі модулі активні)");

  // Graceful shutdown
  process.once("SIGINT", async () => {
    bot.stop("SIGINT");
    await prisma.$disconnect();
    console.log("👋 Бот зупинено (SIGINT)");
  });

  process.once("SIGTERM", async () => {
    bot.stop("SIGTERM");
    await prisma.$disconnect();
    console.log("👋 Бот зупинено (SIGTERM)");
  });
}

main().catch((err) => {
  console.error("❌ Критична помилка запуску бота:", err);
  process.exit(1);
});
