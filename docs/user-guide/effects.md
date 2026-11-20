# Effects

Effects are **node graphs** attached to a layer: the layer's image flows from **Layer image** (input) through filters into **Output**. Effects belong to an element. In the scene's **Timeline**, click ✦ on the element's row: pick a built-in preset or one of **My presets**, or (when the element already has an effect) **Edit effect graph**. With several elements selected, a preset goes on all of them. To affect the whole screen, add a shape that covers the screen and give it the effect.

## Start from a preset

Every preset is an editable graph: *Glow*, *Blur*, *Dreamy bloom*, *Old film*, *Heat wave*, *Ripple*, *Pulse (scale)* and *Spin* (drivers), *Mood from variable*, or an empty graph. Choose one, then adjust or extend it.

## Nodes

| Category | Nodes |
| --- | --- |
| Filter | Blur, Shadow, Glow, Vignette, Shader (custom GLSL) |
| Color | Color adjust, Grayscale, Sepia, Invert, Tint, Opacity |
| Distort | Pixelate, Wave, Ripple, Chromatic aberration |
| Generate | Noise, Gradient |
| Composite | Blend (modes), Mask, Shape mask |
| Value | Time, Number, Parameter, Variable, Layer property, Color |
| Math | Math, Oscillator, Map range, Smooth noise, Mix colors |
| Drive | Drive property, Drive color |

Connections are typed: image ports only accept images, numbers accept numbers. Value nodes can feed any number input, so an *Oscillator* can make a glow pulse, or a *Variable* can blur the screen as the player's stress rises.

**Drive** nodes do not change pixels: they set a property of this or another layer each frame (for example sway a character with an oscillator). They never feed back into themselves.

## Parameters

Add **parameters** to a graph to expose values as layer properties. Parameters can be keyed on the timeline (◆) and set from scripts, so "glitch amount" can be animated like any other property.

## Custom shaders

The *Shader* node runs a GLSL ES 1.0 fragment shader. Inputs: `uniform sampler2D u_image; uniform vec2 u_size; uniform float u_time; varying vec2 uv;`. Write to `gl_FragColor`. Compile errors are shown in the effect editor; the layer is drawn unchanged until the shader compiles.

## My presets

Save any effect you made as a preset and use it again — on other elements, in other scenes and in other projects.

- **Save** – in the effect editor click **Save as preset**, or click 🔖 on the effect's row in the Timeline, and give it a name. Using a name that already exists offers to replace that preset. For an effect linked to a shared effect, the element's current parameter values become the preset's defaults.
- **Use** – the ✦ menu and **Load preset** in the effect editor list **My presets** under the built-in ones. Applying a preset puts a copy of it on the element (it replaces the element's effect; **Undo** brings the old one back). Later changes to the preset do not change elements that already use it. Effect parameters keep their ids, so parameter keyframes on the Timeline keep working.
- **Manage** – **Manage presets…** (in the ✦ menu) lists your presets: rename them, add a description, see their nodes, parameters and the modules they use, apply one to the selected elements, or delete it.
- **Share** – **Save to file…** writes a `.vnefx` file; **Load from file…** adds `.vnefx` files to My presets (a preset with the same id is replaced).

Presets live in your user folder (`effect-presets/`), not in the project, so they are available in every project; projects only contain the copies applied to their elements. If a preset uses a module's effect nodes, a variable or another element that the current project does not have, a note after applying says what to turn on or pick again.

## Shared effects

**Save as shared effect** turns a graph into a project effect that several layers can link to — editing it updates all of them. **Make a local copy** detaches one layer.

Modules can add effect nodes and transitions; the *Retro FX* example adds *CRT scanlines*, *Posterize* and a *Pixel dissolve* scene transition.
