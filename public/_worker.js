/* HSK Tứ Kỹ — Cloudflare Worker (D1 + Workers AI)
 * API:
 *  POST /api/login            {id,pwd}            -> {token,user,must_change}
 *  POST /api/logout
 *  GET  /api/me
 *  POST /api/password         {old_pwd,new_pwd}
 *  GET  /api/progress                              -> {learned,stats,level,updated_at}
 *  PUT  /api/progress         {learned,stats,level}
 *  POST /api/activity         {kind,ref,score}
 *  GET  /api/comments?story=  -> [...]
 *  POST /api/comments         {story,text}
 *  DELETE /api/comments/:id   (chủ bình luận hoặc admin)
 *  POST /api/chat             {scenario,history:[{role,content}],text} -> {zh,py,vi,tip}
 *  GET  /api/admin/users      (admin)
 *  POST /api/admin/users      {id,name,pwd,role} (admin) — tạo / đặt lại mật khẩu
 *  POST /api/admin/users/:id/active {active}
 *  GET  /api/admin/progress   (admin) -> tiến độ mọi người
 *  GET  /api/ping
 */
const VERSION = '20261027-hoithoai-1';
const SESSION_DAYS = 90;

const json = (d, s = 200) => new Response(JSON.stringify(d), {
  status: s, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
});
const ok = d => json({ ok: true, ...d });
const bad = (m, s = 400) => json({ ok: false, error: m }, s);

async function hash(pwd, salt) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(pwd), 'PBKDF2', false, ['deriveBits']);
  const b = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations: 100000, hash: 'SHA-256' }, k, 256);
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}
const newSalt = () => 'hsk' + crypto.randomUUID().replace(/-/g, '').slice(0, 12);
const now = () => Date.now();

async function auth(req, env) {
  const t = (req.headers.get('authorization') || '').replace('Bearer ', '').trim();
  if (!t) return null;
  const r = await env.DB.prepare(
    `SELECT u.id,u.name,u.role,u.must_change,u.active FROM session s JOIN users u ON u.id=s.user_id
      WHERE s.token=? AND s.expires_at>?`).bind(t, now()).first();
  if (!r || !r.active) return null;
  return r;
}

async function readBody(req) { try { return await req.json(); } catch { return {}; } }

/* ---------- AI hội thoại ---------- */
const SYSTEM = (scenario, level) => `你是一位友善的中文老师，正在和一位越南学生用中文练习口语对话。
学生水平：HSK${level || 1}。请只使用 HSK${level || 1} 及以下的常用词汇，句子简短（每句不超过 15 个字）。
情景：${scenario || '自由聊天'}。
每一轮：先用一两句中文自然地回应学生并继续对话（可以提一个问题让学生回答）。
如果学生的句子有语法或用词错误，在 tip 中用越南语简短指出并给出正确说法；没有错误时 tip 为空字符串。
严格只输出 JSON，不要输出其他文字，格式：
{"zh":"你的中文回复","py":"对应拼音（带声调）","vi":"回复的越南语翻译","tip":"越南语纠错提示或空字符串"}`;

function parseAi(txt) {
  if (!txt) return null;
  txt = String(txt).replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  const m = txt.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { const o = JSON.parse(m[0]); if (o.zh) return { zh: String(o.zh), py: String(o.py || ''), vi: String(o.vi || ''), tip: String(o.tip || '') }; } catch { }
  return null;
}

async function runAi(env, model, messages) {
  const r = await env.AI.run(model, { messages, max_tokens: 400, temperature: 0.6 });
  return r?.response ?? r?.result?.response ?? (typeof r === 'string' ? r : '');
}

async function chat(req, env, me) {
  const b = await readBody(req);
  const history = Array.isArray(b.history) ? b.history.slice(-10) : [];
  const text = String(b.text || '').trim();
  const messages = [{ role: 'system', content: SYSTEM(b.scenario, b.level) }];
  for (const h of history) if (h && (h.role === 'user' || h.role === 'assistant') && h.content) messages.push({ role: h.role, content: String(h.content).slice(0, 400) });
  if (text) messages.push({ role: 'user', content: text.slice(0, 400) });
  else messages.push({ role: 'user', content: '（请你先开口，用一句简单的中文开始这个情景的对话。）' });

  let out = null, used = env.AI_MODEL;
  try { out = parseAi(await runAi(env, env.AI_MODEL, messages)); } catch (e) { out = null; }
  if (!out && env.AI_MODEL_FALLBACK) {
    used = env.AI_MODEL_FALLBACK;
    try { out = parseAi(await runAi(env, env.AI_MODEL_FALLBACK, messages)); } catch (e) { out = null; }
  }
  if (!out) return bad('AI chưa trả lời được, thử lại sau', 502);
  env.DB.prepare('INSERT INTO activity (user_id,kind,ref,score,created_at) VALUES (?,?,?,?,?)')
    .bind(me.id, 'chat', String(b.scenario || 'free').slice(0, 60), null, now()).run().catch(() => { });
  return ok({ ...out, model: used });
}

