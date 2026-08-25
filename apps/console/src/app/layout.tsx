import type { ReactNode } from 'react';
import { IBM_Plex_Mono, Instrument_Sans } from 'next/font/google';
import './globals.css';

/* Fintech-grade type: Instrument Sans for the chrome, Plex Mono for data values.
   Self-hosted by next/font — no runtime font request leaves the machine. */
const sans = Instrument_Sans({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-sans' });
const mono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-mono' });
import { Header } from '../components/header';
import { currentActor } from '../lib/actor';
import { visibleSpecs } from '../lib/registry';

export const metadata = {
  title: 'Internal Tools Console',
  description: 'One console, many internal tools.',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const actor = await currentActor();
  const specs = visibleSpecs(actor);

  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>
        <div className="shell">
          <Header actor={actor} specs={specs} />
          <main>{children}</main>
        </div>
      </body>
    </html>
  );
}
