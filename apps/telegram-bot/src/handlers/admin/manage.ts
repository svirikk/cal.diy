// src/handlers/admin/manage.ts
// Команди для Супер-Адміна:
// /manage @username — картка керування підпискою власника
// /admin_stats      — загальна статистика платформи

import type { Telegraf } from "telegraf";
import { Markup } from "telegraf";
import prisma from "../../prisma";
import {
  formatSubscriptionDate,
  formatMoney,
} from "../../utils/format";
import { editMessage } from "../../utils/telegram";
import { addDays } from "date-fns";

// ── Guard: лише Супер-Адмін може виконувати ці команди ───────────────────────

function isSuperAdmin(chatId: string): boolean {
  return chatId === process.env.SUPER_ADMIN_TELEGRAM_ID;
}

// ── Формує текст картки керування власником ───────────────────────────────────

function buildManageCard(owner: {
  id: number;
  name: string | null;
  email: string;
  telegramUsername: string | null;
  subscriptionActive: boolean;
  subscriptionExpiresAt: Date | null;
}): string {
  const now = new Date();
  const isExpired =
    owner.subscriptionExpiresAt !== null &&
    owner.subscriptionExpiresAt < now;
  const isBlocked = !owner.subscriptionActive || isExpired;

  const statusEmoji = isBlocked ? "🔴" : "🟢";
  const statusText = isBlocked ? "Заблокована" : "Активна";
  const expiresText = owner.subscriptionExpiresAt
    ? formatSubscriptionDate(owner.subscriptionExpiresAt)
    : "—";

  return (
    `👑 <b>КЕРУВАННЯ КЛІЄНТОМ</b>\n\n` +
    `🏢 Email: <code>${owner.email}</code>\n` +
    `👤 Власник: @${owner.telegramUsername ?? "—"} | <b>${owner.name ?? "—"}</b>\n` +
    `${statusEmoji} Статус підписки: <b>${statusText}</b>\n` +
    `📅 Діяла до: <b>${expiresText}</b>`
  );
}

// ── Реєстрація хендлерів ──────────────────────────────────────────────────────

