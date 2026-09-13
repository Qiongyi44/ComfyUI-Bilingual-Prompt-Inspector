"""Expand the built-in prompt packs with a conservative, curated vocabulary set.

The source lists are intentionally maintained in code so the migration is
repeatable and reviewable. They are not raw dumps of any external tag corpus.
"""

from __future__ import annotations

import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PACK_DIR = ROOT / "data" / "packs"
VERSION = "1.1.0"


PACK_META = {
    "base": "Danbooru 标签文档、Adobe/Nikon 摄影资料与人工精选",
    "anima": "CircleStone Labs Anima 模型卡与 Comfy Org 官方文档",
    "characters": "Danbooru 标签文档、HoYoverse 角色命名与人工精选",
    "poses": "Danbooru 姿势/手势标签组与人工精选",
    "camera": "Adobe/Nikon 摄影资料、Anima/Civitai 示例与人工精选",
    "clothing": "Danbooru 服装标签组与人工精选",
    "adult": "Civitai 成人分级社区示例、Danbooru 成人标签体系与人工筛选（仅成年角色）",
}


# Format per line: English | Chinese | optional Chinese/English aliases separated by semicolons.
# English entries use Anima's recommended space-separated tag style.
DATA = {
    "base": {
        "画面风格": """
anime style|动漫风格|动画风格
manga style|漫画风格
semi-realistic|半写实|半现实风格
painterly|绘画感|画笔质感
digital painting|数字绘画|数字插画
concept art|概念艺术|概念设定图
key visual|主视觉图|宣传主视觉
visual novel cg|视觉小说CG|游戏CG
anime screencap|动画截图风格|动漫截帧
flat colors|平涂色彩|平面上色
soft shading|柔和阴影|柔和上色
hard shading|硬边阴影|硬阴影
gradient shading|渐变阴影|渐变上色
line art|线稿|线描
thick line art|粗线稿|粗线条
thin line art|细线稿|纤细线条
rough sketch|粗略草图|速写
monochrome|单色画面|单色
grayscale|灰度画面|黑白灰
limited palette|限制色板|有限配色
vibrant colors|鲜艳色彩|高饱和色彩
pastel colors|粉彩色调|柔和粉彩
muted colors|低饱和色彩|柔和低饱和
warm color palette|暖色调配色|暖色配色
cool color palette|冷色调配色|冷色配色
high contrast|高对比度|强对比
low contrast|低对比度|柔和对比
chiaroscuro|明暗对照法|强烈明暗
ink wash|水墨风格|水墨画
gouache|水粉画|水粉风格
acrylic painting|丙烯画|丙烯绘画
colored pencil|彩色铅笔画|彩铅
marker drawing|马克笔绘画|马克笔风格
pixel art|像素艺术|像素画
3D render|三维渲染|3D渲染
clay render|黏土渲染|黏土风格
papercut art|剪纸艺术|纸雕风格
stained glass|彩色玻璃风格|花窗玻璃
retro anime|复古动漫风格|老动画风格
1990s anime|20世纪90年代动漫风格|九十年代动漫
fantasy|奇幻风格|幻想题材
dark fantasy|黑暗奇幻|暗黑幻想
gothic|哥特风格|哥特式
cyberpunk|赛博朋克
steampunk|蒸汽朋克
wuxia|武侠风格|武侠
xianxia|仙侠风格|仙侠
japanese aesthetic|日式美学|日本风格
chinese aesthetic|中式美学|中国风
minimalist|极简主义|简约风格
ornate|华丽繁复|繁复装饰
surreal|超现实风格|超现实主义
dreamlike|梦幻感|如梦似幻
ethereal|空灵感|轻盈空灵
cinematic still|电影静帧|影视截图
editorial illustration|编辑插画|杂志插画
fashion illustration|时装插画|服装插画
poster art|海报艺术|宣传海报风格
book cover|书籍封面|封面设计
""",
        "光照": """
soft diffused light|柔和漫射光|柔光
hard light|硬光|强硬光线
front lighting|正面光|顺光
side lighting|侧面光|侧光
top lighting|顶部光|顶光
underlighting|底部光|下方照明
hair light|发丝轮廓光|头发轮廓光
studio lighting|摄影棚灯光|棚拍光线
natural lighting|自然光|自然照明
window light|窗户光|窗边光线
candlelight|烛光
moonlight|月光
neon lighting|霓虹灯光|霓虹照明
golden hour|黄金时刻光线|日出日落金色光线
blue hour|蓝调时刻光线|暮光时刻
sunrise lighting|日出光线|晨曦
sunset lighting|日落光线|夕阳
overcast lighting|阴天漫射光|阴天光线
dappled sunlight|斑驳阳光|树影光斑
god rays|丁达尔光束|耶稣光
lens flare|镜头光晕|镜头耀斑
bloom|泛光效果|柔光溢出
glowing|发光|闪耀
bioluminescent glow|生物荧光|荧光发亮
caustic lighting|焦散光|水波焦散
subsurface scattering|次表面散射|皮肤透光
ambient occlusion|环境光遮蔽|接触阴影
cast shadow|投射阴影|投影
long shadows|长阴影|拉长的影子
soft shadows|柔和阴影|软阴影
harsh shadows|强烈阴影|硬阴影
colored lighting|彩色灯光|色彩照明
red lighting|红色灯光|红光
blue lighting|蓝色灯光|蓝光
purple lighting|紫色灯光|紫光
warm backlight|暖色逆光|金色逆光
cool backlight|冷色逆光|蓝色逆光
low-key lighting|低调照明|暗调布光
high-key lighting|高调照明|明亮布光
spotlight|聚光灯|舞台聚光
""",
        "背景与环境": """
indoors|室内|室内场景
outdoors|室外|户外场景
bedroom|卧室
living room|客厅
classroom|教室
library|图书馆
cafe|咖啡馆|咖啡店
restaurant|餐厅
office|办公室
laboratory|实验室
street|街道
city|城市
cityscape|城市景观|都市天际线
rooftop|屋顶|天台
alley|小巷|巷道
shrine|神社
temple|寺庙|神殿
palace|宫殿
castle|城堡
forest|森林
bamboo forest|竹林
flower field|花田|花海
grassland|草原
desert|沙漠
beach|海滩|沙滩
ocean|海洋|大海
lake|湖泊
river|河流
waterfall|瀑布
mountain|山地|山脉
snowy mountain|雪山
cave|洞穴
ruins|遗迹|废墟
dungeon|地下城|地牢
garden|花园
courtyard|庭院
balcony|阳台
train station|火车站
subway station|地铁站
airport|机场
spaceship interior|宇宙飞船内部|飞船舱内
fantasy landscape|奇幻风景|幻想景观
night sky|夜空
starry sky|星空
cloudy sky|多云天空|云层天空
rain|下雨|雨景
snow|下雪|雪景
fog|浓雾|雾气
mist|薄雾|轻雾
storm|暴风雨|风暴
cherry blossoms|樱花|樱花盛开
autumn leaves|秋叶|红叶
fireflies|萤火虫
underwater|水下|水底
on the water|水面上
cozy interior|温馨室内|舒适房间
futuristic city|未来城市|科幻都市
ancient city|古代城市|古城
abandoned building|废弃建筑|荒废建筑
busy street|繁华街道|热闹街头
empty street|空旷街道|无人街道
simple gradient background|简单渐变背景|渐变背景
abstract background|抽象背景
blurred background|模糊背景|背景虚化
detailed background|细致背景|丰富背景
""",
        "负面词": """
deformed|变形|畸形
malformed limbs|肢体畸形|错误肢体
poorly drawn hands|手部绘制差|坏手
fused fingers|手指粘连|融合手指
too many fingers|手指过多|多余手指
bad proportions|比例错误|身体比例异常
cropped|意外裁切|被裁掉
out of frame|主体超出画面|画外
oversaturated|过度饱和|色彩过饱和
overexposed|过曝|曝光过度
underexposed|欠曝|曝光不足
digital noise|数字噪点|图像噪声
compression artifacts|压缩伪影|压缩瑕疵
color banding|色彩断层|色带
moire pattern|摩尔纹|网纹干扰
logo|标志水印|品牌标志
username|用户名文字|账号水印
speech bubble|对话气泡|对白框
multiple panels|多格画面|漫画分格
collage|拼贴画面|多图拼接
cloned face|重复面孔|克隆脸
asymmetrical eyes|双眼不对称|大小眼
cross-eyed|斗鸡眼|对眼
disconnected limbs|肢体断开|身体断裂
floating limbs|漂浮肢体|脱离身体的肢体
extra arms|多余手臂|额外手臂
extra legs|多余腿部|额外腿
mutated hands|手部变异|畸形手
long neck|脖子过长|长颈
bad perspective|透视错误|错误透视
""",
    },
    "anima": {
        "Anima控制词": """
safe|安全内容|SFW;普通内容
sensitive|轻度敏感内容|擦边内容
nsfw|成人内容|不宜工作场合
explicit|明确成人内容|露骨内容
score_7|质量评分7|Anima基础版质量标签
score_1|质量评分1|低质量评分
score_2|质量评分2|低质量评分
score_3|质量评分3|低质量评分
newest|最新年代风格|新式画风
year 2025|2025年画风|2025年代标签
no humans|无人类角色|纯景物
solo focus|单人主体聚焦|独立人物焦点
male focus|男性主体聚焦|男主角焦点
other focus|非二元主体聚焦|其他性别焦点
anime aesthetic|动漫审美|动画美学
non-photorealistic|非写实风格|非照片风格
sharp line art|锐利线稿|清晰线条
soft texture|柔和纹理|柔软质感
2.5D|2.5D风格|二维半风格
delicate illustration|精致插画|细腻插画
highly detailed background|高度细致背景|精细场景
clean character silhouette|清晰人物轮廓|易读剪影
""",
    },
    "characters": {
        "人物数量": """
1other|一名其他性别角色|单个其他性别角色
2boys|两名男性角色|两个男生
3boys|三名男性角色|三个男生
3girls|三名女性角色|三个女生
4girls|四名女性角色|四个女生
group|多人组合|群体
crowd|人群|大量人物
couple|一对人物|双人组合
""",
        "发型": """
very long hair|超长发|及地长发
medium hair|中长发|中等长度头发
shoulder-length hair|齐肩发|肩长发
bob cut|波波头|短波波发型
hime cut|姬发式|公主切
blunt bangs|齐刘海|平刘海
swept bangs|侧扫刘海|斜刘海
asymmetrical bangs|不对称刘海|偏斜刘海
hair over one eye|头发遮住一只眼|单眼被头发遮挡
hair between eyes|眼间发束|刘海垂在双眼之间
side braid|侧边辫子|侧辫
twin braids|双辫子|两条辫子
braided ponytail|编发马尾|辫状马尾
high ponytail|高马尾
low ponytail|低马尾
side ponytail|侧马尾
hair bun|发髻|丸子头
double bun|双发髻|双丸子头
half updo|半扎发|半盘发
wavy hair|波浪发|波浪卷发
curly hair|卷发|卷曲头发
straight hair|直发|顺直头发
messy hair|凌乱头发|乱发
spiked hair|尖刺发型|刺猬头
ahoge|呆毛|头顶翘发
loose hair strand|松散发丝|零散发束
floating hair|飘浮的头发|头发飘起
hair spread out|铺散的头发|头发散开
wet hair|湿发|湿润头发
two-tone hair|双色头发|双拼发色
multicolored hair|多色头发|彩色头发
gradient hair|渐变发色|渐变头发
streaked hair|挑染头发|发色挑染
colored inner hair|内层染发|内层异色头发
silver hair|银发|银色头发
gray hair|灰发|灰色头发
pink hair|粉发|粉色头发
blue hair|蓝发|蓝色头发
green hair|绿发|绿色头发
orange hair|橙发|橙色头发
""",
        "眼睛": """
green eyes|绿色眼睛|绿眼
yellow eyes|黄色眼睛|黄眼
golden eyes|金色眼睛|金瞳
brown eyes|棕色眼睛|棕眼
black eyes|黑色眼睛|黑瞳
white eyes|白色眼睛|白瞳
heterochromia|异色瞳|双眼异色
glowing eyes|发光眼睛|亮眼
gradient eyes|渐变瞳色|渐变眼睛
star-shaped pupils|星形瞳孔|星星眼
heart-shaped pupils|心形瞳孔|爱心瞳
slit pupils|竖瞳|细长瞳孔
dilated pupils|瞳孔放大|扩张瞳孔
half-closed eyes|半闭眼|慵懒眼神
wide eyes|睁大眼睛|圆睁双眼
teary eyes|含泪的眼睛|泪眼
empty eyes|空洞眼神|无神双眼
""",
        "表情": """
angry|生气|愤怒表情
sad|悲伤|难过表情
crying|哭泣|流泪
tears|眼泪|泪水
surprised|惊讶|吃惊表情
embarrassed|害羞尴尬|羞涩表情
nervous|紧张|不安表情
serious|严肃|认真表情
expressionless|无表情|面无表情
smug|得意表情|自满神情
smirk|坏笑|得意微笑
laughing|大笑|开怀笑
screaming|尖叫|张口喊叫
sleepy|困倦|睡眼惺忪
tired|疲惫|劳累表情
worried|担忧|担心表情
confused|困惑|疑惑表情
determined|坚定|坚毅表情
scared|害怕|惊恐表情
shy|羞怯|害羞
flustered|慌乱脸红|不知所措
teasing smile|调皮微笑|戏谑笑容
gentle expression|温柔表情|柔和神情
parted lips|微张嘴唇|嘴唇微启
biting lip|咬嘴唇|轻咬下唇
""",
        "视线与朝向": """
looking to the side|看向侧面|侧目
looking over shoulder|回头看|越肩回望
eye contact|眼神接触|对视
averted eyes|移开视线|回避目光
facing viewer|面向观众|正对镜头
facing away|背向观众|背对镜头
facing left|面向左侧|朝左
facing right|面向右侧|朝右
head tilted|歪头|头部倾斜
head down|低头|垂头
head up|抬头|仰头
side profile|侧脸轮廓|人物侧脸
three-quarter face|四分之三侧脸|半侧脸
""",
        "人物特征": """
adult woman|成年女性|成人女性
adult man|成年男性|成人男性
dark skin|深色皮肤|黑皮肤
tan skin|小麦色皮肤|晒黑皮肤
pale skin|苍白皮肤|白皙皮肤
freckles|雀斑
mole under eye|眼下痣|泪痣
fangs|尖牙|虎牙
elf ears|精灵耳朵|尖耳
animal ears|动物耳朵|兽耳
cat ears|猫耳|猫咪耳朵
fox ears|狐狸耳朵|狐耳
horns|角|头角
halo|光环|头顶光环
wings|翅膀|羽翼
tail|尾巴
slim|苗条体型|纤细身材
petite|娇小体型|小个子
curvy|曲线丰满|丰盈身材
muscular|肌肉体型|健壮
tall|高挑|高个子
short stature|矮小身材|个子较矮
""",
        "原神角色": """
Furina (Genshin Impact)|芙宁娜（原神）|水神芙宁娜
Neuvillette (Genshin Impact)|那维莱特（原神）|最高审判官
Arlecchino (Genshin Impact)|阿蕾奇诺（原神）|仆人
Navia (Genshin Impact)|娜维娅（原神）
Clorinde (Genshin Impact)|克洛琳德（原神）
Zhongli (Genshin Impact)|钟离（原神）|岩王帝君
Venti (Genshin Impact)|温迪（原神）|风神巴巴托斯
Xiao (Genshin Impact)|魈（原神）|降魔大圣
Kaedehara Kazuha (Genshin Impact)|枫原万叶（原神）|万叶
Kamisato Ayaka (Genshin Impact)|神里绫华（原神）|绫华
Kamisato Ayato (Genshin Impact)|神里绫人（原神）|绫人
Sangonomiya Kokomi (Genshin Impact)|珊瑚宫心海（原神）|心海
Yoimiya (Genshin Impact)|宵宫（原神）
Nilou (Genshin Impact)|妮露（原神）
Dehya (Genshin Impact)|迪希雅（原神）
Alhaitham (Genshin Impact)|艾尔海森（原神）
Kaveh (Genshin Impact)|卡维（原神）
Tighnari (Genshin Impact)|提纳里（原神）
Wanderer (Genshin Impact)|流浪者（原神）|散兵
Tartaglia (Genshin Impact)|达达利亚（原神）|公子;Childe
Eula (Genshin Impact)|优菈（原神）
Jean (Genshin Impact)|琴（原神）|琴团长
Mona (Genshin Impact)|莫娜（原神）
Fischl (Genshin Impact)|菲谢尔（原神）|皇女
Shenhe (Genshin Impact)|申鹤（原神）
Xianyun (Genshin Impact)|闲云（原神）|留云借风真君
""",
    },
    "poses": {
        "基础姿势": """
standing on one leg|单腿站立|金鸡独立
contrapposto|对立式站姿|重心落在单腿
leaning forward|身体前倾|向前探身
leaning back|身体后仰|向后倾斜
leaning against wall|靠墙|倚墙
crouching|蹲伏|低身蹲下
squatting|下蹲|蹲姿
sitting on chair|坐在椅子上|椅上坐姿
sitting on floor|坐在地上|席地而坐
sitting on edge|坐在边缘|坐在台沿
cross-legged|盘腿坐|交叉腿坐姿
seiza|正坐|日式跪坐
kneeling on one knee|单膝跪地|单膝跪姿
on all fours|四肢着地|跪趴姿势
lying on back|仰卧|躺在背部
lying on stomach|俯卧|趴着
lying on side|侧卧|侧躺
reclining|斜躺|倚靠躺姿
tiptoes|踮脚|踮起脚尖
jumping|跳跃|跃起
falling|下落|坠落
floating|漂浮|悬浮
running|奔跑|跑步
dancing|跳舞|舞蹈
fighting stance|战斗姿势|格斗架势
ready stance|准备姿势|预备架势
stretching|伸展身体|拉伸
arching back|弓起背部|背部后弯
bent over|弯腰|俯身
twisting torso|扭转躯干|转动上身
walking toward viewer|朝镜头走来|向观众走近
walking away|向远处走去|背向走开
stepping forward|向前迈步|跨步
dynamic pose|动态姿势|有动势的姿态
relaxed pose|放松姿势|自然站姿
elegant pose|优雅姿势|优美姿态
action pose|动作姿势|运动姿态
""",
        "手臂与手势": """
arms crossed|双臂交叉|抱臂
arms behind back|双手放在背后|背手
hands on hips|双手叉腰|两手扶腰
one hand on hip|单手叉腰|一只手扶腰
hands in pockets|双手插兜|手放口袋
hands clasped|双手合拢|十指相扣
arms raised|双臂举起|举起双手
one arm raised|单臂举起|举起一只手
arms behind head|双手放在脑后|抱头姿势
hand on chest|手放胸前|抚胸
hand on cheek|手托脸颊|手贴脸
hand on chin|手托下巴|托腮
hand on head|手放头上|摸头
hand in hair|手插入头发|拨弄头发
touching face|触摸脸部|摸脸
covering mouth|遮住嘴巴|捂嘴
covering face|遮住脸部|捂脸
covering one eye|遮住一只眼|单手遮眼
finger to lips|手指放在唇边|噤声手势;嘘
index finger raised|举起食指|食指向上
pointing|指向某处|用手指示
pointing at viewer|指向观众|指向镜头
reaching|伸手|探手
reaching toward viewer|伸手朝向观众|手伸向镜头
waving|挥手|招手
salute|敬礼|行礼
peace sign|V字手势|剪刀手
thumbs up|竖起大拇指|点赞手势
heart hands|双手比心|手掌爱心
finger heart|手指比心|韩式比心
clenched fist|握拳|攥紧拳头
open palm|张开手掌|摊手
spread fingers|张开手指|五指分开
fist pump|振臂握拳|胜利挥拳
raised fist|举起拳头|高举拳头
beckoning|招手示意靠近|勾手
shrugging|耸肩|摊肩
facepalm|扶额|捂脸无奈
hat tip|轻触帽檐|脱帽致意
adjusting hat|整理帽子|扶帽
adjusting glasses|调整眼镜|扶眼镜
holding object|手持物品|拿着物体
holding weapon|手持武器|拿武器
hands together|双手并拢|合掌
open hands|张开双手|双手摊开
praying|祈祷姿势|双手祷告
""",
        "腿部姿势": """
legs crossed|双腿交叉|交叉腿
crossed ankles|脚踝交叉|双脚交叉
legs together|双腿并拢|并腿
knees together|双膝并拢|膝盖靠拢
knees apart|双膝分开|膝盖打开
bent knee|屈膝|膝盖弯曲
one knee raised|抬起一侧膝盖|单膝抬起
pigeon-toed|内八站姿|脚尖内扣
wide stance|宽站姿|双脚分开站立
feet apart|双脚分开|分腿站立
one foot forward|一只脚向前|前后脚站姿
crossed legs while standing|站立时双腿交叉|交叉腿站姿
""",
        "身体与头部协调": """
body facing away, head turned toward viewer|身体背向镜头、头转向观众|背身回头
body in profile, face toward viewer|身体侧向、脸转向镜头|侧身看镜头
body facing viewer, head turned aside|身体正对镜头、头转向侧面|正身侧脸
shoulders angled|肩膀呈斜角|肩线倾斜
hips angled|胯部呈斜角|胯部侧转
torso facing left|躯干朝左|上身向左
torso facing right|躯干朝右|上身向右
head turned left|头转向左侧|向左转头
head turned right|头转向右侧|向右转头
over-the-shoulder pose|越肩回望姿势|回眸姿势
three-quarter pose|四分之三侧身姿势|半侧身
profile pose|完全侧身姿势|正侧面姿势
back view pose|背面姿势|背影姿势
front-facing pose|正面姿势|正对姿势
natural body twist|自然身体扭转|自然转体
contrasting head and body direction|头身朝向相反|头和身体不同向
""",
        "双人互动": """
holding hands|牵手|握手同行
hugging|拥抱|相拥
head pat|摸头|轻拍头部
carrying|抱起或背负|携带人物
bridal carry|公主抱|横抱
piggyback|背人|背负姿势
dancing together|共同跳舞|双人舞
back-to-back|背靠背|背对彼此
sitting together|坐在一起|并排坐
standing together|站在一起|并肩站立
arm around shoulder|手臂搭肩|搂肩
arm around waist|手臂环腰|搂腰
forehead to forehead|额头相贴|额头碰额头
face-to-face|面对面|相对而立
""",
    },
    "camera": {
        "相机方位": """
front three-quarter view|正面四分之三视角|正面半侧视角
rear three-quarter view|背面四分之三视角|背后半侧视角
side view|侧面视角|正侧面
profile shot|侧脸镜头|人物侧面镜头
over-the-shoulder shot|过肩镜头|越肩视角
point of view|主观视角|POV
first-person view|第一人称视角|第一视角
selfie|自拍视角|自拍
top-down view|垂直俯视|正上方视角
overhead shot|头顶俯拍|正上方镜头
aerial view|空中俯瞰|航拍视角
drone view|无人机视角|无人机航拍
ground-level shot|贴地机位|地面高度镜头
shoulder-level shot|肩部高度机位|肩平视角
hip-level shot|腰部高度机位|胯部机位
knee-level shot|膝盖高度机位|膝部机位
foot-level shot|脚部高度机位|低至脚面的镜头
from above|从上方拍摄|上方视角
from below|从下方拍摄|下方视角
tilted camera|倾斜相机|歪斜镜头
""",
        "景别": """
macro shot|微距镜头|超近距离细节
detail shot|细节特写|局部细节镜头
headshot|头部肖像|头像镜头
bust shot|胸像镜头|胸部以上
medium close-up|中近景|胸部以上镜头
waist-up shot|腰部以上镜头|半身像
knee-up shot|膝盖以上镜头|七分身
thigh-up shot|大腿以上镜头|大腿景别
medium wide shot|中远景|较宽中景
long shot|远景|全身远距离
extreme wide shot|大远景|极远景
establishing shot|建立镜头|环境交代镜头
two shot|双人镜头|两人同框
group shot|群像镜头|多人合影
environmental portrait|环境人像|带场景的人像
tight close-up|紧凑特写|贴脸特写
full figure|完整人物全身|全身完整入镜
""",
        "构图": """
leading lines|引导线构图|线条引导视线
diagonal composition|对角线构图|斜线构图
triangular composition|三角形构图|三角构图
golden ratio composition|黄金比例构图|黄金分割
frame within a frame|框中框构图|画框式构图
foreground framing|前景框架构图|用前景包围主体
central framing|中心框架构图|主体居中框定
off-center composition|偏心构图|主体偏离中心
balanced composition|平衡构图|视觉均衡
asymmetrical composition|非对称构图|不对称平衡
radial composition|放射式构图|中心放射构图
layered composition|分层构图|多层次画面
depth composition|纵深构图|空间深度构图
foreground, middle ground, background|前景、中景和背景|三层空间
vanishing point|消失点透视|灭点
linear perspective|线性透视|一点透视
forced perspective|强制透视|错位透视
subject on the left|主体位于左侧|人物靠左
subject on the right|主体位于右侧|人物靠右
ample headroom|充足头顶空间|头部留白
tight framing|紧密取景|紧凑构图
cropped composition|裁切式构图|局部切出画面
fill the frame|主体充满画面|填满画幅
silhouette composition|剪影构图|轮廓构图
foreground emphasis|强调前景|前景突出
background emphasis|强调背景|背景突出
single focal point|单一视觉焦点|唯一焦点
multiple focal points|多个视觉焦点|多焦点构图
visual balance|视觉平衡|画面均衡
visual tension|视觉张力|紧张构图
open composition|开放式构图|画外延伸
closed composition|封闭式构图|主体完整闭合
vertical composition|竖向构图|纵向画面
horizontal composition|横向构图|横幅画面
square composition|方形构图|正方形画幅
panoramic composition|全景构图|宽幅全景
""",
        "镜头与焦距": """
14mm lens|14毫米超广角镜头|14mm超广角
24mm lens|24毫米广角镜头|24mm镜头
28mm lens|28毫米广角镜头|28mm镜头
70mm lens|70毫米中长焦镜头|70mm镜头
105mm lens|105毫米人像镜头|105mm镜头
135mm lens|135毫米长焦镜头|135mm镜头
200mm lens|200毫米长焦镜头|200mm镜头
macro lens|微距镜头
prime lens|定焦镜头
zoom lens|变焦镜头
tilt-shift lens|移轴镜头
anamorphic lens|变形宽银幕镜头|电影宽银幕镜头
wide aperture|大光圈|开放光圈
narrow aperture|小光圈|收小光圈
f/1.4|F1.4大光圈|1.4光圈
f/1.8|F1.8大光圈|1.8光圈
f/2.8|F2.8光圈|2.8光圈
f/8|F8小光圈|8光圈
lens compression|长焦空间压缩|透视压缩
perspective distortion|透视畸变|近大远小夸张
barrel distortion|桶形畸变|广角桶形变形
""",
        "对焦与动态效果": """
selective focus|选择性对焦|局部清晰
foreground blur|前景虚化|模糊前景
background blur|背景虚化|模糊背景
soft focus|柔焦|柔化焦点
motion blur|运动模糊|动态拖影
radial blur|径向模糊|放射模糊
zoom blur|变焦模糊|推拉爆炸效果
long exposure|长曝光|慢门效果
freeze frame|动作定格|冻结瞬间
light trails|光轨|长曝光灯光轨迹
shutter drag|慢速快门拖影|慢门拖影
sharp subject, blurred background|主体清晰、背景模糊|人清景虚
foreground in focus|前景对焦|焦点在前景
background in focus|背景对焦|焦点在背景
""",
        "运镜": """
push in|镜头推进|向主体靠近
pull out|镜头拉远|从主体后退
crane shot|摇臂镜头|升降机镜头
crane up|镜头升起|摇臂上升
crane down|镜头下降|摇臂下降
pedestal up|机位垂直上升|相机升高
pedestal down|机位垂直下降|相机降低
truck left|镜头向左横移|相机左移
truck right|镜头向右横移|相机右移
whip pan|快速摇镜|甩镜头
zoom in|镜头放大|变焦拉近
zoom out|镜头缩小|变焦拉远
camera roll|镜头滚转|相机旋转
arc shot|弧形环绕镜头|弧线运镜
steadicam shot|斯坦尼康镜头|稳定器跟拍
gimbal shot|云台稳定镜头|稳定云台拍摄
drone shot|无人机航拍镜头|航拍
locked-off camera|固定机位|静止相机
slow camera movement|缓慢运镜|慢速相机运动
dynamic camera movement|动态运镜|快速相机运动
""",
    },
    "clothing": {
        "上装": """
blouse|女式衬衫|罩衫
sleeveless shirt|无袖衬衫|无袖上衣
crop top|露脐上衣|短款上衣
camisole|吊带背心|细肩带上衣
tank top|背心|无袖背心
tube top|抹胸上衣|无肩带上衣
off-shoulder top|露肩上衣|一字肩上衣
turtleneck|高领衫|高领上衣
halter top|挂脖上衣|绕颈上衣
vest|背心马甲|无袖马甲
waistcoat|西装马甲|正装背心
blazer|西装外套|西服上衣
cardigan|开衫|针织开衫
cape|披肩斗篷|短斗篷
cloak|长斗篷|披风
poncho|斗篷式外套|披巾
bodysuit|连体紧身衣|紧身连体服
leotard|体操服|高叉连体衣
jersey|运动球衣|运动衫
sportswear|运动服|运动装
uniform jacket|制服外套|制式上衣
open jacket|敞开的夹克|外套敞开
oversized shirt|宽大衬衫|超大号上衣
oversized sweater|宽大毛衣|大号针织衫
""",
        "下装": """
miniskirt|迷你裙|短裙
pencil skirt|铅笔裙|包臀裙
layered skirt|分层裙|多层裙
asymmetrical skirt|不对称裙|高低裙
denim skirt|牛仔裙
jeans|牛仔裤
leggings|打底裤|紧身裤
cargo pants|工装裤|多口袋裤
wide-leg pants|阔腿裤|宽腿裤
capri pants|七分裤|中裤
bloomers|灯笼短裤|运动衬裤
culottes|裙裤|宽松短裤
denim shorts|牛仔短裤
high-waisted shorts|高腰短裤|高腰热裤
low-rise shorts|低腰短裤|低腰裤
hakama|袴|日式裙裤
""",
        "连衣裙与制服": """
sundress|夏日连衣裙|太阳裙
cocktail dress|鸡尾酒裙|小礼服
evening gown|晚礼服|长礼裙
ball gown|舞会礼服|蓬裙礼服
qipao|旗袍|cheongsam
kimono|和服
yukata|浴衣|日式浴衣
hanfu|汉服|中国古装
shrine maiden outfit|巫女服|神社巫女装
sailor uniform|水手服|日式校服
military uniform|军装|军事制服
business suit|商务西装|职业套装
lab coat|实验室白大褂|白大褂
nurse uniform|护士服|护理制服
witch outfit|女巫服装|魔女装束
fantasy armor|奇幻盔甲|幻想铠甲
plate armor|板甲|全身铠甲
light armor|轻甲|轻型护甲
robe|长袍|法袍
priestess outfit|女祭司服装|祭司装束
idol costume|偶像服装|舞台打歌服
stage costume|舞台服装|演出服
gothic lolita|哥特洛丽塔|哥特萝莉装
classic lolita|古典洛丽塔|经典洛丽塔
wa lolita|和风洛丽塔|日式洛丽塔
""",
        "泳装与贴身衣物": """
bikini|比基尼|两件式泳装
one-piece swimsuit|连体泳衣|单件泳装
school swimsuit|学校泳衣|日式校园泳装
competition swimsuit|竞技泳衣|竞赛泳装
sports bra|运动内衣|运动胸衣
briefs|三角内裤|短内裤
boxer shorts|平角内裤|四角裤
undershirt|内穿背心|汗衫
slip dress|吊带衬裙|衬裙式连衣裙
""",
        "袖型与领口": """
long sleeves|长袖
short sleeves|短袖
sleeveless|无袖
detached sleeves|分离袖|独立袖套
puffy sleeves|泡泡袖|蓬袖
bell sleeves|喇叭袖|钟形袖
wide sleeves|宽袖|大袖
see-through sleeves|透明袖|薄纱袖
rolled-up sleeves|卷起袖子|挽袖
single sleeve|单边袖子|仅一侧有袖
high collar|高领|立领
sailor collar|水手领|海军领
mandarin collar|中式立领|旗袍领
v-neck|V形领口|V领
square neckline|方形领口|方领
strapless|无肩带|抹胸式
backless|露背|露背装
open back|背部开口|开背设计
""",
        "装饰与材质": """
frills|荷叶边|褶边
lace trim|蕾丝花边|蕾丝装饰
ribbon trim|丝带镶边|缎带装饰
bow|蝴蝶结|结饰
buttons|纽扣|扣子
zipper|拉链
belt|腰带|皮带
sash|腰封|饰带
corset|束腰|紧身胸衣
collar|衣领|领子
hood|兜帽|帽兜
embroidery|刺绣|绣花
floral print|花卉印花|碎花图案
plaid|格纹|格子图案
striped|条纹|条纹图案
polka dot|波点|圆点图案
lace fabric|蕾丝面料|蕾丝材质
leather|皮革材质|皮衣质感
denim|牛仔布|丹宁材质
silk|丝绸材质|真丝质感
velvet|天鹅绒材质|丝绒
transparent fabric|透明面料|透视布料
layered clothing|多层穿搭|叠穿
oversized clothing|宽大服装|超大号衣服
tight clothing|紧身服装|贴身衣物
wet clothes|湿透的衣服|湿衣
torn clothes|破损衣物|撕裂服装
unzipped|拉链解开|未拉拉链
""",
        "腿部服饰与鞋": """
pantyhose|连裤袜|丝袜
stockings|长筒袜|丝袜长袜
knee highs|及膝袜|膝下长袜
ankle socks|短袜|踝袜
loose socks|泡泡袜|宽松袜
garter straps|吊袜带|袜带
leg warmers|腿套|暖腿套
fishnet stockings|渔网袜|网袜
striped thighhighs|条纹过膝袜|条纹长袜
sandals|凉鞋
loafers|乐福鞋|便鞋
pumps|浅口高跟鞋|单鞋
platform shoes|厚底鞋|松糕鞋
mary janes|玛丽珍鞋|搭扣鞋
slippers|拖鞋|室内鞋
barefoot|赤脚|光脚
ankle boots|短靴|踝靴
knee boots|及膝长靴|膝高靴
thigh boots|过膝长靴|大腿靴
combat boots|战斗靴|军靴
""",
        "饰品": """
cap|鸭舌帽|便帽
beret|贝雷帽
beanie|针织帽|毛线帽
sun hat|遮阳帽|宽檐帽
witch hat|女巫帽|魔法帽
hair ribbon|发带丝带|头发缎带
hair bow|发饰蝴蝶结|头发蝴蝶结
hair ornament|头饰|发饰
hair flower|头花|花朵发饰
hairclip|发夹|头发夹子
headband|发箍|头带
choker|颈圈|贴颈项链
necklace|项链
earrings|耳环|耳坠
bracelet|手链|手镯
ring|戒指|指环
scarf|围巾|丝巾
necktie|领带
bow tie|领结|蝴蝶领结
glasses|眼镜
sunglasses|太阳镜|墨镜
eyepatch|眼罩|单眼罩
face mask|口罩|面罩
veil|面纱|头纱
backpack|双肩包|背包
handbag|手提包|女包
parasol|阳伞|遮阳伞
umbrella|雨伞|伞
""",
    },
    "adult": {
        "成年限定": """
adult couple|成年情侣|成人伴侣
mature couple|成熟情侣|成熟伴侣
both adults|双方均为成年人|全部成年
consenting adults|自愿的成年人物|成年自愿双方
clearly adult|明确成年|清晰成人特征
adult-only scene|仅含成年人的场景|成人限定场景
""",
        "裸露程度": """
partially nude|半裸|部分裸体
fully nude|全裸|完全裸体
naked|裸体|赤裸
nude under clothes|衣服下裸体|真空穿着
open clothes|敞开的衣服|衣物打开
clothes removed|脱下衣服|衣物已脱
exposed breasts|乳房裸露|露出胸部
exposed nipples|乳头裸露|露出乳头
exposed genitals|生殖器裸露|私处裸露
pubic hair|阴毛|体毛
areola|乳晕
vulva|外阴|女性外生殖器
penis|阴茎|男性生殖器
testicles|睾丸|阴囊
erection|勃起|阴茎勃起
wet pussy|湿润阴部|湿润外阴
pussy juice|爱液|阴道分泌液
cameltoe|骆驼趾|衣物勒出阴部轮廓
sideboob|侧乳|乳房侧面
underboob|下乳|乳房下缘
covered nipples|遮住乳头|乳头被遮挡
covering breasts|遮住乳房|手遮胸部
covering crotch|遮住私处|手遮胯部
covering ass|遮住臀部|手遮屁股
hand bra|用手遮胸|手掌胸罩
""",
        "成人服饰": """
lace lingerie|蕾丝内衣|蕾丝贴身衣物
see-through lingerie|透明内衣|透视内衣
garter belt|吊袜腰带|吊袜带腰封
bodystocking|连身丝袜|全身丝袜
babydoll lingerie|娃娃式性感睡衣|薄纱短睡衣
negligee|性感睡袍|薄纱睡衣
body harness|身体束带|装饰绑带
nipple pasties|乳贴|胸贴
open cup bra|开杯胸罩|露乳内衣
micro bikini|微型比基尼|极小比基尼
thong|丁字裤|T裤
g-string|细带丁字裤|G弦裤
no panties|未穿内裤|无内裤
no bra|未穿胸罩|无胸衣
latex outfit|乳胶服装|胶衣
leather harness|皮革束带|皮质身体带
""",
        "成人姿势": """
erotic pose|色情姿势|成人姿势
seductive pose|诱惑姿势|撩人姿态
nude pose|裸体姿势|裸身摆姿
pinup pose|海报女郎姿势|复古性感姿势
bedroom pose|卧室性感姿势|床上姿势
legs open|张开双腿|双腿打开
presenting ass|突出臀部|展示臀部
ass focus|臀部特写|以臀部为焦点
breast focus|胸部特写|以乳房为焦点
crotch focus|胯部特写|私处焦点
nipple focus|乳头特写|乳头焦点
arched back pose|性感弓背姿势|腰背后弯
sensual stretching|性感伸展|柔媚拉伸
straddling|跨坐|骑跨姿势
lap sitting|坐在腿上|坐大腿
""",
        "成人互动": """
passionate kiss|热吻|激情接吻
intimate embrace|亲密拥抱|贴身相拥
caressing|爱抚|轻抚身体
groping|揉摸身体|抓握身体
breast grab|抓握乳房|揉胸
butt grab|抓握臀部|摸臀
masturbation|自慰|手淫
female masturbation|女性自慰|女性手淫
male masturbation|男性自慰|男性手淫
fingering|手指插入|指交
handjob|手交|用手刺激阴茎
oral sex|口交|口腔性爱
fellatio|口含阴茎|男性口交
cunnilingus|舔阴|女性口交
vaginal sex|阴道性交|性交
anal sex|肛交|肛门性交
sex from behind|后入式性交|背后体位
missionary position|传教士体位|男上女下
cowgirl position|女上位|骑乘位
reverse cowgirl position|反向女上位|反向骑乘
sixty-nine position|六九式|69式
facesitting|坐脸|颜面骑乘
intercrural sex|腿交|股间性交
breast sex|乳交|乳房性交
double penetration|双重插入|双穴插入
orgasm|高潮|性高潮
ejaculation|射精|精液射出
cum on body|精液在身体上|体表精液
cum inside|体内射精|内射
after sex|性交后|事后场景
""",
        "成人束缚": """
consensual bondage|自愿束缚|成人自愿捆绑
rope bondage|绳索束缚|绳缚
shibari|日式绳缚|缚艺
blindfold|蒙眼|眼罩束缚
handcuffs|手铐|铐住双手
bound wrists|手腕被缚|束缚手腕
bound arms|手臂被缚|束缚双臂
collar and leash|项圈和牵绳|成人项圈牵引
bondage harness|束缚带|身体束缚装具
restrained pose|受束缚姿势|被限制动作
""",
    },
}


