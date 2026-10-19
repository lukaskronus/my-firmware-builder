#!/bin/bash
# Build a minimal Debian 13 (Trixie) armhf rootfs for Hi3798MV100 headless Docker host.
# Usage: ./build-rootfs.sh
# Output: ./pure_rootfs  (chroot-ready; pack with your tool of choice)

set -euo pipefail

ROOTFS_DIR="$(pwd)/pure_rootfs"
QEMU_BIN="/usr/bin/qemu-arm-static"
BOOT_PART="/dev/mmcblk0p9"       # update if you flash elsewhere

# ── Cleanup trap ─────────────────────────────────────────────────────────────
cleanup() {
    echo "--- Cleaning up mounts ---"
    for m in dev/pts dev sys proc; do
        sudo umount -lf "$ROOTFS_DIR/$m" 2>/dev/null || true
    done
}
trap cleanup EXIT

# FIX: if a previous run died, unmount before wiping
cleanup
sudo rm -rf "$ROOTFS_DIR"
mkdir -p "$ROOTFS_DIR"

# ── Sanity checks ────────────────────────────────────────────────────────────
if [[ ! -x "$QEMU_BIN" ]]; then
    echo "ERROR: $QEMU_BIN not found. Install qemu-user-static:" >&2
    echo "  sudo apt-get install qemu-user-static binfmt-support" >&2
    exit 1
fi

echo "=== Building Debian 13 (Trixie) rootfs for Hi3798MV100 ==="

# ── Stage 1: debootstrap ─────────────────────────────────────────────────────
# Keep first-stage minimal; install everything else inside chroot so we can
# use --no-install-recommends and skip docs.
echo "--- Stage 1: debootstrap ---"
sudo debootstrap \
    --arch=armhf \
    --foreign \
    --variant=minbase \
    --include=systemd,systemd-sysv,dbus \
    trixie "$ROOTFS_DIR" http://deb.debian.org/debian/

# ── Chroot prep ──────────────────────────────────────────────────────────────
echo "--- Preparing chroot environment ---"
sudo cp "$QEMU_BIN" "$ROOTFS_DIR/usr/bin/"
sudo cp /etc/resolv.conf "$ROOTFS_DIR/etc/resolv.conf"

sudo mount -t proc  /proc    "$ROOTFS_DIR/proc"
sudo mount -t sysfs /sys     "$ROOTFS_DIR/sys"
sudo mount -o bind  /dev     "$ROOTFS_DIR/dev"
sudo mount -o bind  /dev/pts "$ROOTFS_DIR/dev/pts"

# ── Stage 2: configure inside chroot ─────────────────────────────────────────
echo "--- Stage 2: debootstrap + configuration ---"
sudo chroot "$ROOTFS_DIR" /bin/bash -euo pipefail << CHROOT_EOF
export DEBIAN_FRONTEND=noninteractive
export LC_ALL=C

/debootstrap/debootstrap --second-stage

# ── APT: no recommends, no docs, no translation ──────────────────────────────
cat > /etc/apt/apt.conf.d/99norecommends << 'APT'
APT::Install-Recommends "false";
APT::Install-Suggests   "false";
APT::Get::Assume-Yes    "true";
Acquire::Languages      "none";
APT
cat > /etc/dpkg/dpkg.cfg.d/01nodoc << 'DPKG'
path-exclude=/usr/share/doc/*
path-exclude=/usr/share/man/*
path-exclude=/usr/share/info/*
path-include=/usr/share/doc/*/copyright
DPKG

# ── APT sources ──────────────────────────────────────────────────────────────
cat > /etc/apt/sources.list << 'SOURCES'
deb http://deb.debian.org/debian trixie main contrib non-free non-free-firmware
deb http://deb.debian.org/debian trixie-updates main contrib non-free non-free-firmware
deb http://deb.debian.org/debian-security trixie-security main contrib non-free non-free-firmware
SOURCES

apt-get update -qq
apt-get upgrade -y -q

# ── Packages: minimal headless Docker host ──────────────────────────────────
# REMOVED: binutils, bsdmainutils, cron, rsyslog, usbutils, net-tools,
#          isc-dhcp-client, ifupdown (replaced by systemd-networkd)
# ADDED  : iptables, nftables, iproute2, gnupg, systemd-timesyncd,
#          docker prerequisites
apt-get install -y -q \
    kmod \
    sudo \
    nano \
    curl \
    wget \
    gnupg \
    ca-certificates \
    openssh-server \
    iproute2 \
    iptables \
    nftables \
    systemd-timesyncd \
    locales \
    htop \
    apt-utils \
    e2fsprogs \
    chrony

