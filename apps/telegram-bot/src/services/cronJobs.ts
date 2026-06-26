// src/services/cronJobs.ts
// Всі заплановані задачі (cron) для Telegram-бота.
//
// ВИПРАВЛЕННЯ #2 (паралельний запуск):
// Попередня версія не мала захисту від одночасного запуску кількох
// інстанцій бота (наприклад при PM2 cluster mode або при деплої з
// перекриттям процесів). Кожна інстанція запускала власний cron,
// і всі вони спрацьовували одночасно — власник отримував кілька
// однакових звітів.
//
// Рішення — isRunning lock-прапорець на рівні кожної задачі.
// Якщо попередній запуск ще не завершився — новий пропускається.
// Для повної гарантії при кількох процесах потрібен distributed lock
// (наприклад через PostgreSQL advisory locks або Redis), але для
// одного сервера in-process lock достатній.
//
// Додаткова рекомендація: запускайте бота у PM2 fork mode (не cluster):
//   pm2 start dist/index.js --name barbersaas-bot
// (без прапорця -i, який вмикає cluster mode з кількома worker-процесами)

import cron from "node-cron";
import type { Telegraf } from "telegraf";
import prisma from "../prisma";
import { sendMessage } from "../utils/telegram";
import {
  formatMoney,
  formatDate,
  formatSubscriptionDate,
  resolveServicePrice,
} from "../utils/format";
import { startOfDay, endOfDay, addDays } from "date-fns";

// ── In-process lock для захисту від паралельного запуску ─────────────────────

const locks = {
  dailyReport: false,
  subscriptionCheck: false,
};

function withLock(
  key: keyof typeof locks,
  fn: () => Promise<void>
): () => Promise<void> {
  return async () => {
    if (locks[key]) {
      console.warn(`[Cron] Задача "${key}" ще виконується — пропускаємо`);
      return;
    }
    locks[key] = true;
    try {
      await fn();
    } catch (err) {
      console.error(`[Cron] Помилка у задачі "${key}":`, err);
    } finally {
      locks[key] = false;
    }
  };
}

// ── 1. Щоденний фінансовий звіт (23:59) ──────────────────────────────────────

async function sendDailyReport(bot: Telegraf): Promise<void> {
  const owners = await prisma.user.findMany({
    where: {
      sasRole: "OWNER",
      subscriptionActive: true,
      telegramChatId: { not: null },
    },
    select: {
      id: true,
      name: true,
      telegramChatId: true,
      subscriptionExpiresAt: true,
    },
  });

  const now = new Date();
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);

  for (const owner of owners) {
    if (
      owner.subscriptionExpiresAt &&
      owner.subscriptionExpiresAt < now
    ) {
      continue;
    }

    const barbers = await prisma.user.findMany({
      where: { ownerId: owner.id, sasRole: "BARBER" },
      select: { id: true, name: true, commissionRate: true },
      orderBy: { name: "asc" },
    });

    if (barbers.length === 0) continue;

    let totalGross = 0;
    let totalPayouts = 0;
    let totalBookings = 0;
    let detailLines = "";

    for (const barber of barbers) {
      const completedToday = await prisma.booking.findMany({
        where: {
          userId: barber.id,
          isCompleted: true,
          OR: [
            { completedAt: { gte: todayStart, lte: todayEnd } },
            { completedAt: null, startTime: { gte: todayStart, lte: todayEnd } },
          ],
        },
        include: {
          eventType: { select: { servicePrice: true } },
          // ВИПРАВЛЕННЯ #6: fallback через metadata.completedServicePrice
        },
      });

      const barberGross = completedToday.reduce(
        (sum: number, b: { eventType?: { servicePrice: number } | null; metadata?: unknown }) => sum + resolveServicePrice(b),
        0
      );
      const barberPayout = Math.round(barberGross * barber.commissionRate);
      const commissionPercent = Math.round(barber.commissionRate * 100);
      const count = completedToday.length;

      totalGross += barberGross;
      totalPayouts += barberPayout;
      totalBookings += count;

      detailLines +=
        `\n✂️ <b>${barber.name ?? "Майстер"}</b>: ` +
        `${count} зап. | Каса: ${formatMoney(barberGross)} | ` +
        `Дохід (${commissionPercent}%): ${formatMoney(barberPayout)}`;
    }

    const ownerProfit = totalGross - totalPayouts;

    const reportText =
      `📊 <b>ФІНАНСОВИЙ ЗВІТ ЗА СЬОГОДНІ</b>\n` +
      `📅 ${formatDate(now)}\n\n` +
      `💰 Загальна каса (Брутто): <b>${formatMoney(totalGross)}</b>\n` +
      `✂️ Всього виконаних замовлень: <b>${totalBookings}</b>\n\n` +
      `👥 <b>Деталізація по майстрах:</b>` +
      detailLines +
      `\n\n─────────────────────────\n` +
      `👑 Твій чистий прибуток: <b>${formatMoney(ownerProfit)}</b>`;

    if (owner.telegramChatId) {
      await sendMessage(bot, owner.telegramChatId, reportText);
    }
  }
}

// ── 2. Попередження власнику за 3 дні до кінця підписки ──────────────────────

