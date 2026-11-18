#!/bin/bash
# Run once after dragging Ruhwell Front Desk into Applications.
# macOS blocks apps that aren't from the App Store; this clears that flag for this app only.
APP="/Applications/Ruhwell Front Desk.app"
if [ ! -d "$APP" ]; then
  echo "Drag Ruhwell Front Desk into Applications first, then run this again."
  read -n 1 -s -r -p "Press any key to close"; exit 1
fi
xattr -cr "$APP" && open "$APP" && echo "Done. You can close this window."
