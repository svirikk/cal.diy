// src/services/bookingNotifier.ts
// Сервіс надсилання Telegram-сповіщень про нові та скасовані записи.
//
// ПІДКЛЮЧЕННЯ ДО CAL.DIY:
// Cal.diy підтримує Webhooks (налаштування → Webhooks → додати URL).
// Потрібно додати webhook-ендпоінт у apps/web/pages/api/webhooks/booking-telegram.ts
// і вказати URL в адмінці Cal.diy.
//
// ВИПРАВЛЕННЯ:
// #1 — include для self-relation використовує правильне ім'я поля `sasOwner`
//      (Prisma генерує include за іменем поля у моделі, не за назвою relation)
// #2 — пошук майстра тепер за `organizer.email`, а не `organizer.id`,
//      бо Cal.diy webhook може передавати Profile.id або інший внутрішній ID,
//      тоді як email завжди унікально ідентифікує User у таблиці users.

import type { Telegraf } from "telegraf";
import { Markup } from "telegraf";
import prisma from "../prisma";
import { sendMessage } from "../utils/telegram";
import { formatBookingDateTime, truncate } from "../utils/format";

// ── Типи даних з Cal.diy webhook payload ─────────────────────────────────────

export interface BookingWebhookPayload {
  triggerEvent:
    | "BOOKING_CREATED"
    | "BOOKING_CANCELLED"
    | "BOOKING_RESCHEDULED";
  payload: {
    bookingId?: number;
    uid: string;
    title: string;
    startTime: string;
    endTime: string;
    organizer: {
      id: number;       // НЕ використовуємо для пошуку — може бути Profile.id
      name: string;
      email: string;    // Використовуємо email як надійний ідентифікатор
      username?: string;
    };
    attendees: Array<{
      name: string;
      email: string;
      phoneNumber?: string;
    }>;
    eventType?: {
      id: number;
      title: string;
      slug: string;
    };
  };
}

// ── Сповіщення про НОВИЙ ЗАПИС ────────────────────────────────────────────────

export async function notifyNewBooking(
  bot: Telegraf,
  payload: BookingWebhookPayload["payload"]
): Promise<void> {
  // ВИПРАВЛЕННЯ #2: шукаємо майстра за email організатора, не за id.
  // email завжди унікальний у таблиці users (@@unique([email])),
  // тоді як organizer.id у webhook може відповідати Profile.id або іншому
  // внутрішньому ідентифікатору Cal.diy, а не User.id.
  const barber = await prisma.user.findFirst({
    where: {
      email: payload.organizer.email,
      sasRole: "BARBER",
    },
    select: {
      id: true,
      name: true,
      telegramChatId: true,
      ownerId: true,
      // ВИПРАВЛЕННЯ #1: `sasOwner` — це точне ім'я поля у model User
      // (`sasOwner User? @relation("BarberOwner", ...)`).
      // Prisma Client генерує include/select саме за іменем поля, а не за
      // назвою relation у лапках. Переконайтесь що після `prisma generate`
      // поле називається саме `sasOwner` — відповідно до schema.prisma.
      sasOwner: {
        select: {
          id: true,
          telegramChatId: true,
          subscriptionActive: true,
          subscriptionExpiresAt: true,
        },
      },
    },
  });

  if (!barber) {
    console.warn(
      `[bookingNotifier] Майстра з email "${payload.organizer.email}" ` +
      `та роллю BARBER не знайдено. Перевірте що sasRole виставлено коректно.`
    );
    return;
  }

  // Отримуємо числовий ID запису в БД для прив'язки до inline-кнопок
  let bookingDbId: number | null = null;
  if (payload.bookingId) {
    bookingDbId = payload.bookingId;
  } else {
    const booking = await prisma.booking.findUnique({
      where: { uid: payload.uid },
      select: { id: true },
    });
    bookingDbId = booking?.id ?? null;
  }

  const client = payload.attendees[0];
  const clientName = client?.name ?? "Клієнт";
  const clientPhone = client?.phoneNumber ?? "—";
  const serviceName = truncate(payload.eventType?.title ?? payload.title, 40);
  const startTime = new Date(payload.startTime);

  const messageText =
    `🔥 <b>НОВИЙ ЗАПИС НА СТРИЖКУ</b>\n\n` +
    `👤 Клієнт: <b>${clientName}</b>\n` +
    `📞 Телефон: <b>${clientPhone}</b>\n` +
    `✂️ Послуга: <b>${serviceName}</b>\n` +
    `📅 Дата/Час: <b>${formatBookingDateTime(startTime)}</b>`;

  // Inline-кнопки для майстра (тільки якщо знайшли ID запису в БД)
  const keyboard =
    bookingDbId !== null
      ? Markup.inlineKeyboard([
          [
            Markup.button.callback(
              "✅ Виконано",
              `booking_complete:${bookingDbId}`
            ),
            Markup.button.callback(
              "❌ Скасувати",
              `booking_cancel:${bookingDbId}`
            ),
          ],
        ]).reply_markup
      : undefined;

  // Надсилаємо майстру
  if (barber.telegramChatId) {
    await sendMessage(bot, barber.telegramChatId, messageText, keyboard);
  }

  // Надсилаємо власнику — копія без кнопок
  // sasOwner буде null якщо майстер не прив'язаний до OWNER
  if (barber.sasOwner?.telegramChatId) {
    const owner = barber.sasOwner;
    const now = new Date();
    const ownerActive =
      owner.subscriptionActive &&
      (owner.subscriptionExpiresAt === null ||
        owner.subscriptionExpiresAt > now);

    if (ownerActive) {
      await sendMessage(
        bot,
        owner.telegramChatId,
        `📋 <b>НОВИЙ ЗАПИС У ВАШОМУ ЗАКЛАДІ</b>\n\n` +
          `✂️ Майстер: <b>${barber.name ?? "Майстер"}</b>\n` +
          `👤 Клієнт: <b>${clientName}</b>\n` +
          `📞 Телефон: <b>${clientPhone}</b>\n` +
          `🛎 Послуга: <b>${serviceName}</b>\n` +
          `📅 Дата/Час: <b>${formatBookingDateTime(startTime)}</b>`
      );
    }
  }
}

// ── Сповіщення про СКАСОВАНИЙ ЗАПИС ──────────────────────────────────────────

export async function notifyCancelledBooking(
  bot: Telegraf,
  payload: BookingWebhookPayload["payload"]
): Promise<void> {
  // ВИПРАВЛЕННЯ #2: та сама логіка — шукаємо за email, не за id
  const barber = await prisma.user.findFirst({
    where: {
      email: payload.organizer.email,
      sasRole: "BARBER",
    },
    select: {
      telegramChatId: true,
    },
  });

  if (!barber?.telegramChatId) {
    console.warn(
      `[bookingNotifier] Майстра з email "${payload.organizer.email}" не знайдено ` +
      `або відсутній telegramChatId — сповіщення про скасування не надіслано.`
    );
    return;
  }

  const startTime = new Date(payload.startTime);

  await sendMessage(
    bot,
    barber.telegramChatId,
    `⚠️ <b>ЗАПИС СКАСОВАНО КЛІЄНТОМ</b>\n\n` +
      `📅 Час запису: <b>${formatBookingDateTime(startTime)}</b>\n` +
      `👤 Клієнт: <b>${payload.attendees[0]?.name ?? "—"}</b>`
  );
}
