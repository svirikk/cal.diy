// apps/web/lib/requireActiveSubscription.ts
// Серверна перевірка підписки з in-memory кешем.
// Виправлення #15 (без кешу) + Виправлення #1 (кеш) — фінальна версія.

import type { GetServerSidePropsContext, Redirect } from "next";
import { getToken } from "next-auth/jwt";
import prisma from "@calcom/prisma";

// ── In-memory кеш ─────────────────────────────────────────────────────────────
// TTL за замовчуванням 60 сек. Встановіть SUBSCRIPTION_CACHE_TTL_SECONDS=0
// у .env щоб вимкнути кеш і перевіряти БД при кожному запиті.

const CACHE_TTL_MS =
  parseInt(process.env.SUBSCRIPTION_CACHE_TTL_SECONDS ?? "60", 10) * 1000;

interface CacheEntry {
  isBlocked: boolean;
  cachedAt: number;
}

const subscriptionCache = new Map<string, CacheEntry>();

function getCached(email: string): boolean | null {
  if (CACHE_TTL_MS === 0) return null;
  const entry = subscriptionCache.get(email);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
    subscriptionCache.delete(email);
    return null;
  }
  return entry.isBlocked;
}

function setCache(email: string, isBlocked: boolean): void {
  if (CACHE_TTL_MS === 0) return;
  subscriptionCache.set(email, { isBlocked, cachedAt: Date.now() });
}

export function invalidateSubscriptionCache(email: string): void {
  subscriptionCache.delete(email);
}

// ── Типи ──────────────────────────────────────────────────────────────────────

export type SubscriptionCheckResult =
  | { blocked: false }
  | { blocked: true; redirect: Redirect };

// ── Перевірка підписки напряму в БД ───────────────────────────────────────────

async function checkSubscriptionInDB(email: string): Promise<boolean> {
  const user = await prisma.user.findFirst({
    where: { email },
    select: {
      sasRole: true,
      subscriptionActive: true,
      subscriptionExpiresAt: true,
      ownerId: true,
    },
  });

  if (!user) return false;
  if (user.sasRole === "SUPER_ADMIN") return false;

  const now = new Date();

  if (user.sasRole === "OWNER") {
    const isExpired =
      user.subscriptionExpiresAt !== null &&
      user.subscriptionExpiresAt < now;
    return !user.subscriptionActive || isExpired;
  }

  if (user.sasRole === "BARBER" && user.ownerId) {
    const owner = await prisma.user.findFirst({
      where: { id: user.ownerId },
      select: { subscriptionActive: true, subscriptionExpiresAt: true },
    });
    if (!owner) return false;
    const isExpired =
      owner.subscriptionExpiresAt !== null &&
      owner.subscriptionExpiresAt < now;
    return !owner.subscriptionActive || isExpired;
  }

  return false;
}

// ── Головна функція ───────────────────────────────────────────────────────────

/**
 * Перевіряє підписку поточного користувача.
 * Результат кешується на SUBSCRIPTION_CACHE_TTL_SECONDS секунд (default: 60).
 *
 * Використання у getServerSideProps будь-якої захищеної сторінки Cal.diy:
 *
 *   const subCheck = await requireActiveSubscription(ctx);
 *   if (subCheck.blocked) return { redirect: subCheck.redirect };
 */
export async function requireActiveSubscription(
  ctx: GetServerSidePropsContext
): Promise<SubscriptionCheckResult> {
  const token = await getToken({
    req: ctx.req,
    secret: process.env.NEXTAUTH_SECRET ?? "",
  });

  if (!token?.email) return { blocked: false };

  const email = token.email as string;

  // Кеш-попадання — нуль запитів до БД
  const cached = getCached(email);
  if (cached !== null) {
    return cached
      ? {
          blocked: true,
          redirect: { destination: "/subscription-expired", permanent: false },
        }
      : { blocked: false };
  }

  // Кеш-промах — йдемо в БД і кешуємо
  const isBlocked = await checkSubscriptionInDB(email);
  setCache(email, isBlocked);

  if (isBlocked) {
    return {
      blocked: true,
      redirect: { destination: "/subscription-expired", permanent: false },
    };
  }

  return { blocked: false };
}
