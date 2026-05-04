import aiohttp
import random
from astrbot.api.all import *

@register("ai_draw_manager", "lixia051", "Novelai分发插件", "2.0.0")
class AIDrawManagerPlugin(Star):
    def __init__(self, context: Context):
        super().__init__(context)
        # 必看----部署前，请替换以下三个变量
        self.api_url = "https://你的域名.com/discord-api"  # 你的 Cloudflare Worker 接口地址
        self.api_secret = "Bearer your_super_secret_here"  # 你的机器人api (需与 CF 环境变量一致)
        self.admin_id = "123456789"  # 你的最高权限管理员 ID 

    def is_admin(self, event: AstrMessageEvent) -> bool:
        return str(event.get_sender_id()) == self.admin_id

    def is_private_chat(self, event: AstrMessageEvent) -> bool:
        """
        [跨平台兼容版] 兼容 Discord、QQ 等多平台的私聊判断逻辑
        """
        # 管理员放行
        # if self.is_admin(event):
        #    return True

        # 对平台的特殊底层判断
        try:
            raw_ctx = getattr(event.message_obj, "raw_message", None)
            if raw_ctx is not None:
                if hasattr(raw_ctx, "guild") and raw_ctx.guild is None:
                    return True
                if hasattr(raw_ctx, "guild_id") and raw_ctx.guild_id is None:
                    return True
        except Exception:
            pass 

        # 平台常规判断 (兼容QQ/微信等)
        group_id = str(event.get_group_id()).strip()
        if not group_id or group_id in ("", "0", "None") or group_id == str(event.get_sender_id()):
            return True

        return False

    def random_refuse_text(self) -> str:
        replies = [
            "请私聊我获取密码哦，群里发会被别人偷走的！",
            "安全起见，密码只能在私聊发放哦~",
            "这里人太多啦，点击我的头像私聊发送指令吧！",
            "群聊禁止获取密钥，请私聊机器人操作。"
        ]
        return random.choice(replies)

    # ===用户功能指令 ===

    @command("getkey")
    async def getkey_cn(self, event: AstrMessageEvent):
        """[玩家] 获取你的专属画图密码"""
        user_id = str(event.get_sender_id())

        # 公屏不发 key，只给拒绝提示
        if not self.is_private_chat(event):
            yield event.plain_result(self.random_refuse_text())
            return

        yield event.plain_result("正在连接服务器拉取数据，请稍候...")

        async with aiohttp.ClientSession() as session:
            try:
                async with session.post(
                    self.api_url,
                    headers={"Authorization": self.api_secret},
                    # 跨平台 user_id
                    json={"discord_id": user_id, "action": "get_key"}
                ) as resp:
                    data = await resp.json()

                    if data.get("success"):
                        if data.get("is_new"):
                            yield event.plain_result(
                                f"欢迎！您的专属密码是：\n`{data['token']}`\n请妥善保管，填入绘图客户端使用。"
                            )
                        else:
                            yield event.plain_result(
                                f"您的密码找回成功：\n`{data['token']}`\n请勿泄露给他人哦！"
                            )
                    else:
                        yield event.plain_result("获取失败，服务器响应异常...")
            except Exception as e:
                yield event.plain_result(f"网络错误：{e}")

    @command("qiandao")
    async def qiandao_cn(self, event: AstrMessageEvent):
        """[玩家] 每日签到恢复画图额度"""
        user_id = str(event.get_sender_id())
        async with aiohttp.ClientSession() as session:
            try:
                async with session.post(
                    self.api_url,
                    headers={"Authorization": self.api_secret},
                    json={"discord_id": user_id, "action": "sign_in"}
                ) as resp:
                    data = await resp.json()
                    if data.get("success"):
                        yield event.plain_result("签到成功！今日画图额度已满血恢复！")
                    else:
                        yield event.plain_result(f"签到失败：{data.get('error')}\n请先发送 /getkey 注册哦！")
            except Exception as e:
                yield event.plain_result(f"网络错误：{e}")

    @command("tutorial")
    async def tutorial_cn(self, event: AstrMessageEvent):
        """[玩家] 查看详细使用教程"""
        tutorial_text = """
  **AI 绘图系统使用教程** 

**第一步：获取专属密码**
请务必【私聊】机器人发送 `/getkey` 指令，获取 `sk-` 开头的专属密钥。

**第二步：配置绘图客户端**
1. 打开您的绘图软件（需支持第三方站点转发）。
2. 在 API 接口地址栏填入站长提供的 URL。
3. 在 API 密钥 (Token) 栏填入获取的 `sk-...` 密码。

**第三步：关于额度与签到**
- 每人每天有基础请求额度。
- 额度耗尽后，跨天发送 `/qiandao` 即可恢复满血！

  **常见问题排查：**
- 报错 `404` 或 `Failed to fetch`：请检查接口地址是否填写正确，且首尾没有多余空格。
- 报错频次过高：系统设有单人冷却时间，请勿狂点，等待 30 秒后再试。
        """
        yield event.plain_result(tutorial_text)

    # === 管理员控制台指令 ===
    # admin 指令

    @command("admin_reset_all")
    async def admin_reset_all_cn(self, event: AstrMessageEvent):
        """[管理员] 刷新全体用户的今日额度"""
        if not self.is_admin(event):
            yield event.plain_result("权限不足！")
            return

        async with aiohttp.ClientSession() as session:
            async with session.post(self.api_url, headers={"Authorization": self.api_secret}, json={"discord_id": "admin", "action": "admin_reset_quotas"}) as resp:
                if (await resp.json()).get("success"):
                    yield event.plain_result("全体用户额度已恢复")

    @command("admin_set_limit")
    async def admin_set_limit_cn(self, event: AstrMessageEvent, limit_num: int):
        """[管理员] 修改全体用户的每日画图上限额度"""
        if not self.is_admin(event):
            yield event.plain_result("权限不足！")
            return

        async with aiohttp.ClientSession() as session:
            async with session.post(self.api_url, headers={"Authorization": self.api_secret}, json={"discord_id": "admin", "action": "admin_set_limit", "limit": limit_num}) as resp:
                if (await resp.json()).get("success"):
                    yield event.plain_result(f"全体用户的每日额度上限已修改为 {limit_num} 张！")

    @command("admin_revive_keys")
    async def admin_reset_keys_cn(self, event: AstrMessageEvent):
        """[管理员] 重置所有Key的数据并解封死号"""
        if not self.is_admin(event):
            yield event.plain_result("权限不足！")
            return

        async with aiohttp.ClientSession() as session:
            async with session.post(self.api_url, headers={"Authorization": self.api_secret}, json={"discord_id": "admin", "action": "admin_reset_keys"}) as resp:
                if (await resp.json()).get("success"):
                    yield event.plain_result("所有底层 Key 数据已清零并解除封禁！")

    @command("admin_view_keys")
    async def admin_view_keys_cn(self, event: AstrMessageEvent):
        """[管理员] 查看所有底层Key的工作状态与 ID"""
        if not self.is_admin(event):
            yield event.plain_result("权限不足！")
            return

        yield event.plain_result("正在扫描底层节点...")
        async with aiohttp.ClientSession() as session:
            async with session.post(self.api_url, headers={"Authorization": self.api_secret}, json={"discord_id": "admin", "action": "admin_view_keys"}) as resp:
                data = await resp.json()
                if data.get("success"):
                    keys = data.get("keys", [])
                    if not keys:
                        yield event.plain_result("节点池为空。")
                        return

                    msg = " **底层节点状态报告**\n```\nID | 状态   | 今日调用 | 密钥前缀\n------------------------------------\n"
                    for k in keys:
                        status_str = str(k['status']).ljust(6)
                        usage_str = str(k['daily_usage']).ljust(8)
                        msg += f"{k['id']:<2} | {status_str} | {usage_str} | {k['secret_prefix']}\n"
                    msg += "```"
                    yield event.plain_result(msg)

    @command("admin_add_key")
    async def admin_add_key_cn(self, event: AstrMessageEvent, secret: str):
        """[管理员] 添加一个新的 API 密钥 (需以 pst- 开头)"""
        if not self.is_admin(event):
            yield event.plain_result("权限不足！")
            return

        if not self.is_private_chat(event):
            yield event.plain_result("请私聊执行该命令，避免密钥泄露。")
            return

        async with aiohttp.ClientSession() as session:
            async with session.post(
                self.api_url,
                headers={"Authorization": self.api_secret},
                json={"discord_id": "admin", "action": "admin_add_key", "secret": secret}
            ) as resp:
                data = await resp.json()
                if data.get("success"):
                    yield event.plain_result("新节点已成功入池！")
                else:
                    yield event.plain_result(f"添加失败：{data.get('error')}")

    @command("admin_del_key")
    async def admin_del_key_cn(self, event: AstrMessageEvent, key_id: int):
        """[管理员] 根据 ID 删除一个失效的底层密钥"""
        if not self.is_admin(event):
            yield event.plain_result("权限不足！")
            return

        async with aiohttp.ClientSession() as session:
            async with session.post(self.api_url, headers={"Authorization": self.api_secret}, json={"discord_id": "admin", "action": "admin_del_key", "key_id": key_id}) as resp:
                data = await resp.json()
                if data.get("success"):
                    yield event.plain_result(f"ID 为 {key_id} 的节点已移除！")
                else:
                    yield event.plain_result(f"删除失败：{data.get('error')}")
