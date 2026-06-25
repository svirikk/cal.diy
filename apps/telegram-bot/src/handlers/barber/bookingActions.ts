// src/handlers/barber/bookingActions.ts
// Обробник inline-кнопок ✅ Виконано та ❌ Скасувати
// які з'являються у майстра після нового запису

import type { Telegraf } from "telegraf";
import { Markup } from "telegraf";
import prisma from "../../prisma";
import { editMessage } from "../../utils/telegram";
import { formatBookingDateTime } from "../../utils/format";

export function registerBookingActionHandlers(bot: Telegraf): void {

  // ── ✅ Виконано ────────────────────────────────────────────────────────────
  bot.action(/^booking_complete:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();

    const bookingId = parseInt(ctx.match[1], 10);
    const chatId = String(ctx.from?.id);

    // Перевіряємо, що майстер є власником цього запису
    const barber = await prisma.user.findFirst({
      where: { telegramChatId: chatId, sasRole: "BARBER" },
      select: { id: true, name: true, commissionRate: true },
    });

    if (!barber) {
      await ctx.answerCbQuery("⛔ Доступ заборонено");
      return;
    }

    const booking = await prisma.booking.findFirst({
      where: { id: bookingId, userId: barber.id },
      include: {
        attendees: { take: 1 },
        eventType: { select: { title: true, servicePrice: true } },
      },
    });

    if (!booking) {
      await ctx.answerCbQuery("❌ Запис не знайдено");
      return;
    }

    if (booking.isCompleted) {
      await ctx.answerCbQuery("ℹ️ Вже позначено як виконано");
      return;
    }

    // Позначаємо як виконано.
    // ВИПРАВЛЕННЯ #5/#6: денормалізуємо servicePrice у Booking.metadata —
    // якщо пізніше EventType буде видалено або від'єднано від запису,
    // звіти все одно матимуть правильну суму з metadata.completedServicePrice.
    const servicePrice = booking.eventType?.servicePrice ?? 0;

    await prisma.booking.update({
      where: { id: bookingId },
      data: {
        isCompleted: true,
        completedAt: new Date(),
        // Зберігаємо ціну на момент виконання — незмінна копія для звітів
        metadata: {
          ...(typeof booking.metadata === "object" && booking.metadata !== null
            ? (booking.metadata as Record<string, unknown>)
            : {}),
          completedServicePrice: servicePrice,
        },
      },
    });
    const earnings = Math.round(servicePrice * barber.commissionRate);
    const commissionPercent = Math.round(barber.commissionRate * 100);
    const clientName = booking.attendees[0]?.name ?? "Клієнт";
    const serviceName = booking.eventType?.title ?? "Послуга";

    // Редагуємо повідомлення — прибираємо кнопки, додаємо позначку
    const updatedText =
      `✅ <b>ВИКОНАНО</b>\n\n` +
      `👤 Клієнт: <b>${clientName}</b>\n` +
      `✂️ Послуга: <b>${serviceName}</b>\n` +
      `📅 Дата/Час: <b>${formatBookingDateTime(booking.startTime)}</b>\n\n` +
      `💰 Вартість послуги: <b>${servicePrice} грн</b>\n` +
      `🎯 Ваш заробіток (${commissionPercent}%): <b>${earnings} грн</b>`;

    const msgId = ctx.callbackQuery.message?.message_id;
    if (msgId) {
      await editMessage(bot, chatId, msgId, updatedText);
    } else {
      await ctx.replyWithHTML(updatedText);
    }
  });

  // ── ❌ Скасувати ───────────────────────────────────────────────────────────
  bot.action(/^booking_cancel:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();

    const bookingId = parseInt(ctx.match[1], 10);
    const chatId = String(ctx.from?.id);

    const barber = await prisma.user.findFirst({
      where: { telegramChatId: chatId, sasRole: "BARBER" },
      select: { id: true },
    });

    if (!barber) {
      await ctx.answerCbQuery("⛔ Доступ заборонено");
      return;
    }

    const booking = await prisma.booking.findFirst({
      where: { id: bookingId, userId: barber.id },
      include: {
        attendees: { take: 1 },
        eventType: { select: { title: true } },
      },
    });

    if (!booking) {
      await ctx.answerCbQuery("❌ Запис не знайдено");
      return;
    }

    // Просимо підтвердження
    const clientName = booking.attendees[0]?.name ?? "Клієнт";
    const msgId = ctx.callbackQuery.message?.message_id;

    const confirmText =
      `⚠️ <b>Підтвердження скасування</b>\n\n` +
      `Клієнт: <b>${clientName}</b>\n` +
      `Час: <b>${formatBookingDateTime(booking.startTime)}</b>\n\n` +
      `Ви впевнені, що хочете скасувати цей запис?`;

    const confirmKeyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback("✅ Так, скасувати", `booking_cancel_confirm:${bookingId}`),
        Markup.button.callback("↩️ Назад", `booking_cancel_back:${bookingId}`),
      ],
    ]).reply_markup;

    if (msgId) {
      await editMessage(bot, chatId, msgId, confirmText, confirmKeyboard);
    } else {
      await ctx.replyWithHTML(confirmText, { reply_markup: confirmKeyboard });
    }
  });

  // ── Підтвердження скасування ───────────────────────────────────────────────
  bot.action(/^booking_cancel_confirm:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();

    const bookingId = parseInt(ctx.match[1], 10);
    const chatId = String(ctx.from?.id);

    // ВИПРАВЛЕННЯ #14: Prisma Client TypeScript API використовує оригінальні
    // назви enum-членів ("CANCELLED"), а не значення з @map("cancelled"),
    // яке впливає лише на те, як значення зберігається у стовпці БД.
    await prisma.booking.update({
      where: { id: bookingId },
      data: { status: "CANCELLED" },
    });

    const msgId = ctx.callbackQuery.message?.message_id;
    if (msgId) {
      await editMessage(
        bot,
        chatId,
        msgId,
        `🚫 <b>Запис скасовано майстром</b>\n\nID запису: <code>${bookingId}</code>`
      );
    }
  });

  // ── Скасування → назад (відновлюємо оригінальні кнопки) ───────────────────
  bot.action(/^booking_cancel_back:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();

    const bookingId = parseInt(ctx.match[1], 10);
    const chatId = String(ctx.from?.id);

    const booking = await prisma.booking.findFirst({
      where: { id: bookingId },
      include: {
        attendees: { take: 1 },
        eventType: { select: { title: true } },
      },
    });

    if (!booking) return;

    const clientName = booking.attendees[0]?.name ?? "Клієнт";
    const serviceName = booking.eventType?.title ?? "Послуга";

    const restoredText =
      `🔥 <b>НОВИЙ ЗАПИС НА СТРИЖКУ</b>\n\n` +
      `👤 Клієнт: <b>${clientName}</b>\n` +
      `✂️ Послуга: <b>${serviceName}</b>\n` +
      `📅 Дата/Час: <b>${formatBookingDateTime(booking.startTime)}</b>`;

    const restoredKeyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback("✅ Виконано", `booking_complete:${bookingId}`),
        Markup.button.callback("❌ Скасувати", `booking_cancel:${bookingId}`),
      ],
    ]).reply_markup;

    const msgId = ctx.callbackQuery.message?.message_id;
    if (msgId) {
      await editMessage(bot, chatId, msgId, restoredText, restoredKeyboard);
    }
  });
}
