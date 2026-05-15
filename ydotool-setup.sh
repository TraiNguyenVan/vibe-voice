#!/usr/bin/env bash
# ydotool-setup.sh — One-shot setup for Fedora (Wayland/Hyprland)
# Usage: bash ydotool-setup.sh

set -euo pipefail

# ── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

ok()   { echo -e "${GREEN}  ✔ ${RESET}$*"; }
info() { echo -e "${CYAN}  → ${RESET}$*"; }
warn() { echo -e "${YELLOW}  ⚠ ${RESET}$*"; }
die()  { echo -e "${RED}  ✘ ${RESET}$*" >&2; exit 1; }
header() { echo -e "\n${BOLD}${CYAN}══ $* ${RESET}"; }

# ── Sanity checks ─────────────────────────────────────────────────────────────
[[ $EUID -eq 0 ]] && die "Đừng chạy script này bằng root. Chạy bằng user thường, script sẽ tự sudo khi cần."
command -v dnf &>/dev/null || die "Script này chỉ dành cho Fedora (dnf)."

USER_ID=$(id -u)
GROUP_ID=$(id -g)
CURRENT_USER=$(whoami)
SHELL_RC=""

# Detect shell rc file
if [[ "$SHELL" == *"zsh"* ]]; then
    SHELL_RC="$HOME/.zshrc"
elif [[ "$SHELL" == *"bash"* ]]; then
    SHELL_RC="$HOME/.bashrc"
else
    warn "Shell không phải zsh/bash. Mày tự thêm YDOTOOL_SOCKET vào shell config nhé."
fi

echo -e "\n${BOLD}╔══════════════════════════════════════════╗"
echo -e "║       ydotool setup — Fedora/Wayland     ║"
echo -e "╚══════════════════════════════════════════╝${RESET}"
echo -e "  User: ${BOLD}$CURRENT_USER${RESET}  (UID=$USER_ID GID=$GROUP_ID)"
echo -e "  Shell RC: ${BOLD}${SHELL_RC:-"(không tìm thấy)"}${RESET}\n"

# ── Step 1: Install ────────────────────────────────────────────────────────────
header "1/5 · Cài ydotool"

if rpm -q ydotool &>/dev/null; then
    ok "ydotool đã được cài rồi, bỏ qua."
else
    info "Đang cài ydotool..."
    sudo dnf install -y ydotool
    ok "Cài xong."
fi

# ── Step 2: Add user to input group ────────────────────────────────────────────
header "2/5 · Thêm user vào group 'input'"

if groups "$CURRENT_USER" | grep -q '\binput\b'; then
    ok "User đã trong group 'input' rồi."
else
    info "Đang thêm $CURRENT_USER vào group 'input'..."
    sudo usermod -aG input "$CURRENT_USER"
    ok "Xong. Cần logout/login lại để group có hiệu lực (sau khi script chạy xong)."
fi

# ── Step 3: udev rule ──────────────────────────────────────────────────────────
header "3/5 · Tạo udev rule cho /dev/uinput"

UDEV_RULE_FILE="/etc/udev/rules.d/70-uinput.rules"
UDEV_RULE_CONTENT='KERNEL=="uinput", GROUP="input", MODE="0660", OPTIONS+="static_node=uinput", TAG+="uaccess"'

if [[ -f "$UDEV_RULE_FILE" ]] && grep -q "uinput" "$UDEV_RULE_FILE"; then
    ok "udev rule đã tồn tại: $UDEV_RULE_FILE"
else
    info "Tạo $UDEV_RULE_FILE..."
    echo "$UDEV_RULE_CONTENT" | sudo tee "$UDEV_RULE_FILE" > /dev/null
    sudo udevadm control --reload-rules
    sudo udevadm trigger
    ok "udev rule đã tạo và reload xong."
fi

# ── Step 4: System service ─────────────────────────────────────────────────────
header "4/5 · Tạo system service (/etc/systemd/system/ydotool.service)"

SERVICE_FILE="/etc/systemd/system/ydotool.service"
SERVICE_CONTENT="[Unit]
Description=ydotool daemon (ydotoold)
After=network.target

[Service]
Type=simple
Restart=always
ExecStart=/usr/bin/ydotoold --socket-path=/tmp/.ydotool_socket --socket-own=${USER_ID}:${GROUP_ID}

[Install]
WantedBy=multi-user.target"

# Disable user service nếu đang enable (tránh conflict)
if systemctl --user is-enabled ydotool.service &>/dev/null; then
    info "Tắt user service cũ để tránh conflict..."
    systemctl --user disable --now ydotool.service 2>/dev/null || true
fi

info "Ghi $SERVICE_FILE..."
echo "$SERVICE_CONTENT" | sudo tee "$SERVICE_FILE" > /dev/null
sudo systemctl daemon-reload
sudo systemctl enable --now ydotool.service
ok "System service đã enable và start."

# Verify service is running
if sudo systemctl is-active ydotool.service &>/dev/null; then
    ok "ydotoold đang chạy."
else
    warn "Service có vẻ không start được. Kiểm tra: sudo systemctl status ydotool.service"
fi

# ── Step 5: Environment variable ───────────────────────────────────────────────
header "5/5 · Set YDOTOOL_SOCKET trong shell RC"

EXPORT_LINE='export YDOTOOL_SOCKET=/tmp/.ydotool_socket'

if [[ -n "$SHELL_RC" ]]; then
    if grep -q "YDOTOOL_SOCKET" "$SHELL_RC" 2>/dev/null; then
        ok "YDOTOOL_SOCKET đã có trong $SHELL_RC rồi."
    else
        info "Thêm vào $SHELL_RC..."
        echo "" >> "$SHELL_RC"
        echo "# ydotool socket" >> "$SHELL_RC"
        echo "$EXPORT_LINE" >> "$SHELL_RC"
        ok "Đã thêm vào $SHELL_RC."
    fi
fi

# Export ngay cho session hiện tại
export YDOTOOL_SOCKET=/tmp/.ydotool_socket

# ── Hyprland tip ───────────────────────────────────────────────────────────────
echo -e "\n${YELLOW}  ⚠  Hyprland tip:${RESET} Nếu gõ sai ký tự, thêm vào hyprland.conf:"
echo -e "     ${CYAN}device {"
echo -e "         name = ydotoold-virtual-device"
echo -e "         kb_layout = us"
echo -e "     }${RESET}"

# ── Final test ─────────────────────────────────────────────────────────────────
echo ""
header "Kiểm tra nhanh"

# Cho daemon khởi động hẳn
sleep 1

if YDOTOOL_SOCKET=/tmp/.ydotool_socket ydotool type "" &>/dev/null 2>&1; then
    ok "ydotool kết nối socket thành công!"
else
    # Socket có thể chưa kịp tạo nếu mới start service
    if [[ -S "/tmp/.ydotool_socket" ]]; then
        ok "Socket /tmp/.ydotool_socket tồn tại."
        warn "Thử test thủ công sau khi source shell RC: ydotool type 'hello'"
    else
        warn "Socket chưa thấy. Có thể cần logout/login lại (vì group 'input' vừa được thêm)."
    fi
fi

echo -e "\n${BOLD}${GREEN}✔ Setup hoàn tất!${RESET}"
echo -e "  Nếu đây là lần đầu thêm vào group 'input' → ${BOLD}logout và login lại${RESET}"
echo -e "  Sau đó test bằng: ${CYAN}ydotool type 'hello world'${RESET}\n"
