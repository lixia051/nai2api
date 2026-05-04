export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);

      if (request.method === 'OPTIONS') {
        return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': '*', 'Access-Control-Allow-Headers': '*' }});
      }

      // ==========================================
      // 1.(供 AstrBot 调用)

            if (url.pathname === '/discord-api') {
        if (request.method !== 'POST') {
          return new Response("Method Not Allowed", { status: 405 });
        }

        // 从 CF 环境变量中读取你的机器人 API 密钥
        if (!env.API_SECRET) {
          return new Response(JSON.stringify({ error: "Server missing API_SECRET" }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        const auth = request.headers.get('Authorization');
        if (auth !== `Bearer ${env.API_SECRET}`) { 
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        const data = await request.json();
        const discordId = String(data.discord_id || '').trim();
        const action = data.action;

        if (!discordId) {
          return new Response(JSON.stringify({ error: "missing discord_id" }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          });
        }


         // === 玩家的基础指令 ===
        if (action === 'get_key') {
          let user = await env.naid1.prepare("SELECT sk_token FROM users WHERE username = ?").bind(discordId).first();
          if (user) {
            return new Response(JSON.stringify({ success: true, is_new: false, token: user.sk_token }), { headers: { 'Content-Type': 'application/json' } });
          } else {
            const skToken = 'sk-' + crypto.randomUUID();
            await env.naid1.prepare("INSERT INTO users (username, sk_token, daily_limit, used_today, status) VALUES (?, ?, ?, ?, ?)").bind(discordId, skToken, 20, 0, 'active').run();
            return new Response(JSON.stringify({ success: true, is_new: true, token: skToken }), { headers: { 'Content-Type': 'application/json' } });
          }
        }

        if (action === 'sign_in') {
          // 先查出这个人
          let user = await env.naid1.prepare("SELECT * FROM users WHERE username = ?").bind(discordId).first();
          if (!user) {
              return new Response(JSON.stringify({ success: false, error: "未找到账号，请先使用 /getkey 获取密码哦" }), { headers: { 'Content-Type': 'application/json' } });
          }

          const nowSec = Math.floor(Date.now() / 1000);
          // 转换为东八区日期字符串
          const todayStr = new Date(nowSec * 1000 + 8 * 3600 * 1000).toISOString().split('T')[0];
          const lastSignInStr = user.last_sign_in ? new Date(user.last_sign_in * 1000 + 8 * 3600 * 1000).toISOString().split('T')[0] : "";

          // 判断最后一次签到的日期是不是今天
          if (lastSignInStr === todayStr) {
              return new Response(JSON.stringify({ success: false, error: "杂鱼哥哥太贪心啦！今天已经签到过了哦，明天再来吧~" }), { headers: { 'Content-Type': 'application/json' } });
          }

          // 清空今日用量，把当前的签到时间更新进去
          await env.naid1.prepare("UPDATE users SET used_today = 0, last_sign_in = ? WHERE username = ?").bind(nowSec, discordId).run();
          
          return new Response(JSON.stringify({ success: true, message: "签到成功！" }), { headers: { 'Content-Type': 'application/json' } });
        }

        // === 管理员的指令 ===
        if (action === 'admin_reset_quotas') {
          await env.naid1.prepare("UPDATE users SET used_today = 0").run();
          return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
        }
        if (action === 'admin_set_limit') {
          const newLimit = parseInt(data.limit);
          if (isNaN(newLimit) || newLimit < 0) return new Response(JSON.stringify({ error: "参数错误" }), { status: 400 });
          await env.naid1.prepare("UPDATE users SET daily_limit = ?").bind(newLimit).run();
          return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
        }
        if (action === 'admin_reset_keys') {
          await env.naid1.prepare("UPDATE nai_keys SET daily_usage = 0, status = 'active', locked_until = 0").run();
          return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
        }
        if (action === 'admin_view_keys') {
          const { results } = await env.naid1.prepare("SELECT id, substr(secret, 1, 10) || '...' as secret_prefix, status, daily_usage FROM nai_keys ORDER BY id ASC").all();
          return new Response(JSON.stringify({ success: true, keys: results }), { headers: { 'Content-Type': 'application/json' } });
        }
        
        // 添加novelai的token（在qq使用时要私聊，否则会明文出现在公屏）
        if (action === 'admin_add_key') {
          const secret = data.secret;
          if (!secret || !secret.startsWith('pst-')) {
              return new Response(JSON.stringify({ error: "格式错误，密钥必须以 pst- 开头" }), { status: 400 });
          }
          await env.naid1.prepare("INSERT INTO nai_keys (secret, status, locked_until, last_used_at, daily_usage) VALUES (?, 'active', 0, 0, 0)").bind(secret).run();
          return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
        }
        
        // 删除过期或被ban的token
        if (action === 'admin_del_key') {
          const keyId = parseInt(data.key_id);
          if (isNaN(keyId)) return new Response(JSON.stringify({ error: "ID 错误" }), { status: 400 });
          const result = await env.naid1.prepare("DELETE FROM nai_keys WHERE id = ?").bind(keyId).run();
          if (result.meta.changes === 0) return new Response(JSON.stringify({ error: "找不到该 ID 的密钥" }), { status: 404 });
          return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
        }

        return new Response(JSON.stringify({ error: "Invalid action" }), { status: 400 });
      }

      // ==========================================
      // 前端部分，不需要可以弃用，如果要用务必接入d1数据库
      // ==========================================
      // 保留这个页面，如果不想让人通过网页注册，直接把下面这一块删掉即可
      // ==========================================
      if (url.pathname === '/register') {
        if (request.method === 'GET') {
          const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AI 绘图接口 | 专属通行证</title>
    <link href="https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@700&display=swap" rel="stylesheet">
    <style>
        body, html {
            margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden;
            /* 背景图自己改 background-image */
            background: linear-gradient(135deg, #fdfcfb 0%, #e2d1c3 100%);
            font-family: 'Segoe UI', system-ui, sans-serif;
        }
        #particles-js { position: absolute; width: 100%; height: 100%; top: 0; left: 0; z-index: 2; }
        .main-panel {
            position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
            width: 90%; max-width: 480px; padding: 40px 30px;
            background: rgba(255, 255, 255, 0.25); 
            backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
            border: 1px solid rgba(255, 255, 255, 0.5); 
            border-radius: 20px; text-align: center; 
            box-shadow: 0 15px 35px rgba(0, 0, 0, 0.1); z-index: 10;
        }
        h1 {
            font-family: 'Noto Serif SC', serif; font-size: 2.5rem; color: #333; margin: 0;
            letter-spacing: 5px; text-shadow: 1px 1px 0 #ffffff;
        }
        .subtitle { color: #666; letter-spacing: 1px; font-size: 0.9rem; margin-top: 10px; margin-bottom: 25px; font-weight: bold; }
        
        .api-box { 
            margin-bottom: 25px; padding: 12px; background: rgba(255, 255, 255, 0.6); 
            border-radius: 12px; border: 1px dashed #aaa; 
            cursor: pointer; transition: all 0.3s ease; position: relative;
        }
        .api-box:hover { background: rgba(255, 255, 255, 0.9); transform: scale(1.02); border-color: #666; }
        .api-label { font-size: 12px; color: #555; font-weight: bold; margin-bottom: 4px; }
        .api-value { font-family: 'Courier New', monospace; font-size: 16px; color: #d32f2f; font-weight: bold; word-break: break-all; }

        .input-group { margin-bottom: 20px; text-align: left; }
        input { 
            width: 100%; box-sizing: border-box; background: rgba(255, 255, 255, 0.8); 
            border: 1px solid #ccc; color: #333; 
            padding: 14px 16px; border-radius: 12px; font-size: 16px; outline: none; 
            transition: all 0.3s ease; font-weight: bold; text-align: center;
        }
        input::placeholder { color: #999; font-weight: normal; }
        input:focus { border-color: #666; background: #fff; box-shadow: 0 0 10px rgba(0, 0, 0, 0.1); }
        .action-btn { 
            width: 100%; background: #4a90e2; color: white; border: none; 
            padding: 15px; border-radius: 12px; font-size: 16px; font-weight: bold; 
            cursor: pointer; transition: all 0.3s ease; box-shadow: 0 4px 15px rgba(74, 144, 226, 0.3); 
            letter-spacing: 1px;
        }
        .action-btn:hover { background: #357abd; transform: translateY(-2px); box-shadow: 0 6px 20px rgba(74, 144, 226, 0.4); }
        .action-btn:active { transform: translateY(1px); }
        .action-btn:disabled { opacity: 0.7; cursor: not-allowed; transform: none; }
        .result-box { 
            margin-top: 25px; padding: 20px; background: rgba(255, 255, 255, 0.8); 
            border-radius: 15px; border: 1px dashed #4a90e2; display: none; 
        }
        .result-title { font-size: 13px; color: #333; margin-bottom: 8px; font-weight: bold; }
        .token-display { 
            font-family: 'Courier New', monospace; font-size: 20px; color: #d32f2f; 
            font-weight: bold; word-break: break-all; cursor: pointer; padding: 12px; 
            background: #fff; border-radius: 8px; 
            border: 1px solid rgba(211, 47, 47, 0.3); transition: all 0.2s;
        }
        .token-display:hover { background: #fdfdfd; transform: scale(1.02); }
        .hint { font-size: 12px; color: #666; margin-top: 12px; font-weight: bold; }
        #toast {
            position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
            background: rgba(0, 0, 0, 0.8); color: white; padding: 10px 25px;
            border-radius: 8px; font-size: 0.9rem; z-index: 10001; font-weight: bold;
            display: none; animation: fadeInOut 2s forwards;
        }
        @keyframes fadeInOut { 0% { opacity: 0; top: 0;} 15% { opacity: 1; top: 20px;} 85% { opacity: 1; top: 20px;} 100% { opacity: 0; top: 0;} }
    </style>
</head>
<body>
    <div id="toast">✅ 已成功复制到剪贴板！</div>
    <div id="particles-js"></div>

    <div class="main-panel">
        <h1>API 通行证</h1>
        <p class="subtitle">— 请联系系统管理员或通过机器人获取密钥 —</p>
        
        <div class="api-box" onclick="copyApiUrl()">
            <div class="api-label">🔗 接口 URL (点击复制)</div>
            <div class="api-value" id="apiUrlDisplay">加载中...</div>
        </div>
        
        <div class="input-group">
            <input type="text" id="username" placeholder="请输入用户 ID" autocomplete="off">
        </div>

        <button id="submitBtn" class="action-btn" onclick="reg()">点击生成密钥</button>
        
        <div id="resultBox" class="result-box">
            <div class="result-title">这是你的密钥：</div>
            <div id="tokenDisplay" class="token-display" onclick="copyToken()"></div>
            <div class="hint">点击红字即可复制密钥。</div>
        </div>
    </div>

    <script src="https://cdn.jsdelivr.net/particles.js/2.0.0/particles.min.js"></script>
    <script>
        //动态获取当前部署的域名
        const currentDomain = window.location.origin;
        document.getElementById('apiUrlDisplay').innerText = currentDomain;

        async function reg() { 
            const u = document.getElementById('username').value.trim(); 
            if(!u) return showToast('请填写用户 ID！'); 
            
            const btn = document.getElementById('submitBtn');
            const resBox = document.getElementById('resultBox');
            const tokenDisp = document.getElementById('tokenDisplay');
            
            btn.disabled = true;
            btn.innerText = "正在生成中...";
            resBox.style.display = "none";
            
            try {
                const r = await fetch('/register', { method:'POST', headers: {'Content-Type': 'application/json'}, body:JSON.stringify({username:u}) }); 
                const d = await r.json(); 
                
                if(d.success) {
                    tokenDisp.innerText = d.token;
                    resBox.style.display = "block";
                    btn.innerText = "✅ 生成成功";
                } else {
                    showToast("❌ 生成失败，请联系管理员！");
                    btn.innerText = "重新生成";
                    btn.disabled = false;
                }
            } catch(e) {
                showToast("❌ 网络错误，请稍后再试！");
                btn.innerText = "重新生成";
                btn.disabled = false;
            }
        }

        function copyToken() {
            const token = document.getElementById('tokenDisplay').innerText;
            navigator.clipboard.writeText(token).then(() => {
                showToast('✅ 密钥复制成功！');
            });
        }

        function copyApiUrl() {
            navigator.clipboard.writeText(currentDomain).then(() => {
                showToast('✅ 接口地址复制成功！');
            });
        }

        function showToast(msg) {
            const toast = document.getElementById('toast');
            toast.innerText = msg;
            toast.style.display = 'block';
            setTimeout(() => { toast.style.display = 'none'; }, 2500);
        }

        particlesJS('particles-js', {
            "particles": {
                "number": { "value": 60 }, "color": { "value": "#666666" },
                "opacity": { "value": 0.4, "random": true }, "size": { "value": 3, "random": true },
                "line_linked": { "enable": true, "distance": 150, "color": "#aaaaaa", "opacity": 0.3, "width": 1 },
                "move": { "enable": true, "speed": 2, "direction": "none", "out_mode": "out" }
            }
        });
    </script>
</body>
</html>`;
          return new Response(html, { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
        } 
               else if (request.method === 'POST') {
          const { username } = await request.json();
          const cleanName = String(username || '').trim();

          if (!cleanName) {
            return errorResponse("用户 ID 不能为空", 400);
          }

          const existing = await env.naid1.prepare(
            "SELECT sk_token FROM users WHERE username = ?"
          ).bind(cleanName).first();

          if (existing) {
            return new Response(JSON.stringify({
              success: true,
              is_new: false,
              token: existing.sk_token
            }), {
              headers: { 'Content-Type': 'application/json' }
            });
          }

          const skToken = 'sk-' + crypto.randomUUID(); 
          await env.naid1.prepare(
            "INSERT INTO users (username, sk_token, daily_limit, used_today, status) VALUES (?, ?, ?, ?, ?)"
          ).bind(cleanName, skToken, 20, 0, 'active').run();

          return new Response(JSON.stringify({
            success: true,
            is_new: true,
            token: skToken
          }), {
            headers: { 'Content-Type': 'application/json' }
          });
        }
      }


      // ==========================================
      // 签到部分
      // ==========================================
      const authHeader = request.headers.get('Authorization');
      let clientToken = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : "";

      const user = await env.naid1.prepare("SELECT * FROM users WHERE sk_token = ? AND status = 'active'").bind(clientToken).first();
      if (!user) return errorResponse("笨蛋杂鱼哥哥填错密码了啦！", 401);
      
      const nowSec = Math.floor(Date.now() / 1000);

      // 二次检查
      if (user.used_today >= user.daily_limit) {
          return errorResponse("杂鱼哥哥好像没有额度了哦，快去Discord找泉此方签到吧！", 429);
      }

      // 每人30秒cd，只要小于30秒一律拦截
      if (nowSec - (user.last_draw_time || 0) < 30) {
          return errorResponse("杂鱼哥哥慢点啦！罚你30秒cd!(说明你点太快了)", 429);
      }

      // 边缘 IP 限制，目的是为了防止这个cf的ip多次访问官网防止封号
      const edgeIp = request.headers.get('cf-connecting-ip') || 'unknown';
      const ipCheck = await env.naid1.prepare(`SELECT count(id) as c FROM logs WHERE edge_ip = ? AND created_at >= datetime('now', '-1 hour')`).bind(edgeIp).first();
      if (ipCheck && ipCheck.c > 30) {
          return errorResponse("杂鱼哥哥真倒霉呢~稍后再试试吧(说明分到的ip用的人很多,再试试)", 429);
      }

      // 原子锁，每个token锁60秒
      const lockUntilSec = nowSec + 60;
      const selectedKey = await env.naid1.prepare(`
        UPDATE nai_keys 
        SET locked_until = ? 
        WHERE id = (SELECT id FROM nai_keys WHERE status = 'active' AND locked_until <= ? ORDER BY last_used_at ASC LIMIT 1) 
        RETURNING *
      `).bind(lockUntilSec, nowSec).first();

      if (!selectedKey) return errorResponse("杂鱼哥哥手速真慢呢，乖乖排队吧...(你现在在pvp)", 429);

      // 更新最后一次的画图时间
      await env.naid1.prepare("UPDATE users SET last_draw_time = ? WHERE id = ?").bind(nowSec, user.id).run();

      // 已删除

    

      if (url.pathname.includes('/generate-image')) url.hostname = 'image.novelai.net';
      else url.hostname = 'api.novelai.net';

      const newHeaders = new Headers(request.headers);
      newHeaders.set('Authorization', `Bearer ${selectedKey.secret}`);
      newHeaders.set('Host', url.hostname);
      newHeaders.set('Origin', 'https://novelai.net');
      newHeaders.set('Referer', 'https://novelai.net/');
      newHeaders.delete('Accept-Encoding');

      const abortSignal = AbortSignal.timeout(25000); 
      const modifiedRequest = new Request(url.toString(), {
        method: request.method, headers: newHeaders,
        body: request.method === 'GET' || request.method === 'HEAD' ? null : request.body, 
        redirect: 'follow',
        signal: abortSignal 
      });

      let response;
      try {
         response = await fetch(modifiedRequest);

         if (response.status === 401 || response.status === 403) {
             console.log(`Key ${selectedKey.id} 已失效或被封，直接打入冷宫！`);
             ctx.waitUntil(
                 env.naid1.prepare("UPDATE nai_keys SET status = 'banned', locked_until = 0 WHERE id = ?").bind(selectedKey.id).run()
             );
             return errorResponse("底层节点失效，系统已自动隔离该节点，请杂鱼哥哥重新点击生成~(说明这个key被封了)", 502);
         }

      } catch (e) {
         if (e.name === 'TimeoutError' || e.name === 'AbortError') {
            const timeoutSec = Math.floor(Date.now() / 1000);
            ctx.waitUntil(
              env.naid1.prepare("UPDATE nai_keys SET locked_until = ?, last_used_at = ? WHERE id = ?")
              .bind(timeoutSec + 120, timeoutSec, selectedKey.id).run()
            );
            return errorResponse("上游响应超时(25秒保护)，已自动切断，杂鱼哥哥稍后再试吧~", 504); 
         }
         
         await env.naid1.prepare("UPDATE nai_keys SET locked_until = 0 WHERE id = ?").bind(selectedKey.id).run();
         return errorResponse("上游请求失败: " + e.message, 502);
      }

      ctx.waitUntil((async () => {
         try {
             await env.naid1.prepare("UPDATE users SET used_today = used_today + 1 WHERE id = ?").bind(user.id).run();
             await env.naid1.prepare("INSERT INTO logs (user_id, key_id, edge_ip, status_code) VALUES (?, ?, ?, ?)").bind(user.id, selectedKey.id, edgeIp, response.status).run();
         } catch (err) { console.error("日志记录失败:", err); }
         finally {
             const endSec = Math.floor(Date.now() / 1000);
             const jitterCooldown = Math.floor(Math.random() * 26) + 20; 
             await env.naid1.prepare("UPDATE nai_keys SET locked_until = ?, last_used_at = ?, daily_usage = daily_usage + 1 WHERE id = ?").bind(endSec + jitterCooldown, endSec, selectedKey.id).run();
         }
      })());

      const finalResponse = new Response(response.body, response);
      finalResponse.headers.set('Access-Control-Allow-Origin', '*');
      return finalResponse;

    } catch (fatalError) {
      return errorResponse("杂鱼哥哥真笨呢~: " + fatalError.message, 500);
    }
  }
};

function errorResponse(msg, status) {
  return new Response(JSON.stringify({ error: msg }), {
    status: status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}