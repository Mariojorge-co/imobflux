import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import "./globals.css";
import { themeInitScript } from "@/lib/ui/theme";

export const metadata: Metadata = {
  title: "ImobFlux",
  description: "CRM para corretores imobiliários",
};

// O teclado do celular encolhe a área da página (a caixa de mensagem sobe junto), em vez de cobri-la.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  interactiveWidget: "resizes-content",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // suppressHydrationWarning: o script abaixo põe a classe `dark` no <html> antes da hidratação (sem piscar o tema).
    <html className={GeistSans.className} lang="pt-BR" suppressHydrationWarning>
      <head>
        <meta content="light dark" name="color-scheme" />
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
