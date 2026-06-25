// apps/web/middleware.ts
// ПОВНІСТЮ ЗАМІНЮЄ існуючий файл apps/web/middleware.ts у Cal.diy.
//
// ── Що виправлено (проблема #3, Частина A) ───────────────────────────────────
// Стара версія робила fetch() до /api/barbershop/subscription-check всередині
// Middleware. Next.js Middleware виконується в Edge Runtime — середовищі без
// Node.js API. `fetch(..., { next: { revalidate: 60 } })` є розширенням
// Next.js для Server Components і в Edge Runtime ігнорується — кожен запит
// до дешборду робив окремий удар у БД.
//
// Нова версія: читає лише JWT-токен (декодування cookie — нуль мережевих
// запитів). Поле `subscriptionBlocked` буде записуватись у токен при логіні
// через NextAuth callback — це Частина Б цього виправлення.
// ─────────────────────────────────────────────────────────────────────────────

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";

// Маршрути дешборду Cal.diy, захищені перевіркою підписки
const SUBSCRIPTION_PROTECTED = [
  "/event-types",
  "/bookings",
  "/availability",
  "/settings",
  "/apps",
  "/workflows",
  "/insights",
  "/teams",
];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Статика, API-роути та файли — пропускаємо без перевірки
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    pathname.startsWith("/static") ||
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  // Перевіряємо лише маршрути дешборду
  const needsCheck = SUBSCRIPTION_PROTECTED.some((p) =>
    pathname.startsWith(p)
  );

  if (!needsCheck) {
    return NextResponse.next();
  }

  // getToken лише декодує підписаний JWT з cookie —
  // жодних мережевих запитів, жодних звернень до БД
  const token = await getToken({
    req,
    secret: process.env.NEXTAUTH_SECRET ?? "",
  });

  // Не авторизований → редірект на логін Cal.diy
  if (!token) {
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = "/auth/login";
    loginUrl.searchParams.set("callbackUrl", req.nextUrl.href);
    return NextResponse.redirect(loginUrl);
  }

  // SUPER_ADMIN — ніколи не блокується
  if (token.sasRole === "SUPER_ADMIN") {
    return NextResponse.next();
  }

  // subscriptionBlocked записується у JWT при кожному логіні/оновленні сесії
  // через NextAuth callbacks.jwt (Частина Б цього виправлення).
  // Для OWNER — перевіряється власна підписка.
  // Для BARBER — перевіряється підписка його OWNER.
  if (token.subscriptionBlocked === true) {
    const blockedUrl = req.nextUrl.clone();
    blockedUrl.pathname = "/subscription-expired";
    return NextResponse.redirect(blockedUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/event-types/:path*",
    "/bookings/:path*",
    "/availability/:path*",
    "/settings/:path*",
    "/apps/:path*",
    "/workflows/:path*",
    "/insights/:path*",
    "/teams/:path*",
  ],
};
