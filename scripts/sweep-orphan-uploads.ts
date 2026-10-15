// Varredura de uploads órfãos do envio de arquivos: arquivos em `<workspace>/<conversa>/out/` do bucket privado
// `whatsapp-media` que nunca viraram mensagem (a pessoa escolheu o arquivo e desistiu, fechou a aba, o envio falhou
// antes de gravar). Por padrão só LISTA (simulação). Para apagar de verdade: `--apply`.
//
//   npx tsx scripts/sweep-orphan-uploads.ts [--older-than-hours 24] [--apply]
//
// Lê NEXT_PUBLIC_SUPABASE_URL e SUPABASE_ADMIN_KEY do ambiente (nunca imprime a chave). Roda só com o ambiente que
// você escolheu; contra produção, só com autorização expressa.
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const hoursIndex = args.indexOf("--older-than-hours");
const hours = hoursIndex >= 0 ? Number(args[hoursIndex + 1]) : 24;

if (!Number.isFinite(hours) || hours < 1) {
  console.error("Use --older-than-hours com um número maior ou igual a 1.");
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_ADMIN_KEY;
if (!url || !key) {
  console.error("Defina NEXT_PUBLIC_SUPABASE_URL e SUPABASE_ADMIN_KEY no ambiente.");
  process.exit(1);
}

async function main() {
  const admin = createClient(url as string, key as string, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await admin.rpc("list_orphan_outbound_uploads", { p_older_than: `${hours} hours` });
  if (error) {
    console.error(`Falha ao listar órfãos (código ${error.code ?? "desconhecido"}).`);
    process.exit(1);
  }
  const names = (data ?? []) as string[];
  console.log(`${names.length} upload(s) órfão(s) com mais de ${hours} h.`);
  if (names.length === 0) return;
  if (!apply) {
    console.log("Simulação: nada foi apagado. Use --apply para apagar.");
    return;
  }
  const { error: removeError } = await admin.storage.from("whatsapp-media").remove(names);
  if (removeError) {
    console.error("Falha ao apagar os órfãos.");
    process.exit(1);
  }
  console.log(`${names.length} arquivo(s) apagado(s).`);
}

void main();
