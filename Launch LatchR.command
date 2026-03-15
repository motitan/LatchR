#!/usr/bin/env bash

alert() {
  local message="$1"
  osascript -e "display alert \"$message\""
}

confirm_install() {
  local message="$1"
  local response
  response="$(osascript -e "display dialog \"$message\" buttons {\"Cancel\", \"Install\"} default button \"Install\"")" || return 1
  [[ "$response" == *"button returned:Install"* ]]
}

activate_terminal() {
  osascript -e 'tell application "Terminal" to activate' >/dev/null 2>&1 || true
}

find_brew() {
  if command -v brew >/dev/null 2>&1; then
    command -v brew
    return 0
  fi
  if [ -x /opt/homebrew/bin/brew ]; then
    echo "/opt/homebrew/bin/brew"
    return 0
  fi
  if [ -x /usr/local/bin/brew ]; then
    echo "/usr/local/bin/brew"
    return 0
  fi
  return 1
}

refresh_shellenv() {
  local brew_cmd="$1"
  eval "$("$brew_cmd" shellenv)" >/dev/null 2>&1 || true
  hash -r
}

install_homebrew() {
  if ! command -v curl >/dev/null 2>&1; then
    alert "curl not found. Install Homebrew manually from brew.sh, then try again."
    return 1
  fi
  activate_terminal
  echo "Installing Homebrew (this may prompt for your macOS password)..."
  if ! /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"; then
    return 1
  fi
  hash -r
  return 0
}

ensure_brew() {
  local brew_cmd
  brew_cmd="$(find_brew || true)"
  if [ -n "$brew_cmd" ]; then
    refresh_shellenv "$brew_cmd"
    echo "$brew_cmd"
    return 0
  fi

  if ! confirm_install "Homebrew is not installed. Install Homebrew automatically now?"; then
    return 1
  fi

  if ! install_homebrew; then
    alert "Homebrew install failed. Install Homebrew from brew.sh, then try again."
    return 1
  fi

  brew_cmd="$(find_brew || true)"
  if [ -z "$brew_cmd" ]; then
    alert "Homebrew install did not complete. Install Homebrew from brew.sh, then try again."
    return 1
  fi

  refresh_shellenv "$brew_cmd"
  echo "$brew_cmd"
  return 0
}

node_major_version() {
  if ! command -v node >/dev/null 2>&1; then
    echo ""
    return 0
  fi
  local node_version node_major
  node_version="$(node -v 2>/dev/null || true)"
  node_major="${node_version#v}"
  node_major="${node_major%%.*}"
  if [[ "$node_major" =~ ^[0-9]+$ ]]; then
    echo "$node_major"
    return 0
  fi
  echo ""
}

has_node_20_plus() {
  local major
  major="$(node_major_version)"
  [[ -n "$major" && "$major" -ge 20 ]]
}

install_brew_package() {
  local brew_cmd="$1"
  local pkg="$2"
  activate_terminal
  echo "Installing $pkg with Homebrew..."
  "$brew_cmd" install "$pkg"
}

cd "$(dirname "$0")" || {
  alert "Unable to open app folder."
  exit 1
}

if ! has_node_20_plus; then
  brew_cmd="$(ensure_brew || true)"
  if [ -z "$brew_cmd" ]; then
    alert "Node.js not found. Install Node.js 20+ from nodejs.org then try again."
    exit 1
  fi
  if ! confirm_install "Node.js 20+ is required. Install automatically now with Homebrew?"; then
    alert "Node.js not found. Install Node.js 20+ from nodejs.org then try again."
    exit 1
  fi
  refresh_shellenv "$brew_cmd"
  if ! install_brew_package "$brew_cmd" node; then
    alert "Node.js install failed. Install Node.js 20+ from nodejs.org then try again."
    exit 1
  fi
  refresh_shellenv "$brew_cmd"
  if ! has_node_20_plus; then
    alert "Node.js version too old. Please install Node.js 20+ from nodejs.org."
    exit 1
  fi
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
  brew_cmd="${brew_cmd:-$(ensure_brew || true)}"
  if [ -z "$brew_cmd" ]; then
    alert "ffmpeg not found. Open Terminal and run: brew install ffmpeg"
    exit 1
  fi
  if ! confirm_install "ffmpeg is required. Install automatically now with Homebrew?"; then
    alert "ffmpeg not found. Open Terminal and run: brew install ffmpeg"
    exit 1
  fi
  refresh_shellenv "$brew_cmd"
  if ! install_brew_package "$brew_cmd" ffmpeg; then
    alert "ffmpeg not found. Open Terminal and run: brew install ffmpeg"
    exit 1
  fi
  refresh_shellenv "$brew_cmd"
  if ! command -v ffmpeg >/dev/null 2>&1; then
    alert "ffmpeg not found. Open Terminal and run: brew install ffmpeg"
    exit 1
  fi
fi

if ! command -v npm >/dev/null 2>&1; then
  alert "npm not found. Reinstall Node.js 20+ then try again."
  exit 1
fi

if [ ! -d "node_modules" ]; then
  activate_terminal
  echo "node_modules not found. Installing dependencies..."
  if ! npm install; then
    alert "npm install failed. Check Terminal output and try again."
    exit 1
  fi
fi

if ! npm start; then
  alert "Failed to start app. Check Terminal output and try again."
  exit 1
fi