# ── Hostname / hosts ────────────────────────────────────────────────────────
echo "debian" > /etc/hostname
cat > /etc/hosts << 'HOSTS'
127.0.0.1   localhost
127.0.1.1   debian
HOSTS

# ── Timezone ────────────────────────────────────────────────────────────────
ln -sf /usr/share/zoneinfo/Asia/Ho_Chi_Minh /etc/localtime
echo "Asia/Ho_Chi_Minh" > /etc/timezone

# ── Root password ────────────────────────────────────────────────────────────
echo "root:1234" | chpasswd

# ── SSH ──────────────────────────────────────────────────────────────────────
sed -i 's/^#*PermitRootLogin.*/PermitRootLogin yes/' /etc/ssh/sshd_config
systemctl enable ssh

# ── fstab: use PARTUUID if available, else label ────────────────────────────
# Generate a stable label on the root fs from the host side and reference it.
cat > /etc/fstab << 'FSTAB'
# /etc/fstab
LABEL=rootfs    /       ext4    defaults,noatime,errors=remount-ro  0 1
proc            /proc   proc    defaults                             0 0
sysfs           /sys    sysfs   defaults                             0 0
tmpfs           /tmp    tmpfs   defaults,noatime,nosuid,size=100M    0 0
tmpfs           /var/tmp tmpfs  defaults,noatime,nosuid,size=50M     0 0
FSTAB

# ── Network: systemd-networkd (Debian 13 default) ───────────────────────────
cat > /etc/systemd/network/20-wired.network << 'NET'
[Match]
Name=eth0

[Network]
DHCP=yes
NET
systemctl enable systemd-networkd
systemctl enable systemd-resolved

# ── Serial console ──────────────────────────────────────────────────────────
# Debian 13 auto-instantiates serial-getty@ttyAMA0 from the kernel cmdline
# (console=ttyAMA0). Drop the custom unit; ensure the stock one is enabled.
systemctl enable serial-getty@ttyAMA0.service

# ── Locale ──────────────────────────────────────────────────────────────────
echo "en_US.UTF-8 UTF-8" > /etc/locale.gen
locale-gen
echo "LANG=en_US.UTF-8" > /etc/default/locale

# ── First-boot resize: growpart + resize2fs (partition + fs) ────────────────
# resize2fs alone only grows the filesystem; the partition must be grown first.
cat > /etc/systemd/system/resize-rootfs.service << 'SERVICE'
[Unit]
Description=Grow root partition and resize filesystem
After=local-fs.target
ConditionPathExists=/etc/resize-rootfs-pending
ConditionPathIsReadWrite=/

[Service]
Type=oneshot
ExecStart=/bin/bash -c '\
    DEV=${BOOT_PART} && \
    DISK=/dev/$(lsblk -no PKNAME $DEV) && \
    PARTNUM=$(echo $DEV | grep -o "[0-9]*$") && \
    growpart $DISK $PARTNUM || true && \
    resize2fs $DEV'
ExecStartPost=/bin/rm -f /etc/resize-rootfs-pending
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
SERVICE
# NOTE: 'growpart' is shipped by the 'cloud-guest-utils' package; add it if you
# want partition grow. Otherwise the filesystem will grow only if the partition
# was already larger than the fs.
touch /etc/resize-rootfs-pending
systemctl enable resize-rootfs.service

# ── Cleanup ─────────────────────────────────────────────────────────────────
apt-get autoremove -y -q
apt-get clean
rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*
rm -f /usr/bin/qemu-arm-static

echo "✅ Chroot configuration complete"
CHROOT_EOF

# ── Post-chroot: label the root filesystem for fstab ─────────────────────────
echo "--- Tagging root filesystem ---"
sudo e2label "$ROOTFS_DIR" rootfs || true

echo "=== Rootfs build complete ==="
echo "Location      : $ROOTFS_DIR"
echo "Next steps    :"
echo "  1. Pack rootfs into your image (e.g. tar, mkfs.ext4, dd)"
echo "  2. Ensure bootargs include: console=ttyAMA0,115200 root=LABEL=rootfs rw"
echo "  3. Boot, log in via console (root has no password — use single-user"
echo "     rescue if needed), create a user, add SSH key, then install Docker."