export function registerAdminManageHandler(bot: Telegraf): void {

  // ── Команда /manage @username ─────────────────────────────────────────────
  bot.command("manage", async (ctx) => {
    const chatId = String(ctx.from?.id);

    if (!isSuperAdmin(chatId)) {
      await ctx.replyWithHTML(`⛔ Доступ заборонено.`);
      return;
    }

    // Парсимо аргумент: /manage @username або /manage username
    const rawArg = ctx.message.text.split(" ")[1];
    if (!rawArg) {
      await ctx.replyWithHTML(
        `ℹ️ Використання: /manage @username\n\nПриклад: /manage @salon_owner`
      );
      return;
    }

    // Прибираємо @ якщо є
    const username = rawArg.replace(/^@/, "").trim().toLowerCase();

    if (!username) {
      await ctx.replyWithHTML(`❌ Вкажіть нікнейм власника.`);
      return;
    }

    const owner = await prisma.user.findFirst({
      where: {
        // ВИПРАВЛЕННЯ #7: username вже приведено до toLowerCase() вище.
        // mode: "insensitive" — страховка для legacy-записів у БД,
        // збережених з великими літерами до запровадження цього виправлення.
        telegramUsername: {
          equals: username,
          mode: "insensitive",
        },
        sasRole: "OWNER",
      },
      select: {
        id: true,
        name: true,
        email: true,
        telegramUsername: true,
        subscriptionActive: true,
        subscriptionExpiresAt: true,
      },
    });

    if (!owner) {
      await ctx.replyWithHTML(
        `❌ Власника з нікнеймом <b>@${username}</b> не знайдено.\n\n` +
        `Переконайтесь, що:\n` +
        `• Нікнейм вказано правильно\n` +
        `• Власник запустив бота (/start)\n` +
        `• Роль OWNER призначена в системі`
      );
      return;
    }

    const cardText = buildManageCard(owner);

    await ctx.replyWithHTML(
      cardText,
      Markup.inlineKeyboard([
        [
          Markup.button.callback(
            "✅ Продовжити (+28 днів)",
            `sub_extend:${owner.id}`
          ),
          Markup.button.callback(
            "🚫 Заблокувати",
            `sub_block:${owner.id}`
          ),
        ],
      ])
    );
  });

  // ── Кнопка: Продовжити підписку (+28 днів) ────────────────────────────────
  bot.action(/^sub_extend:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();

    const chatId = String(ctx.from?.id);
    if (!isSuperAdmin(chatId)) return;

    const ownerId = parseInt(ctx.match[1], 10);

    const owner = await prisma.user.findFirst({
      where: { id: ownerId, sasRole: "OWNER" },
      select: {
        id: true,
        subscriptionActive: true,
        subscriptionExpiresAt: true,
        telegramChatId: true,
        name: true,
      },
    });

    if (!owner) {
      await ctx.answerCbQuery("❌ Власника не знайдено");
      return;
    }

    const now = new Date();
    const isExpiredOrNull =
      !owner.subscriptionExpiresAt || owner.subscriptionExpiresAt < now;

    // Якщо прострочена — відраховуємо 28 днів від сьогодні
    // Якщо ще активна — додаємо 28 днів до залишку
    const baseDate = isExpiredOrNull ? now : owner.subscriptionExpiresAt!;
    const newExpiresAt = addDays(baseDate, 28);

    await prisma.user.update({
      where: { id: ownerId },
      data: {
        subscriptionActive: true,
        subscriptionExpiresAt: newExpiresAt,
      },
    });

    // ВИПРАВЛЕННЯ #15: попередня версія намагалась "інвалідувати сесії"
    // через prisma.session.deleteMany(), що НЕ працює для Cal.diy.
    //
    // Cal.diy налаштований на session: { strategy: "jwt" } (підтверджено
    // у вихідному коді packages/features/auth/lib/next-auth-options.ts).
    // При JWT-стратегії NextAuth НЕ записує сесії у таблицю Session —
    // увесь стан живе у підписаному cookie на клієнті. Видалення рядків
    // з таблиці Session нічого не інвалідує і створює лише ілюзію миттєвої
    // реакції.
    //
    // Реальний механізм блокування реалізовано інакше — через перевірку
    // підписки без кешу безпосередньо на сервері при кожному запиті
    // захищеної сторінки (apps/web/lib/requireActiveSubscription.ts,
    // підключається у getServerSideProps дешборд-сторінок Cal.diy).
    // Це дає миттєву реакцію незалежно від того, коли оновиться JWT.
    //
    // Middleware (apps/web/middleware.ts) залишається як швидкий
    // попередній фільтр на основі JWT — він спрацює одразу для нових
    // сесій і протягом updateAge для існуючих, а остаточну перевірку
    // на кожен рендер виконує requireActiveSubscription.

    // Оновлюємо картку у повідомленні
    const updatedOwner = await prisma.user.findFirst({
      where: { id: ownerId },
      select: {
        id: true,
        name: true,
        email: true,
        telegramUsername: true,
        subscriptionActive: true,
        subscriptionExpiresAt: true,
      },
    });

    if (!updatedOwner) return;

    const msgId = ctx.callbackQuery.message?.message_id;
    const updatedCard =
      buildManageCard(updatedOwner) +
      `\n\n✅ <b>Підписку продовжено до ${formatSubscriptionDate(newExpiresAt)}</b>`;

    if (msgId) {
      await editMessage(
        bot,
        chatId,
        msgId,
        updatedCard,
        Markup.inlineKeyboard([
          [
            Markup.button.callback("✅ Продовжити (+28 днів)", `sub_extend:${ownerId}`),
            Markup.button.callback("🚫 Заблокувати", `sub_block:${ownerId}`),
          ],
        ]).reply_markup
      );
    }

    // Сповіщаємо власника про продовження підписки
    if (owner.telegramChatId) {
      try {
        await bot.telegram.sendMessage(
          owner.telegramChatId,
          `🎉 <b>Вашу підписку продовжено!</b>\n\n` +
          `📅 Нова дата закінчення: <b>${formatSubscriptionDate(newExpiresAt)}</b>\n\n` +
          `Дякуємо за довіру! Ваш заклад залишається активним.`,
          { parse_mode: "HTML" }
        );
      } catch {
        // Власник міг заблокувати бота — не критично
      }
    }
  });

  // ── Кнопка: Заблокувати підписку ─────────────────────────────────────────
  bot.action(/^sub_block:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();

    const chatId = String(ctx.from?.id);
    if (!isSuperAdmin(chatId)) return;

    const ownerId = parseInt(ctx.match[1], 10);

    const owner = await prisma.user.findFirst({
      where: { id: ownerId, sasRole: "OWNER" },
      select: {
        id: true,
        name: true,
        email: true,
        telegramUsername: true,
        subscriptionActive: true,
        subscriptionExpiresAt: true,
        telegramChatId: true,
      },
    });

    if (!owner) {
      await ctx.answerCbQuery("❌ Власника не знайдено");
      return;
    }

    // Миттєво блокуємо
    await prisma.user.update({
      where: { id: ownerId },
      data: { subscriptionActive: false },
    });

    const msgId = ctx.callbackQuery.message?.message_id;
    const blockedOwner = { ...owner, subscriptionActive: false };
    const updatedCard =
      buildManageCard(blockedOwner) +
      `\n\n🚫 <b>Підписку заблоковано. Фронтенд закладу недоступний.</b>`;

    if (msgId) {
      await editMessage(
        bot,
        chatId,
        msgId,
        updatedCard,
        Markup.inlineKeyboard([
          [
            Markup.button.callback("✅ Продовжити (+28 днів)", `sub_extend:${ownerId}`),
            Markup.button.callback("🚫 Заблокувати", `sub_block:${ownerId}`),
          ],
        ]).reply_markup
      );
    }

    // Сповіщаємо власника про блокування
    if (owner.telegramChatId) {
      try {
        await bot.telegram.sendMessage(
          owner.telegramChatId,
          `⚠️ <b>Доступ до вашого закладу призупинено.</b>\n\n` +
          `Для відновлення зверніться до адміністратора сервісу.\n\n` +
          `Всі записи клієнтів тимчасово недоступні.`,
          { parse_mode: "HTML" }
        );
      } catch {
        // Не критично
      }
    }
  });
}

