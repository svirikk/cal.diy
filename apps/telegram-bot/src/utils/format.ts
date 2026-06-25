// src/utils/format.ts
// Утиліти для форматування дат, часу та сум у повідомленнях бота

import { format, isToday, isTomorrow } from "date-fns";
import { uk } from "date-fns/locale";

/** Форматує DateTime у рядок "25 грудня о 14:30" */
export function formatBookingDateTime(date: Date): string {
  return format(date, "d MMMM 'о' HH:mm", { locale: uk });
}

/** Форматує тільки час "14:30" */
export function formatTime(date: Date): string {
  return format(date, "HH:mm");
}

/** Форматує дату "25 грудня 2024" */
export function formatDate(date: Date): string {
  return format(date, "d MMMM yyyy", { locale: uk });
}

/** Форматує дату підписки "25.12.2024" */
export function formatSubscriptionDate(date: Date): string {
  return format(date, "dd.MM.yyyy");
}

/** Форматує суму "1 500 грн" */
export function formatMoney(amount: number): string {
  return `${amount.toLocaleString("uk-UA")} грн`;
}

/** Повертає відносну назву дня: "сьогодні", "завтра" або "25 грудня" */
export function formatRelativeDay(date: Date): string {
  if (isToday(date)) return "сьогодні";
  if (isTomorrow(date)) return "завтра";
  return format(date, "d MMMM", { locale: uk });
}

/** Скорочує рядок до maxLength символів */
export function truncate(str: string | null | undefined, maxLength = 40): string {
  if (!str) return "—";
  return str.length > maxLength ? str.slice(0, maxLength) + "…" : str;
}


// ── Отримання servicePrice з Booking з fallback ───────────────────────────────
// ВИПРАВЛЕННЯ #5/#6: якщо EventType від'єднаний або видалений —
// беремо збережену ціну з metadata.completedServicePrice (денормалізована
// копія, записана при натисканні ✅ Виконано у bookingActions.ts).

export function resolveServicePrice(booking: {
  eventType?: { servicePrice: number } | null;
  metadata?: unknown;
}): number {
  // Пріоритет 1: актуальна ціна з EventType (якщо relation ще живий)
  if (booking.eventType?.servicePrice != null) {
    return booking.eventType.servicePrice;
  }

  // Пріоритет 2: денормалізована ціна з metadata (записана при ✅)
  if (
    booking.metadata !== null &&
    typeof booking.metadata === "object" &&
    "completedServicePrice" in (booking.metadata as object)
  ) {
    const price = (booking.metadata as Record<string, unknown>)
      .completedServicePrice;
    if (typeof price === "number") return price;
  }

  // Fallback: ціна невідома
  return 0;
}
