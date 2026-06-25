// apps/web/pages/barbershop/[ownerId].tsx
// Публічна сторінка-вітрина барбершопу зі списком майстрів

import type { GetServerSideProps, NextPage } from "next";
import Head from "next/head";
import Image from "next/image";
import { useRouter } from "next/router";
import prisma from "@calcom/prisma";

// ─── Типи ────────────────────────────────────────────────────────────────────

type Barber = {
  id: number;
  name: string | null;
  username: string | null;
  avatarUrl: string | null;
  bio: string | null;
  // ВИПРАВЛЕННЯ #9: slug першого EventType для прямого посилання на бронювання.
  // Якщо у майстра одна послуга — редіректимо на /{username}/{slug}.
  // Якщо кілька — на /{username} (Cal.diy покаже список послуг).
  eventSlug: string | null;
  eventCount: number;
};

type PageProps =
  | {
      isBlocked: true;
      ownerName: string | null;
    }
  | {
      isBlocked: false;
      ownerName: string | null;
      ownerBio: string | null;
      barbers: Barber[];
    };

// ─── Компонент заблокованої сторінки ─────────────────────────────────────────

function BlockedScreen({ ownerName }: { ownerName: string | null }) {
  return (
    <div className="blocked-wrapper">
      <div className="blocked-card">
        <div className="blocked-icon">🔒</div>
        <h1 className="blocked-title">
          {ownerName ? ownerName : "Барбершоп"}
        </h1>
        <p className="blocked-message">
          Запис тимчасово призупинено.
          <br />
          Будь ласка, зверніться до адміністратора закладу.
        </p>
      </div>
    </div>
  );
}

// ─── Компонент картки майстра ─────────────────────────────────────────────────

function BarberCard({ barber }: { barber: Barber }) {
  const router = useRouter();

  const handleClick = () => {
    if (!barber.username) return;

    // ВИПРАВЛЕННЯ #9: якщо у майстра рівно одна послуга — одразу на неї.
    // Якщо кілька або жодної — на список послуг Cal.diy /{username}.
    if (barber.eventCount === 1 && barber.eventSlug) {
      router.push(`/${barber.username}/${barber.eventSlug}`);
    } else {
      router.push(`/${barber.username}`);
    }
  };

  const initials =
    barber.name
      ?.split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2) ?? "✂️";

  return (
    <button
      onClick={handleClick}
      disabled={!barber.username}
      className="barber-card"
      aria-label={`Записатись до ${barber.name ?? "майстра"}`}
    >
      <div className="barber-avatar-wrapper">
        {barber.avatarUrl ? (
          <Image
            src={barber.avatarUrl}
            alt={barber.name ?? "Майстер"}
            width={96}
            height={96}
            className="barber-avatar-img"
            unoptimized
          />
        ) : (
          <div className="barber-avatar-placeholder">
            <span>{initials}</span>
          </div>
        )}
        <div className="barber-status-dot" aria-hidden="true" />
      </div>

      <div className="barber-info">
        <h3 className="barber-name">{barber.name ?? "Майстер"}</h3>
        {barber.bio && (
          <p className="barber-bio">{barber.bio}</p>
        )}
        <span className="barber-cta">Записатись →</span>
      </div>
    </button>
  );
}

// ─── Головний компонент сторінки ──────────────────────────────────────────────

const BarbershopPage: NextPage<PageProps> = (props) => {
  if (props.isBlocked) {
    return (
      <>
        <Head>
          <title>
            {props.ownerName ? `${props.ownerName} — Запис` : "Запис на послуги"}
          </title>
          <meta name="robots" content="noindex" />
        </Head>
        <BlockedScreen ownerName={props.ownerName} />
        <style jsx global>{globalStyles}</style>
      </>
    );
  }

  const { ownerName, ownerBio, barbers } = props;

  return (
    <>
      <Head>
        <title>
          {ownerName ? `${ownerName} — Онлайн-запис` : "Онлайн-запис на послуги"}
        </title>
        <meta
          name="description"
          content={
            ownerBio ??
            `Онлайн-запис до майстрів ${ownerName ?? "барбершопу"}. Оберіть майстра та зручний час.`
          }
        />
      </Head>

      <div className="page-wrapper">
        {/* Хедер закладу */}
        <header className="shop-header">
          <div className="shop-header-inner">
            <div className="shop-logo-placeholder">✂️</div>
            <div>
              <h1 className="shop-title">
                {ownerName ?? "Барбершоп"}
              </h1>
              {ownerBio && (
                <p className="shop-subtitle">{ownerBio}</p>
              )}
            </div>
          </div>
        </header>

        {/* Основний контент */}
        <main className="main-content">
          <div className="section-label">
            <span className="section-dot" />
            Наші майстри
          </div>

          {barbers.length === 0 ? (
            <div className="empty-state">
              <p>Майстри ще не додані. Зверніться до адміністратора.</p>
            </div>
          ) : (
            <div className="barbers-grid">
              {barbers.map((barber) => (
                <BarberCard key={barber.id} barber={barber} />
              ))}
            </div>
          )}
        </main>

        <footer className="page-footer">
          <p>Powered by BarberSaaS</p>
        </footer>
      </div>

      <style jsx global>{globalStyles}</style>
    </>
  );
};

