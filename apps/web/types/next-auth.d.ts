// apps/web/types/next-auth.d.ts
// Розширення типів NextAuth — додає SaaS-поля до JWT і Session.
//
// РОЗМІЩЕННЯ: створіть файл apps/web/types/next-auth.d.ts
// TypeScript підхопить його автоматично через tsconfig.json Cal.diy
// (там вже є "include": ["**/*.d.ts"] або аналогічне).
//
// НІЧОГО БІЛЬШЕ НЕ ПОТРІБНО — цей файл лише декларує типи,
// не містить runtime-логіки.

import type { DefaultSession, DefaultJWT } from "next-auth";

declare module "next-auth/jwt" {
  interface JWT extends DefaultJWT {
    /**
     * Роль у SaaS-системі: "SUPER_ADMIN" | "OWNER" | "BARBER"
     * Записується у JWT при кожному логіні через callbacks.jwt
     */
    sasRole?: string;

    /**
     * true — підписка заблокована або прострочена.
     * Для BARBER перевіряється підписка його OWNER.
     * Для SUPER_ADMIN завжди false.
     * Middleware читає це поле для блокування дешборду.
     */
    subscriptionBlocked?: boolean;
  }
}

declare module "next-auth" {
  interface Session {
    user: {
      sasRole?: string;
      subscriptionBlocked?: boolean;
    } & DefaultSession["user"];
  }
}
