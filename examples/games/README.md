# Example games

Each folder with a `project.vne.json` appears on the editor's Home screen under **Examples** (use **Copy as new project** to get your own copy).

## Like Human

A short story in two chapters about Seven, a prototype android, and Mika, the engineer who built her. It exercises most features:

| Feature | Where |
| --- | --- |
| Branching with per-choice outputs, a hidden choice revealed by a script | *Awakening › Boot sequence* (click Mika) |
| Event, Condition, dice check (module story nodes with a data connection) | *Awakening › Calibrate*, *Empathy ≥ 2?*, *Calibration check* |
| Cross-chapter Jump In / Jump Out | *To the city* → *From the lab* |
| Keyframe animation, custom easing, text reveal, music that continues | *Boot sequence* |
| Effect graphs: inline (chromatic + CRT scanlines) and shared (*Old film*) | *Silence* (Seven), *Memory* (background) |
| Reusable behavior (*Glitch*) and composition (*Chapter title card*) | *Silence*, *Rooftop* |
| Video layer, timed choices module, Affection Branch node | *Memory*, *Does Mika trust Seven?* |
| Module layer (speech bubble), module properties (float, wobble), module transition (pixel dissolve) | *Boot sequence*, *Rooftop* |
| Three endings with persistent unlock variables | *Sleep mode*, *Like Human*, *Just a Machine* |

All images, music, sounds and the video were generated for this example and may be reused freely. The project is generated from code so it can be rebuilt reproducibly:

```bash
node examples/games/_sources/like-human/make.mjs            # needs rsvg-convert, python3 with numpy + Pillow, ffmpeg
node examples/games/_sources/like-human/make.mjs --skip-media  # only rebuild project.vne.json and modules
```
