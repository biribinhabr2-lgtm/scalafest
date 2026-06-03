'use strict';

const { createClient } = require('@supabase/supabase-js');

// Node.js < 22 não tem WebSocket nativo — passa o pacote "ws" como transport
// para que o cliente Realtime do Supabase funcione corretamente.
const ws = require('ws');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  {
    auth: {
      // Servidor não precisa de sessão de usuário
      persistSession: false,
      autoRefreshToken: false,
    },
    realtime: {
      transport: ws,
    },
  }
);

module.exports = supabase;
