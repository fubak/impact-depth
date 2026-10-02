# Plan 024 hull contrast

Target from Plan 022: in the underwater chase view, mean luminance of the player hull box over the surrounding ring is at least 1.4, at high and low quality, day and night.

A system Chrome session at `http://127.0.0.1:8098/` showed the chase view with the player hull readable against the water column and three contacts on the horizon. The canvas does not keep a drawing buffer, so this session did not compute the hull-box to ring ratio. No shader was changed. The number is not a lighting ACCEPT. Operator eye-pass stays pending.
