import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'IALAW Anonimizador documental',
  description: 'Plataforma local IALAW para anonimizar documentos en lote.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
