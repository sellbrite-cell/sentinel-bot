import discord
from discord.ext import commands, tasks
from discord import app_commands
import asyncio
from datetime import datetime, timedelta
import pytz
import os

# ============================
# 설정
# ============================
TOKEN = os.getenv("DISCORD_TOKEN")
TIMER_CHANNEL_ID = int(os.getenv("TIMER_CHANNEL_ID", 0))  # 젠타이머 채널 ID
KST = pytz.timezone('Asia/Seoul')

# ============================
# 보스 데이터
# ============================
BOSSES = {
    "레마넌트":  {"level": 40, "type": "timer", "hours": 8},
    "베나토리아": {"level": 50, "type": "timer", "hours": 8},
    "샤렌나":   {"level": 60, "type": "timer", "hours": 10},
    "칼리브락스": {"level": 70, "type": "timer", "hours": 12},
    "아르칸다르": {"level": 75, "type": "timer", "hours": 12},
    "벨카르":   {"level": 80, "type": "timer", "hours": 15},
    "사바토":   {"level": 85, "type": "fixed", "weekday": 4, "hour": 18, "minute": 30},  # 금요일
    "말록":    {"level": 90, "type": "fixed", "weekday": 5, "hour": 18, "minute": 30},  # 토요일
    "샤를레":   {"level": 99, "type": "fixed", "weekday": 6, "hour": 18, "minute": 30},  # 일요일
}

WEEKDAY_KR = {4: "금요일", 5: "토요일", 6: "일요일"}

# 활성 타이머 저장 {보스명: {"spawn_time": datetime, "channel_id": int}}
active_timers = {}

# ============================
# 봇 초기화
# ============================
intents = discord.Intents.default()
client = discord.Client(intents=intents)
tree = app_commands.CommandTree(client)


@client.event
async def on_ready():
    await tree.sync()
    check_fixed_bosses.start()
    print(f"✅ 센티넬 봇 온라인: {client.user}")


# ============================
# /보스킬 커맨드 (타이머 보스)
# ============================
@tree.command(name="보스킬", description="보스 처치 기록 및 젠 타이머 시작")
@app_commands.describe(보스이름="처치한 보스를 선택하세요")
@app_commands.choices(보스이름=[
    app_commands.Choice(name="Lv.40 레마넌트  (8시간)", value="레마넌트"),
    app_commands.Choice(name="Lv.50 베나토리아 (8시간)", value="베나토리아"),
    app_commands.Choice(name="Lv.60 샤렌나   (10시간)", value="샤렌나"),
    app_commands.Choice(name="Lv.70 칼리브락스 (12시간)", value="칼리브락스"),
    app_commands.Choice(name="Lv.75 아르칸다르 (12시간)", value="아르칸다르"),
    app_commands.Choice(name="Lv.80 벨카르   (15시간)", value="벨카르"),
])
async def boss_kill(interaction: discord.Interaction, 보스이름: str):
    boss = BOSSES.get(보스이름)
    if not boss or boss["type"] != "timer":
        await interaction.response.send_message("❌ 해당 보스는 타이머 보스가 아닙니다.", ephemeral=True)
        return

    now = datetime.now(KST)
    spawn_time = now + timedelta(hours=boss["hours"])
    active_timers[보스이름] = {"spawn_time": spawn_time, "channel_id": interaction.channel_id}

    embed = discord.Embed(
        title=f"💀 {보스이름} 처치 완료!",
        color=0xE74C3C
    )
    embed.add_field(name="레벨", value=f"Lv.{boss['level']}", inline=True)
    embed.add_field(name="리스폰", value=f"{boss['hours']}시간 후", inline=True)
    embed.add_field(name="다음 젠 시간", value=f"🕐 **{spawn_time.strftime('%m/%d (%a) %H:%M')}**", inline=False)
    embed.set_footer(text=f"처치 시간: {now.strftime('%Y-%m-%d %H:%M:%S')} (KST)")

    await interaction.response.send_message(embed=embed)
    asyncio.create_task(send_spawn_alert(보스이름, spawn_time, interaction.channel_id))


