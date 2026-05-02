import { ImageResponse } from 'next/og';

/**
 * OG image — rendered as JSX, generated at edge runtime.
 *
 * Visible whenever a1de.xyz is shared (Slack, iMessage, Twitter).
 * Dimensions are 1200x630 (the universal social card size).
 *
 * Why dynamic + JSX instead of a static PNG: we get to use the live
 * accent color and the same Newsreader serif as the app, in one source
 * of truth. No image editor in the loop.
 */

export const runtime = 'edge';
export const alt = 'A1DE — Your personal family AI assistant';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          height: '100%',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: 80,
          background:
            'linear-gradient(135deg, hsl(18,78%,55%) 0%, hsl(28,78%,62%) 60%, hsl(38,72%,68%) 100%)',
          color: '#1a0d05',
          fontFamily: 'serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 14,
              background: '#1a0d05',
              color: 'hsl(18,78%,55%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontStyle: 'italic',
              fontSize: 40,
              fontWeight: 500,
            }}
          >
            a
          </div>
          <span style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.02em' }}>A1DE</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              fontSize: 96,
              lineHeight: 1.05,
              fontStyle: 'italic',
              fontWeight: 500,
              letterSpacing: '-0.03em',
              maxWidth: 900,
            }}
          >
            Remember what matters.
          </div>
          <div style={{ marginTop: 24, fontSize: 28, fontStyle: 'normal', maxWidth: 900, opacity: 0.85 }}>
            Your personal family AI assistant — calendar, email, health,
            golf, and everything in between.
          </div>
        </div>
      </div>
    ),
    size,
  );
}
