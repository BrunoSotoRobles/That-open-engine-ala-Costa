import React from 'react';
import { LanguageSelector } from './LanguageSelector';
import { useCostStore } from '../stores/CostStore';
import { getAppNavLabel } from '../locales/appNav';
import { getAboutPageText } from '../locales/aboutPage';

export function AboutPage() {
  const language = useCostStore((s) => s.language);
  const t = (key: string) => getAboutPageText(key, language);

  const featureItem = (label: string) => (
    <li
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        marginBottom: '0.8rem',
        color: 'var(--text-2)',
        fontSize: '0.9rem',
      }}
    >
      <span
        className="material-icons-round"
        style={{ fontSize: '1rem', color: 'var(--primary)' }}
      >
        check_circle
      </span>
      {label}
    </li>
  );

  const techRow = (label: string, value: string) => (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.8rem',
        color: 'var(--text-2)',
        fontSize: '0.9rem',
        marginBottom: '0.3rem',
      }}
    >
      <span
        style={{
          color: 'var(--primary)',
          fontWeight: '500',
          minWidth: '90px',
          fontSize: '0.9rem',
        }}
      >
        {label}
      </span>
      <span style={{ fontSize: '0.9rem' }}>{value}</span>
    </div>
  );

  return (
    <div className="page">
      <header
        style={{
          padding: '1rem 2rem',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 24,
        }}
      >
        <h2
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            margin: 0,
            fontSize: '1.5rem',
          }}
        >
          <span className="material-icons-round">info</span>
          {getAppNavLabel('about', language)}
        </h2>
        <LanguageSelector />
      </header>

      <div
        className="main-page-content"
        style={{
          background: `
          linear-gradient(135deg, rgba(0, 0, 0, 0.8) 0%, rgba(0, 0, 0, 0.6) 100%),
          url('/images/background.webp') center/cover no-repeat,
          radial-gradient(circle at 20% 80%, rgba(2, 154, 224, 0.1) 0%, transparent 50%),
          radial-gradient(circle at 80% 20%, rgba(2, 154, 224, 0.1) 0%, transparent 50%),
          radial-gradient(circle at 50% 50%, rgba(2, 154, 224, 0.02) 0%, transparent 50%)
        `,
          backgroundAttachment: 'fixed',
          minHeight: 'calc(100vh - 80px)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '2rem 1rem',
        }}
      >
        <div
          style={{
            position: 'relative',
            maxWidth: '1200px',
            width: '100%',
          }}
        >
          <div
            style={{
              backgroundColor: 'rgba(38, 38, 38, 0.9)',
              borderRadius: '8px',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              padding: '2rem',
              marginBottom: '2rem',
            }}
          >
            <h2
              style={{
                color: 'var(--primary)',
                marginBottom: '0.35rem',
                fontSize: '1.2rem',
                fontWeight: '600',
                textAlign: 'center',
              }}
            >
              {t('productTitle')}{' '}
              <span
                style={{ fontSize: '0.85rem', fontWeight: '400', opacity: 0.9 }}
              >
                v1.1.0
              </span>
            </h2>
            <p
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                color: '#fff',
                fontSize: '1.25rem',
                fontWeight: 600,
                textAlign: 'center',
                margin: '0 auto 1rem',
                letterSpacing: '0.03em',
                lineHeight: 1,
                textShadow:
                  '0 0 2px #2F79CC, 1px 1px 0 #2F79CC, -1px -1px 0 #2F79CC, 1px -1px 0 #2F79CC, -1px 1px 0 #2F79CC',
              }}
            >
              Costa
              <span
                className="material-icons-round"
                style={{
                  fontSize: '2.5rem',
                  color: 'var(--primary)',
                  lineHeight: 1,
                  textShadow:
                    '0 0 2px #2F79CC, 1px 1px 0 #2F79CC, -1px -1px 0 #2F79CC, 1px -1px 0 #2F79CC, -1px 1px 0 #2F79CC',
                }}
                aria-label="love"
              >
                favorite
              </span>
              BIM
            </p>
            <p
              style={{
                color: 'var(--text-secondary)',
                lineHeight: '1.6',
                marginBottom: '1.5rem',
                fontSize: '0.9rem',
                textAlign: 'center',
                maxWidth: '900px',
                margin: '0 auto 1.5rem',
              }}
            >
              {t('overview')}
            </p>

            <div
              style={{
                padding: '1rem',
                backgroundColor: 'rgba(255, 193, 7, 0.15)',
                borderRadius: '6px',
                border: '1px solid rgba(255, 193, 7, 0.3)',
                textAlign: 'center',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.5rem',
                  color: '#ffc107',
                  fontSize: '0.9rem',
                  fontWeight: '500',
                  marginBottom: '0.5rem',
                }}
              >
                <span
                  className="material-icons-round"
                  style={{ fontSize: '1rem' }}
                >
                  info
                </span>
                <strong>{t('statusTitle')}</strong>
              </div>
              <p
                style={{
                  color: 'var(--text-2)',
                  fontSize: '0.9rem',
                  margin: 0,
                  lineHeight: '1.4',
                }}
              >
                {t('statusBody')}
              </p>
            </div>
          </div>

          <div
            style={{
              backgroundColor: 'rgba(38, 38, 38, 0.9)',
              borderRadius: '8px',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              padding: '2rem',
              marginBottom: '2rem',
            }}
          >
            <h2
              style={{
                color: 'var(--primary)',
                marginBottom: '1.5rem',
                fontSize: '1.2rem',
                fontWeight: '600',
                textAlign: 'center',
              }}
            >
              {t('featuresTitle')}
            </h2>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
                gap: '2rem',
              }}
            >
              <div>
                <h3
                  style={{
                    color: 'var(--text-1)',
                    marginBottom: '1rem',
                    fontSize: '1rem',
                    fontWeight: '500',
                    textAlign: 'center',
                  }}
                >
                  {t('featMgmtTitle')}
                </h3>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {featureItem(t('featMgmt1'))}
                  {featureItem(t('featMgmt2'))}
                  {featureItem(t('featMgmt3'))}
                </ul>
              </div>

              <div>
                <h3
                  style={{
                    color: 'var(--text-1)',
                    marginBottom: '1rem',
                    fontSize: '1rem',
                    fontWeight: '500',
                    textAlign: 'center',
                  }}
                >
                  {t('featIntelTitle')}
                </h3>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {featureItem(t('featIntel1'))}
                  {featureItem(t('featIntel2'))}
                  {featureItem(t('featIntel3'))}
                  {featureItem(t('featIntel4'))}
                </ul>
              </div>

              <div>
                <h3
                  style={{
                    color: 'var(--text-1)',
                    marginBottom: '1rem',
                    fontSize: '1rem',
                    fontWeight: '500',
                    textAlign: 'center',
                  }}
                >
                  {t('featDocTitle')}
                </h3>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {featureItem(t('featDoc1'))}
                  {featureItem(t('featDoc2'))}
                  {featureItem(t('featDoc3'))}
                  {featureItem(t('featDoc4'))}
                </ul>
              </div>
            </div>
          </div>

          <div
            style={{
              backgroundColor: 'rgba(38, 38, 38, 0.9)',
              borderRadius: '8px',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              padding: '2rem',
            }}
          >
            <h2
              style={{
                color: 'var(--primary)',
                marginBottom: '1.5rem',
                fontSize: '1.2rem',
                fontWeight: '600',
                textAlign: 'center',
              }}
            >
              {t('techTitle')}
            </h2>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))',
                gap: '2rem',
              }}
            >
              <div>
                <h3
                  style={{
                    color: 'var(--primary)',
                    marginBottom: '1rem',
                    fontSize: '0.9rem',
                    fontWeight: '500',
                    textAlign: 'left',
                  }}
                >
                  {t('coreTech')}
                </h3>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(2, 1fr)',
                    gap: '1.2rem',
                    marginBottom: '1.5rem',
                  }}
                >
                  {techRow(t('labelFrontend'), 'React 18.2.0')}
                  {techRow(t('labelLanguage'), 'TypeScript 5.4.2')}
                  {techRow(t('labelBuild'), 'Vite 4.5.3')}
                  {techRow(t('labelState'), 'Zustand 5.0.3')}
                  {techRow(t('labelBackend'), 'Firebase 10.5.2')}
                  {techRow(t('labelBim'), '@thatopen 2.4.0')}
                  {techRow(t('labelCharts'), 'Chart.js 4.4')}
                  {techRow(t('labelExcel'), 'ExcelJS, XLSX')}
                </div>
              </div>

              <div>
                <h3
                  style={{
                    color: 'var(--primary)',
                    marginBottom: '1rem',
                    fontSize: '0.9rem',
                    fontWeight: '500',
                    textAlign: 'left',
                  }}
                >
                  {t('companyDevTitle')}
                </h3>

                <div style={{ marginBottom: '1.5rem' }}>
                  <h4
                    style={{
                      color: 'var(--text-1)',
                      marginBottom: '0.8rem',
                      fontSize: '0.9rem',
                      fontWeight: '500',
                      textAlign: 'left',
                    }}
                  >
                    {t('companyHeading')}
                  </h4>
                  <p
                    style={{
                      color: 'var(--text-2)',
                      fontSize: '0.85rem',
                      lineHeight: '1.5',
                      marginBottom: '0.8rem',
                    }}
                  >
                    {t('companyP1')}
                  </p>
                  <p
                    style={{
                      color: 'var(--text-2)',
                      fontSize: '0.85rem',
                      lineHeight: '1.5',
                      margin: 0,
                    }}
                  >
                    {t('companyP2')}
                  </p>
                </div>

                <div style={{ marginBottom: '1.5rem' }}>
                  <h4
                    style={{
                      color: 'var(--text-1)',
                      marginBottom: '0.8rem',
                      fontSize: '0.9rem',
                      fontWeight: '500',
                      textAlign: 'left',
                    }}
                  >
                    {t('developer')}
                  </h4>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.8rem',
                      color: 'var(--text-2)',
                      fontSize: '0.9rem',
                    }}
                  >
                    <span
                      className="material-icons-round"
                      style={{ fontSize: '1rem', color: 'var(--primary)' }}
                    >
                      person
                    </span>
                    Bruno Soto
                  </div>
                </div>

                <div>
                  <h4
                    style={{
                      color: 'var(--text-1)',
                      marginBottom: '0.8rem',
                      fontSize: '0.9rem',
                      fontWeight: '500',
                      textAlign: 'left',
                    }}
                  >
                    {t('linksTitle')}
                  </h4>
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.6rem',
                      alignItems: 'flex-start',
                    }}
                  >
                    <a
                      href="https://www.linkedin.com/in/bruno-soto-robles/"
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        color: 'var(--primary)',
                        textDecoration: 'none',
                        fontSize: '0.9rem',
                        transition: 'all 0.2s ease',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.opacity = '0.8';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.opacity = '1';
                      }}
                    >
                      <span
                        className="material-icons-round"
                        style={{ fontSize: '1rem' }}
                      >
                        link
                      </span>
                      {t('linkLinkedIn')}
                    </a>
                    <a
                      href="https://github.com/Asagra2002"
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        color: 'var(--primary)',
                        textDecoration: 'none',
                        fontSize: '0.9rem',
                        transition: 'all 0.2s ease',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.opacity = '0.8';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.opacity = '1';
                      }}
                    >
                      <span
                        className="material-icons-round"
                        style={{ fontSize: '1rem' }}
                      >
                        link
                      </span>
                      {t('linkGitHub')}
                    </a>
                    <a
                      href="https://co2data.fi/"
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        color: 'var(--primary)',
                        textDecoration: 'none',
                        fontSize: '0.9rem',
                        transition: 'all 0.2s ease',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.opacity = '0.8';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.opacity = '1';
                      }}
                    >
                      <span
                        className="material-icons-round"
                        style={{ fontSize: '1rem' }}
                      >
                        link
                      </span>
                      {t('linkCo2')}
                    </a>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
