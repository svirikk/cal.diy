// src/handlers/barber/stats.ts
// Команда /stats для майстра (BARBER)
// — показує розклад на сьогодні
// — показує фінансову статистику за поточний місяць (виконані послуги × commissionRate)
//
// ВИПРАВЛЕННЯ #4:
// Стара версія фільтрувала виконані записи лише за completedAt:
//   completedAt: { gte: monthStart, lte: monthEnd }
// Проблема: якщо isCompleted виставлено вручну (наприклад через пряме оновлення БД)
// або completedAt не збережено з якоїсь причини — completedAt буде null,
// і такі записи не потрапляли у звіт попри isCompleted = true.
//
// Рішення: основний фільтр — startTime у межах місяця (час запису, не завершення).
// Додатково: якщо completedAt заповнений — беремо його для точності,
// але не виключаємо записи де completedAt = null але isCompleted = true.
// Реалізовано через OR: або completedAt у місяці, або (completedAt = null і startTime у місяці).

import type { Telegraf } from "telegraf";
import prisma from "../../prisma";
import {
  formatTime,
  formatDate,
  formatMoney,
  truncate,
  resolveServicePrice,
} from "../../utils/format";
import { startOfDay, endOfDay, startOfMonth, endOfMonth } from "date-fns";

export function registerBarberStatsHandler(bot: Telegraf): void {
  bot.command("stats", async (ctx) => {
    const chatId = String(ctx.from?.id);

    const barber = await prisma.user.findFirst({
      where: { telegramChatId: chatId, sasRole: "BARBER" },
      select: {
        id: true,
        name: true,
        commissionRate: true,
      },
    });

    if (!barber) {
      await ctx.replyWithHTML(
        `⛔ Команда /stats доступна лише для майстрів.\n` +
        `Якщо ви майстер — зверніться до адміністратора для прив'язки акаунту.`
      );
      return;
    }

    const now = new Date();
    const todayStart = startOfDay(now);
    const todayEnd = endOfDay(now);
    const monthStart = startOfMonth(now);
    const monthEnd = endOfMonth(now);

    // Записи на сьогодні (всі активні, не скасовані)
    const todayBookings = await prisma.booking.findMany({
      where: {
        userId: barber.id,
        startTime: { gte: todayStart, lte: todayEnd },
        // ВИПРАВЛЕННЯ #14: оригінальні назви enum-членів, не мапований рядок
        status: { notIn: ["CANCELLED", "REJECTED"] },
      },
      include: {
        attendees: { take: 1 },
        eventType: { select: { title: true, servicePrice: true } },
      },
      orderBy: { startTime: "asc" },
    });

    // ВИПРАВЛЕННЯ #4: виконані записи за місяць з fallback-фільтром.
    //
    // OR умова покриває два сценарії:
    //
    // Сценарій A (норма): майстер натиснув ✅ у Telegram → completedAt збережено.
    //   Фільтруємо за completedAt у межах місяця.
    //
    // Сценарій Б (edge case): isCompleted = true але completedAt = null
    //   (пряме оновлення БД, міграція старих даних, або баг при збереженні).
    //   Фільтруємо за startTime у межах місяця як надійний fallback.
    //
    // Обидва сценарії об'єднані через OR — жоден виконаний запис не губиться.
    const monthCompleted = await prisma.booking.findMany({
      where: {
        userId: barber.id,
        isCompleted: true,
        OR: [
          // Сценарій A: completedAt заповнений і у межах місяця
          {
            completedAt: {
              gte: monthStart,
              lte: monthEnd,
            },
          },
          // Сценарій Б: completedAt відсутній — орієнтуємось на час запису
          {
            completedAt: null,
            startTime: {
              gte: monthStart,
              lte: monthEnd,
            },
          },
        ],
      },
      include: {
        eventType: { select: { servicePrice: true } },
        // ВИПРАВЛЕННЯ #5: metadata містить completedServicePrice — fallback
        // якщо EventType від'єднаний або видалений після виконання послуги
      },
    });

    // Підраховуємо фінанси
    const monthGross = monthCompleted.reduce(
      (sum: number, b: { eventType?: { servicePrice: number } | null; metadata?: unknown }) => sum + resolveServicePrice(b),
      0
    );
    const monthEarnings = Math.round(monthGross * barber.commissionRate);
    const commissionPercent = Math.round(barber.commissionRate * 100);

    // ── Формуємо повідомлення ─────────────────────────────────────────────

    let text =
      `📊 <b>СТАТИСТИКА МАЙСТРА</b>\n` +
      `👤 ${barber.name ?? "Майстер"}\n` +
      `📅 ${formatDate(now)}\n\n`;

    // Розклад на сьогодні
    text += `✂️ <b>РОЗКЛАД НА СЬОГОДНІ</b>\n`;

    if (todayBookings.length === 0) {
      text += `<i>Записів на сьогодні немає</i>\n`;
    } else {
      for (const booking of todayBookings) {
        const clientName = booking.attendees[0]?.name ?? "Клієнт";
        const service = truncate(booking.eventType?.title, 30);
        const time = formatTime(booking.startTime);
        const status = booking.isCompleted ? "✅" : "🕐";

        text += `${status} <b>${time}</b> — ${clientName} | <i>${service}</i>\n`;
      }
    }

    // Фінансова статистика за місяць
    text +=
      `\n💰 <b>ФІНАНСИ ЗА МІСЯЦЬ</b>\n` +
      `✅ Виконано послуг: <b>${monthCompleted.length}</b>\n` +
      `💵 Загальна каса: <b>${formatMoney(monthGross)}</b>\n` +
      `🎯 Ваша ставка: <b>${commissionPercent}%</b>\n` +
      `💳 До отримання: <b>${formatMoney(monthEarnings)}</b>`;

    await ctx.replyWithHTML(text);
  });
}
