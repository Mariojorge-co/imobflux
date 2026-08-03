import type { Metadata } from "next";
import "./globals.css";

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
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
