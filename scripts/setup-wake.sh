#!/bin/bash
# Boost: Configure passwordless sudo for wakeOnSchedule feature.
# Enables pmset wake scheduling and the DarkWake→FullWake kicker daemon.
#
# Usage: sudo bash scripts/setup-wake.sh
# Or:    curl -fsSL <raw-url> | sudo bash
set -euo pipefail

USER_NAME="${SUDO_USER:-$(logname 2>/dev/null || echo "")}"
if [ -z "$USER_NAME" ]; then
  echo "Error: Could not determine the target user."
  echo "Run this script with: sudo bash $0"
  exit 1
fi

if [ "$(id -u)" -ne 0 ]; then
  echo "Error: This script must be run as root."
  echo "Run with: sudo bash $0"
  exit 1
fi

SUDOERS_FILE="/etc/sudoers.d/boost"
DAEMON_PLIST="/Library/LaunchDaemons/com.claude.boost.wake-kicker.plist"

cat > "$SUDOERS_FILE" <<EOF
# Boost: wakeOnSchedule support for Claude Code scheduled tasks.
# Installed by: scripts/setup-wake.sh

# pmset wake scheduling
$USER_NAME ALL=(root) NOPASSWD: /usr/bin/pmset schedule *

# Wake-kicker LaunchDaemon lifecycle
$USER_NAME ALL=(root) NOPASSWD: /bin/cp /tmp/com.claude.boost.wake-kicker.plist $DAEMON_PLIST
$USER_NAME ALL=(root) NOPASSWD: /bin/chmod 644 $DAEMON_PLIST
$USER_NAME ALL=(root) NOPASSWD: /usr/sbin/chown root\:wheel $DAEMON_PLIST
$USER_NAME ALL=(root) NOPASSWD: /bin/launchctl bootstrap system $DAEMON_PLIST
$USER_NAME ALL=(root) NOPASSWD: /bin/launchctl bootout system/com.claude.boost.wake-kicker
$USER_NAME ALL=(root) NOPASSWD: /bin/rm $DAEMON_PLIST
EOF

chmod 440 "$SUDOERS_FILE"
chown root:wheel "$SUDOERS_FILE"

# Validate the sudoers file
if ! visudo -cf "$SUDOERS_FILE" >/dev/null 2>&1; then
  echo "Error: Generated sudoers file is invalid. Removing it."
  rm -f "$SUDOERS_FILE"
  exit 1
fi

echo "Done. wakeOnSchedule is now configured for user '$USER_NAME'."
echo ""
echo "Installed: $SUDOERS_FILE"
echo "Granted passwordless sudo for:"
echo "  - pmset schedule (wake events)"
echo "  - LaunchDaemon install/remove (DarkWake promotion)"
echo ""
echo "To remove: sudo rm $SUDOERS_FILE"
