# Glossary · 术语表

| English | 简体中文 | Meaning |
| --- | --- | --- |
| Project | 项目 | A folder containing `project.vne.json`, assets and modules |
| Chapter | 章节 | A part of the story with its own graph |
| Story flow graph | 剧情流程图 | The node graph that defines the order of scenes and logic |
| Node | 节点 | A box in the graph |
| Port | 端口 | A connection point on a node (inputs left, outputs right) |
| Connection / edge | 连线 | A link from an output port to an input port |
| Start | 开始 | Where the game begins |
| Scene / Page | 场景 / 页面 | A playable page made of elements (layers), including its dialogue and choices |
| Element / Layer | 元素 / 图层 | Anything in a scene: picture, character, text, media, dialogue, choice; has properties, keyframes and effects |
| Event | 事件 | Runs actions when the story passes through |
| Condition | 条件 | Branches on an expression (True / False) |
| Jump In / Jump Out | 跳转入口 / 跳转出口 | A numbered pair that continues the story elsewhere, also across chapters |
| Ending | 结局 | Ends a route |
| Choice | 选项 | An option the player picks; each has its own output port |
| Layer | 图层 | One element of a scene: background, character, text… |
| Composition | 合成 | The arrangement of layers in a scene; a *reusable composition* can be placed in many scenes |
| Portrait | 立绘 | One image of a character (a pose or face) |
| Skeleton / Bone / Part | 骨骼 / 骨头 / 部件 | A character's tree of bones with image parts, built in the Character studio or imported from Spine |
| Motion | 动作 | A character animation: keyframes of the skeleton, or an image sequence; one motion is the idle motion |
| Expression | 表情 | Changes to a character's parts (images, opacity, small pose changes), or a portrait for characters without a skeleton |
| Scene preset | 场景（预设） | Elements saved to your library with their keys and interactions, added or switched as one group |
| Timeline | 时间轴 | Where animations are edited |
| Keyframe | 关键帧 | A value at a point in time |
| Interpolation / easing | 插值 / 缓动 | How a value moves between keyframes |
| Effect graph | 特效节点图 | A node graph that processes a layer's image |
| Driver | 驱动 | An effect node that sets a layer property each frame |
| Interaction / script | 交互 / 脚本 | A stack of visual-scripting blocks |
| Block | 积木 | One step of a script |
| Trigger (hat block) | 触发积木 | The “When …” block that starts a script |
| Behavior | 行为 | A reusable script |
| Variable | 变量 | A value the story remembers (game, persistent or scene scope) |
| Module | 模块 | An extension that adds features to the editor and/or the game |
| Node module (component) | 节点模块 | Module settings attached to one node, edited in its Modules tab |
| Preview | 预览 | Playing the story inside the editor |
| Export | 导出 | Building the standalone game |
| Problems list | 问题列表 | Validation errors and warnings |
