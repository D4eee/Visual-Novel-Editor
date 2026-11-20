# Animation

Each scene can hold several **animations** (clips). Open the **Timeline** tab in the scene dock.

## Keyframes

- Create an animation with **+**, give it a name and a duration. Mark it **Autoplay** to start with the scene, or **Loop** to repeat.
- Select a layer. Click ◆ next to any animatable property in the inspector to set a keyframe at the playhead, or use **Animate a property** in the timeline.
- Switch on **Record** to create keyframes automatically whenever you move, scale or rotate a layer on the canvas or change a value in the inspector.
- Drag keyframes to retime them (Shift+click or box-select several). **Ctrl/⌘+C / V** copies and pastes keyframes at the playhead. **,** and **.** jump between keyframes.
- Colors and numbers interpolate; other values (text, images, booleans) switch at the keyframe.

Any property marked animatable can be keyed — transform, opacity, colors, text reveal, effect parameters, and properties added by modules (for example *Wobble* and *Float*).

## Interpolation and curves

Right-click a keyframe → **Interpolation** sets how the value travels to the next keyframe: *Linear*, *Hold* (step), *Ease in*, *Ease out*, *Ease in-out*, *Back*, *Elastic*, *Bounce* or a custom **Bezier** curve. **Edit easing curve…** opens a curve editor with two draggable handles. Modules can add curves (the Wobble example adds *Smoother step*).

## Audio and video on the timeline

Select an audio or video layer and choose **Sync with timeline**. Its clip appears in the timeline: drag it to set the start, drag its edges to trim. While you scrub, video frames follow the playhead; in the game the media starts and stops with the animation.

## Playing animations

- **Autoplay** clips start when the scene starts.
- Scripts: *Play animation* (optionally *and wait*), *Stop animation*, *When animation finishes*.
- Choices: a choice can play an animation when picked.
- *Tween* blocks animate one property without a clip, with any interpolation.

In the editor, **Play** in the timeline previews the clip on the canvas. **Preview** plays the scene for real.
