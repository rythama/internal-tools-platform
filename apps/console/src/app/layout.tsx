import type { ReactNode } from 'react';
import './globals.css';
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
    <html lang="en">
      <body>
        <Header actor={actor} specs={specs} />
        <main>{children}</main>
      </body>
    </html>
  );
}
