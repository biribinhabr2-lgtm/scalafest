// supabase/functions/api-eventos/index.ts
//
// Entry point da Edge Function.
// Toda a lógica fica em _handler.ts para permitir testes sem side-effects.
//
// Deploy:
//   supabase functions deploy api-eventos --no-verify-jwt

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { processRequest } from './_handler.ts'

serve(processRequest)
