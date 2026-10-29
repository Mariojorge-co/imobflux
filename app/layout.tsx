import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import "./globals.css";
import { FieldFontGuard } from "@/components/field-font-guard";
import { themeInitScript } from "@/lib/ui/theme";

export const metadata: Metadata = {
  title: "ImobFlux",
  description: "CRM para corretores imobiliários",
  // iOS: ao instalar na tela inicial abre como app (sem barras do navegador). Barra de status normal: o conteúdo não passa por baixo dela.
  appleWebApp: { capable: true, title: "ImobFlux", statusBarStyle: "default" },
  formatDetection: { telephone: false },
};

// O teclado do celular encolhe a área da página (a caixa de mensagem sobe junto), em vez de cobri-la.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  interactiveWidget: "resizes-content",
  // Usa a tela toda (inclusive atrás da barra de início do iPhone); as áreas seguras são respeitadas com env(safe-area-inset-*).
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8fafc" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1120" },
  ],
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
      <body>
        <FieldFontGuard />
        {children}
      </body>
    </html>
  );
}
