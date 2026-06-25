// src/handlers/start.ts
// Команда /start
// — прив'язує telegramChatId та telegramUsername до існуючого User у БД
// — надсилає Супер-Адміну сповіщення про нового користувача
//
// ВИПРАВЛЕННЯ #6:
// Текст пушу Супер-Адміну приведено до вимоги ТЗ:
//   "🎉 Користувач @username запустив бота"
// Додаткова інформація (роль, email) додається окремим рядком нижче —
// щоб основне повідомлення відповідало ТЗ, але корисний контекст не губився.

import type { Telegraf } from "telegraf";
import prisma from "../prisma";
import { sendMessage } from "../utils/telegram";

export function registerStartHandler(bot: Telegraf): void {
  bot.start(async (ctx) => {
    const tgUser = ctx.from;
    if (!tgUser) return;

    const chatId = String(tgUser.id);
    const username = tgUser.username ?? null;
    const firstName = tgUser.first_name ?? "";
    const lastName = tgUser.last_name ?? "";
    const displayName = [firstName, lastName].filter(Boolean).join(" ");

    // Шукаємо користувача: спочатку по chatId, потім по username.
    // ВИПРАВЛЕННЯ #7: username завжди приводимо до нижнього регістру перед
    // пошуком. Telegram usernames регістронезалежні (@MyBarber = @mybarber),
    // але PostgreSQL порівнює рядки з урахуванням регістру за замовчуванням.
    // toLowerCase() при пошуку + toLowerCase() при збереженні = гарантія
    // що в БД завжди лежить lowercase і порівняння завжди коректне.
    // mode: "insensitive" — додатковий захисний шар, але NOT RELIABLE для
    // полів з @unique індексом якщо collation не є case-insensitive.
    let user = await prisma.user.findFirst({
      where: { telegramChatId: chatId },
    });

    if (!user && username) {
      const usernameLower = username.toLowerCase();
      user = await prisma.user.findFirst({
        where: {
          telegramUsername: {
            equals: usernameLower,
            mode: "insensitive",
          },
        },
      });
    }

    if (user) {
      // Оновлюємо chatId/username якщо змінились
      await prisma.user.update({
        where: { id: user.id },
        data: {
          telegramChatId: chatId,
          ...(username ? { telegramUsername: username.toLowerCase() } : {}),
        },
      });

      const roleLabel =
        user.sasRole === "OWNER"
          ? "👑 Власник закладу"
          : user.sasRole === "SUPER_ADMIN"
          ? "🛡 Супер-Адмін"
          : "✂️ Майстер";

      await ctx.replyWithHTML(
        `👋 З поверненням, <b>${user.name ?? displayName}</b>!\n\n` +
        `${roleLabel}\n\n` +
        `Ваш акаунт підключено до системи.\n` +
        `Використовуйте /help для перегляду доступних команд.`
      );
    } else {
      await ctx.replyWithHTML(
        `👋 Вітаємо у системі <b>BarberSaaS</b>!\n\n` +
        `Я ваш помічник для сповіщень про записи та фінансових звітів.\n\n` +
        `⚠️ Ваш Telegram-акаунт ще не прив'язаний до системи.\n\n` +
        `Зверніться до адміністратора та назвіть ваш нікнейм:\n` +
        `<b>@${username ?? `(немає username, ID: ${chatId})`}</b>`
      );
    }

    // ВИПРАВЛЕННЯ #6: пуш Супер-Адміну точно відповідає формулюванню ТЗ:
    // "🎉 Користувач @username запустив бота"
    // Додаткова інформація (роль, email) йде окремим рядком для зручності.
    const superAdminId = process.env.SUPER_ADMIN_TELEGRAM_ID;
    if (superAdminId && superAdminId !== chatId) {
      const userTag = username ? `@${username}` : displayName || `ID: ${chatId}`;
      const extraInfo = user
        ? `роль: <b>${user.sasRole}</b> | email: <code>${user.email}</code>`
        : `<i>не прив'язаний до системи</i>`;

      await sendMessage(
        bot,
        superAdminId,
        `🎉 Користувач <b>${userTag}</b> запустив бота\n\n` +
        `ℹ️ ${extraInfo}\n` +
        `💬 Chat ID: <code>${chatId}</code>`
      );
    }
  });
}
