#!/bin/zsh

SERVICE="com.atlas.app"

if launchctl remove "$SERVICE" >/dev/null 2>&1; then
  echo "Atlas Dashboard stopped."
else
  echo "Atlas Dashboard is not running."
fi
