import { execSync } from "child_process";
import * as net from "net";
import * as path from "path";
import * as fs from "fs";

function checkTcpPort(host: string, port: number, timeoutMs = 2000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let status = false;

    socket.setTimeout(timeoutMs);

    socket.on("connect", () => {
      status = true;
      socket.destroy();
    });

    socket.on("timeout", () => {
      socket.destroy();
    });

    socket.on("error", () => {
      socket.destroy();
    });

    socket.on("close", () => {
      resolve(status);
    });

    socket.connect(port, host);
  });
}

async function validateLocalEnvironment() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";

  if (!supabaseUrl.includes("127.0.0.1") && !supabaseUrl.includes("localhost")) {
    throw new Error(
      `SEGURANÇA FAIL-CLOSED ABORT: URL do Supabase '${supabaseUrl}' não é local (127.0.0.1 / localhost).`
    );
  }

  const isLocalDbPortOpen = await checkTcpPort("127.0.0.1", 54322);

  if (!isLocalDbPortOpen) {
    throw new Error(
      "ERRO FAIL-CLOSED: O Supabase local não está em execução na porta 54322. Inicie o ambiente local com 'npx supabase start' antes de operar o Demo Mode."
    );
  }
}

function runSqlFile(relativeFilePath: string) {
  const absolutePath = path.join(process.cwd(), relativeFilePath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Arquivo SQL não encontrado: ${absolutePath}`);
  }

  const sqlContent = fs.readFileSync(absolutePath, "utf-8");

  const env = {
    ...process.env,
    PATH: `C:\\Users\\User\\AppData\\Local\\Programs\\DockerDesktop\\resources\\bin;${process.env.PATH || ""}`,
  };

  const command = `docker exec -i supabase_db_imobflux psql -h 127.0.0.1 -v ON_ERROR_STOP=1 -U postgres -d postgres`;

  console.log(`[Demo Mode] Executando ${relativeFilePath}...`);
  execSync(command, {
    env,
    input: sqlContent,
    stdio: ["pipe", "inherit", "inherit"],
  });

  execSync("docker exec -i supabase_db_imobflux psql -h 127.0.0.1 -U postgres -d postgres", {
    env,
    input: 'ALTER ROLE postgres SET search_path TO "$user", public, extensions; ALTER DATABASE postgres SET search_path TO "$user", public, extensions;',
    stdio: ["pipe", "ignore", "ignore"],
  });
}

async function main() {
  const args = process.argv.slice(2);
  const isLoad = args.includes("--load");
  const isClean = args.includes("--clean");
  const isReset = args.includes("--reset");

  if (!isLoad && !isClean && !isReset) {
    console.error("Uso: tsx scripts/demo-control.ts [--load | --clean | --reset]");
    process.exit(1);
  }

  try {
    await validateLocalEnvironment();

    if (isClean || isReset) {
      console.log("[Demo Mode] Limpando dados fictícios do workspace local...");
      runSqlFile("supabase/demo/clean_demo_data.sql");
    }

    if (isLoad || isReset) {
      runSqlFile("supabase/demo/bootstrap_local_workspace.sql");
      console.log("[Demo Mode] Carregando 20 clientes fictícios no workspace local...");
      runSqlFile("supabase/demo/demo_data.sql");
    }

    console.log("[Demo Mode] Operação concluída com sucesso!");
  } catch (error) {
    console.error(`[Demo Mode Error] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

main();
