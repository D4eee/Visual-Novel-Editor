# Effects

Effects are **node graphs** attached to a layer: the layer's image flows from **Layer image** (input) through filters into **Output**. Effects belong to an element. In the scene's **Timeline**, click ✦ on the element's row: pick a preset, or open the effect graph editor if the element already has one. To affect the whole screen, add a shape that covers the screen and give it the effect.

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

## Shared effects

**Save as shared effect** turns a graph into a project effect that several layers can link to — editing it updates all of them. **Make a local copy** detaches one layer.

Modules can add effect nodes and transitions; the *Retro FX* example adds *CRT scanlines*, *Posterize* and a *Pixel dissolve* scene transition.
