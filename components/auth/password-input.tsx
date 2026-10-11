"use client";

import { useEffect, useRef, useState, type ComponentPropsWithoutRef } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui";

type PasswordInputProps = Omit<ComponentPropsWithoutRef<"input">, "type">;

// O nome acessível do botão é constante ("Mostrar caracteres") e o estado vai em aria-pressed.
// Evita a palavra "senha" para não colidir com o rótulo do campo em leitores de tela e seletores.
export function PasswordInput({ className, ...props }: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Ao enviar o formulário, o campo volta a ficar oculto.
  useEffect(() => {
    const form = inputRef.current?.form;
    if (!form) return;
    const hide = () => setVisible(false);
    form.addEventListener("submit", hide);
    return () => form.removeEventListener("submit", hide);
  }, []);

  return (
    <div className="relative">
      <Input {...props} className={`pr-12 ${className ?? ""}`.trim()} ref={inputRef} type={visible ? "text" : "password"} />
      <button
        aria-label="Mostrar caracteres"
        aria-pressed={visible}
        className="absolute inset-y-0 right-0 flex min-h-11 min-w-11 items-center justify-center rounded-control text-text-muted outline-none hover:text-text focus-visible:ring-2 focus-visible:ring-primary/30"
        onClick={() => setVisible((current) => !current)}
        title={visible ? "Ocultar caracteres" : "Mostrar caracteres"}
        type="button"
      >
        {visible ? <EyeOff aria-hidden="true" size={18} /> : <Eye aria-hidden="true" size={18} />}
      </button>
    </div>
  );
}