// ── Команда /admin_stats ──────────────────────────────────────────────────────

export function registerAdminStatsHandler(bot: Telegraf): void {
  bot.command("admin_stats", async (ctx) => {
    const chatId = String(ctx.from?.id);

    if (!isSuperAdmin(chatId)) {
      await ctx.replyWithHTML(`⛔ Доступ заборонено.`);
      return;
    }

    // Загальна кількість закладів (OWNER)
    const totalOwners = await prisma.user.count({
      where: { sasRole: "OWNER" },
    });

    // Активні підписки
    const now = new Date();
    const activeSubscriptions = await prisma.user.count({
      where: {
        sasRole: "OWNER",
        subscriptionActive: true,
        OR: [
          { subscriptionExpiresAt: null },
          { subscriptionExpiresAt: { gt: now } },
        ],
      },
    });

    // Заблоковані/прострочені заклади
    const blockedCount = totalOwners - activeSubscriptions;

    // Загальна кількість майстрів
    const totalBarbers = await prisma.user.count({
      where: { sasRole: "BARBER" },
    });

    // MRR: кількість активних підписок × фіксована ціна
    // ⚠️ Замініть SUBSCRIPTION_PRICE_GEL на реальну ціну вашої підписки
    const SUBSCRIPTION_PRICE = parseInt(
      process.env.SUBSCRIPTION_PRICE ?? "99",
      10
    );
    const mrr = activeSubscriptions * SUBSCRIPTION_PRICE;

    await ctx.replyWithHTML(
      `📊 <b>СТАТИСТИКА ПЛАТФОРМИ</b>\n\n` +
      `🏢 Всього закладів: <b>${totalOwners}</b>\n` +
      `🟢 Активні підписки: <b>${activeSubscriptions}</b>\n` +
      `🔴 Заблоковані/прострочені: <b>${blockedCount}</b>\n` +
      `✂️ Всього майстрів: <b>${totalBarbers}</b>\n\n` +
      `💰 <b>MRR (розрахунковий): ${formatMoney(mrr)}</b>\n` +
      `   (${activeSubscriptions} × ${formatMoney(SUBSCRIPTION_PRICE)}/міс)`
    );
  });
}
