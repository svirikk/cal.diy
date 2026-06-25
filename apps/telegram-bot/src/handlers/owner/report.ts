// src/handlers/owner/report.ts
// Команда /report для власника (OWNER)
// — показує inline-кнопки вибору періоду: 2 тижні або місяць
// — після вибору формує детальну відомість ДО ВИПЛАТИ по кожному майстру

import type { Telegraf } from "telegraf";
import { Markup } from "telegraf";
import prisma from "../../prisma";
import {
  formatMoney,
  formatDate,
  formatSubscriptionDate,
  resolveServicePrice,
} from "../../utils/format";
import { editMessage } from "../../utils/telegram";
import { subDays, startOfDay, endOfDay } from "date-fns";

// ── Допоміжна функція: формує фінансовий звіт за діапазон дат ────────────────

async function buildFinancialReport(
  ownerId: number,
  dateFrom: Date,
  dateTo: Date,
  periodLabel: string
): Promise<string> {
  // Знаходимо всіх майстрів власника
  const barbers = await prisma.user.findMany({
    where: {
      ownerId,
      sasRole: "BARBER",
    },
    select: {
      id: true,
      name: true,
      commissionRate: true,
    },
    orderBy: { name: "asc" },
  });

  if (barbers.length === 0) {
    return `📊 <b>ФІНАНСОВИЙ ЗВІТ — ${periodLabel}</b>\n\n<i>Майстрів у закладі ще немає.</i>`;
  }

  let totalGross = 0;
  let totalPayouts = 0;
  let totalBookings = 0;
  let detailLines = "";

  for (const barber of barbers) {
    // Виконані записи майстра за вказаний період
    // ВИПРАВЛЕННЯ #4: OR-фільтр — не губимо записи де completedAt = null
    const completedBookings = await prisma.booking.findMany({
      where: {
        userId: barber.id,
        isCompleted: true,
        OR: [
          {
            completedAt: {
              gte: startOfDay(dateFrom),
              lte: endOfDay(dateTo),
            },
          },
          {
            completedAt: null,
            startTime: {
              gte: startOfDay(dateFrom),
              lte: endOfDay(dateTo),
            },
          },
        ],
      },
      include: {
        eventType: { select: { servicePrice: true } },
        // ВИПРАВЛЕННЯ #6: fallback через metadata.completedServicePrice
      },
    });

    const barberGross = completedBookings.reduce(
      (sum, b) => sum + resolveServicePrice(b),
      0
    );
    const barberPayout = Math.round(barberGross * barber.commissionRate);
    const commissionPercent = Math.round(barber.commissionRate * 100);
    const count = completedBookings.length;

    totalGross += barberGross;
    totalPayouts += barberPayout;
    totalBookings += count;

    detailLines +=
      `\n👤 <b>${barber.name ?? "Майстер"}</b>\n` +
      `   ✂️ Виконано: <b>${count}</b> | Каса: <b>${formatMoney(barberGross)}</b>\n` +
      `   💳 До виплати (${commissionPercent}%): <b>${formatMoney(barberPayout)}</b>\n`;
  }

  const ownerProfit = totalGross - totalPayouts;

  return (
    `📊 <b>ФІНАНСОВИЙ ЗВІТ — ${periodLabel}</b>\n` +
    `📅 <b>${formatDate(dateFrom)} — ${formatDate(dateTo)}</b>\n\n` +
    `💰 Загальна каса: <b>${formatMoney(totalGross)}</b>\n` +
    `✂️ Всього виконано: <b>${totalBookings}</b> послуг\n\n` +
    `👥 <b>ДЕТАЛІЗАЦІЯ ПО МАЙСТРАХ:</b>` +
    detailLines +
    `\n─────────────────────────\n` +
    `📤 Виплати майстрам: <b>${formatMoney(totalPayouts)}</b>\n` +
    `👑 <b>Ваш чистий прибуток: ${formatMoney(ownerProfit)}</b>`
  );
}

// ── Реєстрація хендлерів ──────────────────────────────────────────────────────

export function registerOwnerReportHandler(bot: Telegraf): void {
  // Команда /report — показує кнопки вибору періоду
  bot.command("report", async (ctx) => {
    const chatId = String(ctx.from?.id);

    const owner = await prisma.user.findFirst({
      where: { telegramChatId: chatId, sasRole: "OWNER" },
      select: { id: true },
    });

    if (!owner) {
      await ctx.replyWithHTML(
        `⛔ Команда /report доступна лише для власників закладів.\n` +
        `Якщо ви власник — зверніться до адміністратора для прив'язки акаунту.`
      );
      return;
    }

    await ctx.replyWithHTML(
      `📊 Оберіть період для фінансового звіту по зарплатах:`,
      Markup.inlineKeyboard([
        [
          Markup.button.callback("📅 За 2 тижні", `report_period:14:${owner.id}`),
          Markup.button.callback("📅 За місяць", `report_period:30:${owner.id}`),
        ],
      ])
    );
  });

  // Callback-хендлер після вибору періоду
  bot.action(/^report_period:(\d+):(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();

    const days = parseInt(ctx.match[1], 10);
    const ownerId = parseInt(ctx.match[2], 10);
    const chatId = String(ctx.from?.id);

    // Перевіряємо що натиснув саме цей власник
    const owner = await prisma.user.findFirst({
      where: { id: ownerId, telegramChatId: chatId, sasRole: "OWNER" },
    });

    if (!owner) {
      await ctx.answerCbQuery("⛔ Доступ заборонено");
      return;
    }

    const dateTo = new Date();
    const dateFrom = subDays(dateTo, days);
    const periodLabel = days === 14 ? "2 ТИЖНІ" : "МІСЯЦЬ";

    const reportText = await buildFinancialReport(
      ownerId,
      dateFrom,
      dateTo,
      periodLabel
    );

    const msgId = ctx.callbackQuery.message?.message_id;
    if (msgId) {
      await editMessage(bot, chatId, msgId, reportText);
    } else {
      await ctx.replyWithHTML(reportText);
    }
  });
}

// ── /daily_report — ручний виклик щоденного звіту ────────────────────────────
// ВИПРАВЛЕННЯ #7: ТЗ вказує /daily_report як команду, яку власник може
// викликати вручну (а не лише отримувати автоматично о 23:59 через cron).
// Команда формує той самий звіт що і cron, але за поточний день на вимогу.

export function registerOwnerDailyReportHandler(bot: Telegraf): void {
  bot.command("daily_report", async (ctx) => {
    const chatId = String(ctx.from?.id);

    const owner = await prisma.user.findFirst({
      where: { telegramChatId: chatId, sasRole: "OWNER" },
      select: { id: true },
    });

    if (!owner) {
      await ctx.replyWithHTML(
        `⛔ Команда /daily_report доступна лише для власників закладів.`
      );
      return;
    }

    const now = new Date();
    // Звіт за сьогоднішній день: від 00:00 до поточного моменту
    const todayStart = startOfDay(now);

    const reportText = await buildFinancialReport(
      owner.id,
      todayStart,
      now,
      "СЬОГОДНІ"
    );

    await ctx.replyWithHTML(reportText);
  });
}

// Експортуємо buildFinancialReport для використання у щоденному cron
export { buildFinancialReport };