/* ---------- router ---------- */
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req);
    const p = url.pathname.slice(4), m = req.method;
    try {
      if (p === '/ping') return ok({ version: VERSION, ai: !!env.AI });

      if (p === '/login' && m === 'POST') {
        const { id, pwd } = await readBody(req);
        if (!id || !pwd) return bad('Thiếu tài khoản hoặc mật khẩu');
        const u = await env.DB.prepare('SELECT * FROM users WHERE id=?').bind(String(id).trim().toLowerCase()).first();
        if (!u || !u.active) return bad('Tài khoản không tồn tại hoặc đã khoá', 401);
        if (await hash(pwd, u.pwd_salt) !== u.pwd_hash) return bad('Sai mật khẩu', 401);
        const token = crypto.randomUUID().replace(/-/g, '');
        const exp = now() + SESSION_DAYS * 864e5;
        await env.DB.prepare('INSERT INTO session (token,user_id,expires_at) VALUES (?,?,?)').bind(token, u.id, exp).run();
        if (Math.random() < 0.05) await env.DB.prepare('DELETE FROM session WHERE expires_at<?').bind(now()).run();
        return ok({ token, user: { id: u.id, name: u.name, role: u.role }, must_change: !!u.must_change });
      }

      const me = await auth(req, env);
      if (!me) return bad('Chưa đăng nhập', 401);

      if (p === '/logout' && m === 'POST') {
        const t = (req.headers.get('authorization') || '').replace('Bearer ', '').trim();
        await env.DB.prepare('DELETE FROM session WHERE token=?').bind(t).run();
        return ok({});
      }
      if (p === '/me') return ok({ user: { id: me.id, name: me.name, role: me.role }, must_change: !!me.must_change });

      if (p === '/password' && m === 'POST') {
        const { old_pwd, new_pwd } = await readBody(req);
        if (!new_pwd || String(new_pwd).length < 4) return bad('Mật khẩu mới tối thiểu 4 ký tự');
        const u = await env.DB.prepare('SELECT pwd_hash,pwd_salt FROM users WHERE id=?').bind(me.id).first();
        if (await hash(old_pwd || '', u.pwd_salt) !== u.pwd_hash) return bad('Mật khẩu cũ không đúng', 401);
        const salt = newSalt();
        await env.DB.prepare('UPDATE users SET pwd_hash=?, pwd_salt=?, must_change=0 WHERE id=?').bind(await hash(new_pwd, salt), salt, me.id).run();
        return ok({});
      }

      if (p === '/progress' && m === 'GET') {
        const r = await env.DB.prepare('SELECT learned,stats,level,updated_at FROM progress WHERE user_id=?').bind(me.id).first();
        if (!r) return ok({ learned: [], stats: {}, level: 1, updated_at: 0 });
        return ok({ learned: JSON.parse(r.learned || '[]'), stats: JSON.parse(r.stats || '{}'), level: r.level, updated_at: r.updated_at });
      }
      if (p === '/progress' && m === 'PUT') {
        const b = await readBody(req);
        const learned = Array.isArray(b.learned) ? b.learned.filter(x => typeof x === 'string').slice(0, 20000) : [];
        const stats = b.stats && typeof b.stats === 'object' ? b.stats : {};
        const level = Number.isInteger(b.level) ? b.level : 1;
        await env.DB.prepare(`INSERT INTO progress (user_id,learned,stats,level,updated_at) VALUES (?,?,?,?,?)
          ON CONFLICT(user_id) DO UPDATE SET learned=excluded.learned, stats=excluded.stats, level=excluded.level, updated_at=excluded.updated_at`)
          .bind(me.id, JSON.stringify(learned), JSON.stringify(stats), level, now()).run();
        return ok({ updated_at: now(), count: learned.length });
      }

      if (p === '/activity' && m === 'POST') {
        const b = await readBody(req);
        await env.DB.prepare('INSERT INTO activity (user_id,kind,ref,score,created_at) VALUES (?,?,?,?,?)')
          .bind(me.id, String(b.kind || 'x').slice(0, 30), String(b.ref || '').slice(0, 80), Number.isFinite(b.score) ? Math.round(b.score) : null, now()).run();
        return ok({});
      }

      if (p === '/comments' && m === 'GET') {
        const sid = parseInt(url.searchParams.get('story') || '0', 10);
        const r = await env.DB.prepare('SELECT id,user_id,user_name,text,created_at FROM comment WHERE story_id=? ORDER BY created_at ASC LIMIT 200').bind(sid).all();
        return ok({ items: r.results || [] });
      }
      if (p === '/comments' && m === 'POST') {
        const b = await readBody(req);
        const text = String(b.text || '').trim().slice(0, 1000);
        const sid = parseInt(b.story, 10);
        if (!text || !Number.isInteger(sid)) return bad('Thiếu nội dung');
        const r = await env.DB.prepare('INSERT INTO comment (story_id,user_id,user_name,text,created_at) VALUES (?,?,?,?,?)').bind(sid, me.id, me.name, text, now()).run();
        return ok({ id: r.meta.last_row_id, created_at: now() });
      }
      let mm = p.match(/^\/comments\/(\d+)$/);
      if (mm && m === 'DELETE') {
        const c = await env.DB.prepare('SELECT user_id FROM comment WHERE id=?').bind(+mm[1]).first();
        if (!c) return bad('Không có bình luận này', 404);
        if (c.user_id !== me.id && me.role !== 'admin') return bad('Không có quyền', 403);
        await env.DB.prepare('DELETE FROM comment WHERE id=?').bind(+mm[1]).run();
        return ok({});
      }

      if (p === '/chat' && m === 'POST') return chat(req, env, me);

      /* ----- admin ----- */
      if (p.startsWith('/admin/')) {
        if (me.role !== 'admin') return bad('Chỉ quản trị viên', 403);
        if (p === '/admin/users' && m === 'GET') {
          const r = await env.DB.prepare('SELECT id,name,role,active,must_change,created_at FROM users ORDER BY created_at').all();
          return ok({ items: r.results || [] });
        }
        if (p === '/admin/users' && m === 'POST') {
          const b = await readBody(req);
          const id = String(b.id || '').trim().toLowerCase();
          if (!/^[a-z0-9_.]{2,30}$/.test(id)) return bad('Tên đăng nhập chỉ gồm chữ thường, số, _ . (2–30 ký tự)');
          const pwd = String(b.pwd || '');
          if (pwd.length < 4) return bad('Mật khẩu tối thiểu 4 ký tự');
          const role = b.role === 'admin' ? 'admin' : 'user';
          const salt = newSalt(), h = await hash(pwd, salt);
          const ex = await env.DB.prepare('SELECT id FROM users WHERE id=?').bind(id).first();
          if (ex) {
            await env.DB.prepare('UPDATE users SET pwd_hash=?, pwd_salt=?, must_change=1' + (b.name ? ', name=?' : '') + ' WHERE id=?')
              .bind(...(b.name ? [h, salt, String(b.name).slice(0, 60), id] : [h, salt, id])).run();
            await env.DB.prepare('DELETE FROM session WHERE user_id=?').bind(id).run();
            return ok({ reset: true });
          }
          const cnt = await env.DB.prepare('SELECT COUNT(*) c FROM users').first();
          if (cnt.c >= 12) return bad('Đã đủ 12 tài khoản (admin + vợ + 10 người học)');
          await env.DB.prepare('INSERT INTO users (id,name,role,pwd_hash,pwd_salt,must_change,active,created_at) VALUES (?,?,?,?,?,1,1,?)')
            .bind(id, String(b.name || id).slice(0, 60), role, h, salt, now()).run();
          return ok({ created: true });
        }
        mm = p.match(/^\/admin\/users\/([a-z0-9_.]+)\/active$/);
        if (mm && m === 'POST') {
          const b = await readBody(req);
          if (mm[1] === me.id) return bad('Không tự khoá chính mình');
          await env.DB.prepare('UPDATE users SET active=? WHERE id=?').bind(b.active ? 1 : 0, mm[1]).run();
          if (!b.active) await env.DB.prepare('DELETE FROM session WHERE user_id=?').bind(mm[1]).run();
          return ok({});
        }
        if (p === '/admin/progress' && m === 'GET') {
          const r = await env.DB.prepare(`SELECT u.id,u.name,u.role,u.active,p.learned,p.stats,p.level,p.updated_at,
              (SELECT COUNT(*) FROM activity a WHERE a.user_id=u.id AND a.created_at>?) AS acts7,
              (SELECT MAX(created_at) FROM activity a WHERE a.user_id=u.id) AS last_act
             FROM users u LEFT JOIN progress p ON p.user_id=u.id ORDER BY u.created_at`).bind(now() - 7 * 864e5).all();
          const items = (r.results || []).map(x => ({
            id: x.id, name: x.name, role: x.role, active: x.active, level: x.level || 1, updated_at: x.updated_at || 0,
            learned: x.learned ? JSON.parse(x.learned).length : 0, stats: x.stats ? JSON.parse(x.stats) : {}, acts7: x.acts7, last_act: x.last_act
          }));
          return ok({ items });
        }
      }
      return bad('Không có API này', 404);
    } catch (e) {
      return bad('Lỗi máy chủ: ' + (e && e.message || e), 500);
    }
  }
};
