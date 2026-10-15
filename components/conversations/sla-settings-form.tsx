"use client";

import { useId, useState, useTransition } from "react";
import { Button, Card, Input, Select } from "@/components/ui";
import { updateSlaSettingsAction } from "@/lib/conversations/sla-settings-actions";
import { DEFAULT_SLA_SETTINGS, formatLimit, type SlaSettings } from "@/lib/conversations/sla";
import { SLA_SETTING_FIELDS, splitMinutes, toMinutes, validateSlaSettings, type TimeUnit } from "@/lib/conversations/sla-settings";

type FieldState = { value: string; unit: TimeUnit };
type FormState = Record<keyof SlaSettings, FieldState>;

function toForm(settings: SlaSettings): FormState {
  const entries = SLA_SETTING_FIELDS.map((field) => {
    const { value, unit } = splitMinutes(settings[field.key]);
    return [field.key, { value: String(value), unit }] as const;
  });
  return Object.fromEntries(entries) as FormState;
}

function fromForm(form: FormState): SlaSettings {
  const read = (key: keyof SlaSettings) => {
    const number = Number(form[key].value.replace(",", "."));
    return Number.isFinite(number) ? toMinutes(number, form[key].unit) : Number.NaN;
  };
  return {
    teamGreenUntil: read("teamGreenUntil"),
    teamYellowUntil: read("teamYellowUntil"),
    teamOrangeUntil: read("teamOrangeUntil"),
    teamRedUntil: read("teamRedUntil"),
    followup1: read("followup1"),
    followup2: read("followup2"),
    followup3: read("followup3"),
  };
}

/** Configurações > Prazos: limites de "Cliente aguardando" e de follow-up (só o proprietário). */
export function SlaSettingsForm({ initial }: { initial: SlaSettings }) {
  const baseId = useId();
  const [saved, setSaved] = useState(initial);
  const [form, setForm] = useState<FormState>(() => toForm(initial));
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const draft = fromForm(form);
  const validation = validateSlaSettings(draft);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  const update = (key: keyof SlaSettings, changes: Partial<FieldState>) => {
    setMessage(null);
    setError(null);
    setForm((previous) => ({ ...previous, [key]: { ...previous[key], ...changes } }));
  };

  const save = () => {
    if (!validation.ok) {
      setError(validation.error);
      return;
    }
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await updateSlaSettingsAction(draft);
      if (result.success) {
        setSaved(result.settings);
        setForm(toForm(result.settings));
        setMessage("Prazos salvos. Já valem em todas as telas.");
      } else {
        setError(result.error);
      }
    });
  };

  const restoreDefaults = () => {
    setForm(toForm(DEFAULT_SLA_SETTINGS));
    setMessage(null);
    setError(null);
  };

  const renderGroup = (group: "team" | "followup") => (
    <div className="space-y-3">
      {SLA_SETTING_FIELDS.filter((field) => field.group === group).map((field) => {
        const id = `${baseId}-${field.key}`;
        return (
          <div className="grid gap-1 sm:grid-cols-[12rem_1fr] sm:items-start sm:gap-3" key={field.key}>
            <label className="pt-2 text-body font-medium text-text" htmlFor={id}>
              {field.label}
            </label>
            <div>
              <div className="flex gap-2">
                <Input
                  className="max-w-28"
                  id={id}
                  inputMode="decimal"
                  min={1}
                  onChange={(event) => update(field.key, { value: event.target.value })}
                  type="number"
                  value={form[field.key].value}
                />
                <Select
                  aria-label={`Unidade de ${field.label}`}
                  className="max-w-32"
                  onChange={(event) => update(field.key, { unit: event.target.value as TimeUnit })}
                  value={form[field.key].unit}
                >
                  <option value="min">minutos</option>
                  <option value="h">horas</option>
                  <option value="d">dias</option>
                </Select>
              </div>
              <p className="mt-1 text-caption text-text-muted">{field.help}</p>
            </div>
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="max-w-3xl space-y-stack">
      <p className="text-body text-text-muted">
        Defina em que momento uma conversa muda de cor e quando ela entra no painel de Prioridades. São avisos para a
        equipe: <strong>nenhuma mensagem automática é enviada ao cliente</strong>. Grupos e a conversa com você mesmo
        nunca têm prazo.
      </p>

      <Card>
        <h2 className="text-body font-semibold text-text">Cliente aguardando (a equipe deve resposta)</h2>
        <p className="mb-3 text-caption text-text-muted">Conta a partir da última mensagem do cliente.</p>
        {renderGroup("team")}
        <p className="mt-3 text-caption text-text-muted" data-testid="team-preview">
          Verde até {formatLimit(Number.isNaN(draft.teamGreenUntil) ? 0 : draft.teamGreenUntil)} · amarelo até {formatLimit(Number.isNaN(draft.teamYellowUntil) ? 0 : draft.teamYellowUntil)} · laranja até {formatLimit(Number.isNaN(draft.teamOrangeUntil) ? 0 : draft.teamOrangeUntil)} · vermelho até {formatLimit(Number.isNaN(draft.teamRedUntil) ? 0 : draft.teamRedUntil)} · depois, vermelho grave.
        </p>
      </Card>

      <Card>
        <h2 className="text-body font-semibold text-text">Aguardando cliente / follow-up (o cliente está parado)</h2>
        <p className="mb-3 text-caption text-text-muted">
          Conta a partir da última mensagem da equipe. O painel de Prioridades mostra as conversas que passaram do 1º nível.
        </p>
        {renderGroup("followup")}
        <p className="mt-3 text-caption text-text-muted" data-testid="followup-preview">
          Entra no painel após {formatLimit(Number.isNaN(draft.followup1) ? 0 : draft.followup1)}; fica laranja após {formatLimit(Number.isNaN(draft.followup2) ? 0 : draft.followup2)} e vermelho após {formatLimit(Number.isNaN(draft.followup3) ? 0 : draft.followup3)}.
        </p>
      </Card>

      {error ? (
        <p className="rounded-control bg-danger-soft px-3 py-2 text-caption font-medium text-danger" data-testid="sla-settings-error" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="rounded-control bg-emerald-500/10 px-3 py-2 text-caption font-medium text-emerald-700 dark:text-emerald-400" data-testid="sla-settings-saved" role="status">
          {message}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button disabled={isPending || !dirty} onClick={save}>
          {isPending ? "Salvando…" : "Salvar prazos"}
        </Button>
        <Button disabled={isPending} onClick={restoreDefaults} variant="secondary">
          Restaurar padrões
        </Button>
      </div>
    </div>
  );
}