// ─── SSR: дані завантажуються на сервері ──────────────────────────────────────

export const getServerSideProps: GetServerSideProps<PageProps> = async (ctx) => {
  const { ownerId } = ctx.params as { ownerId: string };
  const ownerIdNum = parseInt(ownerId, 10);

  if (isNaN(ownerIdNum)) {
    return { notFound: true };
  }

  try {
    const owner = await prisma.user.findFirst({
      where: {
        id: ownerIdNum,
        sasRole: "OWNER",
      },
      select: {
        id: true,
        name: true,
        bio: true,
        subscriptionActive: true,
        subscriptionExpiresAt: true,
      },
    });

    if (!owner) {
      return { notFound: true };
    }

    // Перевірка блокування: підписка неактивна або прострочена
    const now = new Date();
    const isExpired =
      owner.subscriptionExpiresAt !== null &&
      owner.subscriptionExpiresAt < now;
    const isBlocked = !owner.subscriptionActive || isExpired;

    if (isBlocked) {
      return {
        props: {
          isBlocked: true,
          ownerName: owner.name,
        },
      };
    }

    // Отримуємо список майстрів
    const barbers = await prisma.user.findMany({
      where: {
        ownerId: ownerIdNum,
        sasRole: "BARBER",
      },
      select: {
        id: true,
        name: true,
        username: true,
        avatarUrl: true,
        bio: true,
        // ВИПРАВЛЕННЯ #9 + #4: отримуємо slug та точну кількість EventTypes.
        // Попередній підхід (take: 2) давав хибний результат коли у майстра
        // 2 послуги і одна прихована: take: 2 поверне 2 видимих, eventCount = 2,
        // але реально одна — клієнт потрапляє на список з однієї послуги
        // замість прямого переходу. Виправлено: беремо всі видимі slug-и
        // і рахуємо довжину масиву вже в JavaScript, не через take.
        ownedEventTypes: {
          select: { slug: true },
          where: { hidden: false },
          orderBy: { position: "asc" },
          // take прибрано — беремо всі видимі послуги для точного підрахунку
        },
      },
      orderBy: { name: "asc" },
    });

    return {
      props: {
        isBlocked: false,
        ownerName: owner.name,
        ownerBio: owner.bio,
        barbers: barbers.map((b) => ({
          id: b.id,
          name: b.name,
          username: b.username,
          avatarUrl: b.avatarUrl,
          bio: b.bio,
          // ВИПРАВЛЕННЯ #4: реальна кількість видимих послуг без обмеження take
          // Якщо рівно одна видима послуга — пряме посилання на неї,
          // якщо кілька або жодної — на список послуг Cal.diy /{username}
          eventSlug: b.ownedEventTypes.length === 1
            ? (b.ownedEventTypes[0]?.slug ?? null)
            : null,
          eventCount: b.ownedEventTypes.length,
        })),
      },
    };
  } catch (error) {
    console.error("[BarbershopPage SSR error]", error);
    return { notFound: true };
  }
};

// ─── Глобальні стилі сторінки ─────────────────────────────────────────────────

