// src/utils/telegram.ts
// Wrapper над telegraf.telegram для надсилання / редагування повідомлень.
//
// ВИПРАВЛЕННЯ #3 (retry-логіка):
// Попередня версія при помилці просто логувала і мовчки губила повідомлення.
// Telegram API буває тимчасово недоступним (429 Too Many Requests, 502, 503)
// — майстер не отримував сповіщення про клієнта і не знав про запис.
//
// Рішення — exponential backoff retry: 3 спроби з затримками 1с → 2с → 4с.
// Обробка специфічних Telegram-помилок:
//   • 429 (flood limit) — чекаємо retry_after секунд, що Telegram вказує
//   • 403 (бот заблокований юзером) — не ретраємо, просто логуємо
//   • 400 (невірний chat_id) — не ретраємо
//   • 5xx (серверна помилка Telegram) — ретраємо

import type { Telegraf } from "telegraf";
import type { InlineKeyboardMarkup } from "telegraf/types";

// ── Конфігурація retry ────────────────────────────────────────────────────────

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Визначаємо чи варто ретраїти по коду помилки Telegram
function isRetryable(err: unknown): { retry: boolean; waitMs?: number } {
  if (!(err instanceof Error)) return { retry: false };

  const msg = err.message;

  // 429 Too Many Requests — Telegram сам вказує скільки чекати
  const retryAfterMatch = msg.match(/retry after (\d+)/i);
  if (retryAfterMatch) {
    const seconds = parseInt(retryAfterMatch[1], 10);
    return { retry: true, waitMs: (seconds + 1) * 1000 };
  }

  // 403 Forbidden — юзер заблокував бота, ретраї безглузді
  if (msg.includes("403") || msg.includes("Forbidden")) {
    return { retry: false };
  }

  // 400 Bad Request — невірні дані, ретраї не допоможуть
  if (msg.includes("400") || msg.includes("Bad Request")) {
    return { retry: false };
  }

  // 5xx — тимчасова помилка серверу Telegram, ретраємо
  if (msg.includes("5")) {
    return { retry: true };
  }

  // ETIMEDOUT, ECONNRESET, ECONNREFUSED — мережеві проблеми, ретраємо
  if (
    msg.includes("ETIMEDOUT") ||
    msg.includes("ECONNRESET") ||
    msg.includes("ECONNREFUSED") ||
    msg.includes("socket hang up")
  ) {
    return { retry: true };
  }

  // Будь-яка інша помилка — ретраємо (обережно)
  return { retry: true };
}

// ── Core retry-обгортка ───────────────────────────────────────────────────────

async function withRetry<T>(
  operation: () => Promise<T>,
  context: string
): Promise<T | null> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await operation();
    } catch (err) {
      lastError = err;
      const { retry, waitMs } = isRetryable(err);

      if (!retry) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[Telegram] ${context} — не ретраємо: ${msg}`);
        return null;
      }

      if (attempt === MAX_RETRIES) break;

      const delay = waitMs ?? BASE_DELAY_MS * Math.pow(2, attempt - 1);
      console.warn(
        `[Telegram] ${context} — спроба ${attempt}/${MAX_RETRIES} невдала, ` +
        `чекаємо ${delay}мс...`
      );
      await sleep(delay);
    }
  }

  const msg = lastError instanceof Error ? lastError.message : String(lastError);
  console.error(
    `[Telegram] ${context} — всі ${MAX_RETRIES} спроби невдалі: ${msg}`
  );
  return null;
}

// ── Публічні функції ──────────────────────────────────────────────────────────

/** Надсилає HTML-повідомлення з опціональними inline-кнопками (з retry) */
export async function sendMessage(
  bot: Telegraf,
  chatId: string,
  html: string,
  replyMarkup?: InlineKeyboardMarkup
): Promise<void> {
  await withRetry(
    () =>
      bot.telegram.sendMessage(chatId, html, {
        parse_mode: "HTML",
        reply_markup: replyMarkup,
      }),
    `sendMessage(chatId=${chatId})`
  );
}

/** Редагує існуюче повідомлення після натискання inline-кнопки (з retry) */
export async function editMessage(
  bot: Telegraf,
  chatId: string,
  messageId: number,
  html: string,
  replyMarkup?: InlineKeyboardMarkup
): Promise<void> {
  await withRetry(
    () =>
      bot.telegram.editMessageText(chatId, messageId, undefined, html, {
        parse_mode: "HTML",
        reply_markup: replyMarkup,
      }),
    `editMessage(chatId=${chatId}, msgId=${messageId})`
  );
}
