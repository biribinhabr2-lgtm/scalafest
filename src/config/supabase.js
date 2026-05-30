'use strict';

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  {
    auth: {
      // Servidor não precisa de sessão de usuário
      persistSession: false,
      autoRefreshToken: false,
    },
  }
);

module.exports = supabase;
