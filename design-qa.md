# AS译林本地副本 v50 设计验收

- source visual truth paths:
  - `/var/folders/yp/ndk322vn0x98q2hcpwf3b9fm0000gp/T/TemporaryItems/NSIRD_screencaptureui_P4qw0O/截屏2026-07-17 11.10.36.png`
  - `/var/folders/yp/ndk322vn0x98q2hcpwf3b9fm0000gp/T/TemporaryItems/NSIRD_screencaptureui_ysQdrt/截屏2026-07-17 11.12.02.png`
  - `/var/folders/yp/ndk322vn0x98q2hcpwf3b9fm0000gp/T/TemporaryItems/NSIRD_screencaptureui_HPk7K6/截屏2026-07-17 11.14.30.png`
  - `/var/folders/yp/ndk322vn0x98q2hcpwf3b9fm0000gp/T/TemporaryItems/NSIRD_screencaptureui_HcT9Wz/截屏2026-07-17 11.14.52.png`
- implementation screenshot path: `/Users/Min369/Documents/同步空间/Manju/AIProjects/洞见/design-qa-implementation-v47.png`
- persona pointer-state screenshots:
  - `/Users/Min369/Documents/同步空间/Manju/AIProjects/洞见/qa-persona-source-v48.png`
  - `/Users/Min369/Documents/同步空间/Manju/AIProjects/洞见/qa-persona-editor-v48.png`
- v50 source visual truth paths:
  - `/var/folders/yp/ndk322vn0x98q2hcpwf3b9fm0000gp/T/TemporaryItems/NSIRD_screencaptureui_tJhFF2/截屏2026-07-17 15.40.37.png`
  - `/var/folders/yp/ndk322vn0x98q2hcpwf3b9fm0000gp/T/TemporaryItems/NSIRD_screencaptureui_miVArF/截屏2026-07-17 15.41.41.png`
- v50 implementation screenshot path: `/Users/Min369/Documents/同步空间/Manju/AIProjects/洞见/design-qa-implementation-v50.png`
- viewport: 1280 × 720
- state: 工作台，P5，缩略图视图，页码导航并入顶部项目行

## Full-view comparison evidence

- “未分章”和“原典”均不再显示，顶部面包屑精简为“洞见中译英 / P5”。
- 左侧栏提供“缩略图 / 目录”双视图；缩略图使用真实 PDF 页图，目录以页段呈现。当前 PDF 没有可用目录标题，因此未虚构章节名称。
- 页码导航直接位于顶部项目/当前页同一行，PDF 图像上方不再存在独立工具行。
- 最左侧“未分章”行隐藏，缩略图/目录入口仍正常显示。
- v50 将左栏拖宽至约 363px 后，缩略图随栏宽完整放大，页面比例和左右留白保持稳定；主工作区仍可正常使用。
- 右栏点击原文后，左侧页面出现对应的金色同步范围；左侧点击后，右栏对应 block 定位并高亮。

## Focused region comparison evidence

- 字体与排版：沿用 AS译林现有中文字体和按钮字号，新增控件保持 12–13px 的工作台密度。
- 间距与布局：导航按钮为 30px 高，缩略图和目录均限制在原侧栏内滚动，没有挤压主工作区。
- 颜色与视觉变量：复用既有深色侧栏、金色激活色和纸张色菜单，没有引入新的主题色。
- 图片质量：缩略图直接加载 `/storage/.../pages/page-NNN.png` 原页资源，不使用占位图或重绘图。
- 文案内容：使用“缩略图、目录、更多、第一页、上一页、下一页、最后一页”等明确中文标签和辅助标题。
- 字体：没有改变现有中文字体、字号、行高或译文排版。
- 间距与布局：左栏从 240px 拖到约 363px；缩略图从 184×258px 变为约 307×431px。
- 颜色：拖拽边界和同步状态复用既有金色变量，没有引入额外主题色。
- 图片质量：缩略图使用原始页面图片，宽高比始终为 0.7118，与源图片 2186×3071 一致。
- 文案：仅新增拖拽和同步定位的辅助标题，不增加常驻说明文字。

## Findings

- 无 P0、P1、P2 问题。
- P3：目录目前按 20 页分组；待后端提供真实 PDF 目录或章节锚点后可升级为语义目录。
- 本次 v48 修复未修改角色数据、角色顺序或翻译逻辑，只稳定译文编辑器头部排版。
- v50 无 P0、P1、P2 问题。图片型 PDF 尚无逐字坐标时采用段落范围映射，属于预期约束。

## Comparison history

1. v46 已将 PDF 工具压成一行，但“未分章”和“原典”仍占据文字空间，导航仍位于独立行。
2. 修复：v47 隐藏两个文字节点，并将页码导航移动到顶部面包屑行。
3. 复测：P5→P6 翻页时页码、面包屑与 PDF 图像同步；可见区域不存在“未分章”；控制台无错误。
4. v48 修复：译文编辑器头部使用固定标签列、弹性角色列和操作列，并为段落列表预留稳定滚动条空间。
5. v48 复测：鼠标位于段落原文和译文编辑框时，角色选择区均为 `x=833.75, y=368.90625, width=382.5, height=116.75`，未发生位移；控制台无错误或警告。
6. v50 初检：发现原有拖动边界不明显，缩略图被 156px 最大高度限制；修复为可见拖动边界和等比例自适应缩略图。
7. v50 交互补充：新增左右原文段落范围双向定位，并在页面或 block 上保留当前同步高亮。
8. v50 复测：左栏拖宽后缩略图宽高比不变；左右点击均产生对应高亮；控制台无错误或警告。

## Primary interactions tested

- 点击下一页：P5 正确切换为 P6，页码输入、顶部当前页和 PDF 图像同步更新。
- 点击目录：缩略图切换为页段目录，当前页段正确高亮。
- 点击更多：编辑原文、导入文本、全部直读正确展开。
- console errors checked: 0。
- 鼠标从段落原文移动到译文编辑框：译者标签位置与尺寸保持不变。
- 拖动左栏右边界：宽度从 240px 调整至约 363px，并保存宽度。
- 点击右栏原文：左侧对应页面范围高亮并滚动到可见位置。
- 点击左侧原文范围：右侧对应 block 高亮并滚动到可见位置。

final result: passed