def normalize(value: str) -> str:
    value = value.strip().lower().replace("_", " ")
    value = re.sub(r"\s+", " ", value)
    return value


def parse_rows(block: str):
    for raw in block.splitlines():
        raw = raw.strip()
        if not raw or raw.startswith("#"):
            continue
        fields = [part.strip() for part in raw.split("|")]
        if len(fields) < 2:
            raise ValueError(f"Invalid vocabulary row: {raw!r}")
        aliases = [part.strip() for part in fields[2].split(";") if part.strip()] if len(fields) > 2 else []
        yield fields[0], fields[1], aliases


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def main():
    manifest_path = PACK_DIR / "manifest.json"
    manifest = load_json(manifest_path)
    pack_docs = {}
    existing_global = {}
    for definition in manifest["packs"]:
        pack_id = definition["id"]
        doc = load_json(PACK_DIR / definition["filename"])
        pack_docs[pack_id] = doc
        for tag in doc["tags"]:
            existing_global[normalize(tag["english"])] = pack_id

    added = {}
    skipped = []
    for pack_id, groups in DATA.items():
        doc = pack_docs[pack_id]
        count = 0
        default_source = "anima-official" if pack_id == "anima" else (
            "civitai-danbooru-curated" if pack_id == "adult" else (
                "adobe-nikon-curated" if pack_id == "camera" else "danbooru-curated"
            )
        )
        for category, block in groups.items():
            for english, chinese, aliases in parse_rows(block):
                key = normalize(english)
                if key in existing_global:
                    skipped.append((pack_id, english, existing_global[key]))
                    continue
                doc["tags"].append({
                    "english": english,
                    "chinese": chinese,
                    "aliases": aliases,
                    "category": category,
                    "models": ["general", "anima"] if pack_id != "anima" else ["anima"],
                    "source": default_source,
                    "verified": True,
                })
                existing_global[key] = pack_id
                count += 1
        doc["pack"]["version"] = VERSION
        doc["pack"]["source"] = PACK_META[pack_id]
        added[pack_id] = count

    for definition in manifest["packs"]:
        pack_id = definition["id"]
        definition["version"] = VERSION
        definition["source"] = PACK_META[pack_id]
        path = PACK_DIR / definition["filename"]
        path.write_text(json.dumps(pack_docs[pack_id], ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "version": VERSION,
        "added": added,
        "skipped_duplicates": len(skipped),
        "total": len(existing_global),
        "duplicate_examples": skipped[:20],
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
