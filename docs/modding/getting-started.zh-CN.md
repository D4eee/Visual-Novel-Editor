# 模块开发快速上手

模块可以在不修改引擎的情况下扩展 Visual Novel Editor：新的剧情节点、图层类型、可做动画的属性、特效节点、转场、脚本积木、玩法系统、节点设置界面、编辑器面板、导入器和导出器。编辑器自带的功能也是通过同一套注册表实现的。

## 模块的结构

```
my-module/
  module.json        清单：id、版本、兼容范围、入口
  runtime.js         可选：在编辑器预览和导出的游戏中运行
  editor.js          可选：只在编辑器中运行（不会被导出）
  locales/en.json    界面文字
  locales/zh-CN.json
```

入口文件是普通的 ES 模块，不需要构建工具。

## 第一步：复制模板

```bash
cp -r templates/extension my-sparkle
```

修改 `module.json`。**id 一旦发布就不要再改**：项目会用 `<模块 id>/<本地 id>` 的形式保存你注册的类型。

```json
{
  "id": "io.github.yourname.sparkle",
  "name": { "en": "Sparkle", "zh-CN": "闪光" },
  "version": "0.1.0",
  "engine": ">=0.2.2 <2.0.0",
  "api": "^1.1.0",
  "runtime": "runtime.js",
  "editor": "editor.js",
  "locales": "locales",
  "provides": { "blocks": ["flash"], "panels": ["panel"] }
}
```

## 第二步：运行时部分

`runtime.js` 导出 `activate(api)`，这里注册一个「让图层闪一下」的积木：

```js
export function activate(api) {
  api.blocks.register({
    id: 'flash',
    category: 'looks',
    shape: 'statement',
    label: 'sparkle.flash',          // 在 locales 中写成 "让 {layer} 闪烁 {color}"
    args: [{ id: 'layer', type: 'layer' }, { id: 'color', type: 'string', default: '' }],
    async run(ctx, a) {
      if (!ctx.scene) return;
      const color = a.color || ctx.project.extensions[api.id]?.color || '#ffe066';
      ctx.scene.flash(color, 0.2);
      await ctx.scene.tween(a.layer, 'opacity', 0.3, 0.1);
      await ctx.scene.tween(a.layer, 'opacity', 1, 0.2);
    },
  });
}
```

积木文字中的 `{layer}` 会被替换成对应参数的输入框；参数类型是 `layer`，编辑器就会显示图层选择器。

## 第三步：编辑器部分

`editor.js` 导出 `activateEditor(api)`，在左侧栏加一个设置面板：

```js
import { ui } from './vendor/vne-sdk.js';

export function activateEditor(api) {
  api.panels.register({
    id: 'panel', title: 'sparkle.panel', icon: 'sparkles', location: 'sidebar',
    mount(el, ctx) {
      const render = () => {
        const data = ctx.project().extensions[api.id] || {};
        el.replaceChildren(ui.field(ctx.t('sparkle.color'), ui.color(data.color || '#ffe066', (v) =>
          ctx.update(ctx.t('sparkle.color'), (d) => { d.extensions[api.id] = { ...data, color: v }; }))));
      };
      render();
      return ctx.onChange(render);   // 撤销/重做后重新渲染；返回值用于清理
    },
  });
}
```

`ctx.update` 是可撤销的修改。`project.extensions[模块 id]` 中的数据会随项目保存，并随游戏一起导出。

## 第四步：安装并试用

1. 打开一个项目，打开「模块管理」，选择「从文件或文件夹安装…」，选中 `my-sparkle/module.json`。
2. 模块会被复制到项目的 `modules/` 文件夹并自动启用，左侧栏出现新的面板。
3. 打开场景的「交互」页，「外观」分类里就有新积木。
4. 预览场景。模块报错会显示在预览的「错误」页和模块管理中。

修改文件后重新安装，并在模块管理中点「重新加载模块」。

## 第五步：打包

```bash
npm run pack-module -- my-sparkle
# → dist/modules/io.github.yourname.sparkle-0.1.0.vnemod
```

打包前会检查清单、入口文件和语言文件。把 `.vnemod` 发给别人，对方用「从文件或文件夹安装…」即可，全程不需要联网。

## 继续阅读（英文）

- [运行时扩展](runtime.md)：节点、端口、图层、属性、插值、特效节点、转场、积木、节点模块、系统、函数
- [编辑器扩展](editor.md)：面板、检查器、节点界面、工作区、工具栏、导入器、导出器
- [数据、兼容性与安全](compatibility.md)
- [七个示例模块](../../examples/extensions)