# ============================
# /젠현황 커맨드
# ============================
@tree.command(name="젠현황", description="현재 활성 젠 타이머 목록 확인")
async def timer_status(interaction: discord.Interaction):
    now = datetime.now(KST)

    if not active_timers:
        await interaction.response.send_message("⏰ 현재 진행 중인 타이머가 없습니다.", ephemeral=True)
        return

    embed = discord.Embed(title="⏰ 젠 타이머 현황", color=0x5865F2)

    for boss_name, data in sorted(active_timers.items(), key=lambda x: x[1]["spawn_time"]):
        remaining = data["spawn_time"] - now
        secs = int(remaining.total_seconds())

        if secs > 0:
            h, r = divmod(secs, 3600)
            m = r // 60
            embed.add_field(
                name=f"⚔️ {boss_name} (Lv.{BOSSES[boss_name]['level']})",
                value=f"남은 시간: **{h}시간 {m}분**\n젠 시간: `{data['spawn_time'].strftime('%m/%d %H:%M')}`",
                inline=False
            )
        else:
            embed.add_field(
                name=f"🔴 {boss_name} (Lv.{BOSSES[boss_name]['level']})",
                value="**이미 젠 시간이 지났습니다!**",
                inline=False
            )

    await interaction.response.send_message(embed=embed)


# ============================
# /보스목록 커맨드
# ============================
@tree.command(name="보스목록", description="전체 필드 보스 목록 및 리스폰 정보 확인")
async def boss_list(interaction: discord.Interaction):
    embed = discord.Embed(title="📋 필드 보스 목록", color=0x2ECC71)

    for name, boss in BOSSES.items():
        if boss["type"] == "timer":
            embed.add_field(
                name=f"Lv.{boss['level']} {name}",
                value=f"리스폰: {boss['hours']}시간",
                inline=True
            )
        else:
            embed.add_field(
                name=f"Lv.{boss['level']} {name}",
                value=f"고정: {WEEKDAY_KR[boss['weekday']]} 18:30",
                inline=True
            )

    await interaction.response.send_message(embed=embed)


# ============================
# 젠 알림 전송 (비동기)
# ============================
async def send_spawn_alert(boss_name: str, spawn_time: datetime, channel_id: int):
    now = datetime.now(KST)
    wait = (spawn_time - now).total_seconds()

    if wait > 0:
        await asyncio.sleep(wait)

    channel = client.get_channel(channel_id)
    if channel:
        embed = discord.Embed(
            title=f"🔔 {boss_name} 젠!",
            description=f"**{boss_name}** (Lv.{BOSSES[boss_name]['level']})이(가) 출현했습니다!\n지금 바로 출격하세요!",
            color=0xFF0000
        )
        embed.set_footer(text=f"젠 시간: {spawn_time.strftime('%H:%M')} KST")
        await channel.send("@everyone", embed=embed)

    active_timers.pop(boss_name, None)


# ============================
# 고정 보스 자동 알림 (매 1분 체크)
# ============================
@tasks.loop(minutes=1)
async def check_fixed_bosses():
    now = datetime.now(KST)
    for boss_name, boss in BOSSES.items():
        if boss["type"] != "fixed":
            continue
        if now.weekday() == boss["weekday"] and now.hour == boss["hour"] and now.minute == boss["minute"]:
            channel = client.get_channel(TIMER_CHANNEL_ID)
            if channel:
                embed = discord.Embed(
                    title=f"🔔 {boss_name} 출현!",
                    description=f"**{boss_name}** (Lv.{boss['level']}) 고정 보스가 출현했습니다!\n지금 바로 출격하세요!",
                    color=0xFF0000
                )
                embed.set_footer(text=f"{WEEKDAY_KR[boss['weekday']]} 18:30 KST 고정")
                await channel.send("@everyone", embed=embed)


client.run(TOKEN)
