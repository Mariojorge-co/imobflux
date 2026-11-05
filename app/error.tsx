"use client";

import Link from "next/link";
import {
  ErrorScreen,
  ERROR_BUTTON_CLASSES,
  ERROR_PRIMARY_CLASSES,
  ERROR_SECONDARY_CLASSES,
} from "@/components/errors/error-screen";

// Erro inesperado em qualquer página: texto fixo em português. O erro real (mensagem/stack) fica só no log do servidor; aqui
// nada é mostrado nem registrado no navegador além do código `digest` que o Next gera para cruzar com o log.
export default function AppError({ unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return (
    <ErrorScreen
      actions={
        <>
          <button className={`${ERROR_BUTTON_CLASSES} ${ERROR_PRIMARY_CLASSES}`} onClick={unstable_retry} type="button">
            Tentar de novo
          </button>
          <Link className={`${ERROR_BUTTON_CLASSES} ${ERROR_SECONDARY_CLASSES}`} href="/hoje">
            Ir para o Hoje
          </Link>
        </>
      }
      description="Tente de novo. Se continuar, avise o suporte."
      title="Algo deu errado."
    />
  );
}
