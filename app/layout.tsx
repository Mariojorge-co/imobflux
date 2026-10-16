import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import "./globals.css";
import { themeInitScript } from "@/lib/ui/theme";

export const metadata: Metadata = {
  title: "ImobFlux",
  description: "CRM para corretores imobiliários",
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
