'use strict';
const sb = require('../../../config/supabase');
const T = 'sf_pontos_encontro';

module.exports = {
  list:   (adminId)        => sb.from(T).select('*').eq('admin_id', adminId).order('nome'),
  get:    (id, adminId)    => sb.from(T).select('*').eq('id', id).eq('admin_id', adminId).single(),
  create: (adminId, data)  => sb.from(T).insert({ ...data, admin_id: adminId }).select().single(),
  update: (id, adminId, d) => sb.from(T).update(d).eq('id', id).eq('admin_id', adminId).select().single(),
  remove: (id, adminId)    => sb.from(T).delete().eq('id', id).eq('admin_id', adminId),
};
