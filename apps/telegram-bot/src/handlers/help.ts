// src/handlers/help.ts
// Команда /help — показує список доступних команд залежно від ролі

import type { Telegraf } from "telegraf";
import prisma from "../prisma";

export function registerHelpHandler(bot: Telegraf): void {
  bot.help(async (ctx) => {
    const chatId = String(ctx.from?.id);

    const user = await prisma.user.findFirst({
      where: { telegramChatId: chatId },
      select: { sasRole: true, name: true },
    });

    if (!user) {
      await ctx.replyWithHTML(
        `ℹ️ Ваш акаунт не прив'язаний до системи.\n` +
        `Зверніться до адміністратора.`
      );
      return;
    }

    if (user.sasRole === "BARBER") {
      await ctx.replyWithHTML(
        `📋 <b>Доступні команди для майстра:</b>\n\n` +
        `/stats — статистика та розклад на сьогодні\n` +
        `/help — ця довідка`
      );
    } else if (user.sasRole === "OWNER") {
      await ctx.replyWithHTML(
        `📋 <b>Доступні команди для власника:</b>\n\n` +
        `/daily_report — фінансовий звіт за сьогодні\n` +
        `/report — фінансовий звіт за вибраний період\n` +
        `/help — ця довідка`
      );
    } else if (user.sasRole === "SUPER_ADMIN") {
      await ctx.replyWithHTML(
        `📋 <b>Команди Супер-Адміна:</b>\n\n` +
        `/manage @username — керування підпискою клієнта\n` +
        `/admin_stats — загальна статистика платформи\n` +
        `/help — ця довідка`
      );
    }
  });
}
