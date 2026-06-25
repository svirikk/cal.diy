// apps/web/types/booking-webhook.ts
// Єдине визначення типу BookingWebhookPayload для apps/web.
//
// ЧОМУ ОКРЕМИЙ ФАЙЛ, А НЕ ІМПОРТ З БОТА:
// apps/web і telegram-bot — два незалежні застосунки.
// Імпорт між ними через відносний шлях (../../../../telegram-bot/src/...)
// ненадійний: шлях залежить від фізичного розміщення папок на диску,
// ламається при рефакторингу структури і не компілюється в CI/CD
// якщо бот і вебсервер збираються окремо.
//
// Цей файл — локальна копія типу для apps/web.
// Тип у боті (src/services/bookingNotifier.ts) залишається незмінним.
// При зміні структури payload — оновлюйте обидва файли синхронно.

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
      id: number;
      name: string;
      email: string;       // використовується для пошуку майстра в БД
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
