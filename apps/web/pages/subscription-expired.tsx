// apps/web/pages/subscription-expired.tsx
// Сторінка-заглушка для власника або майстра з простроченою підпискою.
// Показується замість дешборду Cal.diy.

import type { NextPage } from "next";
import Head from "next/head";
import Link from "next/link";

const SubscriptionExpiredPage: NextPage = () => {
  return (
    <>
      <Head>
        <title>Підписка призупинена</title>
        <meta name="robots" content="noindex" />
      </Head>

      <div className="wrapper">
        <div className="card">
          <div className="icon">⚠️</div>

          <h1 className="title">Доступ тимчасово обмежено</h1>

          <p className="description">
            Підписку вашого закладу призупинено або термін її дії закінчився.
            <br />
            Для відновлення доступу зверніться до адміністратора сервісу.
          </p>

          <div className="divider" />

          <div className="actions">
            <Link href="/" className="btn-secondary">
              На головну
            </Link>
          </div>

          <p className="footer-note">
            Якщо ви вважаєте, що це помилка — зверніться в підтримку.
          </p>
        </div>
      </div>

      <style jsx global>{`
        * {
          box-sizing: border-box;
          margin: 0;
          padding: 0;
        }

        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,
            'Helvetica Neue', Arial, sans-serif;
          background: #0f0f0f;
          color: #f0f0f0;
          min-height: 100vh;
        }

        .wrapper {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
          background: #0f0f0f;
        }

        .card {
          background: #1a1a1a;
          border: 1px solid #2a2a2a;
          border-radius: 24px;
          padding: 52px 44px;
          max-width: 460px;
          width: 100%;
          text-align: center;
        }

        .icon {
          font-size: 60px;
          margin-bottom: 24px;
        }

        .title {
          font-size: 26px;
          font-weight: 800;
          color: #fff;
          letter-spacing: -0.6px;
          margin-bottom: 16px;
          line-height: 1.2;
        }

        .description {
          font-size: 15px;
          color: #888;
          line-height: 1.7;
          margin-bottom: 32px;
        }

        .divider {
          height: 1px;
          background: #2a2a2a;
          margin-bottom: 28px;
        }

        .actions {
          display: flex;
          gap: 12px;
          justify-content: center;
          margin-bottom: 24px;
        }

        .btn-secondary {
          display: inline-flex;
          align-items: center;
          padding: 12px 28px;
          border-radius: 12px;
          font-size: 15px;
          font-weight: 600;
          cursor: pointer;
          text-decoration: none;
          transition: all 0.15s ease;
          background: #222;
          color: #ccc;
          border: 1px solid #333;
        }

        .btn-secondary:hover {
          background: #2a2a2a;
          color: #fff;
        }

        .footer-note {
          font-size: 12px;
          color: #555;
        }

        @media (max-width: 480px) {
          .card {
            padding: 36px 24px;
          }

          .title {
            font-size: 22px;
          }
        }
      `}</style>
    </>
  );
};

export default SubscriptionExpiredPage;