async function sendOwnerSubscriptionWarnings(bot: Telegraf): Promise<void> {
  const now = new Date();
  const in3days = addDays(now, 3);
  const warningFrom = startOfDay(in3days);
  const warningTo = endOfDay(in3days);

  const ownersExpiringSoon = await prisma.user.findMany({
    where: {
      sasRole: "OWNER",
      subscriptionActive: true,
      telegramChatId: { not: null },
      subscriptionExpiresAt: { gte: warningFrom, lte: warningTo },
    },
    select: {
      telegramChatId: true,
      name: true,
      subscriptionExpiresAt: true,
    },
  });

  for (const owner of ownersExpiringSoon) {
    if (!owner.telegramChatId || !owner.subscriptionExpiresAt) continue;

    await sendMessage(
      bot,
      owner.telegramChatId,
      `⚠️ <b>УВАГА!</b> Твоя підписка закінчується через <b>3 дні</b>.\n\n` +
      `📅 Дата закінчення: <b>${formatSubscriptionDate(owner.subscriptionExpiresAt)}</b>\n\n` +
      `Для продовження надішліть оплату адміністратору сервісу.\n` +
      `Після підтвердження оплати доступ буде продовжено на 28 днів.`
    );
  }
}

// ── 3. Автоблокування прострочених підписок ───────────────────────────────────

async function autoBlockExpiredSubscriptions(bot: Telegraf): Promise<void> {
  const superAdminId = process.env.SUPER_ADMIN_TELEGRAM_ID;
  const now = new Date();

  const expiredOwners = await prisma.user.findMany({
    where: {
      sasRole: "OWNER",
      subscriptionActive: true,
      subscriptionExpiresAt: { lt: now },
    },
    select: {
      id: true,
      name: true,
      email: true,
      telegramChatId: true,
      telegramUsername: true,
      subscriptionExpiresAt: true,
    },
  });

  if (expiredOwners.length === 0) return;

  await prisma.user.updateMany({
    where: { id: { in: expiredOwners.map(function(o) { return o.id; }) } },
    data: { subscriptionActive: false },
  });

  for (const owner of expiredOwners) {
    if (owner.telegramChatId) {
      await sendMessage(
        bot,
        owner.telegramChatId,
        `🔴 <b>Ваш заклад автоматично заблоковано.</b>\n\n` +
        `Термін підписки закінчився ${
          owner.subscriptionExpiresAt
            ? formatSubscriptionDate(owner.subscriptionExpiresAt)
            : "—"
        }.\n\n` +
        `Для відновлення доступу зверніться до адміністратора сервісу.`
      );
    }
  }

  if (superAdminId) {
    let blockedList = "";
    for (const owner of expiredOwners) {
      blockedList +=
        `\n• @${owner.telegramUsername ?? "—"} | ${owner.email}` +
        ` | до: ${
          owner.subscriptionExpiresAt
            ? formatSubscriptionDate(owner.subscriptionExpiresAt)
            : "—"
        }`;
    }

    await sendMessage(
      bot,
      superAdminId,
      `🔴 <b>АВТОБЛОКУВАННЯ</b>\n\n` +
      `Сьогодні автоматично заблоковано <b>${expiredOwners.length}</b> заклад(ів):` +
      blockedList
    );
  }
}

// ── 4. Пуш Супер-Адміну про заклади з 3 днями до кінця ──────────────────────

async function notifySuperAdminExpiringSoon(bot: Telegraf): Promise<void> {
  const superAdminId = process.env.SUPER_ADMIN_TELEGRAM_ID;
  if (!superAdminId) return;

  const now = new Date();
  const in3days = addDays(now, 3);
  const warningFrom = startOfDay(in3days);
  const warningTo = endOfDay(in3days);

  const ownersExpiringSoon = await prisma.user.findMany({
    where: {
      sasRole: "OWNER",
      subscriptionActive: true,
      subscriptionExpiresAt: { gte: warningFrom, lte: warningTo },
    },
    select: {
      name: true,
      email: true,
      telegramUsername: true,
      subscriptionExpiresAt: true,
    },
  });

  if (ownersExpiringSoon.length === 0) return;

  let list = "";
  for (const owner of ownersExpiringSoon) {
    list +=
      `\n• @${owner.telegramUsername ?? "—"} | ${owner.email}` +
      ` | до: ${
        owner.subscriptionExpiresAt
          ? formatSubscriptionDate(owner.subscriptionExpiresAt)
          : "—"
      }`;
  }

  await sendMessage(
    bot,
    superAdminId,
    `⚠️ <b>ПІДПИСКИ ЗАКІНЧУЮТЬСЯ ЧЕРЕЗ 3 ДНІ</b>\n\n` +
    `Закладів: <b>${ownersExpiringSoon.length}</b>` +
    list +
    `\n\nВикористайте /manage @username для продовження.`
  );
}

// ── Запуск cron-задач ─────────────────────────────────────────────────────────

export function startCronJobs(bot: Telegraf): void {
  const tz = process.env.TZ ?? "Asia/Tbilisi";

  // Щоденний звіт о 23:59 — з lock-захистом від дублювання
  cron.schedule(
    "59 23 * * *",
    withLock("dailyReport", async () => {
      console.log("[Cron] Надсилаємо щоденні звіти власникам...");
      await sendDailyReport(bot);
      console.log("[Cron] Щоденні звіти надіслано");
    }),
    { timezone: tz }
  );

  // Перевірка підписок о 10:00 — з lock-захистом від дублювання
  cron.schedule(
    "0 10 * * *",
    withLock("subscriptionCheck", async () => {
      console.log("[Cron] Перевірка підписок що закінчуються...");
      await sendOwnerSubscriptionWarnings(bot);
      await notifySuperAdminExpiringSoon(bot);
      await autoBlockExpiredSubscriptions(bot);
      console.log("[Cron] Перевірку підписок завершено");
    }),
    { timezone: tz }
  );

  console.log(`✅ Cron-задачі запущено (TZ: ${tz}) | lock-захист активний`);
}
