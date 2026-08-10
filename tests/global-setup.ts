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
}
