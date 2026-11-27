import type { Metadata } from 'next';
import { Montserrat } from 'next/font/google';
import 'leaflet/dist/leaflet.css';
import './globals.css';

const montserrat = Montserrat({ subsets: ['latin'], variable: '--fuente-montserrat' });

export const metadata: Metadata = {
  title: 'Rastreo · Industrias Reynales',
  description: 'Panel de despacho para el rastreo de camiones',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={montserrat.variable}>
      <body>{children}</body>
    </html>
  );
}
