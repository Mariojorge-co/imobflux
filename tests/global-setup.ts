import { execSync } from "child_process";

export default async function globalSetup() {
  const env = {
    ...process.env,
    PATH: `C:\\Users\\User\\AppData\\Local\\Programs\\DockerDesktop\\resources\\bin;${process.env.PATH || ""}`,
  };

  execSync("npx.cmd --yes supabase@2.111.0 db reset --local --no-seed", {
    env,
    stdio: "pipe",
  });

  const sql = 'ALTER ROLE postgres SET search_path TO "$user", public, extensions; ALTER DATABASE postgres SET search_path TO "$user", public, extensions;';
  execSync('docker exec -i supabase_db_imobflux psql -h 127.0.0.1 -U postgres -d postgres', {
    env,
    input: sql,
    stdio: "pipe",
  });
}
