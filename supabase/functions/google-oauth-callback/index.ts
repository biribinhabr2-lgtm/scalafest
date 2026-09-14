import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

serve(async (req) => {
  const url = new URL(req.url)
  const code = url.searchParams.get("code")
  const state = url.searchParams.get("state") // user_id em base64

  if (!code || !state) {
    return Response.redirect(
      "https://escalafesta.netlify.app/dashboard?error=oauth_failed"
    )
  }

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: Deno.env.get("GOOGLE_CLIENT_ID")!,
      client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!,
      redirect_uri: Deno.env.get("GOOGLE_REDIRECT_URI")!,
      grant_type: "authorization_code",
    }),
  })

  const tokens = await tokenRes.json()

  if (!tokens.refresh_token) {
    // Google só devolve refresh_token na PRIMEIRA autorização.
    // Se não veio, o usuário precisa revogar em myaccount.google.com/permissions e re-autorizar.
    return Response.redirect(
      "https://escalafesta.netlify.app/dashboard?error=no_refresh_token"
    )
  }

  let userId: string
  try {
    userId = atob(state)
  } catch {
    return Response.redirect(
      "https://escalafesta.netlify.app/dashboard?error=oauth_failed"
    )
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  )

  await supabase.from("google_calendar_tokens").upsert(
    {
      tenant_id: userId,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_expiry: new Date(
        Date.now() + tokens.expires_in * 1000
      ).toISOString(),
      sync_enabled: true,
    },
    { onConflict: "tenant_id" }
  )

  return Response.redirect(
    "https://escalafesta.netlify.app/dashboard?success=calendar_connected"
  )
})
