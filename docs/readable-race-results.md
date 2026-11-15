# Readable timing and results

The result overlay previously relied on a world gradient sharing `#race::after` with speed feedback. Results could consequently lose their surface and place dark numbers directly over grass and asphalt.

Timing now has its own small dark-green surface with cream tabular monospace digits. The finish panel has an opaque cream surface, dark-green digits, no negative number spacing, and a bounded responsive size. Its layout remains an overlay and does not change the finish camera.

Validated in actual desktop/mobile finishes, restart and four start-screen sizes (12 browser cases). Result screenshots confirm clear contrast independently of scenery. No movement or scoring changes.