const globalStyles = `
  *, *::before, *::after {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    background: #0f0f0f;
    color: #f0f0f0;
    min-height: 100vh;
  }

  /* ── Заблокований екран ── */
  .blocked-wrapper {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #0f0f0f;
    padding: 24px;
  }

  .blocked-card {
    background: #1a1a1a;
    border: 1px solid #2a2a2a;
    border-radius: 20px;
    padding: 48px 40px;
    text-align: center;
    max-width: 420px;
    width: 100%;
  }

  .blocked-icon {
    font-size: 56px;
    margin-bottom: 20px;
  }

  .blocked-title {
    font-size: 24px;
    font-weight: 700;
    color: #f0f0f0;
    margin-bottom: 16px;
    letter-spacing: -0.5px;
  }

  .blocked-message {
    font-size: 16px;
    color: #888;
    line-height: 1.6;
  }

  /* ── Основна сторінка ── */
  .page-wrapper {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    background: #0f0f0f;
  }

  /* ── Хедер ── */
  .shop-header {
    background: linear-gradient(135deg, #1a1a1a 0%, #141414 100%);
    border-bottom: 1px solid #2a2a2a;
    padding: 32px 24px;
  }

  .shop-header-inner {
    max-width: 900px;
    margin: 0 auto;
    display: flex;
    align-items: center;
    gap: 20px;
  }

  .shop-logo-placeholder {
    font-size: 48px;
    width: 72px;
    height: 72px;
    background: #222;
    border-radius: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    border: 1px solid #333;
  }

  .shop-title {
    font-size: 28px;
    font-weight: 800;
    color: #ffffff;
    letter-spacing: -0.8px;
    line-height: 1.2;
  }

  .shop-subtitle {
    font-size: 15px;
    color: #888;
    margin-top: 6px;
    line-height: 1.5;
    max-width: 500px;
  }

  /* ── Контент ── */
  .main-content {
    flex: 1;
    max-width: 900px;
    width: 100%;
    margin: 0 auto;
    padding: 40px 24px;
  }

  .section-label {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    font-weight: 600;
    color: #666;
    text-transform: uppercase;
    letter-spacing: 1.2px;
    margin-bottom: 24px;
  }

  .section-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #c9a84c;
  }

  /* ── Грід майстрів ── */
  .barbers-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 16px;
  }

  /* ── Картка майстра ── */
  .barber-card {
    background: #1a1a1a;
    border: 1px solid #2a2a2a;
    border-radius: 20px;
    padding: 28px 24px;
    cursor: pointer;
    transition: all 0.2s ease;
    text-align: left;
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
  }

  .barber-card:hover {
    background: #202020;
    border-color: #c9a84c;
    transform: translateY(-3px);
    box-shadow: 0 12px 40px rgba(201, 168, 76, 0.12);
  }

  .barber-card:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  .barber-card:disabled:hover {
    transform: none;
    border-color: #2a2a2a;
    box-shadow: none;
  }

  /* ── Аватар ── */
  .barber-avatar-wrapper {
    position: relative;
    width: 96px;
    height: 96px;
    flex-shrink: 0;
  }

  .barber-avatar-img {
    border-radius: 50%;
    object-fit: cover;
    width: 96px;
    height: 96px;
    border: 2px solid #333;
  }

  .barber-avatar-placeholder {
    width: 96px;
    height: 96px;
    border-radius: 50%;
    background: linear-gradient(135deg, #c9a84c 0%, #a07830 100%);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 28px;
    font-weight: 700;
    color: #fff;
    letter-spacing: -1px;
  }

  .barber-status-dot {
    position: absolute;
    bottom: 4px;
    right: 4px;
    width: 14px;
    height: 14px;
    background: #22c55e;
    border-radius: 50%;
    border: 2px solid #1a1a1a;
  }

  /* ── Інфо майстра ── */
  .barber-info {
    text-align: center;
    width: 100%;
  }

  .barber-name {
    font-size: 18px;
    font-weight: 700;
    color: #f0f0f0;
    letter-spacing: -0.3px;
    margin-bottom: 6px;
  }

  .barber-bio {
    font-size: 13px;
    color: #777;
    line-height: 1.5;
    margin-bottom: 14px;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .barber-cta {
    display: inline-block;
    font-size: 13px;
    font-weight: 600;
    color: #c9a84c;
    letter-spacing: 0.2px;
  }

  /* ── Порожній стан ── */
  .empty-state {
    text-align: center;
    color: #666;
    padding: 60px 0;
    font-size: 16px;
  }

  /* ── Футер ── */
  .page-footer {
    text-align: center;
    padding: 24px;
    font-size: 12px;
    color: #444;
    border-top: 1px solid #1a1a1a;
  }

  /* ── Адаптивність ── */
  @media (max-width: 600px) {
    .shop-header-inner {
      flex-direction: column;
      text-align: center;
    }

    .shop-title {
      font-size: 22px;
    }

    .barbers-grid {
      grid-template-columns: 1fr;
    }

    .main-content {
      padding: 28px 16px;
    }
  }
`;

export default BarbershopPage;
