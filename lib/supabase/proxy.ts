import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getPublicSupabaseConfig } from "@/lib/supabase/config";
import type { Database } from "@/types/database";

const privatePaths = [
  "/prioridades",
  "/contatos",
  "/conversas",
  "/kanban",
  "/configuracoes",
];

function isPrivatePath(pathname: string) {
  return privatePaths.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

export async function refreshSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const { clientKey, url } = getPublicSupabaseConfig();

  const supabase = createServerClient<Database>(url, clientKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });

        response = NextResponse.next({ request });

        cookiesToSet.forEach(({ name, options, value }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  const { data } = await supabase.auth.getClaims();

  if (!data?.claims && isPrivatePath(request.nextUrl.pathname)) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    return NextResponse.redirect(loginUrl);
  }

  return response;
}
