#  nai2api

> **⚠️ 声明 (Read Me First)**
> - **没点 Star 和 Follow 的同学**：严禁将本项目用于任何形式的商业盈利（包括但不限于：二次转售、有偿代部署、挂在后台对外提供付费接口、包装成商业 API 中转服务出售等）。
> - **点了 Star 的人**：我什么都没看见
> 
> *代码本体按 MIT License 开源。请务必遵守上游模型（NovelAI）的官方服务条款，因商业滥用引发的一切纠纷与作者无关。*

基于 Cloudflare Workers + D1 数据库构建的 NovelAI 高性能防刷中转网关。
零服务器成本，原生支持并发排队、IP 限频、密钥池轮询以及 astrbot 机器人联动管理。

## ✨ 核心特性

- ☁️ **Serverless 架构**：完全依托 Cloudflare 免费额度，无需购买云服务器。
- 🔄 **智能密钥池**：支持导入多个底层 `pst-` 密钥，自动轮询接客。
- 🛡️ **高并发与防刷**：
  - 原子锁机制：防止单密钥被并发调用导致报错。
  - 边缘 IP 拦截：1 小时内请求过多自动拉黑，保护底层节点。
  - 单人冷却时间：自带 30 秒 CD 防护。
- 🤖 **僵尸节点自动隔离**：当底层节点失效 (返回 401/403) 时，系统会自动将其打入冷宫，避免影响用户体验。
- 👥 **用户独立额度管理**：每个人生成独立的 `sk-` 令牌，支持每日限额、签到刷新。


## 部署前必须修改

### Worker
请在 Cloudflare Variables and Secrets 中添加：

- API_SECRET：机器人访问 Worker 的密钥

### AstrBot 插件
打开 ai_draw_manager 插件，修改：

```python
self.api_url = "https://你的Worker域名/discord-api"
self.api_secret = "Bearer 你的API_SECRET"
self.admin_id = "你的QQ号或Discord用户ID"
```

## 部署指南

### 第一步：创建 D1 数据库
1. 进入 Cloudflare 控制台 -> `Workers & Pages` -> `D1`。
2. 创建一个名为 `naid1` 的数据库。
3. 进入该数据库，选择 `Console (控制台)`，依次执行以下 SQL 语句建表：

```sql
-- 1. 用户表
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    sk_token TEXT UNIQUE,
    daily_limit INTEGER DEFAULT 20, -- 每天的限额，比如 20 
    used_today INTEGER DEFAULT 0,
    status TEXT DEFAULT 'active',
    last_sign_in INTEGER DEFAULT 0,
    last_draw_time INTEGER DEFAULT 0
);

-- 2. 密钥池表
CREATE TABLE nai_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    secret TEXT UNIQUE,
    status TEXT DEFAULT 'active',
    locked_until INTEGER DEFAULT 0,
    last_used_at INTEGER DEFAULT 0,
    daily_usage INTEGER DEFAULT 0
);

-- 3. 请求日志表
CREATE TABLE logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    key_id INTEGER,
    edge_ip TEXT,
    status_code INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```
### 第二步：部署 Worker 代码
在 Cloudflare 中新建一个 Worker。

将仓库中的 worker.js 代码全部复制并覆盖进去。

点击右上角的 部署。

### 第三步：绑定变量与数据库 (重要！)
进入该 Worker 的 Settings (设置) -> Bindings (绑定)。

绑定数据库：添加一个 D1 Database 绑定，变量名 必须填 naid1，并选择你刚才创建的数据库。

设置安全密钥：进入 Variables and Secrets (变量和机密)，添加一个环境变量：

变量名：API_SECRET

值：你自己设定的机器人api

（如astrbot插件里填 self.api_secret = "Bearer your_super_secret_here"
cf环境变量设置 API_SECRET = your_super_secret_here）

## 前端使用说明

本项目自带**【前端网页】**与**【聊天机器人】**两模式，底层数据互通，你可以根据自己的社群类型任选其一，或两者混用！

### 模式一：纯享版 Web 前端 (适合无群组的个人站长/论坛)
如果你没有 QQ 群或 Discord 服务器，只需要一个前端网站：
1. **如何访问**：直接在浏览器输入 `https://你的Worker域名/register`。
2. **如何获取**：用户在网页输入自己的常用 ID，点击生成，即可在网页上直接获得 `sk-` 开头的密钥。
3. **如何关闭**：如果你想用机器人，不希望别人通过网页获取，可以打开 `worker.js`，将 `if (url.pathname === '/register') { ... }` 这一段代码直接删除即可。

---

### 模式二：社群 Bot 模式 (配合 AstrBot 插件)
适合有自己 QQ 群、Discord 服务器的群主。请将本仓库提供的 `ai_draw_manager` 插件填好放入 AstrBot 框架中使用。
打开astrbot里的plugins目录，创建插件目录，然后把填好信息的ai_draw_manager复制进去即可


#### 🔵 Discord 平台操作指南
Discord 支持原生斜杠指令，体验最佳。
* **用户获取密码**：
  * **必须私聊**：用户需要点击机器人的头像，进入**私聊界面 (Direct Messages)**。
  * **发送指令**：在私聊中输入 `/getkey` 获取专属密码；输入 `/qiandao` 恢复每日画图额度。
  * **防呆机制**：如果用户在公开频道输入 `/getkey`，机器人会傲娇地拒绝发放密码，并提示用户私聊。
* **站长管理**：
  * 站长可以在私聊或自己能看见的隐秘管理频道中，输入 `/admin_view_keys`、`/admin_add_key` 等指令来管理底层节点池。

#### 🐧 QQ / 微信平台操作指南
* **用户获取密码**：
  * **必须私聊**：用户必须在 QQ 里加机器人为好友，或者在群聊临时会话中**私聊机器人**。
  * **发送指令**：发送 `/getkey` 和 `/qiandao`。
  * **防呆机制**：如果群友在 QQ 群内直接发送 `/getkey`，机器人会进行拦截并回复。
* **站长管理**：
  * 站长只需用绑定的管理员 QQ 号私聊机器人，发送管理指令即可实时监控底层状态，无需再打开cf。

---

## 🎨 绘图客户端通用配置 (智绘姬/SillyTavern等)

当用户通过【网页】或【机器人】拿到密码后，只需在各种 AI 绘图软件中这样配置：
1. **接口地址 (API URL)**：填入 `https://你的Worker域名` *(注意：不要带 /register或者v1，首尾不要有空格！)*
2. **API 密钥 (Token)**：填入机器人或网页发放的 `sk-xxxxxxxx`。

## ⚠️ 免责声明
本项目仅供学习与技术交流，请勿用于任何商业或非法用途。请尊重 NovelAI 官方的使用条款。