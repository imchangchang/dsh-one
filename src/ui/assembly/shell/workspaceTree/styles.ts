/**
 * 侧栏树的全部样式（自有类名前缀 `dshOneTree_`，数值逐字取自官方 css-module、
 * 颜色只用官方 token；密度/间距项写成 `var(--dsh-one-density-<项>, <官方原值>)`
 * ——没人给偏好时取官方原值，宿主给了就更紧凑，本件不判断宿主）。分节注释沿用
 * 搬运前的说明。
 */

// ---------------------------------------------------------------------------
// 样式：数值逐字取自官方 css-module（Rows.module.css / WorkspaceBrowser.module.css，
// 骨架四区的几件另见对应规则上方的出处注；#104），
// 颜色只用官方 token 变量；类名前缀 dshOneTree_ 是本插件自有命名空间。
//
// ## 密度偏好（#85 A 项，键面 #104 扩到骨架四区）：消费 shell 给的 CSS 变量，缺省即官方档
// 几何/间距项（行高、行间空隙、分组空隙、行内边距、分节头高、字号、列表底部
// 留白、图标按钮/搜索胶囊尺寸，以及 #104 扩出来的顶栏行内边距与行内间隙、
// 分组胶囊的高/字号/内边距、回收站入口行行高、抽屉块头高）写成
// `var(--dsh-one-density-<项>, <官方原值>)`：
// - **本插件不判断宿主**：没人给偏好时取官方字面量（官方 web 侧原样），宿主
//   （我们的 VS Code 侧栏外框 @dsh-one/vscode-sidebar-shell）在容器上设这组
//   变量时自动变紧凑——本件据此保持可移植（AGENTS.md 铁律「能移植的必须移植」）。
// - 变量是**可选输入**、不是契约：官方 web 无人设 → 走兜底；任何宿主都可以只
//   设其中几项（未设的项独立回落官方值）。
// - 观感语言（图标/颜色/圆角/字体族/动效曲线）**不在这组变量里**：那些继续
//   逐字沿用官方，这里只调密度（issue #85 / #104 的范围）。
// - 变量名与官方原值两栏一一对应，改动时两边同步（test/assemblyShellContract.test.ts
//   有两条契约测试守着「shell 设的键集 = 树消费的键集」与「新键各挂各的规则」）。
// ---------------------------------------------------------------------------
const CSS =
  // overflow:hidden 是给分节头的 `margin-right:-4px`（官方原值，让标题栏贴到侧栏
  // 右缘）兜住溢出：shell 把 `--dsh-sidebar-inline-padding` 置 0 之后，那 4px 会伸到
  // 容器外，让侧栏外层（官方 hHd-Xa_regionArea）的 scrollWidth 比 clientWidth 大 4px
  // ——平时看不见，但官方在「单列表」视图里对选中行 scrollIntoView 时会被横滚 4px，
  // 整棵树跟着左移 4px（#85 回归断言实测到的既有缺陷）。列表自己的滚动在 .dshOneTree_list。
  '.dshOneTree_root{--dsh-session-list-edge-inset:var(--dsh-sidebar-inline-padding);--dsh-session-list-scrollbar-width:8px;--dsh-session-list-scrollbar-offset:2px;box-sizing:border-box;min-height:0;padding-right:var(--dsh-session-list-edge-inset);overflow:hidden;flex-direction:column;flex:1;display:flex;position:relative}' +
  '.dshOneTree_iconButton{cursor:pointer;width:var(--dsh-one-density-icon-button-size,28px);height:var(--dsh-one-density-icon-button-size,28px);color:var(--dsw-alias-label-secondary);background:0 0;border:none;border-radius:50%;flex:none;justify-content:center;align-items:center;padding:0;display:inline-flex}' +
  '.dshOneTree_iconButton:hover{background:var(--dsw-alias-interactive-bg-hover)}' +
  '.dshOneTree_sectionHeader{box-sizing:border-box;height:var(--dsh-one-density-section-header-height,36px);color:var(--dsw-alias-label-tertiary);border-radius:12px;flex:none;justify-content:flex-end;align-items:center;gap:var(--dsh-one-density-section-gap,4px);margin-bottom:var(--dsh-one-density-section-header-gap,4px);padding-left:var(--dsh-one-density-section-padding-inline,4px);display:flex;overflow:hidden;margin-top:2px;margin-right:-4px}' +
  // 搜索栏（#99：官方那套 UI 的**展开态**常驻，折叠态的放大镜胶囊退役）——
  // search / searchSlot / searchButton / searchInput 四个类名与几何逐字对应官方
  // css-module（含 Expanded 变体），所以两侧展开态可以直接逐项比对（F-04）。
  '.dshOneTree_searchSlot{box-sizing:border-box;min-width:0;max-width:var(--dsh-one-density-icon-button-size,28px);transition:max-width .18s var(--ds-ease-in-out),padding-left .18s var(--ds-ease-in-out);flex:1;align-items:center;margin-left:auto;padding-left:0;display:flex}' +
  '.dshOneTree_searchSlotExpanded{max-width:100%;padding-left:0}' +
  '.dshOneTree_headerActions{opacity:1;visibility:visible;max-width:none;flex:none;align-items:center;gap:var(--dsh-one-density-section-gap,4px);display:flex}' +
  '.dshOneTree_search{box-sizing:border-box;cursor:text;width:100%;height:var(--dsh-one-density-search-height,28px);color:var(--dsw-alias-label-secondary);transition:width .18s var(--ds-ease-in-out),padding .18s var(--ds-ease-in-out),border-color .18s var(--ds-ease-in-out),background-color .18s var(--ds-ease-in-out);background:0 0;border:none;border-radius:50%;flex:none;align-items:center;gap:0;margin:0;padding:0;display:flex;overflow:hidden}' +
  '.dshOneTree_searchExpanded{border:.5px solid var(--dsw-alias-border-l4);width:calc(100% + 4px);height:var(--dsh-one-density-search-expanded-height,30px);color:var(--dsw-alias-label-caption);background:0 0;border-radius:10px;margin-inline:-2px;padding:0 4px 0 0}' +
  '.dshOneTree_searchButton{cursor:pointer;width:var(--dsh-one-density-icon-button-size,28px);height:var(--dsh-one-density-icon-button-size,28px);color:inherit;background:0 0;border:none;border-radius:50%;flex:none;justify-content:center;align-items:center;padding:0;display:inline-flex}' +
  '.dshOneTree_searchExpanded .dshOneTree_searchButton{width:var(--dsh-one-density-icon-button-size,28px);height:var(--dsh-one-density-search-expanded-height,30px)}' +
  '.dshOneTree_searchButton:hover{background:var(--dsw-alias-interactive-bg-hover)}' +
  '.dshOneTree_searchExpanded .dshOneTree_searchButton:hover{background:0 0}' +
  '.dshOneTree_searchInput{opacity:0;pointer-events:none;width:0;min-width:0;color:var(--dsw-alias-label-primary);transition:opacity .12s var(--ds-ease-in-out);background:0 0;border:none;outline:none;flex:1;font-size:13px;line-height:18px}' +
  '.dshOneTree_searchExpanded .dshOneTree_searchInput{opacity:1;pointer-events:auto;margin-left:-2px}' +
  '.dshOneTree_searchInput::placeholder{color:var(--dsw-alias-label-tertiary)}' +
  '.dshOneTree_clearButton{cursor:pointer;width:24px;height:24px;color:var(--dsw-alias-label-secondary);background:0 0;border:none;border-radius:50%;flex:none;justify-content:center;align-items:center;padding:0;display:inline-flex}' +
  '.dshOneTree_clearButton:hover{background:var(--dsw-alias-interactive-bg-hover)}' +
  '.dshOneTree_listArea{min-height:0;margin-left:-4px;margin-right:calc(-1 * var(--dsh-session-list-edge-inset));flex-direction:column;flex:1;padding-left:4px;display:flex;overflow:visible}' +
  '.dshOneTree_list{min-height:0;margin-left:-4px;margin-right:var(--dsh-session-list-scrollbar-offset);padding-left:4px;padding-right:calc(var(--dsh-session-list-edge-inset) - var(--dsh-session-list-scrollbar-width) - var(--dsh-session-list-scrollbar-offset));scrollbar-gutter:stable;flex:1;padding-bottom:var(--dsh-one-density-list-padding-bottom,16px);overflow-y:auto}' +
  '.dshOneTree_flatList>*+*,.dshOneTree_groupSection>*+*{margin-top:var(--dsh-one-density-row-gap,2px)}' +
  '.dshOneTree_groupSection{position:relative}' +
  '.dshOneTree_groupSection+.dshOneTree_groupSection{margin-top:var(--dsh-one-density-group-gap,4px)}' +
  '.dshOneTree_searchStatus,.dshOneTree_searchWarning{color:var(--dsw-alias-label-tertiary);padding:10px 12px;font-size:12px;line-height:18px}' +
  '.dshOneTree_searchWarning{color:var(--dsw-alias-label-secondary)}' +
  '.dshOneTree_empty{color:var(--dsw-alias-label-tertiary);padding:16px 12px;font-size:13px}' +
  // 空态/加载态是一小块竖排区域（#110）：一行说明 + 可选的第二行 + 可选的入口按钮，
  // 所以里面每一行都是块级元素，按钮跟在最后自成一行。文案与内边距沿用上面那条
  // （零工作区 / 分组无成员 / 加载中三态与「暂无会话」共用同一外形，只是内容不同）。
  '.dshOneTree_emptyLine+.dshOneTree_emptyLine{margin-top:2px}' +
  '.dshOneTree_emptyAction{cursor:pointer;height:26px;color:var(--dsw-alias-label-secondary);background:0 0;border:.5px solid var(--dsw-alias-border-l3);border-radius:6px;flex:none;align-items:center;margin-top:8px;padding:0 10px;font-family:inherit;font-size:12px;display:inline-flex}' +
  '.dshOneTree_emptyAction:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l4);background:var(--dsw-alias-interactive-bg-hover)}' +
  '.dshOneTree_sessionOverflowButton{cursor:pointer;text-align:left;width:100%;height:var(--dsh-one-density-overflow-row-height,28px);color:var(--dsw-alias-label-tertiary);background:0 0;border:none;border-radius:8px;padding:0 12px 0 28px;font-size:var(--dsh-one-density-meta-font-size,12px)}' +
  '.dshOneTree_sessionOverflowButton:hover{color:var(--dsw-alias-label-secondary);background:0 0}' +
  '.dshOneTree_projectRow,.dshOneTree_sessionRow{cursor:pointer;user-select:none;color:var(--dsw-alias-label-primary);border-radius:8px;align-items:center;gap:6px;padding:0 var(--dsh-one-density-row-padding-inline,8px);display:flex}' +
  '.dshOneTree_projectRow:hover,.dshOneTree_sessionRow:hover,.dshOneTree_sessionRow.dshOneTree_selected,.dshOneTree_projectRow.dshOneTree_menuOpen,.dshOneTree_sessionRow.dshOneTree_menuOpen{background:var(--dsw-alias-interactive-bg-hover)}' +
  '.dshOneTree_projectRow{box-sizing:border-box;align-items:center;height:var(--dsh-one-density-row-height,34px)}' +
  '.dshOneTree_projectRow .dshOneTree_rowActions{height:20px}' +
  '.dshOneTree_sessionRow{height:var(--dsh-one-density-session-row-height,32px);gap:0}' +
  '.dshOneTree_sessionRow .dshOneTree_title{flex:1;margin:0 6px 0 4px}' +
  '.dshOneTree_flatRowWithoutStatus .dshOneTree_title{margin-left:0}' +
  '.dshOneTree_slot{width:16px;height:20px;color:var(--dsw-alias-label-tertiary);flex:none;justify-content:center;align-items:center;display:inline-flex}' +
  '.dshOneTree_visuallyHidden{clip:rect(0 0 0 0);white-space:nowrap;width:1px;height:1px;position:absolute;overflow:hidden}' +
  '.dshOneTree_folderActive{color:var(--dsw-alias-state-business-primary)}' +
  '.dshOneTree_projectRow .dshOneTree_chevron{display:none}' +
  '.dshOneTree_projectRow:hover .dshOneTree_chevron{display:inline-flex}' +
  '.dshOneTree_projectRow:hover .dshOneTree_folder{display:none}' +
  '.dshOneTree_arrow{transition:transform .15s var(--ds-ease-in-out)}' +
  '.dshOneTree_arrowOpen{transform:rotate(90deg)}' +
  '.dshOneTree_projectText{flex-direction:column;flex:1;gap:2px;min-width:0;display:flex}' +
  '.dshOneTree_title{text-overflow:ellipsis;white-space:nowrap;min-width:0;font-size:var(--dsh-one-density-title-font-size,14px);line-height:var(--dsh-one-density-title-line-height,20px);overflow:hidden}' +
  '.dshOneTree_time{color:var(--dsw-alias-label-tertiary);flex:none;font-size:var(--dsh-one-density-meta-font-size,12px);line-height:var(--dsh-one-density-meta-line-height,20px)}' +
  '.dshOneTree_scheduleIndicator{width:16px;height:20px;color:var(--dsw-alias-label-tertiary);flex:none;justify-content:center;align-items:center;margin-right:6px;display:inline-flex}' +
  // 搜索结果行里的那一枚（官方 `_searchScheduleIndicator`）：贴着标题，不再留右外边距。
  '.dshOneTree_searchScheduleIndicator{margin-left:4px;margin-right:0}' +
  '.dshOneTree_dot{flex:none}' +
  '.dshOneTree_rowActions{flex:none;align-items:center;gap:12px;display:none}' +
  '.dshOneTree_projectRow:hover .dshOneTree_rowActions,.dshOneTree_sessionRow:hover .dshOneTree_rowActions,.dshOneTree_projectRow.dshOneTree_menuOpen .dshOneTree_rowActions,.dshOneTree_sessionRow.dshOneTree_menuOpen .dshOneTree_rowActions{display:inline-flex}' +
  '.dshOneTree_sessionRow:hover .dshOneTree_time,.dshOneTree_sessionRow.dshOneTree_menuOpen .dshOneTree_time{display:none}' +
  '.dshOneTree_rowIconButton{cursor:pointer;width:16px;height:16px;color:var(--dsw-alias-label-tertiary);background:0 0;border:none;border-radius:4px;flex:none;justify-content:center;align-items:center;padding:0;display:inline-flex}' +
  '.dshOneTree_rowIconButton:hover{color:var(--dsw-alias-label-primary)}' +
  '.dshOneTree_chevron{color:var(--dsw-alias-label-caption)}' +
  '.dshOneTree_searchRow{box-sizing:border-box;cursor:pointer;text-align:left;width:100%;min-height:var(--dsh-one-density-search-row-min-height,48px);color:var(--dsw-alias-label-primary);background:0 0;border:none;border-radius:8px;flex-direction:column;align-items:stretch;padding:4px 8px;display:flex}' +
  '.dshOneTree_searchRow:hover,.dshOneTree_searchRow.dshOneTree_selected{background:var(--dsw-alias-interactive-bg-hover)}' +
  '.dshOneTree_searchRowHeading{align-items:center;min-width:0;display:flex}' +
  '.dshOneTree_searchRowTitle{text-overflow:ellipsis;white-space:nowrap;flex:0 auto;min-width:0;margin-left:4px;font-size:14px;line-height:20px;overflow:hidden}' +
  '.dshOneTree_searchRowMeta{align-items:center;gap:6px;min-width:0;margin-left:20px;display:flex}' +
  '.dshOneTree_searchRowWorkspace,.dshOneTree_searchRowSnippet{text-overflow:ellipsis;white-space:nowrap;font-size:12px;line-height:17px;overflow:hidden}' +
  '.dshOneTree_searchRowWorkspace{max-width:40%;color:var(--dsw-alias-label-tertiary);flex:none}' +
  '.dshOneTree_searchRowSnippet{min-width:0;color:var(--dsw-alias-label-secondary);flex:1}' +
  '.dshOneTree_hoverContent{flex-direction:column;gap:8px;display:flex}' +
  '.dshOneTree_hoverTitle{color:#fff;overflow-wrap:break-word;font-size:14px;line-height:20px}' +
  '.dshOneTree_hoverPath{color:#cfd3d6;word-break:break-all;font-size:12px;line-height:16px}' +
  '.dshOneTree_hoverTime{color:#cfd3d6;font-size:12px;line-height:16px}' +
  '.dshOneTree_hoverStatus{color:#adb2b8;align-items:center;gap:8px;font-size:12px;line-height:20px;display:flex}' +
  '.dshOneTree_renameInput{box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l4);width:100%;height:44px;color:var(--dsw-alias-label-primary);background:0 0;border-radius:22px;outline:none;padding:7px 14px;font-size:14px;font-weight:400;line-height:22px}' +
  '.dshOneTree_renameError{color:var(--dsw-alias-state-error-primary);margin-top:8px;font-size:12px;line-height:18px}' +
  '.dshOneTree_deleteStatus{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}' +
  '.dshOneTree_deleteAction:not(:disabled){color:var(--dsw-alias-state-error-primary)}' +
  // ---- #81：分组过滤条 / 活状态计数 / 批量选择 / 回收站抽屉 ----
  // 颜色一律官方 token；尺寸/间距走密度档变量（#104 起把过滤条与抽屉也纳进来，新键的
  // 出处见文件头那段的说明：胶囊尺寸取自官方同形的胶囊触发器、块头取自官方列表分组
  // 块头）。变量名与官方原值两栏一一对应，改动时 shell 侧那张表同步改。
  '.dshOneTree_filterBar{align-items:center;gap:var(--dsh-one-density-section-gap,4px);margin:0 0 var(--dsh-one-density-group-gap,4px);padding-left:var(--dsh-one-density-section-padding-inline,4px);display:flex}' +
  // 分组过滤条（#99：单胶囊 + 成员计数 + ▾）。外观语言沿用官方胶囊语言（官方 token、
  // 999px 圆角），尺寸按官方同形的胶囊触发器（ui-model-selection 的 `_7KE1Ra_trigger`
  // ——28px 高 / 13px 字号 / 行内间隙 4px / 内边距起 8px 止 4px），并走密度档。
  '.dshOneTree_pill{cursor:pointer;height:var(--dsh-one-density-pill-height,28px);color:var(--dsw-alias-label-secondary);background:0 0;border:.5px solid var(--dsw-alias-border-l3);border-radius:999px;flex:none;align-items:center;gap:var(--dsh-one-density-section-gap,4px);max-width:100%;padding:0 var(--dsh-one-density-pill-padding-end,4px) 0 var(--dsh-one-density-pill-padding-start,8px);font-size:var(--dsh-one-density-pill-font-size,13px);display:inline-flex;overflow:hidden}' +
  '.dshOneTree_pill:hover{background:var(--dsw-alias-interactive-bg-hover)}' +
  '.dshOneTree_pillActive{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l4);background:var(--dsw-alias-interactive-bg-hover)}' +
  '.dshOneTree_pillTag{flex:none;align-items:center;color:var(--dsw-alias-label-tertiary);display:inline-flex}' +
  '.dshOneTree_pillLabel{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden}' +
  '.dshOneTree_pillCount{color:var(--dsw-alias-label-tertiary);flex:none}' +
  '.dshOneTree_pillChevron{color:var(--dsw-alias-label-tertiary);flex:none;align-items:center;display:inline-flex}' +
  '.dshOneTree_menuRow{align-items:center;gap:12px;min-width:0;width:100%;display:flex}' +
  '.dshOneTree_menuRowLabel{text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1;overflow:hidden}' +
  '.dshOneTree_menuRowCount{color:var(--dsw-alias-label-tertiary);flex:none}' +
  // 底部回收站入口行（#99：官方 sidebar.footer.action 座位）。形态按旧侧栏那一行：
  // 主区（🗑 + 文案 + 计数）+ 右侧两枚动作图标；计数 0 整体灰态。行高按**同座位**的
  // 官方条目（ui-cordis 的 CordisPanel.module.css `Nqubda_badge{height:42px}`）取，
  // 内边距走骨架基线与行内边距两档。
  '.dshOneTree_footerRow{align-items:center;gap:2px;padding:0 var(--dsh-one-density-section-padding-inline,4px);display:flex}' +
  '.dshOneTree_footerRowEmpty{color:var(--dsw-alias-label-tertiary)}' +
  '.dshOneTree_footerMain{cursor:pointer;min-width:0;height:var(--dsh-one-density-footer-row-height,42px);color:inherit;background:0 0;border:none;border-radius:8px;flex:1;align-items:center;gap:8px;padding:0 var(--dsh-one-density-row-padding-inline,8px);font-family:inherit;font-size:var(--dsh-one-density-title-font-size,14px);display:inline-flex;overflow:hidden}' +
  '.dshOneTree_footerMain:hover{background:var(--dsw-alias-interactive-bg-hover)}' +
  '.dshOneTree_footerIcon{flex:none;align-items:center;display:inline-flex}' +
  '.dshOneTree_footerLabel{text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1;text-align:left;overflow:hidden}' +
  '.dshOneTree_footerCount{color:var(--dsw-alias-label-tertiary);flex:none;font-size:var(--dsh-one-density-meta-font-size,12px)}' +
  '.dshOneTree_footerIconButton{cursor:pointer;width:var(--dsh-one-density-icon-button-size,28px);height:var(--dsh-one-density-icon-button-size,28px);color:var(--dsw-alias-label-tertiary);background:0 0;border:none;border-radius:50%;flex:none;justify-content:center;align-items:center;padding:0;display:inline-flex}' +
  '.dshOneTree_footerIconButton:disabled{cursor:default;opacity:.45}' +
  '.dshOneTree_footerIconButton:not(:disabled):hover{background:var(--dsw-alias-interactive-bg-hover)}' +
  // 「管理分组…」对话框（#99）：行 = 名字 + 计数 + ✎/🗑。
  '.dshOneTree_manageList{max-height:240px;margin-bottom:12px;overflow-y:auto}' +
  '.dshOneTree_manageRow{align-items:center;gap:8px;height:var(--dsh-one-density-row-height,34px);padding:0 4px;display:flex}' +
  '.dshOneTree_manageName{text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1;overflow:hidden}' +
  '.dshOneTree_manageCount{color:var(--dsw-alias-label-tertiary);flex:none;font-size:var(--dsh-one-density-meta-font-size,12px)}' +
  '.dshOneTree_manageEmpty{color:var(--dsw-alias-label-tertiary);padding:8px 4px;font-size:var(--dsh-one-density-meta-font-size,12px)}' +
  '.dshOneTree_manageCreate{align-items:center;gap:8px;display:flex}' +
  '.dshOneTree_manageCreate .dshOneTree_renameInput{flex:1;min-width:0}' +
  '.dshOneTree_manageCreate button{white-space:nowrap;flex:none}' +
  // 行尾绝对定位层（#109）：当前工作区那枚蓝色胶囊 + 活状态计数。**不进正常流**——
  // 官方这一行没有这两个元素，进流会把标题挤窄，而 F-04 PARITY 逐项比对标题的几何
  // 矩形（同一处置的说明见 ActivityBadge 的注释）。悬停时整层让位给四枚动作按钮。
  '.dshOneTree_rowEnd{pointer-events:none;position:absolute;right:var(--dsh-one-density-row-padding-inline,8px);align-items:center;gap:6px;display:inline-flex}' +
  '.dshOneTree_projectRow:hover .dshOneTree_rowEnd,.dshOneTree_projectRow.dshOneTree_menuOpen .dshOneTree_rowEnd{display:none}' +
  // 「当前工作区」胶囊（#109 E7）：蓝色药丸 + 容器名（VS Code 侧就是 vscode，官方 web 侧是 web
  // ——名字由能力口给，不写死）。颜色全部由官方 business 蓝 token 混出来（老侧栏那份用的是
  // VS Code 的 chart 蓝，官方 web 侧没有那个变量，本件要保持可移植）；`color-mix` 认不出时
  // 前一行的兜底值生效（中性底色 + 蓝字，观感退化但不破版）。
  '.dshOneTree_workspaceBadge{flex:none;height:16px;color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-interactive-bg-hover);background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 18%,transparent);border:.5px solid color-mix(in srgb,var(--dsw-alias-state-business-primary) 40%,transparent);border-radius:999px;align-items:center;padding:0 6px;font-size:10px;line-height:1;display:inline-flex}' +
  // 二级菜单的零尺寸锚点（空白会话行 / 未分组行没有 ⋯ 按钮可挂；右键那一份用指针坐标）。
  '.dshOneTree_menuAnchor{display:none}' +
  '.dshOneTree_activity{align-items:center;gap:6px;display:inline-flex}' +
  '.dshOneTree_activityItem{color:var(--dsw-alias-label-tertiary);font-size:var(--dsh-one-density-meta-font-size,12px);line-height:var(--dsh-one-density-meta-line-height,20px);align-items:center;gap:4px;display:inline-flex}' +
  '.dshOneTree_check{cursor:pointer;width:16px;height:20px;color:var(--dsw-alias-label-tertiary);flex:none;justify-content:center;align-items:center;display:inline-flex}' +
  '.dshOneTree_checkBox{box-sizing:border-box;width:14px;height:14px;border:.5px solid var(--dsw-alias-border-l4);border-radius:4px;justify-content:center;align-items:center;display:inline-flex}' +
  '.dshOneTree_checkOn{background:var(--dsw-alias-state-business-primary);border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-inverse,#fff)}' +
  // #102：勾选框的灰态（置顶行不可勾选）。0.35 的透明度与旧侧栏的 disabled 复选框同值。
  '.dshOneTree_checkOff{opacity:.35;cursor:default}' +
  // #108：部分选中（组头三态里的 some）——方框与全选同色，里面画一条短横线。
  // 官方 primitives 没有减号类图标（按 0.1.6-alpha.1 的 combo 核实：IconMinus* /
  // IconRemove* / IconSubtract* 零命中），所以这条横线用样式画。
  '.dshOneTree_checkDash{width:8px;height:2px;background:currentColor;border-radius:1px}' +
  '.dshOneTree_groupCheck{flex:none;cursor:pointer}' +
  // #102：置顶图钉（标题前常驻）与手动未读的加粗标题。颜色走官方 token（次级色，
  // 与行内其它标记同一档）；加粗值取自旧侧栏的 .session-title.unread（600）。
  '.dshOneTree_pin{flex:none;width:14px;height:14px;margin-right:4px;color:var(--dsw-alias-label-tertiary);align-items:center;display:inline-flex}' +
  '.dshOneTree_unread{font-weight:600}' +
  '.dshOneTree_selectionBarWrap{flex:none}' +
  '.dshOneTree_selectionBar{gap:8px;box-sizing:border-box;padding:4px 8px;align-items:center;display:flex}' +
  '.dshOneTree_selectionCount{color:var(--dsw-alias-label-secondary);flex:1;min-width:0;font-size:var(--dsh-one-density-meta-font-size,12px)}' +
  '.dshOneTree_selectionError{color:var(--dsw-alias-state-error-primary);font-size:var(--dsh-one-density-meta-font-size,12px);padding:0 8px 4px}' +
  // 回收站抽屉（#103）：从底部半高滑出（高度由组件按档位给，默认 50%、上拉到 90%）。
  '.dshOneTree_drawer{z-index:10;box-sizing:border-box;background:var(--dsw-alias-bg-base);border-top:.5px solid var(--dsw-alias-border-l3);position:absolute;left:0;right:0;bottom:0;transform:translateY(100%);transition:transform .2s var(--ds-ease-in-out);flex-direction:column;display:flex;overflow:hidden}' +
  '.dshOneTree_drawerOpen{transform:none}' +
  '.dshOneTree_drawerHandle{cursor:grab;height:12px;flex:none;justify-content:center;align-items:center;display:flex;touch-action:none}' +
  '.dshOneTree_drawerHandle:active{cursor:grabbing}' +
  '.dshOneTree_drawerGrip{width:32px;height:3px;background:var(--dsw-alias-border-l3);border-radius:2px}' +
  '.dshOneTree_drawerHandle:hover .dshOneTree_drawerGrip{background:var(--dsw-alias-label-tertiary)}' +
  '.dshOneTree_drawerHeader{height:var(--dsh-one-density-section-header-height,36px);flex:none;align-items:center;gap:var(--dsh-one-density-section-gap,4px);padding:0 var(--dsh-one-density-section-padding-inline,4px) 0 var(--dsh-one-density-row-padding-inline,8px);display:flex}' +
  '.dshOneTree_drawerTitle{color:var(--dsw-alias-label-secondary);flex:1;min-width:0;font-size:var(--dsh-one-density-title-font-size,14px);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
  '.dshOneTree_drawerCount{color:var(--dsw-alias-label-tertiary);flex:none;font-size:var(--dsh-one-density-meta-font-size,12px)}' +
  '.dshOneTree_drawerList{min-height:0;padding:0 var(--dsh-one-density-section-padding-inline,4px) var(--dsh-one-density-list-padding-bottom,16px);flex:1;overflow-y:auto}' +
  '.dshOneTree_drawerGroup+.dshOneTree_drawerGroup{margin-top:var(--dsh-one-density-group-gap,4px)}' +
  // 抽屉里的分块块头**就是那一枚可点折叠的按钮**：几何沿用 #104 的密度键（官方列表的
  // 分组块头是 ui-model-selection 的 `_7KE1Ra_groupTitle`：26px 总高、行内边距 8px、
  // 12px 字号），另加可点性（cursor / 圆角 / hover 底色）。
  '.dshOneTree_drawerGroupLabel{cursor:pointer;width:100%;color:var(--dsw-alias-label-tertiary);background:0 0;border:none;border-radius:6px;height:var(--dsh-one-density-drawer-block-header-height,26px);align-items:center;gap:var(--dsh-one-density-section-gap,4px);padding:0 var(--dsh-one-density-row-padding-inline,8px);font-family:inherit;font-size:var(--dsh-one-density-meta-font-size,12px);display:flex}' +
  '.dshOneTree_drawerGroupLabel:hover{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover)}' +
  '.dshOneTree_drawerGroupArrow{width:14px;flex:none;align-items:center;display:inline-flex}' +
  '.dshOneTree_drawerGroupLabelText{text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1;text-align:left;overflow:hidden}' +
  '.dshOneTree_drawerGroupCount{flex:none}' +
  '.dshOneTree_drawerRow{cursor:pointer;height:var(--dsh-one-density-session-row-height,32px);color:var(--dsw-alias-label-primary);border-radius:8px;align-items:center;gap:6px;padding:0 var(--dsh-one-density-row-padding-inline,8px);display:flex}' +
  '.dshOneTree_drawerRow:hover,.dshOneTree_drawerRow.dshOneTree_menuOpen{background:var(--dsw-alias-interactive-bg-hover)}' +
  '.dshOneTree_drawerRow .dshOneTree_title{flex:1;margin:0}' +
  // 抽屉行的动作**常显**（不像主树那样悬停才出）：抽屉里本来就只有两个动作，藏起来
  // 反而要多一步悬停；行悬停时时间让位给动作。
  '.dshOneTree_drawerActions{flex:none;align-items:center;gap:2px;display:inline-flex}' +
  '.dshOneTree_drawerRow:hover .dshOneTree_time,.dshOneTree_drawerRow.dshOneTree_menuOpen .dshOneTree_time{display:none}' +
  '.dshOneTree_drawerRestore{cursor:pointer;height:20px;color:var(--dsw-alias-label-tertiary);background:0 0;border:none;border-radius:4px;flex:none;align-items:center;gap:4px;padding:0 4px;font-family:inherit;font-size:var(--dsh-one-density-meta-font-size,12px);display:inline-flex}' +
  '.dshOneTree_drawerRestore:hover:not(:disabled){color:var(--dsw-alias-label-primary)}' +
  '.dshOneTree_drawerRestore:disabled{cursor:default;opacity:.45}' +
  '.dshOneTree_drawerStatus{color:var(--dsw-alias-label-tertiary);padding:10px 8px;font-size:var(--dsh-one-density-meta-font-size,12px)}' +
  // 归档确认弹窗的明细（按工作区树形列）：块头 + 行。
  '.dshOneTree_modalBlocks{max-height:240px;margin-top:8px;overflow-y:auto}' +
  '.dshOneTree_modalBlock+.dshOneTree_modalBlock{margin-top:6px}' +
  '.dshOneTree_modalBlockLabel{color:var(--dsw-alias-label-tertiary);font-size:var(--dsh-one-density-meta-font-size,12px);padding:0 4px}' +
  '.dshOneTree_modalRow{color:var(--dsw-alias-label-primary);text-overflow:ellipsis;white-space:nowrap;font-size:var(--dsh-one-density-meta-font-size,12px);padding:2px 4px 2px 16px;overflow:hidden}' +
  // 飘提示（移入/还原/归档的回执）：贴树区域底部，几秒后自己消失。
  '.dshOneTree_flash{z-index:20;max-width:90%;background:var(--dsw-alias-bg-elevated,var(--dsw-alias-bg-base));color:var(--dsw-alias-label-primary);border:.5px solid var(--dsw-alias-border-l3);border-radius:8px;padding:6px 10px;font-size:var(--dsh-one-density-meta-font-size,12px);position:absolute;bottom:8px;left:50%;transform:translateX(-50%)}' +
  // 入口行两枚动作里的「清空」是危险动作（= 永久归档），按错误色标出来。
  '.dshOneTree_footerIconDanger:not(:disabled){color:var(--dsw-alias-state-error-primary)}' +
  // 会话标签组（#107）：形态与数值逐字沿用旧侧栏 sessionsView.ts 的 `.tag-*` 规则
  //（小 pill、pill 下沿到组尾的 2px 贯穿竖线、组内行 24px 左缩进、折叠计数角标）。
  // 组色由组件经 `--dshone-tag-color` 下发（色板在 tagGroups.ts，理由见那个文件头：
  // 用户自选的标签色板，官方 token 里没有这一类）。
  '.dshOneTree_tagBlock{position:relative;border-radius:6px}' +
  // 组头：pill 左缘与竖线同列；右侧留出折叠三角与动作位。
  '.dshOneTree_tagHead{align-items:center;height:22px;padding-left:var(--dsh-one-density-row-padding-inline,8px);padding-right:var(--dsh-one-density-row-padding-inline,8px);display:flex}' +
  '.dshOneTree_tagPill{cursor:grab;color:var(--dshone-tag-color);background:color-mix(in srgb,var(--dshone-tag-color) 22%,transparent);border:1px solid color-mix(in srgb,var(--dshone-tag-color) 45%,transparent);border-radius:4px;align-items:center;gap:4px;height:16px;padding:0 7px;font-size:10px;font-weight:600;line-height:1;white-space:nowrap;display:inline-flex}' +
  '.dshOneTree_tagPill:active{cursor:grabbing}' +
  '.dshOneTree_tagDot{width:6px;height:6px;background:var(--dshone-tag-color);border-radius:2px;flex:none}' +
  '.dshOneTree_tagName{text-overflow:ellipsis;white-space:nowrap;max-width:120px;overflow:hidden}' +
  // 拖 pill 换组序时的插入位置指示线（上下沿，box-shadow 不占布局）。
  '.dshOneTree_tagPill[data-dshone-tag-drop="before"]{box-shadow:0 -2px 0 0 var(--dshone-tag-color)}' +
  '.dshOneTree_tagPill[data-dshone-tag-drop="after"]{box-shadow:0 2px 0 0 var(--dshone-tag-color)}' +
  // 折叠/展开三角：展开朝下、折叠朝右（与工作区行同款）。
  '.dshOneTree_tagToggle{cursor:pointer;width:16px;height:16px;color:var(--dsw-alias-label-tertiary);background:0 0;border:none;border-radius:4px;flex:none;justify-content:center;align-items:center;margin-left:2px;padding:0;display:inline-flex}' +
  '.dshOneTree_tagToggle:hover{color:var(--dsw-alias-label-primary)}' +
  '.dshOneTree_tagArrow{transition:transform .15s ease}' +
  '.dshOneTree_tagArrowOpen{transform:rotate(90deg)}' +
  // 组头右侧的 ⋯（组菜单）：与工作区行/会话行同一处置——悬停组块才出（组块很矮，
  // 常显会一直在组名旁边晃）；菜单开着时也保持可见（不然菜单一开按钮就没了锚点）。
  '.dshOneTree_tagBlock:hover .dshOneTree_rowActions,.dshOneTree_tagBlock.dshOneTree_menuOpen .dshOneTree_rowActions{display:inline-flex}' +
  // 折叠态才出计数（展开态每行自己带状态点）；靠右对齐到行尾动作列。
  '.dshOneTree_tagCounts{align-items:center;gap:6px;margin-left:auto;padding-right:2px;display:inline-flex}' +
  '.dshOneTree_tagCount{color:var(--dsw-alias-label-tertiary);align-items:center;gap:4px;font-size:var(--dsh-one-density-meta-font-size,12px);display:inline-flex}' +
  // 组内行：贯穿竖线（从 pill 下沿到组尾）+ 仅给会话行加约 12px 左缩进，行内元素不动。
  '.dshOneTree_tagRows{border-left:2px solid color-mix(in srgb,var(--dshone-tag-color) 55%,transparent);margin-left:calc(var(--dsh-one-density-row-padding-inline,8px) + 8px);padding-left:8px}' +
  '.dshOneTree_tagRows>*+*{margin-top:var(--dsh-one-density-row-gap,2px)}' +
  '.dshOneTree_tagRows .dshOneTree_sessionRow{padding-left:12px}' +
  // 拖会话入组时目标组块高亮（组色淡底，不遮行）。
  '.dshOneTree_tagDropActive{background:color-mix(in srgb,var(--dshone-tag-color) 14%,transparent)}' +
  // 组色小色块（选色菜单与新建弹窗的色板共用）。
  '.dshOneTree_tagSwatch{width:10px;height:10px;border-radius:3px;flex:none;display:block}' +
  '.dshOneTree_tagColorPick{gap:8px;margin-top:10px;display:flex}' +
  '.dshOneTree_tagColorPickItem{cursor:pointer;width:20px;height:20px;color:var(--dsw-alias-label-inverse,#fff);border:.5px solid var(--dsw-alias-border-l4);border-radius:5px;justify-content:center;align-items:center;padding:0;display:inline-flex}' +
  '.dshOneTree_tagColorPickOn{box-shadow:0 0 0 2px var(--dsw-alias-label-secondary)}'
export const CSS_TAG_ID = '@dsh-one/dsh-workspace-tree/Tree.css'
if (typeof document !== 'undefined' && document.querySelector(`style[data-plugin-css="${CSS_TAG_ID}"]`) === null) {
  const tag = document.createElement('style')
  tag.dataset.plugin = '@dsh-one/dsh-workspace-tree'
  tag.dataset.pluginCss = CSS_TAG_ID
  tag.textContent = CSS
  document.head.append(tag)
}
