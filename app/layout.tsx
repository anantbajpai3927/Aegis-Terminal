import type { Metadata } from 'next';
import { Plus_Jakarta_Sans, DM_Sans, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-display',
  display: 'swap',
});

const dmSans = DM_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-body',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Aegis Terminal',
  description:
    'Zero-hallucination tri-agent verification terminal with synchronized reasoning audit, persistent document/URL grounding, and full-duplex live voice.',
  openGraph: {
    title: 'Aegis Terminal',
    description:
      'Zero-hallucination tri-agent verification terminal with synchronized reasoning audit, persistent document/URL grounding, and full-duplex live voice.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Aegis Terminal',
    description:
      'Zero-hallucination tri-agent verification terminal with synchronized reasoning audit, persistent document/URL grounding, and full-duplex live voice.',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${plusJakarta.variable} ${dmSans.variable} ${jetbrainsMono.variable}`}
    >
      <body className="min-h-screen bg-[#0b0d10] text-[#eef1f6] antialiased selection:bg-[#2a3342] selection:text-white" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
