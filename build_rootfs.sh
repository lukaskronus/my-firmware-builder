#!/bin/bash
set -e

# Cleanup trap - unmount everything if script exits for any reason
ROOTFS_DIR="$(pwd)/pure_rootfs"
cleanup() {
    echo "--- Cleaning up mounts ---"
    sudo umount -lf "$ROOTFS_DIR/dev/pts" 2>/dev/null || true
    sudo umount -lf "$ROOTFS_DIR/dev"     2>/dev/null || true
    sudo umount -lf "$ROOTFS_DIR/sys"     2>/dev/null || true
    sudo umount -lf "$ROOTFS_DIR/proc"    2>/dev/null || true
}
trap cleanup EXIT

echo "=== Building Debian 13 (Trixie) rootfs for Hi3798MV100 ==="

# ── 1. Prepare working directory ────────────────────────────────────────────
sudo rm -rf "$ROOTFS_DIR"
mkdir -p "$ROOTFS_DIR"

# ── 2. First stage debootstrap ───────────────────────────────────────────────
# Only include packages needed for first boot here.
# openssh-server, sudo etc. are added inside chroot to avoid duplication.
echo "--- Stage 1: debootstrap ---"
sudo debootstrap \
    --arch=armhf \
    --foreign \
    --variant=minbase \
    --include=systemd,systemd-sysv,dbus \
    trixie "$ROOTFS_DIR" http://deb.debian.org/debian/

# ── 3. Prepare chroot environment ────────────────────────────────────────────
echo "--- Preparing chroot environment ---"
sudo cp /usr/bin/qemu-arm-static "$ROOTFS_DIR/usr/bin/"
sudo cp /etc/resolv.conf "$ROOTFS_DIR/etc/resolv.conf"

sudo mount -t proc  /proc        "$ROOTFS_DIR/proc"
sudo mount -t sysfs /sys         "$ROOTFS_DIR/sys"
sudo mount -o bind  /dev         "$ROOTFS_DIR/dev"
sudo mount -o bind  /dev/pts     "$ROOTFS_DIR/dev/pts"

# ── 4. Second stage + configuration inside chroot ────────────────────────────
echo "--- Stage 2: debootstrap + configuration ---"
sudo chroot "$ROOTFS_DIR" /bin/bash << 'CHROOT_EOF'
set -e
export DEBIAN_FRONTEND=noninteractive
export LC_ALL=C

# Complete debootstrap second stage
/debootstrap/debootstrap --second-stage

# ── Apt sources ──────────────────────────────────────────────────────────────
cat > /etc/apt/sources.list << 'SOURCES'
deb http://deb.debian.org/debian trixie main contrib non-free non-free-firmware
deb http://deb.debian.org/debian trixie-updates main contrib non-free non-free-firmware
deb http://deb.debian.org/debian-security trixie-security main contrib non-free non-free-firmware
SOURCES

apt-get update -qq
apt-get upgrade -y -q

# ── Install packages ─────────────────────────────────────────────────────────
# Note: no initramfs-tools - kernel mounts rootfs directly via bootargs
apt-get install -y -q \
    kmod \
    sudo \
    nano \
    vim-tiny \
    curl \
    wget \
    ca-certificates \
    openssh-server \
    ifupdown \
    net-tools \
    iputils-ping \
    isc-dhcp-client \
    cron \
    rsyslog \
    locales \
    htop \
    binutils \
    bsdmainutils \
    apt-utils \
    e2fsprogs

# ── Hostname and hosts ───────────────────────────────────────────────────────
echo "debian" > /etc/hostname
cat > /etc/hosts << 'HOSTS'
127.0.0.1   localhost
127.0.1.1   debian
HOSTS

# ── Timezone ─────────────────────────────────────────────────────────────────
ln -sf /usr/share/zoneinfo/Asia/Ho_Chi_Minh /etc/localtime
echo "Asia/Ho_Chi_Minh" > /etc/timezone

# ── Root password ────────────────────────────────────────────────────────────
echo "root:1234" | chpasswd

# ── SSH ──────────────────────────────────────────────────────────────────────
sed -i 's/^#*PermitRootLogin.*/PermitRootLogin yes/' /etc/ssh/sshd_config
systemctl enable ssh

# ── fstab ────────────────────────────────────────────────────────────────────
cat > /etc/fstab << 'FSTAB'
# /etc/fstab
/dev/mmcblk0p9  /       ext4    defaults,noatime,errors=remount-ro  0 1
proc            /proc   proc    defaults                             0 0
sysfs           /sys    sysfs   defaults                             0 0
tmpfs           /tmp    tmpfs   defaults,noatime,nosuid,size=100M    0 0
tmpfs           /var/tmp tmpfs  defaults,noatime,nosuid,size=50M     0 0
FSTAB

# ── Network: DHCP on eth0 ────────────────────────────────────────────────────
mkdir -p /etc/network/interfaces.d
cat > /etc/network/interfaces.d/eth0 << 'ETH'
auto eth0
iface eth0 inet dhcp
ETH

# ── Serial console (systemd, NOT inittab) ────────────────────────────────────
# ttyAMA0 is the PL011 UART on Hi3798MV100
systemctl enable serial-getty@ttyAMA0.service

# ── Locale ───────────────────────────────────────────────────────────────────
echo "en_US.UTF-8 UTF-8" > /etc/locale.gen
locale-gen
echo "LANG=en_US.UTF-8" > /etc/default/locale

# ── First boot resize service ─────────────────────────────────────────────────
# Automatically expands the ext4 filesystem to fill mmcblk0p9 on first boot
cat > /etc/systemd/system/resize-rootfs.service << 'SERVICE'
[Unit]
Description=Resize root filesystem to fill partition
After=local-fs.target
ConditionPathExists=/etc/resize-rootfs-pending

[Service]
Type=oneshot
ExecStart=/sbin/resize2fs /dev/mmcblk0p9
ExecStartPost=/bin/rm -f /etc/resize-rootfs-pending
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
SERVICE

touch /etc/resize-rootfs-pending
systemctl enable resize-rootfs.service

# ── Cleanup ──────────────────────────────────────────────────────────────────
apt-get autoremove -y -q
apt-get clean
rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*
rm -f /usr/bin/qemu-arm-static

echo "✅ Chroot configuration complete"
CHROOT_EOF

echo "=== Rootfs build complete ==="
echo "Location : $ROOTFS_DIR"
echo "Root password : 1234  (change immediately after first boot)"