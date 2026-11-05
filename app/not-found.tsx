import type { Metadata } from "next";
import Link from "next/link";
import { ErrorScreen, ERROR_BUTTON_CLASSES, ERROR_PRIMARY_CLASSES } from "@/components/errors/error-screen";

export const metadata: Metadata = { title: "Página não encontrada · ImobFlux" };

export default function NotFound() {
  return (
    <ErrorScreen
      actions={
        <Link className={`${ERROR_BUTTON_CLASSES} ${ERROR_PRIMARY_CLASSES}`} href="/hoje">
          Ir para o Hoje
        </Link>
      }
      description="O endereço não existe ou foi movido."
      kind="not-found"
      title="Página não encontrada"
    />
  );
}
