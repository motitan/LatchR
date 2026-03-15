#!/usr/bin/env bash

alert() {
  local message="$1"
  osascript -e "display alert \"$message\""
}

choose_project() {
  osascript <<'APPLESCRIPT'
set defaultProjects to (POSIX file ((POSIX path of (path to home folder)) & "LatchR/projects/"))
try
  set chosenItem to choose file with prompt "Choose a LatchR project package or project JSON" default location defaultProjects
on error
  return ""
end try
return POSIX path of chosenItem
APPLESCRIPT
}

find_app() {
  local here_dir="$1"
  local candidates=(
    "$here_dir/LatchR.app"
    "/Applications/LatchR.app"
    "$here_dir/dist/LatchR.app"
  )
  local candidate
  for candidate in "${candidates[@]}"; do
    if [ -d "$candidate" ]; then
      echo "$candidate"
      return 0
    fi
  done
  return 1
}

main() {
  local here_dir app_path target_path
  here_dir="$(cd "$(dirname "$0")" && pwd)"
  app_path="$(find_app "$here_dir" || true)"
  if [ -z "$app_path" ]; then
    alert "LatchR.app not found. Put this script next to LatchR.app or install LatchR.app in /Applications."
    exit 1
  fi

  target_path="${1:-}"
  if [ -z "$target_path" ]; then
    target_path="$(choose_project | tr -d '\r' || true)"
  fi

  if [ -z "$target_path" ]; then
    exit 0
  fi
  if [ ! -e "$target_path" ]; then
    alert "Project not found: $target_path"
    exit 1
  fi

  open -a "$app_path" "$target_path"
}

main "$@"
